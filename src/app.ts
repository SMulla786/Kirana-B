import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cors from 'cors';
import httpStatus from 'http-status';
import cookieParser from 'cookie-parser';

import {config, morgan, swaggerRouter} from '@config/index';
import {
    // xss,
    requestId,
    notFoundHandler,
    errorConverter,
    errorHandler,
} from '@middlewares/index';
import routes from '@routes/index';
import {ApiResponse} from '@utils/index';
import prisma from './client';

// Create Express app
const app = express();
app.use(requestId);

// Middleware setup
app.use(helmet()); // Set security HTTP headers
app.use(express.json({limit: '1mb'})); // Parse JSON request body with size limit
app.use(express.urlencoded({extended: true, limit: '1mb'})); // Parse URL-encoded request body with size limit
app.use(express.static('public')); // Serve static files
app.use(cookieParser()); // Parse cookies

app.use(compression());
app.use(
    cors({
        origin: config.cors.origins,
        credentials: true,
    }),
);

// Logging middleware
if (config.env !== 'test') {
    app.use(morgan.successHandler);
    app.use(morgan.errorHandler);
}

// Health (before auth and routes)
app.get('/health', async (_req, res) => {
    try {
        await prisma.$queryRaw`SELECT 1`;
        res.status(200).json(new ApiResponse(200, {status: 'ok', db: 'up'}, 'OK'));
    } catch {
        res.status(503).json(
            new ApiResponse(503, {status: 'degraded', db: 'down'}, 'Service unavailable'),
        );
    }
});

// Routes
app.use('/api/v1', routes); // API routes
app.use(swaggerRouter); // Swagger documentation routes
app.get('/', (req, res) => {
    res.status(httpStatus.OK).json(new ApiResponse(httpStatus.OK, undefined, 'KiranaOS API'));
});

// Error handling
app.use(notFoundHandler);
app.use(errorConverter); // Convert errors to ApiError
app.use(errorHandler); // Handle errors

export default app;
