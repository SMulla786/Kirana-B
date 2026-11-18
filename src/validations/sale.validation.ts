import {z} from 'zod';
import {PaymentMethod, ReturnDisposition} from '@prisma/client';
import {decimal, money} from './custom.validation';
import posValidation from './pos.validation';

const id = z.string().uuid('Invalid ID format.');
const key = z.string().trim().min(8).max(100);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/** The cart as the POS holds it: same line shape as a held bill, priced by the server. */
const checkoutSchema = z
    .object({
        customerId: id.nullable().optional(),
        lines: posValidation.holdBillSchema.shape.lines,
    })
    .strict();

const paymentSchema = z
    .object({
        method: z.nativeEnum(PaymentMethod),
        amount: decimal({dp: 2, positive: true}),
        /** CASH only: what the customer handed over (at least `amount`); the rest is change. */
        tendered: money().optional(),
        /** UPI ref, card slip or bank reference, as typed. Never a confirmation. */
        reference: z.string().trim().max(64).optional(),
    })
    .strict();

const completeSaleSchema = checkoutSchema
    .extend({
        payments: z.array(paymentSchema).min(1).max(6),
        note: z.string().trim().max(120).optional(),
        idempotencyKey: key,
    })
    .strict();

const saleQuerySchema = z
    .object({
        q: z.string().trim().max(100).optional(), // invoice number or customer name/phone
        // Calendar days in IST, both inclusive: from=2026-11-01&to=2026-11-30 is the whole month.
        from: day.optional(),
        to: day.optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(200).default(50),
    })
    .strict();

const createReturnSchema = z
    .object({
        lines: z
            .array(
                z
                    .object({
                        saleLineId: id,
                        quantity: decimal({dp: 3, positive: true}), // in the sale line's unit
                        disposition: z.nativeEnum(ReturnDisposition),
                    })
                    .strict(),
            )
            .min(1)
            .max(200),
        reason: z.string().trim().min(1).max(200),
        refundMethod: z.nativeEnum(PaymentMethod),
        idempotencyKey: key,
    })
    .strict();

export default {
    checkoutSchema,
    paymentSchema,
    completeSaleSchema,
    saleQuerySchema,
    createReturnSchema,
};
