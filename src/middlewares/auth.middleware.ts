import {Request, Response, NextFunction} from 'express';
import {catchAsync, ApiError} from '@utils/index';
import prisma from '../client';
import {tokenService} from '@services/index';
import httpStatus from 'http-status';
import {Role, User} from '@prisma/client';
import {commonValidation} from '@validations/index';

type SelectedUser = Pick<
    User,
    'id' | 'username' | 'email' | 'fullname' | 'phoneNumber' | 'secondaryPhoneNumber' | 'role'
>;
const getTokenFromRequest = (req: Request): string => {
    const token =
        req.cookies?.accessToken || req.headers.authorization?.replace('Bearer ', '') || '';
    commonValidation.tokenSchema.parse(token);
    return token;
};

const assignRoleData = async (user: SelectedUser, req: Request) => {
    if (user.role === Role.KIRANA) {
        const kirana = await prisma.kirana.findUnique({
            where: {userId: user.id},
            select: {id: true},
        });
        if (!kirana) throw new ApiError(httpStatus.UNAUTHORIZED, 'kirana not found');
        req.user = {...user, kiranaId: kirana.id};
    } else if (user.role === Role.EMPLOYEE) {
        const employee = await prisma.employee.findUnique({
            where: {userId: user.id},
            select: {id: true, kiranaId: true},
        });
        if (!employee) throw new ApiError(httpStatus.UNAUTHORIZED, 'employee not found');

        req.user = {...user, employeeId: employee.id, kiranaId: employee.kiranaId};
    } else {
        req.user = {...user};
    }
};

const verifyJWT = catchAsync(async (req, res, next) => {
    const token = getTokenFromRequest(req);
    const decodedToken = tokenService.verifyToken(token);

    const user = await prisma.user.findUnique({
        where: {id: decodedToken.id},
        select: {
            id: true,
            username: true,
            email: true,
            fullname: true,
            role: true,
            phoneNumber: true,
            secondaryPhoneNumber: true,
        },
    });

    if (!user) {
        throw new ApiError(httpStatus.UNAUTHORIZED, 'User not found');
    }

    await assignRoleData(user, req);
    next();
});

const checkRole = (requiredRoles: Role | Role[]) => {
    return (req: Request, res: Response, next: NextFunction) => {
        const user = req.user;

        if (!user) {
            throw new ApiError(httpStatus.UNAUTHORIZED, 'User not authenticated');
        }

        const roles = Array.isArray(requiredRoles) ? requiredRoles : [requiredRoles];

        if (!roles.includes(user.role)) {
            throw new ApiError(
                httpStatus.FORBIDDEN,
                `Access denied: Your role (${user.role}) does not have permission. Required role(s): ${roles.join(', ')}.`,
            );
        }

        next();
    };
};

const checkAdmin = checkRole(Role.ADMIN);
const checkKirana = checkRole(Role.KIRANA);
const checkEmployee = checkRole(Role.EMPLOYEE);

export {verifyJWT, checkRole, checkAdmin, checkKirana, checkEmployee};
