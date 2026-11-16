import {randomUUID} from 'node:crypto';
import {Request, Response, NextFunction} from 'express';

const VALID_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const requestId = (req: Request, res: Response, next: NextFunction) => {
    const incoming = req.get('X-Request-Id');
    const id = incoming && VALID_ID.test(incoming) ? incoming : randomUUID();
    res.locals.requestId = id;
    res.setHeader('X-Request-Id', id);
    next();
};
