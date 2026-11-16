import prisma from 'client';
import {clientValidation} from '@validations/index';
import z from 'zod';
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
    public async updateClient(id: string, data: registerClientData) {
        const client = await prisma.client.update({
            where: {id},
            data,
        });
        return client;
    }
    public async deleteClient(id: string) {
        const client = await prisma.client.delete({
            where: {id},
        });
        return client;
    }
    public async getClient(id: string) {
        const client = await prisma.client.findUnique({
            where: {id},
            include: {
                order: true,
                clientWallet: true,
                clientWalletHistory: true,
            },
        });
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
