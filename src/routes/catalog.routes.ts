import {Router} from 'express';
import c from '@controllers/kirana/catalog.controller';
import {verifyJWT, requirePermission} from '@middlewares/auth.middleware';

const router = Router();
const read = requirePermission('catalog.read');
const manage = requirePermission('catalog.manage');
router.use(verifyJWT);

router.get('/categories', read, c.listCategories);
router.post('/categories', manage, c.createCategory);
router.get('/categories/:id', read, c.getCategory);
router.patch('/categories/:id', manage, c.updateCategory);
router.delete('/categories/:id', manage, c.deleteCategory);

router.get('/brands', read, c.listBrands);
router.post('/brands', manage, c.createBrand);
router.patch('/brands/:id', manage, c.updateBrand);
router.delete('/brands/:id', manage, c.deleteBrand);

// Products are archived (PATCH status), never deleted: the ledger and price history reference them.
router.get('/products', read, c.listProducts);
router.post('/products', manage, c.createProduct);
router.get('/products/:id', read, c.getProduct);
router.patch('/products/:id', manage, c.updateProduct);
router.get('/products/:id/prices', read, c.priceHistory);
router.get('/lookup', read, c.lookup);
router.post('/import', manage, c.importProducts);

export default router;
