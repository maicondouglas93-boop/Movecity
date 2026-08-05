const mongoose = require('mongoose');
const notificationModel = require('../../models/notification.model');
const inboxService = require('../../notification/inbox.service');
const { resolveMeta, toInboxDTO } = require('../../notification/notificationMeta');
const { createUser } = require('../factories/user.factory');
const { createCaptain } = require('../factories/captain.factory');

describe('Notification inbox (central in-app)', () => {
    let user;
    let captain;
    let otherUser;

    beforeEach(async () => {
        await notificationModel.deleteMany({});
        user = await createUser({ email: `inbox_u_${Date.now()}@test.com` });
        otherUser = await createUser({ email: `inbox_o_${Date.now()}@test.com` });
        captain = await createCaptain({ email: `inbox_c_${Date.now()}@test.com` });
    });

    it('resolveMeta mapeia NEW_RIDE para categoria ride e ícone', () => {
        const meta = resolveMeta({ type: 'NEW_RIDE', data: { rideId: 'abc', deepLink: '/captain-home' } });
        expect(meta.category).toBe('ride');
        expect(meta.icon).toBe('🚖');
        expect(meta.action).toBe('/captain-home');
        expect(meta.referenceId).toBe('abc');
    });

    it('createInboxNotifications grava por destinatário com campos da central', async () => {
        const created = await inboxService.createInboxNotifications({
            recipients: [{ userId: user._id }, { captainId: captain._id }],
            title: 'Aviso admin',
            message: 'Nova política',
            type: 'ADMIN',
            category: 'admin',
            priority: 'high',
            action: '/home',
            origin: 'admin',
        });
        expect(created).toHaveLength(2);
        expect(created[0].category).toBe('admin');
        expect(created[0].icon).toBe('🛡️');
        expect(created[0].lida).toBe(false);
    });

    it('listInbox só retorna notificações do usuário autenticado', async () => {
        await inboxService.createInboxNotifications({
            recipients: [{ userId: user._id }],
            title: 'Sua',
            message: 'msg',
            type: 'ADMIN',
        });
        await inboxService.createInboxNotifications({
            recipients: [{ userId: otherUser._id }],
            title: 'Outra',
            message: 'msg',
            type: 'ADMIN',
        });

        const req = { user: { _id: user._id } };
        const result = await inboxService.listInbox(req, { limit: 20 });
        expect(result.items).toHaveLength(1);
        expect(result.items[0].title).toBe('Sua');
    });

    it('markRead e unreadCount respeitam ownership', async () => {
        const [mine] = await inboxService.createInboxNotifications({
            recipients: [{ userId: user._id }],
            title: 'Ler',
            message: 'x',
            type: 'PROMOTION',
            category: 'promotion',
        });

        const req = { user: { _id: user._id } };
        expect((await inboxService.unreadCount(req)).count).toBe(1);

        const updated = await inboxService.markRead(req, mine.id);
        expect(updated.lida).toBe(true);
        expect(updated.readAt).toBeTruthy();
        expect((await inboxService.unreadCount(req)).count).toBe(0);

        const otherReq = { user: { _id: otherUser._id } };
        await expect(inboxService.markRead(otherReq, mine.id)).rejects.toMatchObject({ status: 404 });
    });

    it('markAllRead e clearRead funcionam em lote', async () => {
        await inboxService.createInboxNotifications({
            recipients: [{ captainId: captain._id }, { captainId: captain._id }],
            title: 'Dupla',
            message: 'a',
            type: 'PAYMENT',
        });
        const req = { captain: { _id: captain._id } };
        expect((await inboxService.unreadCount(req)).count).toBe(2);
        await inboxService.markAllRead(req);
        expect((await inboxService.unreadCount(req)).count).toBe(0);
        const cleared = await inboxService.clearRead(req);
        expect(cleared.deleted).toBe(2);
    });

    it('toInboxDTO expõe aliases PT/EN', () => {
        const dto = toInboxDTO({
            _id: new mongoose.Types.ObjectId(),
            userId: user._id,
            title: 'T',
            message: 'D',
            type: 'COUPON',
            category: 'coupon',
            icon: '🏷️',
            action: '/coupons',
            read: false,
            createdAt: new Date(),
        });
        expect(dto.titulo).toBe('T');
        expect(dto.descricao).toBe('D');
        expect(dto.categoria).toBe('coupon');
        expect(dto.acao).toBe('/coupons');
        expect(dto.lida).toBe(false);
    });
});
