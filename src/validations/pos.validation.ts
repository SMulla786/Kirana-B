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

const holdBillSchema = z
    .object({
        customerId: z.string().uuid('Invalid ID format.').nullable().optional(),
        note: z.string().trim().max(80).nullable().optional(),
        lines: z.array(heldLineSchema).min(1).max(200),
    })
    .strict();

export default {holdBillSchema};
