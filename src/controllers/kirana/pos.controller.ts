import {Request} from 'express';
import httpStatus from 'http-status';
import {heldBillService} from '@services/kirana';
import {catchAsync, ApiResponse} from '@utils/index';
import {commonValidation, posValidation} from '@validations/index';
import {tenantOf} from '@middlewares/auth.middleware';
import {hasPermission} from '@config/permissions';
import {catalogContext} from './catalog.controller';

const posContext = (req: Request) => {
    const {kiranaId, storeId, userId} = catalogContext(req);
    const role = tenantOf(req).membershipRole;
    return {
        kiranaId,
        storeId,
        userId,
        canDiscount: hasPermission(role, 'pos.discount'),
        canOverridePrice: hasPermission(role, 'pos.price.override'),
    };
};

export default {
    list: catchAsync(async (req, res) => {
        const rows = await heldBillService.list(catalogContext(req));
        res.json(new ApiResponse(httpStatus.OK, rows, 'Held bills'));
    }),
    hold: catchAsync(async (req, res) => {
        const input = posValidation.holdBillSchema.parse(req.body);
        const bill = await heldBillService.hold(posContext(req), input);
        res.status(httpStatus.CREATED).json(
            new ApiResponse(httpStatus.CREATED, bill, 'Bill held'),
        );
    }),
    recall: catchAsync(async (req, res) => {
        const id = commonValidation.idSchema.parse(req.params.id);
        const bill = await heldBillService.recall(catalogContext(req), id);
        res.json(new ApiResponse(httpStatus.OK, bill, 'Held bill recalled'));
    }),
};
