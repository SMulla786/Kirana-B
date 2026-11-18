import {Request} from 'express';
import httpStatus from 'http-status';
import {heldBillService, saleService} from '@services/kirana';
import {catchAsync, ApiResponse} from '@utils/index';
import {commonValidation, posValidation, saleValidation} from '@validations/index';
import {tenantOf} from '@middlewares/auth.middleware';
import {hasPermission} from '@config/permissions';
import {catalogContext} from './catalog.controller';

const posContext = (req: Request) => {
    const {kiranaId, storeId, userId, canSeeCost} = catalogContext(req);
    const role = tenantOf(req).membershipRole;
    return {
        kiranaId,
        storeId,
        userId,
        canSeeCost,
        canDiscount: hasPermission(role, 'pos.discount'),
        canOverridePrice: hasPermission(role, 'pos.price.override'),
        canCredit: hasPermission(role, 'pos.credit'),
        canOverrideCredit: hasPermission(role, 'pos.credit.override'),
    };
};

export default {
    list: catchAsync(async (req, res) => {
        const rows = await heldBillService.list(catalogContext(req));
        res.json(new ApiResponse(httpStatus.OK, rows, 'Held bills'));
    }),
    hold: catchAsync(async (req, res) => {
        const input = posValidation.holdBillSchema.parse(req.body);
        const {bill, created} = await heldBillService.hold(posContext(req), input);
        const status = created ? httpStatus.CREATED : httpStatus.OK;
        res.status(status).json(new ApiResponse(status, bill, 'Bill held'));
    }),
    recall: catchAsync(async (req, res) => {
        const id = commonValidation.idSchema.parse(req.params.id);
        const {claimKey} = posValidation.claimSchema.parse(req.body);
        const bill = await heldBillService.recall(catalogContext(req), id, claimKey);
        res.json(new ApiResponse(httpStatus.OK, bill, 'Held bill recalled'));
    }),
    confirm: catchAsync(async (req, res) => {
        const id = commonValidation.idSchema.parse(req.params.id);
        const {claimKey} = posValidation.claimSchema.parse(req.query);
        await heldBillService.confirm(catalogContext(req), id, claimKey);
        res.status(httpStatus.NO_CONTENT).end();
    }),
    checkout: catchAsync(async (req, res) => {
        const input = saleValidation.checkoutSchema.parse(req.body);
        const preview = await saleService.preview(posContext(req), input);
        res.json(new ApiResponse(httpStatus.OK, preview, 'Checkout'));
    }),
    completeSale: catchAsync(async (req, res) => {
        const input = saleValidation.completeSaleSchema.parse(req.body);
        const {sale, created} = await saleService.complete(posContext(req), input);
        const status = created ? httpStatus.CREATED : httpStatus.OK;
        res.status(status).json(new ApiResponse(status, sale, 'Sale completed'));
    }),
};
