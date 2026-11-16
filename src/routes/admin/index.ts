import {Router} from 'express';
import {checkAdmin, verifyJWT} from '@middlewares/index';
import softwareRoutes from './softwares.routes';
import sellerRoutes from './seller.routes';
import managerRoutes from './manager.routes';
import {adminController} from '@controllers/index';

const router = Router();
router.use(verifyJWT, checkAdmin);
router.get('/', adminController.adminDashboard);
router.use('/software', softwareRoutes);
router.use('/manager', managerRoutes);
router.use('/seller', sellerRoutes);

export default router;
