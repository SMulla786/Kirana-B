import {z} from 'zod';
import {extendZodWithOpenApi} from '@asteasolutions/zod-to-openapi';
import {Prisma} from '@prisma/client';

extendZodWithOpenApi(z);

// bcrypt only uses the first 72 bytes, so longer passwords are rejected rather than truncated.
const password = z
    .string()
    .max(72, 'Password must be at most 72 characters long.')
    .refine((value) => value.length >= 8 && /\d/.test(value) && /[a-zA-Z]/.test(value), {
        message:
            'Password must be at least 8 characters long and contain at least 1 letter and 1 number.',
    });

const emailSchema = z.string().trim().toLowerCase().email('Invalid email format').max(254);
// No '@' in usernames, so a login identifier is unambiguous (contains '@' => email).
const usernameSchema = z
    .string()
    .trim()
    .min(3, 'Username must be at least 3 characters long')
    .max(50)
    .regex(/^[A-Za-z0-9_.-]+$/, 'Username may contain letters, digits, _ . - only');
const fullnameSchema = z.string().trim().min(1, 'Full name is required').max(100);
const phoneNumberSchema = z
    .string()
    .trim()
    .regex(/^[6-9]\d{9}$/, 'Invalid Indian phone number format');
const gstinSchema = z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Invalid GSTIN format');

/**
 * A decimal from a JSON number or string, parsed exactly (no float maths). `0.1` stays 0.1; values
 * with more than `dp` decimals are rejected, never rounded.
 */
const decimal = (opts: {dp: number; min?: number; max?: number; positive?: boolean}) =>
    z
        .union([z.number().finite(), z.string().trim().min(1)])
        .transform((value, ctx) => {
            const text = String(value);
            if (!/^-?\d{1,12}(\.\d+)?$/.test(text)) {
                ctx.addIssue({code: 'custom', message: 'Must be a decimal number'});
                return z.NEVER;
            }
            const d = new Prisma.Decimal(text);
            const fail = (message: string) => {
                ctx.addIssue({code: 'custom', message});
                return z.NEVER;
            };
            if (d.decimalPlaces() > opts.dp) return fail(`At most ${opts.dp} decimals`);
            if (opts.positive && d.lte(0)) return fail('Must be greater than 0');
            if (opts.min !== undefined && d.lt(opts.min))
                return fail(`Must be at least ${opts.min}`);
            if (opts.max !== undefined && d.gt(opts.max))
                return fail(`Must be at most ${opts.max}`);
            return d;
        })
        .openapi({type: 'string', example: '12.50'});

const money = () => decimal({dp: 2, min: 0});
const quantity = () => decimal({dp: 3});

export {
    password,
    emailSchema,
    usernameSchema,
    fullnameSchema,
    phoneNumberSchema,
    gstinSchema,
    decimal,
    money,
    quantity,
};
