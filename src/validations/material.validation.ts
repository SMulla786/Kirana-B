import {z} from 'zod';
import {MaterialUnit} from '@prisma/client';
import commonValidation from './common.validation';
const materialSchema = z
    .object({
        name: z.string().trim().min(1).max(100),
        unit: z.nativeEnum(MaterialUnit),
        categoryId: z.string().uuid(),
        barcode: z.string().trim().min(1).max(64),
    })
    .strict();
const materialCategorySchema = z
    .object({
        name: z.string().trim().min(1).max(100),
    })
    .strict();
const updateMaterialSchema = materialSchema.partial();
export default {
    materialSchema,
    materialCategorySchema,
    updateMaterialSchema,
    kiranaIdSchema: commonValidation.kiranaIdSchema,
};
