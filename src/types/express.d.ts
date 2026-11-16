import {MembershipRole, Role} from '@prisma/client';

declare global {
    namespace Express {
        interface Request {
            user?: {
                id: string;
                username: string;
                email: string;
                fullname: string;
                phoneNumber: string;
                role: Role;
                sessionId: string;
                /** Tenant for this session, resolved server-side from the session row. */
                kiranaId?: string;
                storeId?: string;
                membershipRole?: MembershipRole;
            };
        }
    }
}
