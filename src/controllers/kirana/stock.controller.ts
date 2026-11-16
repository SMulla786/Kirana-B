import httpStatus from 'http-status';
import {stockService} from '@services/kirana';
import {catchAsync, ApiResponse} from '@utils/index';
import {catalogValidation} from '@validations/index';
import {catalogContext} from './catalog.controller';

export default {
    listMovements: catchAsync(async (req, res) => {
        const query = catalogValidation.movementQuerySchema.parse(req.query);
        const page = await stockService.listMovements(catalogContext(req), query);
        res.json(new ApiResponse(httpStatus.OK, page, 'Stock movements'));
    }),
    recordMovement: catchAsync(async (req, res) => {
        const ctx = catalogContext(req);
        const input = catalogValidation.createMovementSchema.parse(req.body);
        const {movement, replayed} = await stockService.recordMovement(ctx, input);
        // A replayed idempotency key returns the original movement with 200.
        const status = replayed ? httpStatus.OK : httpStatus.CREATED;
        res.status(status).json(new ApiResponse(status, movement, 'Stock movement recorded'));
    }),
};
