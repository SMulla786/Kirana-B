import z from 'zod';
import clientValidation from './client.validation';
import commonValidation from './common.validation';
const createOrderSchema = z.object({
    client: clientValidation.registerClientSchema,
    orderItems: z.array(
        z.object({
            materialId: z.string(),
            quantity: z.number(),
            price: z.number(),
        }),
    ),
    totalPrice: z.number(),
    paid: z.number(),
});

const updateOrderSchema = createOrderSchema.partial();
export default {
    createOrderSchema,
    updateOrderSchema,
    kiranaIdSchema: commonValidation.kiranaIdSchema,
};
