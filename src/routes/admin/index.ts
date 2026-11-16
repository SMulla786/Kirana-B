import {Router} from 'express';
import {checkAdmin, verifyJWT} from '@middlewares/index';
import {adminController} from '@controllers/index';

const router = Router();
router.use(verifyJWT, checkAdmin);
router.get('/', adminController.adminDashboard);

export default router;
