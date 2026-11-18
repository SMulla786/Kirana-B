import {z} from 'zod';
import {GstScheme, MembershipRole, RoundOffRule} from '@prisma/client';
import userValidation from './user.validation';
import {gstinSchema} from './custom.validation';

const updateBusinessSchema = userValidation.businessSchema
    .extend({
        gstin: gstinSchema.nullable(),
        // GST is never assumed (A-030): REGULAR/COMPOSITION need a GSTIN, checked in the service.
        gstScheme: z.nativeEnum(GstScheme),
        roundOff: z.nativeEnum(RoundOffRule),
        invoicePrefix: z
            .string()
            .trim()
            .regex(/^[A-Z0-9-]{1,8}$/, 'Use 1-8 capital letters, digits or -'),
        /** The shop's UPI ID for the static checkout QR (O-10), e.g. shopname@okaxis; null clears it. */
        upiId: z
            .string()
            .trim()
            .regex(/^[a-zA-Z0-9._-]{2,256}@[a-zA-Z][a-zA-Z0-9.-]{1,63}$/, 'Invalid UPI ID')
            .nullable(),
    })
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
