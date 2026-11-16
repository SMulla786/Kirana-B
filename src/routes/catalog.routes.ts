import {Router} from 'express';
import materialController from '@controllers/kirana/material.controller';
import {verifyJWT, requirePermission} from '@middlewares/auth.middleware';

const router = Router();
const c = materialController;
router.use(verifyJWT);

router.get('/categories', requirePermission('catalog.read'), c.getMaterialCategories);
router.post('/categories', requirePermission('catalog.manage'), c.createMaterialCategory);
router.get('/categories/:id', requirePermission('catalog.read'), c.getMaterialCategory);
router.patch('/categories/:id', requirePermission('catalog.manage'), c.updateMaterialCategory);
router.delete('/categories/:id', requirePermission('catalog.manage'), c.deleteMaterialCategory);

router.get('/products', requirePermission('catalog.read'), c.getMaterials);
router.post('/products', requirePermission('catalog.manage'), c.createMaterial);
router.get('/products/:id', requirePermission('catalog.read'), c.getMaterial);
router.patch('/products/:id', requirePermission('catalog.manage'), c.updateMaterial);
router.delete('/products/:id', requirePermission('catalog.manage'), c.deleteMaterial);

export default router;
