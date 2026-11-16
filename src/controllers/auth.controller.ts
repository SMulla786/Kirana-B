import {CookieOptions, Request, Response} from 'express';
import httpStatus from 'http-status';
import {authService} from '@services/index';
import {catchAsync, ApiResponse} from '@utils/index';
import {commonValidation, userValidation} from '@validations/index';

// Web clients use these httpOnly cookies; desktop/Android use the tokens from the body.
const cookieBase: CookieOptions = {httpOnly: true, secure: true, sameSite: 'strict'};
const REFRESH_COOKIE_PATH = '/api/v1/auth';

const setAuthCookies = (
    res: Response,
    tokens: {
        accessToken: string;
        accessTokenExpiresAt: Date;
        refreshToken: string;
        refreshTokenExpiresAt: Date;
    },
) =>
    res
        .cookie('accessToken', tokens.accessToken, {
            ...cookieBase,
            path: '/',
            expires: tokens.accessTokenExpiresAt,
        })
        .cookie('refreshToken', tokens.refreshToken, {
            ...cookieBase,
            path: REFRESH_COOKIE_PATH,
            expires: tokens.refreshTokenExpiresAt,
        });

const clearAuthCookies = (res: Response) =>
    res
        .clearCookie('accessToken', {...cookieBase, path: '/'})
        .clearCookie('refreshToken', {...cookieBase, path: REFRESH_COOKIE_PATH});

const refreshTokenFrom = (req: Request): string | undefined =>
    req.cookies?.refreshToken ?? req.body?.refreshToken;

const ok = (res: Response, data: unknown, message: string, status: number = httpStatus.OK) =>
    res.status(status).json(new ApiResponse(status, data, message));

const register = catchAsync(async (req, res) => {
    const data = userValidation.registerSchema.parse(req.body);
    const result = await authService.register(data);
    return ok(res, result, 'Business created. Check your email for the code', httpStatus.CREATED);
});

const verifyCode = catchAsync(async (req, res) => {
    const {username, code} = userValidation.verifyCodeSchema.parse(req.body);
    await authService.verifyCode(username, code);
    return ok(res, undefined, 'Email verified');
});

const resendCode = catchAsync(async (req, res) => {
    const {username} = userValidation.resendCodeSchema.parse(req.body);
    await authService.resendCode(username);
    return ok(res, undefined, 'If the account needs verification, a new code was sent');
});

const login = catchAsync(async (req, res) => {
    const data = userValidation.loginSchema.parse(req.body);
    const {session, me, ...tokens} = await authService.login(data, {
        userAgent: req.get('user-agent'),
        ip: req.ip,
    });
    const body = {
        accessToken: tokens.accessToken,
        accessTokenExpiresAt: tokens.accessTokenExpiresAt,
        refreshToken: tokens.refreshToken,
        refreshTokenExpiresAt: session.expiresAt,
        me,
    };
    setAuthCookies(res, body);
    return ok(res, body, 'Logged in');
});

const refresh = catchAsync(async (req, res) => {
    const token = userValidation.refreshTokenSchema.parse(refreshTokenFrom(req));
    const tokens = await authService.refresh(token);
    setAuthCookies(res, tokens);
    return ok(res, tokens, 'Token refreshed');
});

const logout = catchAsync(async (req, res) => {
    await authService.logout(refreshTokenFrom(req));
    clearAuthCookies(res);
    return ok(res, undefined, 'Logged out');
});

const logoutAll = catchAsync(async (req, res) => {
    await authService.revokeAllSessions(req.user!.id);
    clearAuthCookies(res);
    return ok(res, undefined, 'Logged out on all devices');
});

const listSessions = catchAsync(async (req, res) => {
    const sessions = await authService.listSessions(req.user!.id, req.user!.sessionId);
    return ok(res, sessions, 'Sessions');
});

const revokeSession = catchAsync(async (req, res) => {
    const id = commonValidation.idSchema.parse(req.params.id);
    await authService.revokeSession(req.user!.id, id);
    return ok(res, undefined, 'Session revoked');
});

const forgotPassword = catchAsync(async (req, res) => {
    const {email} = userValidation.forgotPasswordSchema.parse(req.body);
    await authService.forgotPassword(email);
    return ok(res, undefined, 'If the email is registered, a reset link was sent');
});

const resetPassword = catchAsync(async (req, res) => {
    const {token, newPassword} = userValidation.resetPasswordSchema.parse(req.body);
    await authService.resetPassword(token, newPassword);
    clearAuthCookies(res);
    return ok(res, undefined, 'Password reset. Please log in');
});

const changePassword = catchAsync(async (req, res) => {
    const {currentPassword, newPassword} = userValidation.changePasswordSchema.parse(req.body);
    await authService.changePassword(
        req.user!.id,
        req.user!.sessionId,
        currentPassword,
        newPassword,
    );
    return ok(res, undefined, 'Password changed. Other devices were signed out');
});

const getMe = catchAsync(async (req, res) => {
    const user = req.user!;
    const tenant =
        user.kiranaId && user.membershipRole
            ? {
                  kiranaId: user.kiranaId,
                  storeId: user.storeId ?? null,
                  membershipRole: user.membershipRole,
              }
            : null;
    return ok(res, await authService.buildMe(user, tenant), 'Current user');
});

const updateMe = catchAsync(async (req, res) => {
    const data = userValidation.updateMeSchema.parse(req.body);
    return ok(res, await authService.updateMe(req.user!.id, data), 'Profile updated');
});

export default {
    register,
    verifyCode,
    resendCode,
    login,
    refresh,
    logout,
    logoutAll,
    listSessions,
    revokeSession,
    forgotPassword,
    resetPassword,
    changePassword,
    getMe,
    updateMe,
};
