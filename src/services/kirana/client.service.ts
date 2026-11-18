import prisma from 'client';
import {clientValidation} from '@validations/index';
import z from 'zod';
import ApiError from '@utils/ApiError';
type registerClientData = z.infer<typeof clientValidation.registerClientSchema>;
class clientService {
    public async registerClient(kiranaId: string, data: registerClientData) {
        const client = await prisma.client.create({
            data: {
                ...data,
                kiranaId,
            },
        });
        return client;
    }
    public searchCustomers(kiranaId: string, q?: string) {
        return prisma.client.findMany({
            where: {
                kiranaId,
                ...(q
                    ? {
                          OR: [
                              {name: {contains: q, mode: 'insensitive'}},
                              {phoneNumber: {contains: q}},
                          ],
                      }
                    : {}),
            },
            select: {id: true, name: true, phoneNumber: true},
            orderBy: {name: 'asc'},
            take: 20,
        });
    }
    /**
     * A family may share one phone (A-031): the same name on a phone is refused, and a second name on a
     * phone already in use needs `sharedPhone: true`. The 409 lists the customers on that phone.
     */
    public async createCustomer(
        kiranaId: string,
        data: {name: string; phoneNumber: string; sharedPhone?: boolean},
    ) {
        const onPhone = await prisma.client.findMany({
            where: {kiranaId, phoneNumber: data.phoneNumber},
            select: {id: true, name: true},
        });
        const clash = (message: string) =>
            new ApiError(409, message, [{field: 'phoneNumber', message, customers: onPhone}]);
        const name = data.name.toLowerCase();
        if (onPhone.some((c) => c.name.trim().toLowerCase() === name)) {
            throw clash('A customer with this name already uses this phone');
        }
        if (onPhone.length && !data.sharedPhone) {
            throw clash('This phone belongs to another customer; confirm it is a shared phone');
        }
        return prisma.client.create({
            data: {name: data.name, phoneNumber: data.phoneNumber, address: '', kiranaId},
            select: {id: true, name: true, phoneNumber: true},
        });
    }
    public async updateClient(kiranaId: string, id: string, data: registerClientData) {
        await this.guard(kiranaId, id);
        const client = await prisma.client.update({
            where: {id},
            data,
        });
        return client;
    }
    public async deleteClient(kiranaId: string, id: string) {
        await this.guard(kiranaId, id);
        const client = await prisma.client.delete({
            where: {id},
        });
        return client;
    }
    private async guard(kiranaId: string, id: string) {
        const c = await prisma.client.findFirst({where: {id, kiranaId}, select: {id: true}});
        if (!c) throw new ApiError(404, 'Client not found');
    }
    public async getClient(kiranaId: string, id: string) {
        const client = await prisma.client.findFirst({
            where: {id, kiranaId},
            include: {
                order: true,
                clientWallet: true,
                clientWalletHistory: true,
            },
        });
        if (!client) throw new ApiError(404, 'Client not found');
        return client;
    }
    public async getClients(kiranaId: string) {
        const clients = await prisma.client.findMany({
            where: {kiranaId},
            include: {
                order: true,
            },
        });
        return clients;
    }
}
export default new clientService();
