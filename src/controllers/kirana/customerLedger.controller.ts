import httpStatus from 'http-status';
import {Request} from 'express';
import customerLedgerService from '@services/kirana/customerLedger.service';
import {catchAsync, ApiResponse} from '@utils/index';
import {commonValidation, customerValidation as v} from '@validations/index';
import {tenantOf} from '@middlewares/auth.middleware';
import {catalogContext} from './catalog.controller';

// Phase 5 (A-031): statement, credit invoice dues and collections.
const kiranaOf = (req: Request) => tenantOf(req).kiranaId;
const idOf = (req: Request) => commonValidation.idSchema.parse(req.params.id);
const ok = (data: unknown, message: string) => new ApiResponse(httpStatus.OK, data, message);

export default {
    ledger: catchAsync(async (req, res) => {
        const query = v.ledgerQuerySchema.parse(req.query);
        res.json(
            ok(await customerLedgerService.ledger(kiranaOf(req), idOf(req), query), 'Statement'),
        );
    }),
    invoices: catchAsync(async (req, res) => {
        const {status} = v.invoiceQuerySchema.parse(req.query);
        const rows = await customerLedgerService.invoices(kiranaOf(req), idOf(req), status);
        res.json(ok(rows, 'Credit invoices'));
    }),
    collect: catchAsync(async (req, res) => {
        const id = idOf(req);
        const input = v.collectPaymentSchema.parse(req.body);
        const {payment, created} = await customerLedgerService.collect(
            catalogContext(req),
            id,
            input,
        );
        const status = created ? httpStatus.CREATED : httpStatus.OK;
        res.status(status).json(new ApiResponse(status, payment, 'Payment recorded'));
    }),
    payment: catchAsync(async (req, res) => {
        const {id, paymentId} = v.paymentParams.parse(req.params);
        res.json(ok(await customerLedgerService.payment(kiranaOf(req), id, paymentId), 'Payment'));
    }),
};
