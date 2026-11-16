import {Request, Response, NextFunction, ErrorRequestHandler} from 'express';
import {ZodError} from 'zod';
import httpStatus from 'http-status';
import {ApiError, ApiResponse, PrismaError} from '@utils/index';
import {logger} from '@config/index';
import {Prisma} from '@prisma/client';

const notFoundHandler = (_req: Request, _res: Response, next: NextFunction) => {
    next(new ApiError(httpStatus.NOT_FOUND, 'Not found'));
};

const errorConverter: ErrorRequestHandler = (err, _req, _res, next) => {
    let converted: ApiError;
    if (err instanceof ApiError) {
        converted = err;
    } else if (err instanceof ZodError) {
        const errors = err.errors.map((error) => ({
            field: error.path.join('.'),
            message: error.message,
        }));
        converted = new ApiError(httpStatus.BAD_REQUEST, 'Validation failed', errors);
    } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
        converted = new PrismaError(err);
    } else {
        const status = Number(err?.status ?? err?.statusCode);
        if (Number.isInteger(status) && status >= 400 && status < 500) {
            converted = new ApiError(
                status,
                status === httpStatus.REQUEST_ENTITY_TOO_LARGE
                    ? 'Request body too large'
                    : 'Invalid request body',
            );
        } else {
            converted = new ApiError(httpStatus.INTERNAL_SERVER_ERROR, 'Internal server error');
        }
    }
    if (converted !== err) converted.cause = err;
    next(converted);
};

const errorHandler: ErrorRequestHandler = (err, _req, res, next) => {
    if (res.headersSent) return next(err);
    const statusCode: number = err.statusCode || httpStatus.INTERNAL_SERVER_ERROR;
    const {message} = err;
    if (statusCode >= 500) {
        logger.error(`[${res.locals.requestId}] ${(err.cause ?? err)?.stack ?? err.message}`);
    }
    res.locals.errorMessage = message;
    res.status(statusCode).json(
        new ApiResponse(
            statusCode,
            undefined,
            message,
            err.errors?.length ? err.errors : undefined,
        ),
    );
};

export {errorHandler, errorConverter, notFoundHandler};
