const { validationResult } = require('express-validator');
const supportTicketModel = require('../models/supportTicket.model');
const rideModel = require('../models/ride.model');

const CATEGORY_SUBJECT = {
    ride_issue: 'Problemas com uma corrida',
    lost_item: 'Objeto perdido',
    payment: 'Problemas no pagamento',
    other: 'Outro assunto',
};

// Canais oficiais — configurados no .env do backend (SUPPORT_WHATSAPP / SUPPORT_EMAIL).
module.exports.getContactChannels = async (_req, res) => {
    try {
        const whatsapp = String(process.env.SUPPORT_WHATSAPP || '').replace(/\D/g, '');
        const email = String(process.env.SUPPORT_EMAIL || '').trim();
        return res.status(200).json({
            whatsapp: whatsapp || null,
            email: email || null,
            whatsappUrl: whatsapp ? `https://wa.me/${whatsapp}` : null,
        });
    } catch (err) {
        return res.status(500).json({ message: 'Erro interno do servidor' });
    }
};

module.exports.createTicket = async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ message: errors.array()[0]?.msg || 'Dados inválidos', errors: errors.array() });
        }

        const { category, message, rideId, subject } = req.body;
        const userId = req.user._id;

        if (rideId) {
            const ride = await rideModel.findOne({ _id: rideId, user: userId }).select('_id');
            if (!ride) {
                return res.status(404).json({ message: 'Corrida não encontrada nesta conta.' });
            }
        }

        const ticket = await supportTicketModel.create({
            user: userId,
            category,
            subject: (subject && String(subject).trim()) || CATEGORY_SUBJECT[category] || 'Chamado',
            message: String(message).trim(),
            rideId: rideId || undefined,
        });

        return res.status(201).json({ ticket });
    } catch (err) {
        console.error('Error in createTicket:', err);
        return res.status(500).json({ message: 'Erro interno do servidor' });
    }
};

module.exports.listMyTickets = async (req, res) => {
    try {
        const tickets = await supportTicketModel.find({ user: req.user._id })
            .sort({ createdAt: -1 })
            .limit(50)
            .lean();

        return res.status(200).json({ tickets });
    } catch (err) {
        console.error('Error in listMyTickets:', err);
        return res.status(500).json({ message: 'Erro interno do servidor' });
    }
};

module.exports.getTicket = async (req, res) => {
    try {
        const ticket = await supportTicketModel.findOne({
            _id: req.params.id,
            user: req.user._id,
        }).lean();

        if (!ticket) {
            return res.status(404).json({ message: 'Chamado não encontrado.' });
        }

        return res.status(200).json({ ticket });
    } catch (err) {
        console.error('Error in getTicket:', err);
        return res.status(500).json({ message: 'Erro interno do servidor' });
    }
};
