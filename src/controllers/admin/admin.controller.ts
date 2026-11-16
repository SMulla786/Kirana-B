import {adminService} from '@services/admin';
import {catchAsync, ApiResponse} from '@utils/index';
import httpStatus from 'http-status';
const adminDashboard = catchAsync(async (req, res) => {
    const dashboard = await adminService.getDashboard();
    res.status(httpStatus.OK).json(
        new ApiResponse(httpStatus.OK, dashboard, 'Dashboard retrieved successfully'),
    );
});
export default {
    adminDashboard,
};
