const { validationResult } = require('express-validator');
const tokenRegistry = require('../notification/tokenRegistry.service');

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
}

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
}
