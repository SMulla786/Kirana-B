import httpStatus from 'http-status';
import {adminService} from '@services/admin';
import {businessService} from '@services/index';
import {catchAsync, ApiResponse} from '@utils/index';
import {userValidation} from '@validations/index';

const adminDashboard = catchAsync(async (req, res) => {
    const dashboard = await adminService.getDashboard();
    res.status(httpStatus.OK).json(
        new ApiResponse(httpStatus.OK, dashboard, 'Dashboard retrieved successfully'),
    );
});

/** Platform admin onboards a shop: owner login (pre-verified) + business + default store. */
const createBusiness = catchAsync(async (req, res) => {
    const data = userValidation.registerSchema.parse(req.body);
    const {user, kirana, store} = await businessService.createBusinessWithOwner(data, {
        verified: true,
    });
    res.status(httpStatus.CREATED).json(
        new ApiResponse(
            httpStatus.CREATED,
            {
                business: {id: kirana.id, name: kirana.name},
                store: {id: store.id, name: store.name},
                owner: {id: user.id, username: user.username, email: user.email},
            },
            'Business created',
        ),
    );
});

export default {adminDashboard, createBusiness};
