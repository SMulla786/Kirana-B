import {z} from 'zod';
import {UnitCode} from '@prisma/client';
import {decimal, money} from './custom.validation';

const heldLineSchema = z
    .object({
        productId: z.string().uuid('Invalid ID format.'),
        unit: z.nativeEnum(UnitCode),
        quantity: decimal({dp: 3, positive: true}),
        unitPrice: money().optional(),
        discount: money().optional(),
    })
    .strict();

const key = z.string().trim().min(8).max(100);

const holdBillSchema = z
    .object({
        customerId: z.string().uuid('Invalid ID format.').nullable().optional(),
        note: z.string().trim().max(80).nullable().optional(),
        lines: z.array(heldLineSchema).min(1).max(200),
        idempotencyKey: key.optional(),
    })
    .strict();

/** Recall body and the confirm-delete query: the till's claim on one held bill. */
const claimSchema = z.object({claimKey: key}).strict();

export default {holdBillSchema, claimSchema};
