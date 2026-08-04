const captainModel = require('../models/captain.model');
const captainService = require('../services/captain.service');
const blackListTokenModel = require('../models/blacklistToken.model');
const authService = require('../services/auth.service');
const { validationResult } = require('express-validator');
const { getCache, setCache, deleteByPrefix } = require('../cache/cache');
const notificationService = require('../services/notification.service');

// Auditoria de sessão (2026-08-02): ver o comentário equivalente em user.controller.js.
// O motorista tinha exatamente o mesmo problema — token de 24h e nenhuma renovação.
const COOKIE_OPTIONS = () => {
    const isProduction = process.env.NODE_ENV === 'production';
    return {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? 'none' : 'lax',
        maxAge: authService.ACCESS_TOKEN_TTL_SECONDS * 1000
    };
};

async function respondWithCaptainSession(res, { captain, ip, statusCode = 200 }) {
    const { accessToken, refreshToken } = await authService.issueTokenPair({
        userId: captain._id,
        userType: 'captain',
        ip
    });

    res.cookie('token', accessToken, COOKIE_OPTIONS());
    res.cookie('refreshToken', refreshToken, authService.refreshCookieOptions());

    return res.status(statusCode).json({ token: accessToken, refreshToken, captain });
}


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

    // Fase 7 da correção do sistema de push (2026-08-02): admin precisa saber que tem
    // um motorista novo esperando revisão de documentos — antes, só apareceria pra
    // quem abrisse o painel e fosse conferir a aba de motoristas por conta própria.
    notificationService.sendNewCaptainAlert(`${fullname.firstname} ${fullname.lastname}`).catch(console.error);

    return await respondWithCaptainSession(res, { captain, ip: req.ip, statusCode: 201 });

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

    return await respondWithCaptainSession(res, { captain, ip: req.ip });
}

// Auditoria de sessão (2026-08-02): endpoint novo — o motorista não tinha renovação
// nenhuma. Um motorista em corrida com o token expirando perdia a sessão no meio do
// trabalho.
module.exports.refreshCaptainSession = async (req, res) => {
    try {
        const presentedToken = req.cookies?.refreshToken || req.body?.refreshToken;
        const { userId, refreshToken } = await authService.rotateRefreshToken({
            refreshToken: presentedToken,
            ip: req.ip
        });

        const captain = await captainService.getCaptainProfile(userId);
        if (!captain) {
            return res.status(401).json({ message: 'Sessão inválida' });
        }
        if (captain.isBlocked) {
            await authService.revokeAllForUser({ userId, userType: 'captain', reason: 'blocked' });
            return res.status(403).json({ message: 'Sua conta está bloqueada. Entre em contato com o suporte.' });
        }

        const accessToken = authService.generateAccessToken(userId);
        res.cookie('token', accessToken, COOKIE_OPTIONS());
        res.cookie('refreshToken', refreshToken, authService.refreshCookieOptions());

        return res.status(200).json({ token: accessToken, refreshToken, captain });
    } catch (err) {
        return res.status(401).json({ message: err.message || 'Sessão inválida' });
    }
};

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

    if (token) {
        await blackListTokenModel.create({ token }).catch(() => {});
    }

    const { maxAge, ...accessClearOptions } = COOKIE_OPTIONS();
    res.clearCookie('token', accessClearOptions);
    res.clearCookie('refreshToken', authService.clearCookieOptions());

    // Auditoria de sessão (2026-08-02): sem isto, o refresh token sobrevivia ao logout
    // e podia gerar access tokens novos depois do "Sair".
    // Rota GET — ver comentário equivalente em user.controller.js: logoutUser.
    const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken || req.query?.refreshToken;
    if (refreshToken) {
        await authService.revokeRefreshToken({ refreshToken, reason: 'logout' });
    } else if (req.captain?._id) {
        await authService.revokeAllForUser({ userId: req.captain._id, userType: 'captain', reason: 'logout' });
    }

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

module.exports.requestPayout = async (req, res, next) => {
    try {
        const walletService = require('../services/wallet.service');
        const payout = await walletService.requestPayout(req.captain._id);
        deleteByPrefix(`wallet:${req.captain._id}`);
        res.status(201).json({ payout });
    } catch (err) {
        res.status(400).json({ message: err.message });
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

        // `lastSeenAt` junto: ficar online é o contato mais explícito que existe, e é
        // ele que sustenta a disponibilidade no despacho quando o app fecha depois
        // (separação disponibilidade x conexão, 2026-08-03).
        const captain = await captainModel.findByIdAndUpdate(
            req.captain._id,
            { isOnline, status: isOnline ? 'active' : 'inactive', lastSeenAt: new Date() },
            { new: true }
        );

        deleteByPrefix(`profile:captain:${req.captain._id}`);
        deleteByPrefix(`drivers:`); // clear drivers cache since online status changed

        // Fase C (2026-08-03): mapa do passageiro reage na hora ao toggle. Offline
        // remove o marcador imediatamente (sem isto ele ficaria até o próximo snapshot);
        // online já anuncia a última posição conhecida (sem isto o motorista só
        // apareceria no próximo update de localização, ~10s). Um motorista que ficar
        // online no meio de uma corrida é corrigido pelo 'driver-busy' do fluxo de
        // localização logo em seguida.
        const { sendMessageToRoom, emitDriverMapUpdate, clearDriverMapState } = require('../socket');
        if (!isOnline) {
            // Esquece o último estado publicado: quando este motorista voltar, o primeiro
            // evento dele precisa sair na hora em vez de ser deduplicado contra o estado
            // de antes de sair do ar.
            clearDriverMapState(captain._id);
            sendMessageToRoom('map-viewers', {
                event: 'driver-offline',
                data: { driverId: captain._id.toString() }
            });
        } else if (captain.location && captain.location.ltd != null && captain.location.lng != null) {
            emitDriverMapUpdate(captain._id, {
                busy: false,
                vehicleType: captain.vehicle?.vehicleType || 'car',
                location: { ltd: captain.location.ltd, lng: captain.location.lng }
            });
        }

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

// Auditoria de UX do motorista (2026-08-02, Etapa 8): recorte temporal de ganhos +
// detalhe por corrida — a tela de Ganhos só tinha o total vitalício até aqui.
module.exports.getEarnings = async (req, res, next) => {
    try {
        const range = ['day', 'week', 'month'].includes(req.query.range) ? req.query.range : 'day';
        const captainService = require('../services/captain.service');
        const breakdown = await captainService.getEarningsBreakdown(req.captain._id, range);
        res.status(200).json(breakdown);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
}