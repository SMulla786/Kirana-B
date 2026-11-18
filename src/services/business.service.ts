import crypto from 'node:crypto';
import httpStatus from 'http-status';
import {z} from 'zod';
import {MembershipRole, Role} from '@prisma/client';
import {canAssignRole} from '@config/permissions';
import {ApiError, encryptPassword} from '@utils/index';
import {businessValidation, userValidation} from '@validations/index';
import tokenService from './token.service';
import prisma from '../client';

type RegisterInput = z.infer<typeof userValidation.registerSchema>;
type UpdateBusiness = z.infer<typeof businessValidation.updateBusinessSchema>;
type AddMember = z.infer<typeof businessValidation.addMemberSchema>;
type UpdateMember = z.infer<typeof businessValidation.updateMemberSchema>;

export const VERIFY_CODE_TTL_MS = 60 * 60 * 1000;
export const generateVerificationCode = () =>
    crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');

const memberSelect = {
    id: true,
    role: true,
    isActive: true,
    createdAt: true,
    user: {select: {id: true, username: true, fullname: true, email: true, phoneNumber: true}},
} as const;

const forbidden = (message = 'You do not have permission for this action') =>
    new ApiError(httpStatus.FORBIDDEN, message);

class BusinessService {
    /**
     * Atomically creates the owner login, the business, its default store and the OWNER
     * membership. Self-signup passes verified=false (email code); platform admins pass true.
     */
    public async createBusinessWithOwner(data: RegisterInput, options: {verified: boolean}) {
        const {business, password, ...userData} = data;
        const hashedPassword = await encryptPassword(password); // outside the transaction: slow
        const verifyCode = options.verified ? null : generateVerificationCode();

        return prisma.$transaction(async (tx) => {
            const user = await tx.user.create({
                data: {
                    ...userData,
                    password: hashedPassword,
                    role: Role.KIRANA,
                    isVerified: options.verified,
                    verifyCode,
                    verifyCodeExpiry: verifyCode ? new Date(Date.now() + VERIFY_CODE_TTL_MS) : null,
                },
            });
            const kirana = await tx.kirana.create({data: {...business, userId: user.id}});
            const store = await tx.store.create({
                data: {
                    kiranaId: kirana.id,
                    name: business.name,
                    address: business.address,
                    isDefault: true,
                },
            });
            await tx.membership.create({
                data: {userId: user.id, kiranaId: kirana.id, role: MembershipRole.OWNER},
            });
            return {user, kirana, store, verifyCode};
        });
    }

    public async getBusiness(kiranaId: string) {
        const business = await prisma.kirana.findUnique({
            where: {id: kiranaId},
            select: {
                id: true,
                name: true,
                address: true,
                City: true,
                gstin: true,
                gstScheme: true,
                roundOff: true,
                invoicePrefix: true,
                createdAt: true,
                stores: {
                    select: {id: true, name: true, address: true, isDefault: true},
                    orderBy: {createdAt: 'asc'},
                },
            },
        });
        if (!business) throw new ApiError(httpStatus.NOT_FOUND, 'Business not found');
        return business;
    }

    public async updateBusiness(kiranaId: string, data: UpdateBusiness) {
        // A tax or composition bill must carry the seller's GSTIN (A-030).
        if (data.gstScheme && data.gstScheme !== 'UNREGISTERED' && data.gstin === undefined) {
            const {gstin} = await prisma.kirana.findUniqueOrThrow({
                where: {id: kiranaId},
                select: {gstin: true},
            });
            if (!gstin)
                throw new ApiError(httpStatus.BAD_REQUEST, 'Set the GSTIN for this GST scheme');
        } else if (data.gstScheme && data.gstScheme !== 'UNREGISTERED' && !data.gstin) {
            throw new ApiError(httpStatus.BAD_REQUEST, 'Set the GSTIN for this GST scheme');
        }
        await prisma.kirana.update({where: {id: kiranaId}, data});
        return this.getBusiness(kiranaId);
    }

    public listMembers(kiranaId: string) {
        return prisma.membership.findMany({
            where: {kiranaId},
            select: memberSelect,
            orderBy: {createdAt: 'asc'},
        });
    }

    /** Owner/manager adds a staff login. The owner vouches for it, so no email verification. */
    public async addMember(kiranaId: string, actorRole: MembershipRole, data: AddMember) {
        const {role, password, ...userData} = data;
        if (!canAssignRole(actorRole, role)) throw forbidden('You cannot grant this role');
        const hashedPassword = await encryptPassword(password);

        return prisma.$transaction(async (tx) => {
            const user = await tx.user.create({
                data: {
                    ...userData,
                    password: hashedPassword,
                    role: Role.EMPLOYEE,
                    isVerified: true,
                },
            });
            return tx.membership.create({
                data: {userId: user.id, kiranaId, role},
                select: memberSelect,
            });
        });
    }

    public async updateMember(
        kiranaId: string,
        actor: {id: string; membershipRole: MembershipRole},
        membershipId: string,
        data: UpdateMember,
    ) {
        const member = await prisma.membership.findFirst({where: {id: membershipId, kiranaId}});
        if (!member) throw new ApiError(httpStatus.NOT_FOUND, 'Member not found');
        if (member.userId === actor.id) throw forbidden('You cannot change your own access');
        if (!canAssignRole(actor.membershipRole, member.role)) throw forbidden();
        if (data.role && !canAssignRole(actor.membershipRole, data.role)) {
            throw forbidden('You cannot grant this role');
        }

        const updated = await prisma.membership.update({
            where: {id: member.id},
            data,
            select: memberSelect,
        });
        if (data.isActive === false) {
            await tokenService.revokeUserSessions(member.userId, {kiranaId});
        }
        return updated;
    }
}

export default new BusinessService();
