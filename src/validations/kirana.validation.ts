import z from 'zod';
import userValidation from './user.validation';

const createKiranaSchema = z.object({
    user: userValidation.registerUserSchema,
    City: z.string().min(3, 'City name must be at least 3 characters long'),
    address: z.string().min(10, 'Address must be at least 10 characters long'),
    amount: z.number().min(1, 'Amount must be at least 1'),
    renewalAmount: z.number().min(1, 'Renewal amount must be at least 1'),
    // languageId: z.string().min(3, 'Language ID must be at least 3 characters long'),
});

const updateKiranaSchema = createKiranaSchema.partial();
export default {createKiranaSchema, updateKiranaSchema};
