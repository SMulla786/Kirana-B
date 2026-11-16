import {z} from 'zod';
import commonValidation from './common.validation';
const materialSchema = z.object({
    name: z.string(),
    unit: z.enum(['KG', 'G', 'PEICE', 'L', 'ML', 'DOZON']),
    categoryId: z.string(),
    barcode: z.string(),
});
const materialCategorySchema = z.object({
    name: z.string(),
});
const updateMaterialSchema = materialSchema.partial();
export default {
    materialSchema,
    materialCategorySchema,
    updateMaterialSchema,
    kiranaIdSchema: commonValidation.kiranaIdSchema,
};
