import {Request} from 'express';
import httpStatus from 'http-status';
import customerService from '@services/kirana/customer.service';
import {catchAsync, ApiResponse} from '@utils/index';
import {commonValidation, customerValidation as cv} from '@validations/index';
import {tenantOf} from '@middlewares/auth.middleware';
import {hasPermission} from '@config/permissions';

const ctxOf = (req: Request) => {
    const t = tenantOf(req);
    return {
        kiranaId: t.kiranaId,
        userId: t.id,
        canSetCreditLimit: hasPermission(t.membershipRole, 'customers.credit'),
    };
};
const idOf = (req: Request) => commonValidation.idSchema.parse(req.params.id);

export default {
    list: catchAsync(async (req, res) => {
        const query = cv.customerQuerySchema.parse(req.query);
        const page = await customerService.list(tenantOf(req).kiranaId, query);
        res.json(new ApiResponse(httpStatus.OK, page, 'Customers'));
    }),
    create: catchAsync(async (req, res) => {
        const input = cv.createCustomerSchema.parse(req.body);
        const row = await customerService.create(ctxOf(req), input);
        res.status(httpStatus.CREATED).json(
            new ApiResponse(httpStatus.CREATED, row, 'Customer created'),
        );
    }),
    get: catchAsync(async (req, res) => {
        const row = await customerService.get(tenantOf(req).kiranaId, idOf(req));
        res.json(new ApiResponse(httpStatus.OK, row, 'Customer'));
    }),
    update: catchAsync(async (req, res) => {
        const input = cv.updateCustomerSchema.parse(req.body);
        const row = await customerService.update(ctxOf(req), idOf(req), input);
        res.json(new ApiResponse(httpStatus.OK, row, 'Customer updated'));
    }),
    adjust: catchAsync(async (req, res) => {
        const input = cv.adjustmentSchema.parse(req.body);
        const {entry, created} = await customerService.adjust(ctxOf(req), idOf(req), input);
        const status = created ? httpStatus.CREATED : httpStatus.OK;
        res.status(status).json(new ApiResponse(status, entry, 'Ledger entry posted'));
    }),
    reverse: catchAsync(async (req, res) => {
        const {id, entryId} = cv.entryParams.parse(req.params);
        const input = cv.reverseEntrySchema.parse(req.body);
        const {entry, created} = await customerService.reverse(ctxOf(req), id, entryId, input);
        const status = created ? httpStatus.CREATED : httpStatus.OK;
        res.status(status).json(new ApiResponse(status, entry, 'Entry reversed'));
    }),
};
