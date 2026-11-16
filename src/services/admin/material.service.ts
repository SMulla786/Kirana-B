import prisma from 'client';
import {materialValidation} from '@validations/index';
import z from 'zod';
type createMaterial = z.infer<typeof materialValidation.materialSchema>;
type updateMaterial = z.infer<typeof materialValidation.updateMaterialSchema>;
type createMaterialCategory = z.infer<typeof materialValidation.materialCategorySchema>;

class materialService {
    public async getMaterialCategories() {
        const materialCategory = await prisma.materialCategory.findMany({});
        return materialCategory;
    }
    public async getMaterialCategoryById(id: string) {
        const materialCategory = await prisma.materialCategory.findUnique({
            where: {id},
        });
        return materialCategory;
    }
    public async createMaterialCategory(data: createMaterialCategory) {
        const materialCategory = await prisma.materialCategory.create({
            data: {
                ...data,
            },
        });
        return materialCategory;
    }
    public async updateMaterialCategory(id: string, data: createMaterialCategory) {
        const materialCategory = await prisma.materialCategory.update({
            where: {id},
            data,
        });
        return materialCategory;
    }
    public async deleteMaterialCategory(id: string) {
        const materialCategory = await prisma.materialCategory.delete({
            where: {id},
        });
        return materialCategory;
    }
    public async getMaterials() {
        const material = await prisma.material.findMany({});
        return material;
    }
    public async getMaterialById(id: string) {
        const material = await prisma.material.findUnique({
            where: {id},
        });
        return material;
    }
    public async createMaterial(data: createMaterial) {
        const material = await prisma.material.create({
            data: {
                ...data,
            },
        });
        return material;
    }
    public async updateMaterial(id: string, data: updateMaterial) {
        const material = await prisma.material.update({
            where: {id},
            data,
        });
        return material;
    }
    public async deleteMaterial(id: string) {
        const material = await prisma.material.delete({
            where: {id},
        });
        return material;
    }
}
export default new materialService();
