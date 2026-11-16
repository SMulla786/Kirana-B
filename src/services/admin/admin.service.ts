import prisma from 'client';

class adminService {
    public async getDashboard() {
        const kirana = await prisma.kirana.count();
        const employee = await prisma.employee.count();
        const material = await prisma.material.count();
        const client = await prisma.client.count();
        const order = await prisma.order.count();
        const purchaseOrder = await prisma.purchaseOrder.count();
        return {kirana, employee, material, client, order, purchaseOrder};
    }
}
export default new adminService();
