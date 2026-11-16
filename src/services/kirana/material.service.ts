import prisma from 'client';
import {materialValidation} from '@validations/index';
import z from 'zod';
type createMaterial = z.infer<typeof materialValidation.materialSchema>;
type updateMaterial = z.infer<typeof materialValidation.updateMaterialSchema>;
type createMaterialCategory = z.infer<typeof materialValidation.materialCategorySchema>;

class materialService {
    public async getMaterialCategories(kiranaId: string) {
        const materialCategory = await prisma.kiranaMaterialCategory.findMany({
            where: {kiranaId},
        });
        return materialCategory;
    }
    public async getMaterialCategoryById(id: string) {
        const materialCategory = await prisma.kiranaMaterialCategory.findUnique({
            where: {id},
        });
        return materialCategory;
    }
    public async createMaterialCategory(kiranaId: string, data: createMaterialCategory) {
        const materialCategory = await prisma.kiranaMaterialCategory.create({
            data: {
                ...data,
                kiranaId,
            },
        });
        return materialCategory;
    }
    public async updateMaterialCategory(id: string, data: createMaterialCategory) {
        const materialCategory = await prisma.kiranaMaterialCategory.update({
            where: {id},
            data,
        });
        return materialCategory;
    }
    public async deleteMaterialCategory(id: string) {
        const materialCategory = await prisma.kiranaMaterialCategory.delete({
            where: {id},
        });
        return materialCategory;
    }
    public async getMaterials(kiranaId: string) {
        const material = await prisma.kiranaMaterial.findMany({
            where: {kiranaId},
        });
        return material;
    }
    public async getMaterialById(id: string) {
        const material = await prisma.kiranaMaterial.findUnique({
            where: {id},
        });
        return material;
    }
    public async createMaterial(kiranaId: string, data: createMaterial) {
        const material = await prisma.kiranaMaterial.create({
            data: {
                ...data,
                kiranaId,
            },
        });
        return material;
    }
    public async updateMaterial(id: string, data: updateMaterial) {
        const material = await prisma.kiranaMaterial.update({
            where: {id},
            data,
        });
        return material;
    }
    public async deleteMaterial(id: string) {
        const material = await prisma.kiranaMaterial.delete({
            where: {id},
        });
        return material;
    }
}
export default new materialService();
