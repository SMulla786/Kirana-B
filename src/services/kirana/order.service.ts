import prisma from 'client';
import {orderValidation} from '@validations/index';
import z from 'zod';
import ApiError from '@utils/ApiError';
type createOrder = z.infer<typeof orderValidation.createOrderSchema>;

class OrderService {
    private async assertMaterials(
        kiranaId: string,
        items: {materialId: string}[] | undefined,
        db: Pick<typeof prisma, 'kiranaMaterial'> = prisma,
    ) {
        const ids = [...new Set((items ?? []).map((i) => i.materialId))];
        if (!ids.length) return;
        const n = await db.kiranaMaterial.count({where: {id: {in: ids}, kiranaId}});
        if (n !== ids.length) throw new ApiError(404, 'Product not found');
    }

    public async createOrder(kiranaId: string, data: createOrder) {
        const {client, orderItems = [], ...orderData} = data;

        const totalPrice =
            orderData.totalPrice ??
            orderItems.reduce(
                (s, it) => s + (Number(it.price) || 0) * (Number(it.quantity) || 0),
                0,
            );

        await this.assertMaterials(kiranaId, orderItems);
        return await prisma.$transaction(async (tx) => {
            const cli = await tx.client.upsert({
                where: {kiranaId_phoneNumber: {kiranaId, phoneNumber: client.phoneNumber}},
                update: client,
                create: {...client, kiranaId},
            });

            const ord = await tx.order.create({
                data: {...orderData, clientId: cli.id, kiranaId, totalPrice},
            });

            if (orderItems.length) {
                await tx.orderItem.createMany({
                    data: orderItems.map((it) => ({
                        orderId: ord.id,
                        materialId: it.materialId,
                        quantity: it.quantity,
                        price: it.price,
                    })),
                });
            }

            await tx.clientWallet.upsert({
                where: {clientId: cli.id},
                update: {
                    clientWalletHistories: {
                        create: {
                            type: 'DEBIT',
                            amount: totalPrice,
                            orderId: ord.id,
                            clientId: cli.id,
                        },
                    },
                },
                create: {
                    clientId: cli.id,
                    amount: 0,
                    clientWalletHistories: {
                        create: {
                            type: 'DEBIT',
                            amount: totalPrice,
                            orderId: ord.id,
                            clientId: cli.id,
                        },
                    },
                },
            });

            return ord;
        });
    }

    public async updateOrder(kiranaId: string, id: string, data: createOrder) {
        return await prisma.$transaction(async (tx) => {
            const ex = await tx.order.findFirst({
                where: {id, kiranaId},
                include: {orderItem: true},
            });
            if (!ex) throw new ApiError(404, 'Order not found');

            const {client, orderItems, ...od} = data;
            await this.assertMaterials(kiranaId, orderItems, tx);

            const cliId = client
                ? (
                      await tx.client.upsert({
                          where: {
                              kiranaId_phoneNumber: {
                                  kiranaId: ex.kiranaId,
                                  phoneNumber: client.phoneNumber,
                              },
                          },
                          update: client,
                          create: {...client, kiranaId: ex.kiranaId},
                      })
                  ).id
                : ex.clientId;

            let tot = od.totalPrice;
            if (tot == null) {
                if (orderItems?.length) {
                    tot = orderItems.reduce(
                        (s, it) => s + (Number(it.price) || 0) * (Number(it.quantity) || 0),
                        0,
                    );
                } else {
                    tot = ex.totalPrice ?? 0;
                }
            }

            const ord = await tx.order.update({
                where: {id},
                data: {...od, clientId: cliId, totalPrice: tot},
            });

            if (orderItems) {
                await tx.orderItem.deleteMany({where: {orderId: id}});
                if (orderItems.length) {
                    await tx.orderItem.createMany({
                        data: orderItems.map((it) => ({
                            orderId: ord.id,
                            materialId: it.materialId,
                            quantity: it.quantity,
                            price: it.price,
                        })),
                    });
                }
            }

            return ord;
        });
    }

    public async deleteOrder(kiranaId: string, id: string) {
        const ex = await prisma.order.findFirst({where: {id, kiranaId}, select: {id: true}});
        if (!ex) throw new ApiError(404, 'Order not found');
        return prisma.order.delete({where: {id}});
    }
    public async getOrder(kiranaId: string, id: string) {
        const order = await prisma.order.findFirst({
            where: {id, kiranaId},
            include: {
                client: true,
                orderItem: {
                    include: {
                        material: true,
                    },
                },
            },
        });
        if (!order) throw new ApiError(404, 'Order not found');
        return order;
    }
    public async getOrders(kiranaId: string) {
        const orders = await prisma.order.findMany({
            where: {kiranaId},
            include: {
                client: true,
            },
        });
        return orders;
    }
    public async getOrdersByClientId(kiranaId: string, clientId: string) {
        const orders = await prisma.order.findMany({
            where: {clientId, kiranaId},
            include: {
                client: true,
            },
        });
        return orders;
    }
}
export default new OrderService();
