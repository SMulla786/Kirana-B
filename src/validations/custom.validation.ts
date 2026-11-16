import {z} from 'zod';

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

export {password, emailSchema, usernameSchema, fullnameSchema, phoneNumberSchema, gstinSchema};
