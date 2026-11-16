import {Router} from 'express';
import userRoute from './user.routes';
// import adminRoutes from './admin';
// import managerRoutes from './manager';
// import studentRoutes from './student';
const router = Router();

router.use('/users', userRoute);
// router.use('/admin', adminRoutes);
// router.use('/manager', managerRoutes);
// router.use('/student', studentRoutes);

export default router;
