import prisma from 'client';
import {materialValidation} from '@validations/index';
import ApiError from '@utils/ApiError';
import z from 'zod';
type createMaterial = z.infer<typeof materialValidation.materialSchema>;
type updateMaterial = z.infer<typeof materialValidation.updateMaterialSchema>;
type createMaterialCategory = z.infer<typeof materialValidation.materialCategorySchema>;

class materialService {
    public async getMaterialCategories(kiranaId: string) {
        return prisma.kiranaMaterialCategory.findMany({where: {kiranaId}, orderBy: {name: 'asc'}});
    }
    public async getMaterialCategoryById(kiranaId: string, id: string) {
        const materialCategory = await prisma.kiranaMaterialCategory.findFirst({
            where: {id, kiranaId},
        });
        if (!materialCategory) throw new ApiError(404, 'Category not found');
        return materialCategory;
    }
    public async createMaterialCategory(kiranaId: string, data: createMaterialCategory) {
        return prisma.kiranaMaterialCategory.create({data: {...data, kiranaId}});
    }
    public async updateMaterialCategory(
        kiranaId: string,
        id: string,
        data: createMaterialCategory,
    ) {
        await this.getMaterialCategoryById(kiranaId, id);
        return prisma.kiranaMaterialCategory.update({where: {id}, data});
    }
    public async deleteMaterialCategory(kiranaId: string, id: string) {
        await this.getMaterialCategoryById(kiranaId, id);
        return prisma.kiranaMaterialCategory.delete({where: {id}});
    }
    public async getMaterials(kiranaId: string) {
        return prisma.kiranaMaterial.findMany({where: {kiranaId}, orderBy: {name: 'asc'}});
    }
    public async getMaterialById(kiranaId: string, id: string) {
        const material = await prisma.kiranaMaterial.findFirst({where: {id, kiranaId}});
        if (!material) throw new ApiError(404, 'Product not found');
        return material;
    }
    public async createMaterial(kiranaId: string, data: createMaterial) {
        await this.getMaterialCategoryById(kiranaId, data.categoryId);
        return prisma.kiranaMaterial.create({data: {...data, kiranaId}});
    }
    public async updateMaterial(kiranaId: string, id: string, data: updateMaterial) {
        await this.getMaterialById(kiranaId, id);
        if (data.categoryId) await this.getMaterialCategoryById(kiranaId, data.categoryId);
        return prisma.kiranaMaterial.update({where: {id}, data});
    }
    public async deleteMaterial(kiranaId: string, id: string) {
        await this.getMaterialById(kiranaId, id);
        return prisma.kiranaMaterial.delete({where: {id}});
    }
}
export default new materialService();
