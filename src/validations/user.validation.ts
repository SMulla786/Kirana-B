import {z} from 'zod';
import {
    password,
    emailSchema,
    usernameSchema,
    fullnameSchema,
    phoneNumberSchema,
    gstinSchema,
} from './custom.validation';

const userFields = {
    fullname: fullnameSchema,
    email: emailSchema,
    username: usernameSchema,
    password,
    phoneNumber: phoneNumberSchema,
    secondaryPhoneNumber: phoneNumberSchema.optional(),
};

/** A login identity. Public input never chooses a platform role. */
const userSchema = z.object(userFields).strict();

const businessSchema = z
    .object({
        name: z.string().trim().min(2).max(100),
        address: z.string().trim().min(5).max(300),
        City: z.string().trim().min(2).max(100),
        gstin: gstinSchema.optional(),
    })
    .strict();

/** Self-signup and admin onboarding: owner user + business (+ default store). */
const registerSchema = z.object({...userFields, business: businessSchema}).strict();

const loginSchema = z
    .object({
        identifier: z.string().trim().min(1).max(254),
        password: z.string().min(1).max(200),
        deviceName: z.string().trim().max(100).optional(),
        kiranaId: z.string().uuid().optional(),
    })
    .strict();

const verifyCodeSchema = z
    .object({
        username: usernameSchema,
        code: z.string().regex(/^\d{6}$/, 'Verification code must be 6 digits'),
    })
    .strict();

const resendCodeSchema = z.object({username: usernameSchema}).strict();
const forgotPasswordSchema = z.object({email: emailSchema}).strict();
const resetPasswordSchema = z
    .object({token: z.string().min(16).max(200), newPassword: password})
    .strict();
const changePasswordSchema = z
    .object({currentPassword: z.string().min(1).max(200), newPassword: password})
    .strict();
const refreshTokenSchema = z.string().min(1).max(300);

const updateMeSchema = z
    .object({
        fullname: fullnameSchema,
        phoneNumber: phoneNumberSchema,
        secondaryPhoneNumber: phoneNumberSchema.nullable(),
    })
    .partial()
    .strict();

export default {
    userSchema,
    businessSchema,
    registerSchema,
    loginSchema,
    verifyCodeSchema,
    resendCodeSchema,
    forgotPasswordSchema,
    resetPasswordSchema,
    changePasswordSchema,
    refreshTokenSchema,
    updateMeSchema,
};
