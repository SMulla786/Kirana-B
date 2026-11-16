import {z} from 'zod';
import {MembershipRole} from '@prisma/client';
import userValidation from './user.validation';
import {gstinSchema} from './custom.validation';

const updateBusinessSchema = userValidation.businessSchema
    .extend({gstin: gstinSchema.nullable()})
    .partial()
    .strict();

const addMemberSchema = userValidation.userSchema
    .extend({role: z.nativeEnum(MembershipRole)})
    .strict();

const updateMemberSchema = z
    .object({role: z.nativeEnum(MembershipRole), isActive: z.boolean()})
    .partial()
    .strict()
    .refine((data) => data.role !== undefined || data.isActive !== undefined, {
        message: 'Nothing to update',
    });

export default {updateBusinessSchema, addMemberSchema, updateMemberSchema};
