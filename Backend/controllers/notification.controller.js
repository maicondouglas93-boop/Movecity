const { validationResult } = require('express-validator');
const tokenRegistry = require('../notification/tokenRegistry.service');
const inboxService = require('../notification/inbox.service');
const notificationService = require('../services/notification.service');

module.exports.registerToken = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { token, device } = req.body;

        // Fase 7 da correção do sistema de push (2026-08-02): admin é o terceiro tipo
        // de dono possível — req.admin é setado pelo middleware authAdmin, na rota
        // POST /admin/notifications/token (ver admin.routes.js).
        let ownerType, ownerId;
        if (req.user) { ownerType = 'user'; ownerId = req.user._id; }
        else if (req.captain) { ownerType = 'captain'; ownerId = req.captain._id; }
        else if (req.admin) { ownerType = 'admin'; ownerId = req.admin._id; }
        else return res.status(401).json({ message: 'Unauthorized' });

        const { reassigned, previousOwner } = await tokenRegistry.registerToken({ ownerType, ownerId, token, device });
        if (reassigned) {
            // A4 da auditoria de push (2026-08-02): não bloqueia — dispositivo
            // compartilhado é um uso legítimo — só deixa rastro auditável.
            console.warn(`[Notification] Token FCM trocou de dono: ${previousOwner} -> ${ownerId}`);
        }

        res.status(200).json({ message: 'Token registrado com sucesso' });
    } catch (err) {
        // A4: nunca logar o token completo — é a credencial de endereçamento do push.
        console.error('Erro ao registrar token FCM:', err.message);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// A3 da auditoria de push (2026-08-02): sem isto, o token FCM continuava vinculado à
// conta depois do logout — em aparelho compartilhado, o próximo usuário a fazer login
// receberia notificações da conta anterior até sobrescrever o mesmo token (upsert), e
// enquanto isso não acontecesse a conta que saiu continuava sendo notificada.
module.exports.unregisterToken = async (req, res) => {
    try {
        const token = req.body?.token || req.query?.token;
        if (!token) {
            return res.status(400).json({ message: 'Token is required' });
        }

        let ownerType, ownerId;
        if (req.user) { ownerType = 'user'; ownerId = req.user._id; }
        else if (req.captain) { ownerType = 'captain'; ownerId = req.captain._id; }
        else if (req.admin) { ownerType = 'admin'; ownerId = req.admin._id; }
        else return res.status(401).json({ message: 'Unauthorized' });

        await tokenRegistry.unregisterToken({ ownerType, ownerId, token });

        res.status(200).json({ message: 'Token removido com sucesso' });
    } catch (err) {
        console.error('Erro ao remover token FCM:', err.message);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// --- Central de notificações (inbox in-app) ---

module.exports.listNotifications = async (req, res) => {
    try {
        const { limit, category, unread, cursor } = req.query;
        const result = await inboxService.listInbox(req, {
            limit,
            category,
            unreadOnly: unread === 'true' || unread === '1',
            cursor,
        });
        res.status(200).json(result);
    } catch (err) {
        res.status(err.status || 500).json({ message: err.message || 'Erro ao listar notificações' });
    }
};

module.exports.getUnread = async (req, res) => {
    try {
        const result = await inboxService.unreadCount(req);
        res.status(200).json(result);
    } catch (err) {
        res.status(err.status || 500).json({ message: err.message || 'Erro ao contar não lidas' });
    }
};

module.exports.markRead = async (req, res) => {
    try {
        const item = await inboxService.markRead(req, req.params.id);
        res.status(200).json(item);
    } catch (err) {
        res.status(err.status || 500).json({ message: err.message || 'Erro ao marcar como lida' });
    }
};

module.exports.markAllRead = async (req, res) => {
    try {
        const result = await inboxService.markAllRead(req);
        res.status(200).json(result);
    } catch (err) {
        res.status(err.status || 500).json({ message: err.message || 'Erro ao marcar todas' });
    }
};

module.exports.deleteNotification = async (req, res) => {
    try {
        const result = await inboxService.deleteOne(req, req.params.id);
        res.status(200).json(result);
    } catch (err) {
        res.status(err.status || 500).json({ message: err.message || 'Erro ao excluir' });
    }
};

module.exports.clearRead = async (req, res) => {
    try {
        const result = await inboxService.clearRead(req);
        res.status(200).json(result);
    } catch (err) {
        res.status(err.status || 500).json({ message: err.message || 'Erro ao limpar lidas' });
    }
};

/**
 * Painel admin → POST /notifications/admin
 * Body: { target, title, message, category, priority, action, userIds?, captainIds?, type? }
 */
module.exports.adminSend = async (req, res) => {
    try {
        const {
            target = 'all',
            title,
            message,
            category,
            priority,
            action,
            userIds,
            captainIds,
            type,
        } = req.body || {};

        if (!title || !message) {
            return res.status(400).json({ message: 'title e message são obrigatórios' });
        }
        if (!['all', 'passengers', 'drivers', 'specific'].includes(target)) {
            return res.status(400).json({ message: 'target inválido' });
        }
        if (target === 'specific' && !(userIds?.length || captainIds?.length)) {
            return res.status(400).json({ message: 'Informe userIds ou captainIds para envio específico' });
        }

        await notificationService.sendAdminNotification(target, title, message, {
            category,
            priority,
            action,
            deepLink: action,
            userIds,
            captainIds,
            type: type || 'ADMIN',
        });

        res.status(200).json({ message: 'Notificação enviada com sucesso' });
    } catch (err) {
        console.error('Erro adminSend:', err.message);
        res.status(500).json({ message: 'Erro ao enviar notificação' });
    }
};
