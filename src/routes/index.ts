import {Router} from 'express';
import authRoutes from './auth.routes';
import businessRoutes from './business.routes';
import catalogRoutes from './catalog.routes';
import stockRoutes from './stock.routes';
import adminRoutes from './admin';

const router = Router();

router.use('/auth', authRoutes);
router.use('/business', businessRoutes);
router.use('/catalog', catalogRoutes);
router.use('/stock', stockRoutes);
router.use('/admin', adminRoutes);

export default router;
