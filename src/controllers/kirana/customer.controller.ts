import httpStatus from 'http-status';
import {clientService} from '@services/kirana';
import {catchAsync, ApiResponse} from '@utils/index';
import {clientValidation} from '@validations/index';
import {tenantOf} from '@middlewares/auth.middleware';

export default {
    list: catchAsync(async (req, res) => {
        const {q} = clientValidation.customerQuerySchema.parse(req.query);
        const rows = await clientService.searchCustomers(tenantOf(req).kiranaId, q);
        res.json(new ApiResponse(httpStatus.OK, rows, 'Customers'));
    }),
    create: catchAsync(async (req, res) => {
        const input = clientValidation.createCustomerSchema.parse(req.body);
        const row = await clientService.createCustomer(tenantOf(req).kiranaId, input);
        res.status(httpStatus.CREATED).json(
            new ApiResponse(httpStatus.CREATED, row, 'Customer created'),
        );
    }),
};
