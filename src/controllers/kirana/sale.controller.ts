import httpStatus from 'http-status';
import saleReturnService from '@services/kirana/saleReturn.service';
import {catchAsync, ApiResponse} from '@utils/index';
import {commonValidation, saleValidation} from '@validations/index';
import {catalogContext} from './catalog.controller';

export default {
    list: catchAsync(async (req, res) => {
        const query = saleValidation.saleQuerySchema.parse(req.query);
        const page = await saleReturnService.list(catalogContext(req), query);
        res.json(new ApiResponse(httpStatus.OK, page, 'Sales'));
    }),
    createReturn: catchAsync(async (req, res) => {
        const id = commonValidation.idSchema.parse(req.params.id);
        const input = saleValidation.createReturnSchema.parse(req.body);
        const {saleReturn, created} = await saleReturnService.create(
            catalogContext(req),
            id,
            input,
        );
        const status = created ? httpStatus.CREATED : httpStatus.OK;
        res.status(status).json(new ApiResponse(status, saleReturn, 'Return recorded'));
    }),
};
