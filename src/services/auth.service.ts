import httpStatus from 'http-status';
import {z} from 'zod';
import {MembershipRole, Role, User} from '@prisma/client';
import {config, logger} from '@config/index';
import {ROLE_PERMISSIONS} from '@config/permissions';
import {ApiError, encryptPassword, isPasswordMatch} from '@utils/index';
import {userValidation} from '@validations/index';
import tokenService, {randomToken, sha256} from './token.service';
import emailService from './email.service';
import businessService, {generateVerificationCode, VERIFY_CODE_TTL_MS} from './business.service';
import prisma from '../client';

type RegisterInput = z.infer<typeof userValidation.registerSchema>;
type LoginInput = z.infer<typeof userValidation.loginSchema>;
type UpdateMe = z.infer<typeof userValidation.updateMeSchema>;
type ClientInfo = {userAgent?: string; ip?: string};
type MeUser = Pick<User, 'id' | 'username' | 'email' | 'fullname' | 'phoneNumber' | 'role'>;
type Tenant = {kiranaId: string; storeId: string | null; membershipRole: MembershipRole};

const invalidCredentials = () => new ApiError(httpStatus.UNAUTHORIZED, 'Invalid credentials');

class AuthService {
    // Compared against when the user does not exist, so both paths cost one bcrypt check.
    private dummyHash = encryptPassword(randomToken());

    public async register(data: RegisterInput) {
        const {user, verifyCode} = await businessService.createBusinessWithOwner(data, {
            verified: false,
        });
        const sent = await emailService.sendVerificationEmail(
            user.email,
            user.username,
            verifyCode!,
        );
        if (!sent.success) logger.warn(`Verification email not sent for user ${user.id}`);
        return {user: {id: user.id, username: user.username, email: user.email}};
    }

    public async verifyCode(username: string, code: string) {
        const user = await prisma.user.findUnique({where: {username}});
        if (
            !user ||
            user.isVerified ||
            user.verifyCode !== code ||
            !user.verifyCodeExpiry ||
            user.verifyCodeExpiry <= new Date()
        ) {
            throw new ApiError(httpStatus.BAD_REQUEST, 'Invalid or expired verification code');
        }
        await prisma.user.update({
            where: {id: user.id},
            data: {isVerified: true, verifyCode: null, verifyCodeExpiry: null},
        });
    }

    /** Always succeeds from the caller's view, so it cannot be used to probe accounts. */
    public async resendCode(username: string) {
        const user = await prisma.user.findUnique({where: {username}});
        if (!user || user.isVerified) return;
        const verifyCode = generateVerificationCode();
        await prisma.user.update({
            where: {id: user.id},
            data: {verifyCode, verifyCodeExpiry: new Date(Date.now() + VERIFY_CODE_TTL_MS)},
        });
        await emailService.sendVerificationEmail(user.email, user.username, verifyCode);
    }

    public async login(data: LoginInput, client: ClientInfo) {
        const where = data.identifier.includes('@')
            ? {email: data.identifier.toLowerCase()}
            : {username: data.identifier};
        const user = await prisma.user.findUnique({where});
        const matches = await isPasswordMatch(
            data.password,
            user?.password ?? (await this.dummyHash),
        );
        if (!user || !matches) throw invalidCredentials();
        // Only revealed after a correct password.
        if (!user.isActive) throw new ApiError(httpStatus.FORBIDDEN, 'Account is disabled');
        if (!user.isVerified) throw new ApiError(httpStatus.FORBIDDEN, 'Email is not verified');

        const tenant = await this.resolveTenant(user, data.kiranaId);
        const tokens = await tokenService.createSession({
            userId: user.id,
            kiranaId: tenant?.kiranaId,
            storeId: tenant?.storeId,
            deviceName: data.deviceName,
            userAgent: client.userAgent?.slice(0, 300),
            ip: client.ip,
        });
        return {...tokens, me: await this.buildMe(user, tenant)};
    }

    /** Picks the business for this session from the user's active memberships. */
    private async resolveTenant(user: User, kiranaId?: string): Promise<Tenant | null> {
        const memberships = await prisma.membership.findMany({
            where: {userId: user.id, isActive: true},
            select: {
                role: true,
                kirana: {
                    select: {
                        id: true,
                        name: true,
                        stores: {where: {isDefault: true}, select: {id: true}, take: 1},
                    },
                },
            },
            orderBy: {createdAt: 'asc'},
        });
        if (!memberships.length) {
            if (user.role === Role.ADMIN && !kiranaId) return null;
            throw new ApiError(httpStatus.FORBIDDEN, 'No active business access');
        }
        const chosen = kiranaId
            ? memberships.find((m) => m.kirana.id === kiranaId)
            : memberships.length === 1
              ? memberships[0]
              : undefined;
        if (kiranaId && !chosen) {
            throw new ApiError(httpStatus.FORBIDDEN, 'No access to this business');
        }
        if (!chosen) {
            throw new ApiError(
                httpStatus.CONFLICT,
                'Select a business',
                memberships.map((m) => ({id: m.kirana.id, name: m.kirana.name})),
            );
        }
        return {
            kiranaId: chosen.kirana.id,
            storeId: chosen.kirana.stores[0]?.id ?? null,
            membershipRole: chosen.role,
        };
    }

    public async buildMe(user: MeUser, tenant: Tenant | null) {
        const [business, store] = tenant
            ? await Promise.all([
                  prisma.kirana.findUnique({
                      where: {id: tenant.kiranaId},
                      select: {id: true, name: true},
                  }),
                  tenant.storeId
                      ? prisma.store.findUnique({
                            where: {id: tenant.storeId},
                            select: {id: true, name: true},
                        })
                      : null,
              ])
            : [null, null];
        const {id, username, email, fullname, phoneNumber, role} = user;
        return {
            user: {id, username, email, fullname, phoneNumber, role},
            business,
            store,
            membershipRole: tenant?.membershipRole ?? null,
            permissions: tenant ? [...ROLE_PERMISSIONS[tenant.membershipRole]] : [],
        };
    }

    public async refresh(refreshToken: string) {
        const result = await tokenService.rotateSession(refreshToken);
        const {session} = result;
        const user = await prisma.user.findUnique({
            where: {id: session.userId},
            select: {isActive: true},
        });
        const membership = session.kiranaId
            ? await prisma.membership.findUnique({
                  where: {userId_kiranaId: {userId: session.userId, kiranaId: session.kiranaId}},
                  select: {isActive: true},
              })
            : {isActive: true};
        if (!user?.isActive || !membership?.isActive) {
            await tokenService.revokeSession(session.id);
            throw new ApiError(httpStatus.UNAUTHORIZED, 'Session expired. Please log in again');
        }
        return {
            accessToken: result.accessToken,
            accessTokenExpiresAt: result.accessTokenExpiresAt,
            refreshToken: result.refreshToken,
            refreshTokenExpiresAt: session.expiresAt,
        };
    }

    /** Revokes the session named by a refresh token, if it is genuine. Never throws. */
    public async logout(refreshToken?: string) {
        const [sessionId, secret] = refreshToken?.split('.') ?? [];
        if (!sessionId || !secret) return;
        await prisma.session.updateMany({
            where: {id: sessionId, refreshTokenHash: sha256(secret), revokedAt: null},
            data: {revokedAt: new Date()},
        });
    }

    public async listSessions(userId: string, currentSessionId: string) {
        const sessions = await tokenService.listActiveSessions(userId);
        return sessions.map((s) => ({...s, current: s.id === currentSessionId}));
    }

    public revokeAllSessions(userId: string) {
        return tokenService.revokeUserSessions(userId);
    }

    public async revokeSession(userId: string, sessionId: string) {
        const count = await tokenService.revokeSession(sessionId, userId);
        if (!count) throw new ApiError(httpStatus.NOT_FOUND, 'Session not found');
    }

    /** Always succeeds from the caller's view (no account enumeration). */
    public async forgotPassword(email: string) {
        const user = await prisma.user.findUnique({where: {email}});
        if (!user || !user.isVerified || !user.isActive) return;
        const token = randomToken();
        await prisma.user.update({
            where: {id: user.id},
            data: {
                passwordResetTokenHash: sha256(token),
                passwordResetExpiry: new Date(
                    Date.now() + config.jwt.resetPasswordExpirationMinutes * 60_000,
                ),
            },
        });
        const sent = await emailService.sendResetPasswordEmail(user.email, token);
        if (!sent.success) logger.warn(`Reset email not sent for user ${user.id}`);
    }

    /** Single use: the hash is cleared in the same conditional update that sets the password. */
    public async resetPassword(token: string, newPassword: string) {
        const tokenHash = sha256(token);
        const invalid = () => new ApiError(httpStatus.BAD_REQUEST, 'Invalid or expired reset link');
        const user = await prisma.user.findUnique({where: {passwordResetTokenHash: tokenHash}});
        if (!user?.passwordResetExpiry || user.passwordResetExpiry <= new Date()) throw invalid();

        const password = await encryptPassword(newPassword);
        await prisma.$transaction(async (tx) => {
            const {count} = await tx.user.updateMany({
                where: {id: user.id, passwordResetTokenHash: tokenHash},
                data: {password, passwordResetTokenHash: null, passwordResetExpiry: null},
            });
            if (count !== 1) throw invalid();
            await tx.session.updateMany({
                where: {userId: user.id, revokedAt: null},
                data: {revokedAt: new Date()},
            });
        });
    }

    /** Keeps the current session and signs out every other device. */
    public async changePassword(
        userId: string,
        sessionId: string,
        currentPassword: string,
        newPassword: string,
    ) {
        const user = await prisma.user.findUniqueOrThrow({where: {id: userId}});
        if (!(await isPasswordMatch(currentPassword, user.password))) {
            // 400, not 401: a 401 would make clients try a token refresh
            throw new ApiError(httpStatus.BAD_REQUEST, 'Current password is incorrect');
        }
        await prisma.user.update({
            where: {id: userId},
            data: {password: await encryptPassword(newPassword)},
        });
        await tokenService.revokeUserSessions(userId, {exceptSessionId: sessionId});
    }

    public updateMe(userId: string, data: UpdateMe) {
        return prisma.user.update({
            where: {id: userId},
            data,
            select: {
                id: true,
                username: true,
                email: true,
                fullname: true,
                phoneNumber: true,
                secondaryPhoneNumber: true,
            },
        });
    }
}

export default new AuthService();
