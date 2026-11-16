import {z} from 'zod';
import commonValidation from './common.validation';
import {emailSchema, usernameSchema, fullnameSchema, phoneNumberSchema} from './custom.validation';

const idSchema = z.string().uuid();

const userBaseSchema = z.object({
    email: emailSchema,
    username: usernameSchema,
    fullname: fullnameSchema,
    phoneNumber: phoneNumberSchema,
    secondaryPhoneNumber: phoneNumberSchema.optional(),
});
const registerClientSchema = z.object({
    name: z.string(),
    address: z.string(),
    phoneNumber: phoneNumberSchema,
    secondaryPhoneNumber: phoneNumberSchema.optional(),
});

const queryClientsSchema = z.object({
    page: z.number().default(1),
    limit: z.number().default(10),
    searchTerm: z.string().optional(),
});

// Point-of-sale customers: minimal context for a bill (Phase 5 builds the real customer work).
const customerQuerySchema = z.object({q: z.string().trim().max(100).optional()});
const createCustomerSchema = z
    .object({name: z.string().trim().min(1).max(100), phoneNumber: phoneNumberSchema})
    .strict();

const getClientByIdSchema = z.object({
    id: idSchema,
});

const updateClientSchema = userBaseSchema
    .extend({
        isVegetarian: z.boolean(),
        isJain: z.boolean(),
        address: z.string(),
        caste: z.string(),
    })
    .partial();

export default {
    registerClientSchema,
    customerQuerySchema,
    createCustomerSchema,
    queryClientsSchema,
    getClientByIdSchema,
    updateClientSchema,
    kiranaIdSchema: commonValidation.kiranaIdSchema,
};
