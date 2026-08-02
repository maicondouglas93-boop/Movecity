const captainModel = require('../models/captain.model');
const captainService = require('../services/captain.service');
const blackListTokenModel = require('../models/blacklistToken.model');
const { validationResult } = require('express-validator');
const { getCache, setCache, deleteByPrefix } = require('../cache/cache');


module.exports.registerCaptain = async (req, res, next) => {

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { fullname, email, password, cpf, birthDate, phone, cnh, pix, vehicle } = req.body;

    const isCaptainAlreadyExist = await captainModel.findOne({ email });

    if (isCaptainAlreadyExist) {
        return res.status(400).json({ message: 'Captain already exist' });
    }

    const vehicleCategoryModel = require('../models/vehicleCategory.model');
    const category = await vehicleCategoryModel.findOne({ name: vehicle.vehicleType, isActive: true });
    if (!category) {
        return res.status(400).json({ message: 'Categoria de veículo inválida' });
    }

    const hashedPassword = await captainModel.hashPassword(password);

    const captain = await captainService.createCaptain({
        firstname: fullname.firstname,
        lastname: fullname.lastname,
        email,
        password: hashedPassword,
        cpf,
        birthDate,
        phone,
        marca: vehicle.marca,
        modelo: vehicle.modelo,
        ano: vehicle.ano,
        color: vehicle.color,
        plate: vehicle.plate,
        capacity: vehicle.capacity,
        vehicleType: vehicle.vehicleType,
        cnhNumber: cnh.number,
        cnhCategory: cnh.category,
        cnhExpiration: cnh.expiration,
        cnhUf: cnh.uf,
        cnhEar: cnh.ear,
        pixKeyType: pix.keyType,
        pixKey: pix.key
    });

    const token = captain.generateAuthToken();

    res.status(201).json({ token, captain });

}

module.exports.loginCaptain = async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    const captain = await captainModel.findOne({ email }).select('+password');

    if (!captain) {
        return res.status(401).json({ message: 'Invalid email or password' });
    }

    const isMatch = await captain.comparePassword(password);

    if (!isMatch) {
        return res.status(401).json({ message: 'Invalid email or password' });
    }

    const token = captain.generateAuthToken();

    res.cookie('token', token);

    res.status(200).json({ token, captain });
}

module.exports.getCaptainProfile = async (req, res, next) => {
    res.status(200).json({ captain: req.captain });
}

const DOCUMENT_TYPES = [ 'cnhFront', 'cnhBack', 'crlv', 'vehicleFront', 'selfie' ];

// Auditoria de UX do motorista (2026-08-02): POST /uploads/document devolve a URL do
// arquivo mas nunca a grava em lugar nenhum — o cadastro completo do motorista
// (CNH, CRLV, selfie) ficava perdido depois do upload. Este endpoint fecha esse elo,
// chamado pelo frontend logo após cada upload bem-sucedido.
module.exports.updateDocument = async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { docType, url } = req.body;
    if (!DOCUMENT_TYPES.includes(docType)) {
        return res.status(400).json({ message: 'Tipo de documento inválido' });
    }

    // verified:false explícito — um reenvio deve voltar a exigir conferência do admin,
    // mesmo que o documento anterior já estivesse verificado.
    const captain = await captainModel.findByIdAndUpdate(
        req.captain._id,
        {
            [`documents.${docType}.url`]: url,
            [`documents.${docType}.verified`]: false
        },
        { new: true }
    );

    res.status(200).json({ captain });
}

module.exports.logoutCaptain = async (req, res, next) => {
    const token = req.cookies.token || req.headers.authorization?.split(' ')[ 1 ];

    await blackListTokenModel.create({ token });

    res.clearCookie('token');

    res.status(200).json({ message: 'Logout successfully' });
}

module.exports.getWallet = async (req, res, next) => {
    try {
        const cacheKey = `wallet:${req.captain._id}`;
        const cached = getCache(cacheKey);
        if (cached) return res.status(200).json({ wallet: cached });

        const walletService = require('../services/wallet.service');
        const wallet = await walletService.getWallet(req.captain._id);

        setCache(cacheKey, wallet, 300); // 5 minutes

        res.status(200).json({ wallet });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
}

module.exports.getTransactions = async (req, res, next) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const cacheKey = `transactions:${req.captain._id}:${limit}`;
        const cached = getCache(cacheKey);
        if (cached) return res.status(200).json({ transactions: cached });

        const walletService = require('../services/wallet.service');
        const transactions = await walletService.getTransactions(req.captain._id, limit);

        setCache(cacheKey, transactions, 300); // 5 minutes

        res.status(200).json({ transactions });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
}

module.exports.rechargeWallet = async (req, res, next) => {
    // Bloqueado propositalmente: este endpoint creditava saldo real sem nenhuma cobrança
    // de fato acontecer (o "QR Code PIX" no app era só um ícone estático, e "Simular
    // Pagamento Pago" chamava direto esta rota). Fica desativado até existir integração
    // real com gateway de pagamento (Asaas) confirmando o recebimento antes de creditar.
    return res.status(501).json({
        message: 'Recarga automática de carteira está temporariamente indisponível. Entre em contato com o suporte para adicionar créditos.'
    });
}

module.exports.toggleOnline = async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    const { isOnline } = req.body;

    try {
        if (isOnline) {
            if (req.captain.approvalStatus !== 'aprovado') {
                return res.status(403).json({ message: 'Seu cadastro ainda não foi aprovado. Você não pode ficar online até a aprovação.' });
            }

            const walletService = require('../services/wallet.service');
            const wallet = await walletService.getWallet(req.captain._id);
            if (wallet.creditBalance < 0) {
                return res.status(403).json({ message: 'Inadimplente. Saldo negativo não permite ficar online. Recarregue a carteira.' });
            }
        }

        const captainService = require('../services/captain.service');
        // Tempo online real: começa/fecha a sessão ANTES de ler o estado anterior de
        // isOnline, para não contar duas sessões abertas se o app chamar toggle 2x seguidas.
        if (isOnline && !req.captain.isOnline) {
            await captainService.startOnlineSession(req.captain._id);
        } else if (!isOnline && req.captain.isOnline) {
            await captainService.endOnlineSession(req.captain._id);
        }

        const captain = await captainModel.findByIdAndUpdate(req.captain._id, { isOnline, status: isOnline ? 'active' : 'inactive' }, { new: true });

        deleteByPrefix(`profile:captain:${req.captain._id}`);
        deleteByPrefix(`drivers:`); // clear drivers cache since online status changed

        res.status(200).json({ captain });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
}

module.exports.getSummary = async (req, res, next) => {
    try {
        const cacheKey = `summary:${req.captain._id}`;
        const cached = getCache(cacheKey);
        
        if (cached) {
            return res.status(200).json(cached);
        }

        const walletService = require('../services/wallet.service');
        const captainService = require('../services/captain.service');
        const rideModel = require('../models/ride.model');
        const wallet = await walletService.getWallet(req.captain._id);
        const todayOnlineSeconds = await captainService.getTodayOnlineSeconds(req.captain._id);

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const todaysRides = await rideModel.find({
            captain: req.captain._id,
            status: 'finished',
            updatedAt: { $gte: today }
        });

        let earnings = 0;
        let commissions = 0;

        todaysRides.forEach(ride => {
            const fare = ride.fare || 0;
            const comm = ride.commissionAmount || 0;
            const finalPrice = ride.finalPrice || fare;
            earnings += (finalPrice - comm);
            commissions += comm;
        });

        const summary = {
            ridesToday: todaysRides.length,
            earnings: parseFloat(earnings.toFixed(2)),
            commissions: parseFloat(commissions.toFixed(2)),
            walletBalance: wallet.creditBalance,
            walletBlocked: wallet.pendingBalance || 0,
            onlineTimeSeconds: todayOnlineSeconds, // tempo online real de hoje, calculado a partir de onlineSince
            rating: req.captain.rating || 5.0,
            acceptanceRate: req.captain.acceptanceRate || 100,
            cancelledRides: req.captain.cancelledRides || 0
        };

        setCache(cacheKey, summary, 30); // 30 seconds TTL as requested

        res.status(200).json(summary);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
}