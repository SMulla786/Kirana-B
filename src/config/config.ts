import {z} from 'zod';

const envVarsSchema = z
    .object({
        NODE_ENV: z.enum(['production', 'development', 'test']),
        PORT: z.coerce.number().default(3000),
        JWT_SECRET: z.string().min(1).describe('JWT secret key (access tokens only)'),
        JWT_ACCESS_EXPIRATION_MINUTES: z.coerce
            .number()
            .int()
            .min(1)
            .max(60)
            .default(15)
            .describe('minutes after which access tokens expire (short-lived by design)'),
        JWT_REFRESH_EXPIRATION_DAYS: z.coerce
            .number()
            .default(30)
            .describe('days after which refresh tokens expire'),
        JWT_RESET_PASSWORD_EXPIRATION_MINUTES: z.coerce
            .number()
            .default(10)
            .describe('minutes after which a password reset link expires'),
        JWT_VERIFY_EMAIL_EXPIRATION_MINUTES: z.coerce
            .number()
            .default(10)
            .describe('minutes after which verify email token expires'),
        SMTP_HOST: z.string().optional().describe('server that will send the emails'),
        SMTP_PORT: z.coerce.number().optional().describe('port to connect to the email server'),
        SMTP_USERNAME: z.string().optional().describe('username for email server'),
        SMTP_PASSWORD: z.string().optional().describe('password for email server'),
        EMAIL_FROM: z.string().optional().describe('the from field in the emails sent by the app'),
        APP_URL: z
            .string()
            .url()
            .default('http://localhost:5173')
            .describe('web admin base URL used in email links'),
        AUTH_RATE_LIMIT_MAX: z.coerce
            .number()
            .int()
            .min(1)
            .default(20)
            .describe('failed auth requests allowed per IP per 15 minutes'),
        CORS_ORIGINS: z
            .string()
            .optional()
            .describe('comma-separated list of allowed origins for CORS'),
    })
    .refine((env) => env.NODE_ENV !== 'production' || env.JWT_SECRET.length >= 32, {
        message: 'JWT_SECRET must be at least 32 characters in production',
        path: ['JWT_SECRET'],
    });

const parseEnvVars = () => {
    try {
        // Parse and validate process.env with the Zod schema
        const envVars = envVarsSchema.parse(process.env);
        return envVars;
    } catch (error: unknown) {
        if (error instanceof Error) {
            throw new Error(`Config validation error: ${error.message}`);
        } else {
            throw new Error('Config validation error: Unknown error');
        }
    }
};

const envVars = parseEnvVars();

export default {
    env: envVars.NODE_ENV,
    port: envVars.PORT,
    jwt: {
        secret: envVars.JWT_SECRET,
        accessExpirationMinutes: envVars.JWT_ACCESS_EXPIRATION_MINUTES,
        refreshExpirationDays: envVars.JWT_REFRESH_EXPIRATION_DAYS,
        resetPasswordExpirationMinutes: envVars.JWT_RESET_PASSWORD_EXPIRATION_MINUTES,
        verifyEmailExpirationMinutes: envVars.JWT_VERIFY_EMAIL_EXPIRATION_MINUTES,
    },
    email: {
        smtp: {
            host: envVars.SMTP_HOST,
            port: envVars.SMTP_PORT,
            auth: {
                user: envVars.SMTP_USERNAME,
                pass: envVars.SMTP_PASSWORD,
            },
        },
        from: envVars.EMAIL_FROM,
    },
    appUrl: envVars.APP_URL.replace(/\/$/, ''),
    authRateLimitMax: envVars.AUTH_RATE_LIMIT_MAX,
    cors: {
        origins: envVars.CORS_ORIGINS
            ? envVars.CORS_ORIGINS.split(',').map((origin) => origin.trim())
            : [],
    },
};
