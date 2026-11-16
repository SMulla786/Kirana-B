import {Request, Response, NextFunction} from 'express';
import httpStatus from 'http-status';
import {MembershipRole, Role} from '@prisma/client';
import {catchAsync, ApiError} from '@utils/index';
import {tokenService} from '@services/index';
import {hasPermission, Permission} from '@config/permissions';
import prisma from '../client';

const getTokenFromRequest = (req: Request): string => {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : req.cookies?.accessToken;
    if (!token) throw new ApiError(httpStatus.UNAUTHORIZED, 'Authentication required');
    return token;
};

/** Authenticates the access token against a live session and resolves the tenant server-side. */
const verifyJWT = catchAsync(async (req, _res, next) => {
    const {userId, sessionId} = tokenService.verifyAccessToken(getTokenFromRequest(req));
    const session = await prisma.session.findUnique({
        where: {id: sessionId},
        include: {
            user: {
                select: {
                    id: true,
                    username: true,
                    email: true,
                    fullname: true,
                    phoneNumber: true,
                    role: true,
                    isActive: true,
                },
            },
        },
    });
    if (
        !session ||
        session.userId !== userId ||
        session.revokedAt ||
        session.expiresAt <= new Date() ||
        !session.user.isActive
    ) {
        throw new ApiError(httpStatus.UNAUTHORIZED, 'Session expired. Please log in again');
    }

    let membershipRole: MembershipRole | undefined;
    if (session.kiranaId) {
        const membership = await prisma.membership.findUnique({
            where: {userId_kiranaId: {userId, kiranaId: session.kiranaId}},
            select: {role: true, isActive: true},
        });
        if (!membership?.isActive) {
            throw new ApiError(httpStatus.UNAUTHORIZED, 'Business access revoked');
        }
        membershipRole = membership.role;
    }

    const {id, username, email, fullname, phoneNumber, role} = session.user;
    req.user = {
        id,
        username,
        email,
        fullname,
        phoneNumber,
        role,
        sessionId: session.id,
        kiranaId: session.kiranaId ?? undefined,
        storeId: session.storeId ?? undefined,
        membershipRole,
    };
    next();
});

const forbidden = () =>
    new ApiError(httpStatus.FORBIDDEN, 'You do not have permission for this action');

const checkRole = (requiredRoles: Role | Role[]) => {
    const roles = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];
    return (req: Request, _res: Response, next: NextFunction) => {
        if (!req.user) throw new ApiError(httpStatus.UNAUTHORIZED, 'Authentication required');
        if (!roles.includes(req.user.role)) throw forbidden();
        next();
    };
};

const checkAdmin = checkRole(Role.ADMIN);

/** Tenant routes: the session must belong to a business whose role grants `permission`. */
const requirePermission = (permission: Permission) => {
    return (req: Request, _res: Response, next: NextFunction) => {
        if (!req.user) throw new ApiError(httpStatus.UNAUTHORIZED, 'Authentication required');
        if (!req.user.kiranaId || !hasPermission(req.user.membershipRole, permission)) {
            throw forbidden();
        }
        next();
    };
};

/** The authenticated tenant context. Never read kiranaId from body, params or query. */
const tenantOf = (req: Request) => {
    const user = req.user;
    if (!user?.kiranaId || !user.membershipRole) throw forbidden();
    return {...user, kiranaId: user.kiranaId, membershipRole: user.membershipRole};
};

export {verifyJWT, checkRole, checkAdmin, requirePermission, tenantOf};
