import {materialService} from '@services/kirana';
import {catchAsync, ApiResponse} from '@utils/index';
import {materialValidation, commonValidation} from '@validations/index';
import {tenantOf} from '@middlewares/auth.middleware';
import httpStatus from 'http-status';
const createMaterialCategory = catchAsync(async (req, res) => {
    const {kiranaId} = tenantOf(req);
    const parsedData = materialValidation.materialCategorySchema.parse(req.body);
    const materialCategory = await materialService.createMaterialCategory(kiranaId, parsedData);
    res.status(httpStatus.CREATED).json(
        new ApiResponse(
            httpStatus.CREATED,
            materialCategory,
            'Material category created successfully',
        ),
    );
});
const updateMaterialCategory = catchAsync(async (req, res) => {
    const {kiranaId} = tenantOf(req);
    const id = commonValidation.idSchema.parse(req.params.id);
    const parsedData = materialValidation.materialCategorySchema.parse(req.body);
    const materialCategory = await materialService.updateMaterialCategory(kiranaId, id, parsedData);
    res.status(httpStatus.OK).json(
        new ApiResponse(httpStatus.OK, materialCategory, 'Material category updated successfully'),
    );
});
const deleteMaterialCategory = catchAsync(async (req, res) => {
    const {kiranaId} = tenantOf(req);
    const id = commonValidation.idSchema.parse(req.params.id);
    const materialCategory = await materialService.deleteMaterialCategory(kiranaId, id);
    res.status(httpStatus.OK).json(
        new ApiResponse(httpStatus.OK, materialCategory, 'Material category deleted successfully'),
    );
});
const getMaterialCategory = catchAsync(async (req, res) => {
    const {kiranaId} = tenantOf(req);
    const id = commonValidation.idSchema.parse(req.params.id);
    const materialCategory = await materialService.getMaterialCategoryById(kiranaId, id);
    res.status(httpStatus.OK).json(
        new ApiResponse(
            httpStatus.OK,
            materialCategory,
            'Material category retrieved successfully',
        ),
    );
});
const getMaterialCategories = catchAsync(async (req, res) => {
    const {kiranaId} = tenantOf(req);
    const materialCategories = await materialService.getMaterialCategories(kiranaId);
    res.status(httpStatus.OK).json(
        new ApiResponse(
            httpStatus.OK,
            materialCategories,
            'Material categories retrieved successfully',
        ),
    );
});
const createMaterial = catchAsync(async (req, res) => {
    const {kiranaId} = tenantOf(req);
    const parsedData = materialValidation.materialSchema.parse(req.body);
    const material = await materialService.createMaterial(kiranaId, parsedData);
    res.status(httpStatus.CREATED).json(
        new ApiResponse(httpStatus.CREATED, material, 'Material created successfully'),
    );
});
const updateMaterial = catchAsync(async (req, res) => {
    const {kiranaId} = tenantOf(req);
    const id = commonValidation.idSchema.parse(req.params.id);
    const parsedData = materialValidation.updateMaterialSchema.parse(req.body);
    const material = await materialService.updateMaterial(kiranaId, id, parsedData);
    res.status(httpStatus.OK).json(
        new ApiResponse(httpStatus.OK, material, 'Material updated successfully'),
    );
});
const deleteMaterial = catchAsync(async (req, res) => {
    const {kiranaId} = tenantOf(req);
    const id = commonValidation.idSchema.parse(req.params.id);
    const material = await materialService.deleteMaterial(kiranaId, id);
    res.status(httpStatus.OK).json(
        new ApiResponse(httpStatus.OK, material, 'Material deleted successfully'),
    );
});
const getMaterial = catchAsync(async (req, res) => {
    const {kiranaId} = tenantOf(req);
    const id = commonValidation.idSchema.parse(req.params.id);
    const material = await materialService.getMaterialById(kiranaId, id);
    res.status(httpStatus.OK).json(
        new ApiResponse(httpStatus.OK, material, 'Material retrieved successfully'),
    );
});
const getMaterials = catchAsync(async (req, res) => {
    const {kiranaId} = tenantOf(req);
    const materials = await materialService.getMaterials(kiranaId);
    res.status(httpStatus.OK).json(
        new ApiResponse(httpStatus.OK, materials, 'Materials retrieved successfully'),
    );
});
export default {
    createMaterialCategory,
    updateMaterialCategory,
    deleteMaterialCategory,
    getMaterialCategory,
    getMaterialCategories,
    createMaterial,
    updateMaterial,
    deleteMaterial,
    getMaterial,
    getMaterials,
};
