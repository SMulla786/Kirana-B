import crypto from 'node:crypto';
import jwt, {TokenExpiredError} from 'jsonwebtoken';
import httpStatus from 'http-status';
import {config} from '@config/index';
import ApiError from '@utils/ApiError';
import prisma from '../client';

export const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
export const randomToken = () => crypto.randomBytes(32).toString('base64url');

const safeEqual = (a: string, b: string) =>
    a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

const unauthorized = (message = 'Session expired. Please log in again') =>
    new ApiError(httpStatus.UNAUTHORIZED, message);

type NewSession = {
    userId: string;
    kiranaId?: string | null;
    storeId?: string | null;
    deviceName?: string | null;
    userAgent?: string | null;
    ip?: string | null;
};

class TokenService {
    public signAccessToken(userId: string, sessionId: string) {
        const minutes = config.jwt.accessExpirationMinutes;
        const accessToken = jwt.sign({sid: sessionId, typ: 'access'}, config.jwt.secret, {
            algorithm: 'HS256',
            subject: userId,
            expiresIn: `${minutes}m`,
        });
        return {accessToken, accessTokenExpiresAt: new Date(Date.now() + minutes * 60_000)};
    }

    public verifyAccessToken(token: string): {userId: string; sessionId: string} {
        let payload: string | jwt.JwtPayload;
        try {
            payload = jwt.verify(token, config.jwt.secret, {algorithms: ['HS256']});
        } catch (error) {
            throw unauthorized(
                error instanceof TokenExpiredError ? 'Token expired' : 'Invalid token',
            );
        }
        if (
            typeof payload === 'string' ||
            payload.typ !== 'access' ||
            typeof payload.sub !== 'string' ||
            typeof payload.sid !== 'string'
        ) {
            throw unauthorized('Invalid token');
        }
        return {userId: payload.sub, sessionId: payload.sid};
    }

    /** Refresh token = `<sessionId>.<random secret>`; only sha256(secret) is stored. */
    public async createSession(data: NewSession) {
        const secret = randomToken();
        const session = await prisma.session.create({
            data: {
                ...data,
                refreshTokenHash: sha256(secret),
                expiresAt: new Date(Date.now() + config.jwt.refreshExpirationDays * 86_400_000),
            },
        });
        return {
            session,
            refreshToken: `${session.id}.${secret}`,
            ...this.signAccessToken(data.userId, session.id),
        };
    }

    /** Rotates the refresh token. Presenting an already-rotated token revokes the session. */
    public async rotateSession(refreshToken: string) {
        const [sessionId, secret] = refreshToken.split('.');
        if (!sessionId || !secret) throw unauthorized();
        const session = await prisma.session.findUnique({where: {id: sessionId}});
        const now = new Date();
        if (!session || session.revokedAt || session.expiresAt <= now) throw unauthorized();

        if (!safeEqual(sha256(secret), session.refreshTokenHash)) {
            await this.revokeSession(session.id);
            throw unauthorized();
        }

        const nextSecret = randomToken();
        // compare-and-swap: two concurrent refreshes with the same token cannot both win
        const {count} = await prisma.session.updateMany({
            where: {id: session.id, refreshTokenHash: session.refreshTokenHash, revokedAt: null},
            data: {refreshTokenHash: sha256(nextSecret), lastUsedAt: now},
        });
        if (count !== 1) throw unauthorized();

        return {
            session,
            refreshToken: `${session.id}.${nextSecret}`,
            ...this.signAccessToken(session.userId, session.id),
        };
    }

    public async revokeSession(sessionId: string, userId?: string) {
        const {count} = await prisma.session.updateMany({
            where: {id: sessionId, ...(userId && {userId}), revokedAt: null},
            data: {revokedAt: new Date()},
        });
        return count;
    }

    public async revokeUserSessions(
        userId: string,
        options: {exceptSessionId?: string; kiranaId?: string} = {},
    ) {
        await prisma.session.updateMany({
            where: {
                userId,
                revokedAt: null,
                ...(options.exceptSessionId && {id: {not: options.exceptSessionId}}),
                ...(options.kiranaId && {kiranaId: options.kiranaId}),
            },
            data: {revokedAt: new Date()},
        });
    }

    public listActiveSessions(userId: string) {
        return prisma.session.findMany({
            where: {userId, revokedAt: null, expiresAt: {gt: new Date()}},
            select: {
                id: true,
                deviceName: true,
                userAgent: true,
                ip: true,
                createdAt: true,
                lastUsedAt: true,
            },
            orderBy: {lastUsedAt: 'desc'},
        });
    }
}

export default new TokenService();
