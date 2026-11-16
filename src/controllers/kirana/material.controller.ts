import {materialService} from '@services/kirana';
import {catchAsync, ApiResponse} from '@utils/index';
import {materialValidation} from '@validations/index';
import httpStatus from 'http-status';
const createMaterialCategory = catchAsync(async (req, res) => {
    const parsedData = materialValidation.materialCategorySchema.parse(req.body);
    const {kiranaId} = materialValidation.kiranaIdSchema.parse(req.user);
    const materialCategory = await materialService.createMaterialCategory(kiranaId, parsedData);
    res.status(httpStatus.OK).json(
        new ApiResponse(httpStatus.OK, materialCategory, 'Material category created successfully'),
    );
});
const updateMaterialCategory = catchAsync(async (req, res) => {
    const parsedData = materialValidation.materialCategorySchema.parse(req.body);
    const materialCategory = await materialService.updateMaterialCategory(
        req.params.id,
        parsedData,
    );
    res.status(httpStatus.OK).json(
        new ApiResponse(httpStatus.OK, materialCategory, 'Material category updated successfully'),
    );
});
const deleteMaterialCategory = catchAsync(async (req, res) => {
    const materialCategory = await materialService.deleteMaterialCategory(req.params.id);
    res.status(httpStatus.OK).json(
        new ApiResponse(httpStatus.OK, materialCategory, 'Material category deleted successfully'),
    );
});
const getMaterialCategory = catchAsync(async (req, res) => {
    const materialCategory = await materialService.getMaterialCategoryById(req.params.id);
    res.status(httpStatus.OK).json(
        new ApiResponse(
            httpStatus.OK,
            materialCategory,
            'Material category retrieved successfully',
        ),
    );
});
const getMaterialCategories = catchAsync(async (req, res) => {
    const {kiranaId} = materialValidation.kiranaIdSchema.parse(req.user);
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
    const parsedData = materialValidation.materialSchema.parse(req.body);
    const {kiranaId} = materialValidation.kiranaIdSchema.parse(req.user);
    const material = await materialService.createMaterial(kiranaId, parsedData);
    res.status(httpStatus.OK).json(
        new ApiResponse(httpStatus.OK, material, 'Material created successfully'),
    );
});
const updateMaterial = catchAsync(async (req, res) => {
    const parsedData = materialValidation.updateMaterialSchema.parse(req.body);
    const material = await materialService.updateMaterial(req.params.id, parsedData);
    res.status(httpStatus.OK).json(
        new ApiResponse(httpStatus.OK, material, 'Material updated successfully'),
    );
});
const deleteMaterial = catchAsync(async (req, res) => {
    const material = await materialService.deleteMaterial(req.params.id);
    res.status(httpStatus.OK).json(
        new ApiResponse(httpStatus.OK, material, 'Material deleted successfully'),
    );
});
const getMaterial = catchAsync(async (req, res) => {
    const material = await materialService.getMaterialById(req.params.id);
    res.status(httpStatus.OK).json(
        new ApiResponse(httpStatus.OK, material, 'Material retrieved successfully'),
    );
});
const getMaterials = catchAsync(async (req, res) => {
    const {kiranaId} = materialValidation.kiranaIdSchema.parse(req.user);
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
