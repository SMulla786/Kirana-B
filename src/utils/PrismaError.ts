import {ApiError} from './index';
import {Prisma} from '@prisma/client';

// Never echo values or raw Prisma messages to clients.
const mapError = (error: Prisma.PrismaClientKnownRequestError): [number, string] => {
    switch (error.code) {
        case 'P2002': {
            const target = error.meta?.target;
            const fields = Array.isArray(target) ? target.join(', ') : 'fields';
            return [409, `A record with the same ${fields} already exists`];
        }
        case 'P2025':
        case 'P2001':
            return [404, 'Record not found'];
        case 'P2003':
            return [409, 'Operation conflicts with related records'];
        case 'P2000':
            return [400, 'Value too long'];
        case 'P2024':
            return [503, 'Database busy, please retry'];
        case 'P2034':
            return [409, 'Write conflict, please retry'];
        default:
            return [500, 'Database error'];
    }
};

class PrismaError extends ApiError {
    constructor(error: Prisma.PrismaClientKnownRequestError) {
        super(...mapError(error));
    }
}

export default PrismaError;
