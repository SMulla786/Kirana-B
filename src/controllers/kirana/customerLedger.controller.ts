import httpStatus from 'http-status';
import {catchAsync, ApiError} from '@utils/index';

// Phase 5 contract stub: the ledger/statement, invoice dues and collections slice fills these in.
const todo = catchAsync(async () => {
    throw new ApiError(httpStatus.NOT_IMPLEMENTED, 'Not built yet (Phase 5)');
});

export default {ledger: todo, invoices: todo, collect: todo, payment: todo};
