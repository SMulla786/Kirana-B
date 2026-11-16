import ApiError from '@utils/ApiError';
import prisma from 'client';
import {kiranaValidation} from '@validations/index';
import {z} from 'zod';
import userService from '@services/user.service';
type SoftwareSoldData = z.infer<typeof kiranaValidation.createKiranaSchema>;

class managerService {
    public async createKirana(data: SoftwareSoldData) {
        const {user, ...kiranaData} = data;
        const users = await userService.registerUser(data.user);
        if (!user) throw new ApiError(404, 'User not found');
        const kirana = await prisma.kirana.create({
            data: {
                ...kiranaData,
                userId: users.id,
            },
        });
        return kirana;
    }
    public async updateKirana(id: string, data: SoftwareSoldData) {
        const {user, ...kiranaData} = data;
        if (!user) throw new ApiError(404, 'User not found');
        const kirana = await prisma.kirana.update({
            where: {id},
            data: {
                ...kiranaData,
            },
        });
        return kirana;
    }
    public async deleteKirana(id: string) {
        const kirana = await prisma.kirana.delete({
            where: {id},
        });
        return kirana;
    }
    public async getKirana(id: string) {
        const kirana = await prisma.kirana.findUnique({
            where: {id},
        });
        return kirana;
    }
    public async getKiranaByUserId(id: string) {
        const kirana = await prisma.kirana.findUnique({
            where: {userId: id},
        });
        return kirana;
    }
}
export default new managerService();
