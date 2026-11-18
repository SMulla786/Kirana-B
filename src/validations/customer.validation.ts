import {z} from 'zod';
import {PaymentMethod, Prisma} from '@prisma/client';
import {decimal, money, phoneNumberSchema} from './custom.validation';

// Phase 5: customers, udhaar ledger and collections (DECISIONS A-031).

const id = z.string().uuid('Invalid ID format.');
const key = z.string().trim().min(8).max(100);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const page = z.coerce.number().int().min(1).default(1);
const reason = z.string().trim().min(1).max(200);

// Zod still runs refinements after decimal() has rejected a value, so they check they got a Decimal.
const isDecimal = (d: unknown): d is Prisma.Decimal => d instanceof Prisma.Decimal;

const tags = z
    .array(z.string().trim().min(1).max(30))
    .max(10)
    .refine((t) => new Set(t.map((x) => x.toLowerCase())).size === t.length, 'Tags must differ');

const customerFields = {
    name: z.string().trim().min(1).max(100),
    phoneNumber: phoneNumberSchema,
    address: z.string().trim().max(200),
    notes: z.string().trim().max(500).nullable(),
    tags,
    /** Most the customer may owe after a credit sale; null for no limit. Needs customers.credit. */
    creditLimit: money().nullable(),
    /** Confirms adding another name on a phone that a customer already uses (a family phone). */
    sharedPhone: z.boolean(),
};

const customerQuerySchema = z
    .object({
        q: z.string().trim().max(100).optional(), // name or phone
        tag: z.string().trim().min(1).max(30).optional(),
        status: z.enum(['active', 'archived', 'all']).default('active'),
        /** true: only customers who owe something (outstanding > 0). */
        due: z
            .enum(['true', 'false'])
            .transform((v) => v === 'true')
            .optional(),
        sort: z.enum(['name', 'outstanding', 'recent']).default('name'),
        page,
        pageSize: z.coerce.number().int().min(1).max(200).default(50),
    })
    .strict();

const createCustomerSchema = z
    .object({
        name: customerFields.name,
        phoneNumber: customerFields.phoneNumber,
        address: customerFields.address.optional(),
        notes: customerFields.notes.optional(),
        tags: customerFields.tags.optional(),
        creditLimit: customerFields.creditLimit.optional(),
        sharedPhone: customerFields.sharedPhone.optional(),
    })
    .strict();

const updateCustomerSchema = z
    .object({...customerFields, isActive: z.boolean()})
    .partial()
    .strict()
    .refine((d) => Object.keys(d).some((k) => k !== 'sharedPhone'), {message: 'Nothing to update'});

/** Posted straight to the ledger by customers.credit. amount is signed: + the customer owes more. */
const adjustmentSchema = z
    .object({
        type: z.enum(['OPENING_BALANCE', 'ADJUSTMENT']),
        amount: decimal({dp: 2}).refine((d) => !isDecimal(d) || !d.isZero(), 'Must not be 0'),
        reason,
        idempotencyKey: key,
    })
    .strict();

const reverseEntrySchema = z.object({reason, idempotencyKey: key}).strict();

const collectPaymentSchema = z
    .object({
        amount: decimal({dp: 2, positive: true}),
        method: z
            .nativeEnum(PaymentMethod)
            .refine((m) => m !== 'CREDIT', 'A collection cannot be on credit'),
        /** UPI ref, cheque or bank reference, as typed. Never a confirmation. */
        reference: z.string().trim().max(64).optional(),
        /** The IST day the money came in; default today, never in the future. */
        receivedOn: day.optional(),
        note: z.string().trim().max(200).optional(),
        /** Set against credit invoices; whatever is left stays on account. */
        allocations: z
            .array(z.object({saleId: id, amount: decimal({dp: 2, positive: true})}).strict())
            .max(50)
            .default([]),
        idempotencyKey: key,
    })
    .strict()
    .superRefine((d, ctx) => {
        if (!isDecimal(d.amount) || !d.allocations.every((a) => isDecimal(a.amount))) return;
        const seen = new Set<string>();
        d.allocations.forEach((a, i) => {
            if (seen.has(a.saleId)) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['allocations', i, 'saleId'],
                    message: 'Invoice listed twice',
                });
            }
            seen.add(a.saleId);
        });
        const allocated = d.allocations.reduce((s, a) => s.add(a.amount), new Prisma.Decimal(0));
        if (allocated.gt(d.amount)) {
            ctx.addIssue({
                code: 'custom',
                path: ['allocations'],
                message: 'Allocations add up to more than the amount',
            });
        }
    });

/** Calendar days in IST, both inclusive. The statement opens with the balance before `from`. */
const ledgerQuerySchema = z
    .object({
        from: day.optional(),
        to: day.optional(),
        page,
        pageSize: z.coerce.number().int().min(1).max(500).default(100),
    })
    .strict();

const invoiceQuerySchema = z.object({status: z.enum(['due', 'all']).default('due')}).strict();

const paymentParams = z.object({id, paymentId: id});
const entryParams = z.object({id, entryId: id});

export default {
    customerQuerySchema,
    createCustomerSchema,
    updateCustomerSchema,
    adjustmentSchema,
    reverseEntrySchema,
    collectPaymentSchema,
    ledgerQuerySchema,
    invoiceQuerySchema,
    paymentParams,
    entryParams,
};
