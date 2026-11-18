import httpStatus from 'http-status';
import {clientService} from '@services/kirana';
import {catchAsync, ApiError, ApiResponse} from '@utils/index';
import {clientValidation, customerValidation} from '@validations/index';
import {tenantOf} from '@middlewares/auth.middleware';

// Phase 5 contract stub: the customers slice replaces these.
const todo = catchAsync(async () => {
    throw new ApiError(httpStatus.NOT_IMPLEMENTED, 'Not built yet (Phase 5)');
});

export default {
    get: todo,
    update: todo,
    adjust: todo,
    reverse: todo,
    list: catchAsync(async (req, res) => {
        const {q} = clientValidation.customerQuerySchema.parse(req.query);
        const rows = await clientService.searchCustomers(tenantOf(req).kiranaId, q);
        res.json(new ApiResponse(httpStatus.OK, rows, 'Customers'));
    }),
    create: catchAsync(async (req, res) => {
        const input = customerValidation.createCustomerSchema.parse(req.body);
        const row = await clientService.createCustomer(tenantOf(req).kiranaId, input);
        res.status(httpStatus.CREATED).json(
            new ApiResponse(httpStatus.CREATED, row, 'Customer created'),
        );
    }),
};
