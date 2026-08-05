const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const adminUserModel = require('../models/adminUser.model');
const adminLogModel = require('../models/adminLog.model');
const rideModel = require('../models/ride.model');
const captainModel = require('../models/captain.model');
const userModel = require('../models/user.model');
const transactionModel = require('../models/transaction.model');
const payoutModel = require('../models/payout.model');
const walletModel = require('../models/wallet.model');
const { deleteByPrefix } = require('../cache/cache');
const { disconnectSocket } = require('../socket');
const uploadService = require('./upload.service');
const walletService = require('./wallet.service');
const notificationService = require('./notification.service');

module.exports.login = async (email, password) => {
    const admin = await adminUserModel.findOne({ email }).select('+password');
    if (!admin) {
        throw new Error('Invalid email or password');
    }

    const isMatch = await admin.comparePassword(password);
    if (!isMatch) {
        throw new Error('Invalid email or password');
    }

    if (!admin.active) {
        throw new Error('Admin account is deactivated');
    }

    // Auditoria de sessão persistente (2026-08-02): migrado do refresh token de 7 dias
    // guardado em texto puro no próprio documento do admin para o auth.service
    // compartilhado — refresh de 365 dias, hash SHA-256 no banco, múltiplas sessões
    // por admin (antes, logar num segundo dispositivo derrubava o primeiro, porque só
    // cabia um refreshToken no documento) e detecção de reuse.
    const authService = require('./auth.service');
    const { accessToken, refreshToken } = await authService.issueTokenPair({
        userId: admin._id,
        userType: 'admin',
        extraClaims: { role: admin.role }
    });

    return { admin, token: accessToken, refreshToken };
};

// Auditoria de sessão (2026-08-02, S6): o refresh token já era gerado e salvo no login,
// mas não existia rota para trocá-lo por um access token novo — a sessão do admin
// morria a cada 15min sem chance de renovação silenciosa. Rotaciona o refresh token a
// cada uso (o antigo para de valer assim que um novo é emitido).
module.exports.refreshAccessToken = async (refreshToken) => {
    const authService = require('./auth.service');

    const rotated = await authService.rotateRefreshToken({ refreshToken });

    const admin = await adminUserModel.findById(rotated.userId);
    if (!admin || !admin.active) {
        // Admin desativado depois de a sessão ter começado — derruba tudo.
        await authService.revokeAllForUser({
            userId: rotated.userId,
            userType: 'admin',
            reason: 'blocked'
        });
        throw new Error('Refresh token inválido');
    }

    const token = authService.generateAccessToken(admin._id, { role: admin.role });

    return { admin, token, refreshToken: rotated.refreshToken };
};

module.exports.invalidateRefreshToken = async (adminId, refreshToken) => {
    const authService = require('./auth.service');
    if (refreshToken) {
        await authService.revokeRefreshToken({ refreshToken, reason: 'logout' });
        return;
    }
    // Sem o token em mãos (ex.: logout só com o access token), encerra todas as sessões
    // deste admin — melhor amplo demais do que deixar uma sessão sobreviver ao "Sair".
    await authService.revokeAllForUser({ userId: adminId, userType: 'admin', reason: 'logout' });
};

module.exports.logAction = async (logData) => {
    try {
        await adminLogModel.create(logData);
    } catch (error) {
        console.error('Failed to log admin action:', error);
    }
};

module.exports.getHealthStatus = async () => {
    const mongoose = require('mongoose');
    const admin = require('firebase-admin');
    return {
        api: true,
        mongodb: mongoose.connection.readyState === 1,
        socket: global.io ? true : false,
        firebase: admin.apps ? admin.apps.length > 0 : false
    };
};

module.exports.getDashboardStats = async (period = 'today') => {
    const now = new Date();
    let currentStart, currentEnd = new Date(now);
    let prevStart, prevEnd;

    // Period configuration
    if (period === 'today') {
        currentStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        
        prevEnd = new Date(currentStart);
        prevEnd.setMilliseconds(-1);
        prevStart = new Date(prevEnd.getFullYear(), prevEnd.getMonth(), prevEnd.getDate());
    } else if (period === '7d') {
        currentStart = new Date(now);
        currentStart.setDate(now.getDate() - 7);
        
        prevEnd = new Date(currentStart);
        prevEnd.setMilliseconds(-1);
        prevStart = new Date(prevEnd);
        prevStart.setDate(prevEnd.getDate() - 7);
    } else if (period === '30d') {
        currentStart = new Date(now);
        currentStart.setDate(now.getDate() - 30);
        
        prevEnd = new Date(currentStart);
        prevEnd.setMilliseconds(-1);
        prevStart = new Date(prevEnd);
        prevStart.setDate(prevEnd.getDate() - 30);
    } else {
        // Fallback to today
        currentStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        prevEnd = new Date(currentStart);
        prevEnd.setMilliseconds(-1);
        prevStart = new Date(prevEnd.getFullYear(), prevEnd.getMonth(), prevEnd.getDate());
    }

    // --- REVENUE ---
    const getRevenueStats = async (start, end) => {
        const agg = await rideModel.aggregate([
            { $match: { createdAt: { $gte: start, $lte: end }, status: 'finished' } },
            { $group: {
                _id: null,
                gross: { $sum: '$finalPrice' },
                commission: { $sum: '$commissionAmount' },
                count: { $sum: 1 },
                totalDistance: { $sum: '$distance' }
            }}
        ]);
        const data = agg[0] || { gross: 0, commission: 0, count: 0, totalDistance: 0 };
        return {
            gross: data.gross,
            commission: data.commission,
            payout: data.gross - data.commission,
            avgTicket: data.count > 0 ? data.gross / data.count : 0,
            avgPerKm: data.totalDistance > 0 ? data.gross / (data.totalDistance / 1000) : 0,
            ridesCount: data.count
        };
    };

    const currentRevenue = await getRevenueStats(currentStart, currentEnd);
    const prevRevenue = await getRevenueStats(prevStart, prevEnd);

    // --- RIDES ---
    const getRidesStats = async (start, end) => {
        const total = await rideModel.countDocuments({ createdAt: { $gte: start, $lte: end } });
        const finished = await rideModel.countDocuments({ createdAt: { $gte: start, $lte: end }, status: 'finished' });
        const cancelled = await rideModel.countDocuments({ createdAt: { $gte: start, $lte: end }, status: 'cancelled' });
        return { total, finished, cancelled };
    };

    const currentRides = await getRidesStats(currentStart, currentEnd);
    const prevRides = await getRidesStats(prevStart, prevEnd);

    // --- CAPTAINS (Snapshot current state) ---
    // Separação disponibilidade x conexão (2026-08-03): "online" aqui usa a MESMA
    // definição do despacho (captainService.availabilityFilter) — inclusive o TTL de
    // lastSeenAt. Sem isso, um motorista que ficou online e fechou o app há dias
    // apareceria como online no painel para sempre, já que `isOnline` não é mais
    // zerado no disconnect.
    const captainService = require('./captain.service');
    const availability = captainService.availabilityFilter();
    const { canReceiveRides, ...availabilityBase } = availability;

    const totalCaptains = await captainModel.countDocuments();
    const onlineCaptains = await captainModel.countDocuments(availabilityBase);
    const availableCaptains = await captainModel.countDocuments({ ...availabilityBase, canReceiveRides: true });
    const inRideCaptains = await captainModel.countDocuments({ ...availabilityBase, canReceiveRides: false });
    const offlineCaptains = totalCaptains - onlineCaptains;

    // --- QUALITY ---
    const getQualityStats = async (start, end) => {
        const reviewModel = require('../models/review.model');
        const [ratingAgg] = await reviewModel.aggregate([
            { $match: { createdAt: { $gte: start, $lte: end }, type: 'passenger_to_driver' } },
            { $group: { _id: null, avg: { $avg: '$rating' } } }
        ]);

        return {
            avgSearchTimeSeconds: null, // To be implemented with logs
            cancelRate: currentRides.total > 0 ? (currentRides.cancelled / currentRides.total) * 100 : 0,
            acceptRate: null, // Need ride request logs
            avgRating: ratingAgg ? Math.round(ratingAgg.avg * 10) / 10 : null // null = sem avaliações no período
        };
    };
    const currentQuality = await getQualityStats(currentStart, currentEnd);
    const prevQuality = await getQualityStats(prevStart, prevEnd);

    // --- ALERTS ---
    const alerts = [];
    const pendingApprovalCaptains = await captainModel.countDocuments({ approvalStatus: 'em_analise' });
    if (pendingApprovalCaptains > 0) {
        alerts.push(`🔴 ${pendingApprovalCaptains} motoristas aguardando aprovação`);
    }

    const pendingPayouts = await payoutModel.countDocuments({ status: 'processing' });
    if (pendingPayouts > 0) {
        alerts.push(`🔴 ${pendingPayouts} pagamentos pendentes para motoristas`);
    }

    // Rides waiting for driver for more than 3 minutes
    const threeMinsAgo = new Date(Date.now() - 3 * 60000);
    const stuckRides = await rideModel.countDocuments({ status: 'requested', createdAt: { $lte: threeMinsAgo } });
    if (stuckRides > 0) {
        alerts.push(`🟡 ${stuckRides} corridas aguardando motorista há mais de 3 minutos`);
    }

    // --- RANKING ---
    const ranking = await rideModel.aggregate([
        { $match: { createdAt: { $gte: currentStart, $lte: currentEnd }, status: 'finished', captain: { $ne: null } } },
        { $group: {
            _id: '$captain',
            rides: { $sum: 1 },
            earnings: { $sum: { $subtract: ['$finalPrice', '$commissionAmount'] } }
        }},
        { $sort: { rides: -1, earnings: -1 } },
        { $limit: 5 },
        { $lookup: { from: 'captains', localField: '_id', foreignField: '_id', as: 'captainData' } },
        { $unwind: '$captainData' },
        { $project: {
            _id: 1,
            rides: 1,
            earnings: 1,
            name: { $concat: ['$captainData.fullname.firstname', ' ', { $ifNull: ['$captainData.fullname.lastname', ''] }] },
            rating: '$captainData.rating',
            acceptanceRate: '$captainData.acceptanceRate',
            cancellationRate: '$captainData.cancellationRate',
            hoursOnline: { $divide: ['$captainData.onlineTimeSeconds', 3600] }
        }}
    ]);

    return {
        period: {
            current: { start: currentStart, end: currentEnd },
            prev: { start: prevStart, end: prevEnd }
        },
        summary: {},
        revenue: {
            current: currentRevenue,
            prev: prevRevenue
        },
        captains: {
            current: { total: totalCaptains, online: onlineCaptains, available: availableCaptains, inRide: inRideCaptains, offline: offlineCaptains }
        },
        rides: {
            current: currentRides,
            prev: prevRides
        },
        quality: {
            current: currentQuality,
            prev: prevQuality
        },
        alerts: alerts,
        ranking: ranking,
        system: {},
        charts: {}
    };
};

module.exports.getUsers = async (page = 1, limit = 10, search = '', filters = {}) => {
    const skip = (page - 1) * limit;
    const query = {};

    if (search) {
        query.$or = [
            { 'fullname.firstname': { $regex: search, $options: 'i' } },
            { 'fullname.lastname': { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } },
            { phone: { $regex: search, $options: 'i' } },
            { cpf: { $regex: search, $options: 'i' } }
        ];
    }
    
    if (filters.status === 'active') query.isBlocked = false;
    if (filters.status === 'blocked') query.isBlocked = true;
    if (filters.city) query.city = { $regex: filters.city, $options: 'i' };
    if (filters.hasRides === 'yes') query.totalRides = { $gt: 0 };
    if (filters.hasRides === 'no') query.totalRides = 0;
    if (filters.dateRange === 'today') {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        query.createdAt = { $gte: startOfDay };
    }
    
    // Sort logic
    let sortObj = { createdAt: -1 };
    if (filters.sortBy === 'name') sortObj = { 'fullname.firstname': filters.sortOrder === 'asc' ? 1 : -1 };
    if (filters.sortBy === 'totalRides') sortObj = { totalRides: filters.sortOrder === 'asc' ? 1 : -1 };
    if (filters.sortBy === 'totalSpent') sortObj = { totalSpent: filters.sortOrder === 'asc' ? 1 : -1 };

    const users = await userModel.find(query).skip(skip).limit(limit).sort(sortObj);
    const total = await userModel.countDocuments(query);
    
    // Summary Cards
    const totalUsers = await userModel.countDocuments();
    const activeUsers = await userModel.countDocuments({ isBlocked: false });
    const blockedUsers = totalUsers - activeUsers;
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const newToday = await userModel.countDocuments({ createdAt: { $gte: today } });
    
    const thisWeek = new Date();
    thisWeek.setDate(thisWeek.getDate() - 7);
    const newWeek = await userModel.countDocuments({ createdAt: { $gte: thisWeek } });
    
    return { 
        users, 
        total, 
        pages: Math.ceil(total / limit),
        summary: {
            total: totalUsers,
            active: activeUsers,
            blocked: blockedUsers,
            newToday,
            newWeek
        }
    };
};

module.exports.getUserDetails = async (userId) => {
    const user = await userModel.findById(userId);
    if (!user) throw new Error('Usuário não encontrado');
    
    // Buscar últimas corridas
    const recentRides = await rideModel.find({ user: userId })
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('captain', 'fullname vehicle');
        
    // Buscar histórico de auditoria/admin
    const adminLogs = await adminLogModel.find({ targetId: userId.toString(), targetModel: 'User' })
        .sort({ createdAt: -1 });
        
    // Dados financeiros calculados
    const ridesCount = user.totalRides || 0;
    const spent = user.totalSpent || 0;
    const averageTicket = ridesCount > 0 ? (spent / ridesCount) : 0;
    
    return {
        user,
        stats: {
            rides: ridesCount,
            spent,
            averageTicket,
            distance: user.totalDistance || 0,
            lastRideAt: user.lastRideAt || null
        },
        recentRides,
        adminLogs
    };
};

module.exports.toggleUserBlock = async (userId, isBlocked, reason, admin, ip) => {
    if (!reason) throw new Error('O motivo do bloqueio/desbloqueio é obrigatório');

    const user = await userModel.findByIdAndUpdate(userId, { isBlocked }, { new: true });

    // P3.2 da auditoria de concorrência (2026-08-02): authUser lê o perfil de um cache de
    // 10 minutos (getUserProfile). Sem invalidar aqui, um usuário recém-bloqueado
    // continuava autenticando normalmente por até 10 minutos — e um recém-desbloqueado
    // continuava sendo rejeitado pelo mesmo motivo, na direção contrária.
    deleteByPrefix(`profile:user:${userId}`);
    if (isBlocked) {
        if (user.socketId) {
            disconnectSocket(user.socketId);
        }
        // Auditoria de sessão persistente (2026-08-02): com refresh token de longa
        // duração, bloquear sem revogar deixaria o usuário renovando a sessão para
        // sempre. O middleware já barra o acesso (403), mas a sessão em si precisa
        // morrer — senão um desbloqueio futuro reviveria uma sessão antiga.
        const authService = require('./auth.service');
        await authService.revokeAllForUser({ userId, userType: 'user', reason: 'blocked' });
    }

    await module.exports.logAction({
        adminId: admin._id,
        adminName: admin.name,
        action: isBlocked ? 'block_user' : 'unblock_user',
        targetId: user._id.toString(),
        targetModel: 'User',
        reason: reason,
        oldValue: { isBlocked: !isBlocked },
        newValue: { isBlocked },
        ipAddress: ip || '0.0.0.0'
    });
    
    return user;
};

module.exports.bulkActionUsers = async (userIds, actionType, reason, admin, ip) => {
    if (!userIds || !userIds.length) throw new Error('Nenhum usuário selecionado');
    if (!reason) throw new Error('O motivo é obrigatório para ações em lote');

    let updatedCount = 0;
    
    if (actionType === 'block') {
        const result = await userModel.updateMany(
            { _id: { $in: userIds } },
            { $set: { isBlocked: true } }
        );
        updatedCount = result.modifiedCount;
        // Mesmo motivo do toggleUserBlock individual (P3.2 da auditoria de concorrência):
        // sem isso, cada usuário bloqueado em lote continuaria autenticando por até 10min.
        userIds.forEach(id => deleteByPrefix(`profile:user:${id}`));

        await module.exports.logAction({
            adminId: admin._id,
            adminName: admin.name,
            action: 'bulk_block_users',
            targetModel: 'User',
            reason: `Bloqueio em lote de ${updatedCount} passageiros. Motivo: ${reason}`,
            ipAddress: ip || '0.0.0.0'
        });
    } else if (actionType === 'unblock') {
        const result = await userModel.updateMany(
            { _id: { $in: userIds } },
            { $set: { isBlocked: false } }
        );
        updatedCount = result.modifiedCount;
        userIds.forEach(id => deleteByPrefix(`profile:user:${id}`));

        await module.exports.logAction({
            adminId: admin._id,
            adminName: admin.name,
            action: 'bulk_unblock_users',
            targetModel: 'User',
            reason: `Desbloqueio em lote de ${updatedCount} passageiros. Motivo: ${reason}`,
            ipAddress: ip || '0.0.0.0'
        });
    }

    return { success: true, updatedCount };
};

module.exports.updateUserTags = async (userId, tags, admin, ip) => {
    const user = await userModel.findByIdAndUpdate(userId, { tags }, { new: true });

    await module.exports.logAction({
        adminId: admin._id,
        adminName: admin.name,
        action: 'update_user_tags',
        targetId: userId.toString(),
        targetModel: 'User',
        reason: 'Atualização de tags de risco/perfil do passageiro',
        newValue: { tags },
        ipAddress: ip || '0.0.0.0'
    });

    return user;
};

module.exports.addUserObservation = async (userId, text, admin, ip) => {
    if (!text) throw new Error('O texto da observação não pode ser vazio');

    const observation = {
        adminId: admin._id,
        adminName: admin.name,
        text,
        createdAt: new Date()
    };

    const user = await userModel.findByIdAndUpdate(
        userId,
        { $push: { observations: { $each: [observation], $position: 0 } } },
        { new: true }
    );

    await module.exports.logAction({
        adminId: admin._id,
        adminName: admin.name,
        action: 'add_user_observation',
        targetId: userId.toString(),
        targetModel: 'User',
        reason: text,
        ipAddress: ip || '0.0.0.0'
    });

    return user.observations;
};

module.exports.getCaptains = async (page = 1, limit = 10, search = '', filters = {}) => {
    const skip = (page - 1) * limit;
    const query = {};

    if (search) {
        query.$or = [
            { 'fullname.firstname': { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } },
            { 'vehicle.plate': { $regex: search, $options: 'i' } }
        ];
    }

    if (filters.status) query.status = filters.status;
    if (filters.approvalStatus) query.approvalStatus = filters.approvalStatus;
    if (filters.vehicleType) query['vehicle.vehicleType'] = filters.vehicleType;
    if (filters.isOnline === 'true') query.isOnline = true;
    if (filters.isOnline === 'false') query.isOnline = false;
    if (filters.isBlocked === 'true') query.isBlocked = true;
    if (filters.isBlocked === 'false') query.isBlocked = false;
    
    // Don't select the heavy 'documents' object
    const captains = await captainModel.find(query)
        .select('-documents')
        .skip(skip).limit(limit).sort({ createdAt: -1 });
        
    const total = await captainModel.countDocuments(query);
    
    // Summary aggregation
    // Mesma definição de disponibilidade usada pelo despacho — ver comentário em
    // getDashboardStats acima.
    const captainServiceForCounts = require('./captain.service');
    const { canReceiveRides: _ignored, ...availabilityForCounts } = captainServiceForCounts.availabilityFilter();

    const totalCaptains = await captainModel.countDocuments();
    const online = await captainModel.countDocuments(availabilityForCounts);
    const inRide = await captainModel.countDocuments({ ...availabilityForCounts, canReceiveRides: false });
    const blocked = await captainModel.countDocuments({ isBlocked: true });
    const inAnalysis = await captainModel.countDocuments({ approvalStatus: 'em_analise' });
    const offline = totalCaptains - online;

    return { 
        captains, 
        total, 
        pages: Math.ceil(total / limit),
        summary: { total: totalCaptains, online, inRide, blocked, inAnalysis, offline }
    };
};

// Snapshot inicial do mapa do painel /rides (2026-08-05): o socket só emite posição
// DEPOIS que a página abre, então sem isto o mapa começa vazio até o próximo ping GPS
// de cada motorista. Usa a mesma base de disponibilidade do dashboard (TTL de
// lastSeenAt), incluindo quem está em corrida (canReceiveRides:false), e só devolve
// quem já tem coordenada gravada.
module.exports.formatLiveMapDriver = (captain) => {
    const first = captain.fullname?.firstname || '';
    const last = captain.fullname?.lastname || '';
    const inRide = captain.canReceiveRides === false || captain.busyLock === true;
    return {
        captainId: captain._id.toString(),
        name: `${first} ${last}`.trim() || 'Motorista',
        ltd: captain.location?.ltd,
        lng: captain.location?.lng,
        status: inRide ? 'in_ride' : 'available',
        vehicle: {
            plate: captain.vehicle?.plate || '',
            vehicleType: captain.vehicle?.vehicleType || '',
            color: captain.vehicle?.color || '',
            modelo: captain.vehicle?.modelo || '',
        },
        lastSeenAt: captain.lastSeenAt || null,
    };
};

module.exports.getLiveMapCaptains = async () => {
    const captainService = require('./captain.service');
    const { canReceiveRides: _ignored, ...availabilityBase } = captainService.availabilityFilter();

    const captains = await captainModel.find({
        ...availabilityBase,
        'location.ltd': { $type: 'number' },
        'location.lng': { $type: 'number' },
    }).select('fullname vehicle location isOnline canReceiveRides busyLock lastSeenAt');

    const drivers = captains
        .map((c) => module.exports.formatLiveMapDriver(c))
        .filter((d) => Number.isFinite(d.ltd) && Number.isFinite(d.lng));

    return {
        drivers,
        counts: {
            total: drivers.length,
            available: drivers.filter((d) => d.status === 'available').length,
            inRide: drivers.filter((d) => d.status === 'in_ride').length,
        },
        updatedAt: new Date().toISOString(),
    };
};

module.exports.updateCaptainApproval = async (captainId, approvalStatus, reason, admin, ip) => {
    const captain = await captainModel.findByIdAndUpdate(captainId, { approvalStatus }, { new: true, runValidators: true });

    // Simplificação do cadastro do motorista (2026-08-04): sem isto, um motorista
    // aprovado continuava vendo (e sendo barrado por) o approvalStatus antigo por até
    // 10 minutos — o mesmo cache de 10 min que já existia, só nunca invalidado aqui
    // (só no bloqueio, ver toggleCaptainBlock). A aprovação/rejeição precisa valer na
    // hora, igual ao bloqueio.
    deleteByPrefix(`profile:captain:${captainId}`);

    if (approvalStatus === 'aprovado') {
        notificationService.sendCaptainApproved(captainId).catch(console.error);
    } else if (approvalStatus === 'reprovado') {
        notificationService.sendCaptainRejected(captainId, { reason }).catch(console.error);
    }

    await module.exports.logAction({
        adminId: admin._id,
        adminName: admin.name,
        action: 'update_captain_approval',
        targetId: captain._id.toString(),
        targetModel: 'Captain',
        reason: reason || 'Alteração de status de aprovação',
        newValue: { approvalStatus },
        ipAddress: ip || '0.0.0.0'
    });

    return captain;
};

// P3.2 da auditoria de concorrência (2026-08-02): bloquear um motorista precisa ter
// efeito imediato — antes, authCaptain lia o perfil de um cache de 10 minutos
// (getCaptainProfile) sem nenhuma invalidação aqui, então um motorista bloqueado
// continuava aceitando e realizando corridas por até 10 minutos. Uma corrida já em
// andamento continua existindo normalmente (decisão consciente: interromper uma
// viagem em curso por causa de uma ação administrativa cria um problema pior — o
// passageiro na rua — do que o que resolve; bloqueio administrativo raramente é uma
// emergência que exige interrupção imediata da corrida). O que muda é só o que o
// motorista consegue fazer DAQUI PRA FRENTE: nenhuma corrida nova.
module.exports.toggleCaptainBlock = async (captainId, isBlocked, reason, admin, ip) => {
    const update = { isBlocked };
    if (isBlocked) {
        // Tira o motorista do pool de despacho de novas corridas imediatamente —
        // getCaptainsInTheRadius já filtra por isOnline:true, então isso sozinho impede
        // que ele receba qualquer corrida nova a partir de agora.
        update.isOnline = false;
        update.status = 'inactive';
    }

    const captain = await captainModel.findByIdAndUpdate(captainId, update, { new: true });

    deleteByPrefix(`profile:captain:${captainId}`);
    if (isBlocked) {
        deleteByPrefix('drivers:'); // cache de busca de motoristas por raio
        if (captain.socketId) {
            disconnectSocket(captain.socketId);
        }
        // Ver o comentário equivalente em toggleUserBlock.
        const authService = require('./auth.service');
        await authService.revokeAllForUser({ userId: captainId, userType: 'captain', reason: 'blocked' });
    }

    await module.exports.logAction({
        adminId: admin._id,
        adminName: admin.name,
        action: isBlocked ? 'block_captain' : 'unblock_captain',
        targetId: captain._id.toString(),
        targetModel: 'Captain',
        reason: reason || 'Bloqueio/Desbloqueio de motorista',
        oldValue: { isBlocked: !isBlocked },
        newValue: { isBlocked },
        ipAddress: ip || '0.0.0.0'
    });
    
    return captain;
};

module.exports.getCaptainDocuments = async (captainId) => {
    const captain = await captainModel.findById(captainId).select('documents');
    if (!captain) throw new Error('Motorista não encontrado');
    return captain.documents;
};

// Auditoria de segurança (2026-08-02, S9): o painel não pode mais usar a URL salva
// no banco direto (deixou de ser pública) — precisa pedir uma URL assinada de curta duração.
module.exports.getCaptainDocumentSignedUrl = async (captainId, docType) => {
    const captain = await captainModel.findById(captainId).select('documents');
    if (!captain || !captain.documents || !captain.documents[docType]) {
        throw new Error('Documento não encontrado');
    }
    const fileUrl = captain.documents[docType].url;
    if (!fileUrl) throw new Error('Documento não enviado');

    return uploadService.getSignedDocumentUrl(fileUrl);
};

// Rótulo amigável do documento nas notificações — mesmo conjunto de chaves de
// captain.model.js (documents) e da tela de perfil do motorista (CaptainProfile.jsx).
const DOCUMENT_LABELS = {
    cnhFront: 'CNH (frente)',
    cnhBack: 'CNH (verso)',
    crlv: 'CRLV',
    vehicleFront: 'Foto do veículo',
    selfie: 'Selfie com a CNH',
};

module.exports.updateCaptainDocument = async (captainId, docType, verified, reason, admin, ip) => {
    const captain = await captainModel.findById(captainId);
    if (!captain || !captain.documents || !captain.documents[docType]) {
        throw new Error('Documento não encontrado');
    }

    captain.documents[docType].verified = verified;
    // Motivo visível pro próprio motorista (2026-08-04) — antes só existia no log de
    // auditoria do admin. Limpo ao aprovar: um motivo de rejeição antigo não deve
    // continuar aparecendo depois que o documento foi aceito.
    captain.documents[docType].reason = verified ? '' : (reason || '');
    await captain.save();

    // Mesmo motivo da invalidação em updateCaptainApproval: sem isto, o motorista só
    // veria o documento verificado/rejeitado depois que o cache de 10 min expirasse.
    deleteByPrefix(`profile:captain:${captainId}`);

    const docLabel = DOCUMENT_LABELS[docType] || docType;
    if (verified) {
        notificationService.sendDocumentApproved(captainId, { docLabel }).catch(console.error);
    } else {
        notificationService.sendDocumentRejected(captainId, { docLabel, reason }).catch(console.error);
    }

    await module.exports.logAction({
        adminId: admin._id,
        adminName: admin.name,
        action: verified ? 'approve_document' : 'reject_document',
        targetId: captain._id.toString(),
        targetModel: 'Captain',
        reason: reason || `Verificação de documento: ${docType}`,
        newValue: { document: docType, verified },
        ipAddress: ip || '0.0.0.0'
    });

    return captain.documents;
};

module.exports.getCaptainRecentRides = async (captainId) => {
    const rides = await rideModel.find({ captain: captainId })
        .populate('user', 'fullname email phone')
        .sort({ createdAt: -1 })
        .limit(20);
    return rides;
};

module.exports.getCaptainWallet = async (captainId) => {
    const captain = await captainModel.findById(captainId).select('earnings');
    
    // Fetch last 10 transactions
    const transactions = await transactionModel.find({ captainId })
        .sort({ createdAt: -1 })
        .limit(10);
        
    const wallet = {
        balance: captain.earnings || 0,
        pending: 0,
        commissions: 0,
        lastRecharge: new Date().toISOString(),
        transactions
    };
    return wallet;
};

module.exports.adjustCaptainWallet = async (captainId, amount, type, reason, admin, ip) => {
    if (!amount || amount <= 0) throw new Error('O valor deve ser maior que zero');
    if (!reason) throw new Error('O motivo é obrigatório');
    if (!['credit', 'debit'].includes(type)) throw new Error('Tipo de operação inválido');

    if (amount > 10000) throw new Error('Valor acima do limite permitido para ajuste manual (R$ 10.000)');

    const captain = await captainModel.findById(captainId);
    if (!captain) throw new Error('Motorista não encontrado');

    const adjustmentAmount = type === 'credit' ? Number(amount) : -Number(amount);

    // Ajuste manual precisa mexer no MESMO saldo que o app do motorista e o resto do
    // sistema leem (wallet.creditBalance), não em captain.earnings (contador vitalício
    // de faturamento, sem relação com saldo disponível). Usar walletService garante que
    // o ledger, o cache, a regra de bloqueio por saldo negativo e o evento em tempo real
    // (wallet-updated) fiquem consistentes — antes esse ajuste não fazia nada disso.
    const walletService = require('./wallet.service');
    const { transaction, wallet } = await walletService.createTransaction({
        captainId: captain._id,
        type: 'adjustment',
        paymentMethod: 'wallet',
        amount: adjustmentAmount, // positive ou negative
        description: `Ajuste manual: ${type === 'credit' ? 'Crédito' : 'Débito'}`,
        adminId: admin.name || admin.email,
        reason
    });

    // Audit log
    await module.exports.logAction({
        adminId: admin._id,
        adminName: admin.name,
        action: 'MANUAL_WALLET_ADJUSTMENT',
        targetId: captain._id.toString(),
        targetModel: 'Captain',
        reason: `Ajuste de R$ ${adjustmentAmount.toFixed(2)}. Motivo: ${reason}`,
        newValue: { amount: adjustmentAmount, balanceBefore: transaction.balanceBefore, balanceAfter: transaction.balanceAfter, type, transactionId: transaction._id.toString() },
        ipAddress: ip || '0.0.0.0'
    });

    return { success: true, balanceAfter: wallet.creditBalance, transaction };
};

module.exports.getCaptainTimeline = async (captainId) => {
    // Bloco I (2026-08-02): bug real encontrado ao reescrever getLogs — a assinatura
    // antiga era (page, limit) só; os dois argumentos extras aqui embaixo (o terceiro
    // era um '' sobrando de uma versão anterior, o quarto o filtro por targetId) eram
    // descartados silenciosamente. A aba "Auditoria" do CRM de motoristas mostrava os
    // logs administrativos do sistema inteiro, não os deste motorista.
    const logs = await module.exports.getLogs(1, 50, { targetId: captainId.toString() });
    return logs.logs;
};

module.exports.getRides = async (page = 1, limit = 10, search = '', filters = {}) => {
    const skip = (page - 1) * limit;
    const query = {};

    // Search by text (passenger or driver name, or status)
    if (search) {
        // To search by user/captain name in MongoDB we'd typically need aggregation or text search.
        // For simplicity in find(), we can search string fields or status.
        // A more advanced approach would use $lookup in aggregation.
        // For now, we search by status or orderId if available.
        query.$or = [
            { status: { $regex: search, $options: 'i' } }
        ];
    }

    if (filters.status) query.status = filters.status;
    if (filters.vehicleType) query.vehicleType = filters.vehicleType;
    if (filters.paymentMethod) query.paymentMethod = filters.paymentMethod;
    
    if (filters.period && filters.period !== 'all') {
        const now = new Date();
        let startDate;
        if (filters.period === 'today') {
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        } else if (filters.period === '7d') {
            startDate = new Date(now);
            startDate.setDate(now.getDate() - 7);
        } else if (filters.period === '30d') {
            startDate = new Date(now);
            startDate.setDate(now.getDate() - 30);
        }
        if (startDate) {
            query.createdAt = { $gte: startDate };
        }
    }

    const rides = await rideModel.find(query)
        .populate('user', 'fullname email phone')
        .populate('captain', 'fullname email phone vehicle rating')
        .skip(skip).limit(limit).sort({ createdAt: -1 });
    
    const total = await rideModel.countDocuments(query);
    
    // Totalizers for the summary block
    const baseDateQuery = query.createdAt ? { createdAt: query.createdAt } : {};
    const requested = await rideModel.countDocuments({ ...baseDateQuery, status: 'requested' });
    const ongoing = await rideModel.countDocuments({ ...baseDateQuery, status: { $in: ['accepted', 'going_to_pickup', 'arrived', 'started', 'waiting_passenger'] } });
    const finished = await rideModel.countDocuments({ ...baseDateQuery, status: 'finished' });
    const cancelled = await rideModel.countDocuments({ ...baseDateQuery, status: 'cancelled' });

    return { 
        rides, 
        total, 
        pages: Math.ceil(total / limit),
        summary: {
            requested,
            ongoing,
            finished,
            cancelled,
            total: requested + ongoing + finished + cancelled
        }
    };
};

module.exports.cancelRide = async (id, reason, admin, ip) => {
    const ride = await rideModel.findById(id);
    if (!ride) throw new Error('Corrida não encontrada');
    if (['finished', 'cancelled'].includes(ride.status)) throw new Error('Corrida já finalizada ou cancelada');

    ride.status = 'cancelled';
    if (reason) ride.observation = reason;
    await ride.save();

    if (ride.captain) {
        const captainService = require('./captain.service');
        captainService.recalculateCancellationStats(ride.captain).catch(console.error);
    }

    await module.exports.logAction({
        adminId: admin._id,
        adminName: admin.name,
        action: 'cancel_ride',
        targetId: ride._id.toString(),
        targetModel: 'Ride',
        reason: reason || 'Cancelada pelo painel admin',
        ipAddress: ip || '0.0.0.0'
    });

    return ride;
};

// Auditoria de concorrência do painel administrativo (2026-08-02, Bloco E, achados
// C4/C5/C6): antes, isto fazia `ride.captain = null; ride.status = 'requested';
// ride.save()` direto — sem passar pela máquina de estados (`transitionRide` em
// ride.service.js), aceitava reatribuir uma corrida `started` (passageiro dentro do
// carro) e não notificava nem redespachava a corrida pra ninguém, deixando-a travada em
// 'requested' pra sempre. A transição segura e o redespacho agora vivem em
// ride.service.js/ride.controller.js — aqui só orquestra e audita.
module.exports.reassignRide = async (id, admin, ip) => {
    const rideService = require('./ride.service');

    let result;
    try {
        result = await rideService.reassignRideByAdmin(id);
    } catch (err) {
        if (err.message === 'Ride not found') throw new Error('Corrida não encontrada');
        if (err.message === 'Ride cannot be reassigned at this stage') {
            throw new Error('Esta corrida não pode ser reatribuída neste estágio (já em andamento, finalizada ou cancelada)');
        }
        throw err;
    }

    const { ride, previousCaptain } = result;

    await module.exports.logAction({
        adminId: admin._id,
        adminName: admin.name,
        action: 'reassign_ride',
        targetId: ride._id.toString(),
        targetModel: 'Ride',
        reason: 'Corrida reatribuída para busca de novo motorista pelo painel administrativo',
        oldValue: { captain: previousCaptain },
        ipAddress: ip || '0.0.0.0'
    });

    return { ride, previousCaptain };
};

module.exports.bulkActionRides = async (rideIds, actionType, reason, admin, ip) => {
    if (!rideIds || !rideIds.length) throw new Error('Nenhuma corrida selecionada');

    let updatedCount = 0;
    
    if (actionType === 'cancel') {
        const affectedCaptainIds = await rideModel.distinct('captain', {
            _id: { $in: rideIds },
            status: { $nin: ['finished', 'cancelled'] },
            captain: { $ne: null }
        });

        const result = await rideModel.updateMany(
            { _id: { $in: rideIds }, status: { $nin: ['finished', 'cancelled'] } },
            { $set: { status: 'cancelled', observation: reason } }
        );
        updatedCount = result.modifiedCount;

        const captainService = require('./captain.service');
        affectedCaptainIds.forEach(captainId => {
            captainService.recalculateCancellationStats(captainId).catch(console.error);
        });

        await module.exports.logAction({
            adminId: admin._id,
            adminName: admin.name,
            action: 'bulk_cancel_rides',
            targetModel: 'Ride',
            reason: `Cancelamento em lote de ${updatedCount} corridas. Motivo: ${reason}`,
            ipAddress: ip || '0.0.0.0'
        });
    }

    return { success: true, updatedCount };
};

module.exports.getPayouts = async (page = 1, limit = 10, filters = {}) => {
    const skip = (page - 1) * limit;
    const query = {};

    if (filters.status) query.status = filters.status;
    if (filters.period && filters.period !== 'all') {
        const now = new Date();
        let startDate;
        if (filters.period === 'today') {
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        } else if (filters.period === '7d') {
            startDate = new Date(now);
            startDate.setDate(now.getDate() - 7);
        } else if (filters.period === '30d') {
            startDate = new Date(now);
            startDate.setDate(now.getDate() - 30);
        }
        if (startDate) {
            query.createdAt = { $gte: startDate };
        }
    }

    const search = String(filters.search || '').trim();
    if (search) {
        if (mongoose.Types.ObjectId.isValid(search) && String(new mongoose.Types.ObjectId(search)) === search) {
            query._id = search;
        } else {
            const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
            const captains = await captainModel.find({
                $or: [
                    { 'fullname.firstname': rx },
                    { 'fullname.lastname': rx },
                    { email: rx },
                    { phone: rx },
                    { pixKey: rx },
                ],
            }).select('_id').limit(100);
            const captainIds = captains.map((c) => c._id);
            query.$or = [
                { captainId: { $in: captainIds } },
                { 'bankDetailsSnapshot.pixKey': rx },
            ];
        }
    }

    const payouts = await payoutModel.find(query)
        .populate('captainId', 'fullname email phone pixKey status isBlocked approvalStatus earnings')
        .skip(skip).limit(limit).sort({ createdAt: -1 });

    const total = await payoutModel.countDocuments(query);

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(startOfToday.getFullYear(), startOfToday.getMonth(), 1);

    // Aggregations for summary (repasses)
    const [pendingSum] = await payoutModel.aggregate([{ $match: { status: { $in: ['requested', 'in_analysis', 'approved', 'processing'] } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]);
    const [paidTodaySum] = await payoutModel.aggregate([{ $match: { status: 'paid', paidAt: { $gte: startOfToday } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]);
    const [paidMonthSum] = await payoutModel.aggregate([{ $match: { status: 'paid', paidAt: { $gte: startOfMonth } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]);
    const rejectedCount = await payoutModel.countDocuments({ status: 'rejected' });

    // Bloco H (2026-08-02): payoutDeadlineDays era salvo em globalSetting e nunca lido
    // por nada — primeiro uso real: repasses parados (não processing/paid/rejected) há
    // mais dias que o prazo configurado viram um alerta visível no Financeiro.
    const settings = await globalSettingModel.findOne();
    const deadlineDays = settings?.payoutDeadlineDays ?? 2;
    const deadlineDate = new Date();
    deadlineDate.setDate(deadlineDate.getDate() - deadlineDays);
    const overdueCount = await payoutModel.countDocuments({
        status: { $in: ['requested', 'in_analysis', 'approved'] },
        createdAt: { $lt: deadlineDate }
    });

    // Saldo da plataforma = comissões já liquidadas na carteira dos motoristas
    // (lançamentos type:commission). Antes ficava null hardcoded ("Não disponível").
    const [commissionAll] = await transactionModel.aggregate([
        { $match: { type: 'commission', status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const [commissionTodayAgg] = await transactionModel.aggregate([
        { $match: { type: 'commission', status: 'completed', createdAt: { $gte: startOfToday } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);
    const [commissionMonthAgg] = await transactionModel.aggregate([
        { $match: { type: 'commission', status: 'completed', createdAt: { $gte: startOfMonth } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
    ]);

    // Série dos últimos 7 dias: comissões recebidas + saques pagos (gráfico real).
    const chartStart = new Date(startOfToday);
    chartStart.setDate(chartStart.getDate() - 6);
    const [commissionByDay, payoutsByDay] = await Promise.all([
        transactionModel.aggregate([
            {
                $match: {
                    type: 'commission',
                    status: 'completed',
                    createdAt: { $gte: chartStart },
                },
            },
            {
                $group: {
                    _id: {
                        $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'America/Sao_Paulo' },
                    },
                    total: { $sum: '$amount' },
                },
            },
        ]),
        payoutModel.aggregate([
            {
                $match: {
                    status: 'paid',
                    paidAt: { $gte: chartStart },
                },
            },
            {
                $group: {
                    _id: {
                        $dateToString: { format: '%Y-%m-%d', date: '$paidAt', timezone: 'America/Sao_Paulo' },
                    },
                    total: { $sum: '$amount' },
                },
            },
        ]),
    ]);

    const commissionMap = Object.fromEntries(commissionByDay.map((d) => [d._id, d.total]));
    const payoutMap = Object.fromEntries(payoutsByDay.map((d) => [d._id, d.total]));
    const weekdayLabels = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const chartSeries = [];
    const keyFmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
    for (let i = 0; i < 7; i += 1) {
        const day = new Date(chartStart);
        day.setDate(chartStart.getDate() + i);
        const key = keyFmt.format(day);
        chartSeries.push({
            name: weekdayLabels[day.getDay()],
            date: key,
            commission: Math.round((commissionMap[key] || 0) * 100) / 100,
            payouts: Math.round((payoutMap[key] || 0) * 100) / 100,
            // valor principal do gráfico = comissão do dia (receita da plataforma)
            valor: Math.round((commissionMap[key] || 0) * 100) / 100,
        });
    }

    const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

    return {
        payouts,
        total,
        pages: Math.ceil(total / limit) || 1,
        chartSeries,
        summary: {
            pendingAmount: round2(pendingSum?.total),
            paidToday: round2(paidTodaySum?.total),
            paidMonth: round2(paidMonthSum?.total),
            rejectedCount,
            overdueCount,
            payoutDeadlineDays: deadlineDays,
            platformBalance: round2(commissionAll?.total),
            commissionToday: round2(commissionTodayAgg?.total),
            commissionMonth: round2(commissionMonthAgg?.total),
        }
    };
};

module.exports.getPayoutDetails = async (payoutId) => {
    const payout = await payoutModel.findById(payoutId)
        .populate('captainId', 'fullname email phone pixKey status isBlocked approvalStatus earnings')
        .populate('operatorId', 'name email');

    if (!payout) throw new Error('Repasse não encontrado');

    // Get timeline logs for this specific payout
    const logs = await adminLogModel.find({ targetId: payoutId, targetModel: 'Payout' }).sort({ createdAt: 1 });

    // Auditoria financeira (2026-08-02, Bloco B): o drawer mostrava captain.earnings
    // como "saldo do motorista" — métrica de ganhos vitalícios, não o saldo que o
    // repasse de fato debita. wallet.pendingBalance é o número real.
    const wallet = payout.captainId ? await walletModel.findOne({ captainId: payout.captainId._id }) : null;

    return { payout, logs, wallet };
};

// Auditoria financeira (2026-08-02, Bloco B): núcleo compartilhado entre approvePayout
// e bulkApprovePayouts. Reivindica o repasse atomicamente (CAS via findOneAndUpdate
// dentro de uma transação Mongo — mesmo padrão de confirmPaymentReceived em
// ride.service.js) e só então debita a carteira real do motorista. Duas aprovações
// concorrentes do mesmo repasse: só uma ganha a corrida pelo CAS: a outra recebe null
// e sabe que não deve debitar nada.
async function claimAndDebitPayout(payoutId, admin) {
    const payout = await payoutModel.findById(payoutId).populate('captainId');
    if (!payout) throw new Error('Repasse não encontrado');

    const captain = payout.captainId;
    if (!captain) throw new Error('Motorista do repasse não encontrado');
    if (captain.isBlocked) throw new Error('Não é possível aprovar: Motorista está bloqueado');
    if (captain.approvalStatus !== 'aprovado') throw new Error('Não é possível aprovar: Motorista não está com cadastro aprovado');
    if (!payout.bankDetailsSnapshot || !payout.bankDetailsSnapshot.pixKey) {
        throw new Error('Não é possível aprovar: Chave PIX não encontrada para este motorista');
    }

    const session = await mongoose.startSession();
    let applySideEffects = null;
    let claimed = null;

    try {
        await session.withTransaction(async () => {
            claimed = await payoutModel.findOneAndUpdate(
                { _id: payoutId, status: { $in: ['requested', 'in_analysis', 'approved'] } },
                { $set: { status: 'processing', operatorId: admin._id, adminId: admin.email } },
                { new: true, session }
            );
            if (!claimed) {
                throw new Error('Este repasse já foi processado por outra ação ou não está em um estado aprovável');
            }

            const wallet = await walletModel.findOne({ captainId: captain._id }).session(session);
            if (!wallet || wallet.pendingBalance < claimed.amount) {
                throw new Error('Saldo insuficiente na carteira do motorista para este repasse');
            }

            const result = await walletService.createTransaction({
                captainId: captain._id,
                type: 'payout',
                paymentMethod: 'pix',
                amount: claimed.amount,
                description: `Repasse aprovado #${claimed._id.toString().slice(-6)}`,
                adminId: admin.email,
                reason: 'Repasse aprovado via painel administrativo',
                session
            });
            applySideEffects = result.applySideEffects;
        });
    } finally {
        await session.endSession();
    }

    // Efeitos colaterais (socket, cache) só depois do commit — mesmo motivo de
    // confirmPaymentReceived: emiti-los antes avisaria de um dinheiro que pode nunca
    // ter sido efetivado, se a transação abortasse.
    if (applySideEffects) await applySideEffects();

    return claimed;
}

module.exports.approvePayout = async (payoutId, admin, ip) => {
    const payout = await claimAndDebitPayout(payoutId, admin);

    await module.exports.logAction({
        adminId: admin._id,
        adminName: admin.name,
        action: 'approve_payout',
        targetId: payout._id.toString(),
        targetModel: 'Payout',
        reason: 'Repasse aprovado — valor debitado da carteira, aguardando confirmação de pagamento',
        newValue: { status: 'processing', amount: payout.amount },
        ipAddress: ip || '0.0.0.0'
    });

    return payout;
};

// Auditoria financeira (2026-08-02, Bloco B): segundo passo deliberado — o financeiro
// confirma manualmente (fora do sistema, olhando o extrato bancário real) que o PIX
// efetivamente saiu. Não existe gateway integrado para automatizar esta confirmação.
module.exports.confirmPayoutPaid = async (payoutId, admin, ip) => {
    const payout = await payoutModel.findOneAndUpdate(
        { _id: payoutId, status: 'processing' },
        { $set: { status: 'paid', paidAt: new Date() } },
        { new: true }
    );
    if (!payout) throw new Error('Este repasse não está aguardando confirmação de pagamento');

    await module.exports.logAction({
        adminId: admin._id,
        adminName: admin.name,
        action: 'confirm_payout_paid',
        targetId: payout._id.toString(),
        targetModel: 'Payout',
        reason: 'Pagamento confirmado manualmente pelo financeiro',
        newValue: { status: 'paid' },
        ipAddress: ip || '0.0.0.0'
    });

    return payout;
};

module.exports.rejectPayout = async (payoutId, reason, admin, ip) => {
    if (!reason) throw new Error('Motivo da rejeição é obrigatório');

    const existing = await payoutModel.findById(payoutId);
    if (!existing) throw new Error('Repasse não encontrado');
    if (existing.status === 'processing') {
        throw new Error('Este repasse já teve o valor debitado da carteira do motorista e não pode mais ser rejeitado por aqui — é necessário um estorno manual');
    }
    if (existing.status === 'paid' || existing.status === 'rejected') {
        throw new Error('Este repasse já foi finalizado');
    }

    const payout = await payoutModel.findOneAndUpdate(
        { _id: payoutId, status: { $in: ['requested', 'in_analysis', 'approved'] } },
        { $set: { status: 'rejected', reason, operatorId: admin._id } },
        { new: true }
    );
    if (!payout) throw new Error('Este repasse já foi processado por outra ação');

    await module.exports.logAction({
        adminId: admin._id,
        adminName: admin.name,
        action: 'reject_payout',
        targetId: payout._id.toString(),
        targetModel: 'Payout',
        reason: reason,
        newValue: { status: 'rejected' },
        ipAddress: ip || '0.0.0.0'
    });

    return payout;
};

module.exports.bulkApprovePayouts = async (payoutIds, admin, ip) => {
    if (!payoutIds || !payoutIds.length) throw new Error('Nenhum repasse selecionado');

    let approvedCount = 0;

    for (const payoutId of payoutIds) {
        try {
            await claimAndDebitPayout(payoutId, admin);
            approvedCount++;
        } catch (err) {
            // Item inválido (bloqueado, sem Pix, saldo insuficiente, já processado) —
            // pula e segue com o resto do lote, igual ao comportamento anterior.
            continue;
        }
    }

    if (approvedCount > 0) {
        await module.exports.logAction({
            adminId: admin._id,
            adminName: admin.name,
            action: 'bulk_approve_payouts',
            targetModel: 'Payout',
            reason: `Aprovação em lote de ${approvedCount} repasses`,
            ipAddress: ip || '0.0.0.0'
        });
    }

    return { success: true, approvedCount, totalRequested: payoutIds.length };
};

module.exports.getCaptainFinancialHistory = async (captainId) => {
    // Simulated financial history
    // We fetch recent rides and recent payouts to interleave them
    const rides = await rideModel.find({ captain: captainId, status: 'finished' })
        .sort({ createdAt: -1 }).limit(10).select('createdAt fare commissionAmount');
        
    const payouts = await payoutModel.find({ captainId, status: 'paid' })
        .sort({ createdAt: -1 }).limit(10).select('paidAt amount');
        
    const history = [];
    rides.forEach(r => {
        history.push({ type: 'ride', date: r.createdAt, amount: r.fare, commission: r.commissionAmount, label: 'Corrida' });
    });
    payouts.forEach(p => {
        history.push({ type: 'payout', date: p.paidAt, amount: -p.amount, label: 'Saque/Repasse' });
    });
    
    history.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    return history.slice(0, 20);
};

const tariffSettingModel = require('../models/tariffSetting.model');
const vehicleCategoryModel = require('../models/vehicleCategory.model');
const globalSettingModel = require('../models/globalSetting.model');
const {
    ensurePlatformCommissions,
    normalizePlatformCommissionsPatch,
} = require('../utils/platformCommission');

// Campos de globalSetting expostos junto com tariffSetting na aba "Globais" do painel.
// Antes o simulador de tarifas usava um platformCommission=15 fixo no front porque o
// admin não tinha como ver/editar o valor real (20%) usado no cálculo.
const GLOBAL_SETTING_FIELDS = ['platformCommission', 'platformCommissions', 'cardFeePercent', 'cardFeeFixed'];

function mergeGlobalFieldsIntoTariff(merged, globalSetting) {
    if (!globalSetting) return;
    GLOBAL_SETTING_FIELDS.forEach((field) => {
        if (field === 'platformCommissions') {
            merged.platformCommissions = globalSetting.platformCommissions?.toObject?.()
                || globalSetting.platformCommissions
                || { ride: globalSetting.platformCommission, presential: globalSetting.platformCommission, parcel: globalSetting.platformCommission };
        } else {
            merged[field] = globalSetting[field];
        }
    });
}

module.exports.getTariffs = async () => {
    let tariff = await tariffSettingModel.findOne();
    if (!tariff) {
        tariff = await tariffSettingModel.create({});
    }

    let globalSetting = await globalSettingModel.findOne();
    if (!globalSetting) {
        globalSetting = await globalSettingModel.create({
            platformCommission: 20,
            platformCommissions: { ride: 20, presential: 20, parcel: 20 },
        });
    } else {
        globalSetting = await ensurePlatformCommissions(globalSetting);
    }

    const merged = tariff.toObject();
    mergeGlobalFieldsIntoTariff(merged, globalSetting);
    // Bloco E (2026-08-02, achado C1): o painel mescla dois documentos num só objeto
    // pra tela de "Tarifas Globais" — o admin precisa devolver a versão de CADA um
    // separadamente no PUT, porque updateGlobalSettings vai checar os dois.
    merged.__tariffVersion = tariff.__v;
    merged.__globalSettingVersion = globalSetting.__v;
    return merged;
};

// Bloco E (2026-08-02, achado C1): dois admins abrindo a tela de Tarifas Globais ao
// mesmo tempo — o segundo a salvar sobrescrevia tudo o que o primeiro tinha acabado de
// mudar, sem aviso nenhum. `__tariffVersion`/`__globalSettingVersion` são o __v que o
// admin leu quando a tela carregou (ver getTariffs); se o documento já mudou desde
// então, recusa com 409 em vez de aplicar por cima.
function assertVersionMatches(expected, actual, message) {
    if (expected !== undefined && expected !== actual) {
        const err = new Error(`${message} Recarregue a página para ver os valores atuais antes de salvar.`);
        err.statusCode = 409;
        throw err;
    }
}

module.exports.updateGlobalSettings = async (data) => {
    const { __tariffVersion, __globalSettingVersion, ...rest } = data;

    const globalFields = {};
    const tariffFields = { ...rest };
    GLOBAL_SETTING_FIELDS.forEach(field => {
        if (rest[field] !== undefined) {
            globalFields[field] = rest[field];
            delete tariffFields[field];
        }
    });

    let tariff = await tariffSettingModel.findOne();
    if (tariff) {
        assertVersionMatches(__tariffVersion, tariff.__v, 'As configurações de tarifa foram alteradas por outro administrador enquanto você editava.');
        Object.assign(tariff, tariffFields);
        await tariff.save();
    } else {
        tariff = await tariffSettingModel.create(tariffFields);
    }

    let globalSetting = await globalSettingModel.findOne();
    const hasCommissionPatch = globalFields.platformCommissions !== undefined
        || globalFields.platformCommission !== undefined;
    const hasOtherGlobal = globalFields.cardFeePercent !== undefined
        || globalFields.cardFeeFixed !== undefined;

    if (hasCommissionPatch || hasOtherGlobal) {
        if (globalSetting) {
            assertVersionMatches(__globalSettingVersion, globalSetting.__v, 'As configurações financeiras globais foram alteradas por outro administrador enquanto você editava.');
            globalSetting = await ensurePlatformCommissions(globalSetting);

            if (hasCommissionPatch) {
                const nextCommissions = normalizePlatformCommissionsPatch(globalFields, globalSetting);
                globalSetting.platformCommissions = nextCommissions;
                globalSetting.platformCommission = nextCommissions.ride;
                globalSetting.markModified('platformCommissions');
            }
            if (globalFields.cardFeePercent !== undefined) {
                globalSetting.cardFeePercent = Number(globalFields.cardFeePercent);
            }
            if (globalFields.cardFeeFixed !== undefined) {
                globalSetting.cardFeeFixed = Number(globalFields.cardFeeFixed);
            }
            await globalSetting.save();
        } else {
            const nextCommissions = normalizePlatformCommissionsPatch(globalFields, {
                platformCommission: 20,
            });
            globalSetting = await globalSettingModel.create({
                platformCommissions: nextCommissions,
                platformCommission: nextCommissions.ride,
                cardFeePercent: globalFields.cardFeePercent ?? 0,
                cardFeeFixed: globalFields.cardFeeFixed ?? 0,
            });
        }
    }

    if (globalSetting) {
        globalSetting = await ensurePlatformCommissions(globalSetting);
    }

    const merged = tariff.toObject();
    mergeGlobalFieldsIntoTariff(merged, globalSetting);
    merged.__tariffVersion = tariff.__v;
    merged.__globalSettingVersion = globalSetting ? globalSetting.__v : undefined;
    return merged;
};

module.exports.getVehicleCategories = async () => {
    const categories = await vehicleCategoryModel.find();
    return categories;
};

// Bloco E (2026-08-02, achado C1): esta função sempre usou findByIdAndUpdate direto —
// optimisticConcurrency (ativado no schema) só entra em ação em .save(), então aqui a
// checagem de versão precisa ser manual, dos dois lados: uma pré-checagem (mensagem
// rápida e clara pro caso comum) e o próprio __v no filtro do findOneAndUpdate (garantia
// atômica de verdade pro caso raro de dois PUTs chegando quase juntos).
module.exports.updateVehicleCategory = async (id, data) => {
    const oldCategory = await vehicleCategoryModel.findById(id).lean();
    if (!oldCategory) throw new Error('Categoria não encontrada');

    assertVersionMatches(data.__v, oldCategory.__v, 'Esta categoria de veículo foi alterada por outro administrador enquanto você editava.');

    // extrair campos permitidos
    const updateData = {
        displayName: data.displayName !== undefined ? data.displayName : oldCategory.displayName,
        description: data.description !== undefined ? data.description : oldCategory.description,
        capacity: data.capacity !== undefined ? data.capacity : oldCategory.capacity,
        iconKey: data.iconKey !== undefined ? data.iconKey : oldCategory.iconKey,
        sortOrder: data.sortOrder !== undefined ? data.sortOrder : oldCategory.sortOrder,
        baseFare: data.baseFare !== undefined ? data.baseFare : oldCategory.baseFare,
        perKmRate: data.perKmRate !== undefined ? data.perKmRate : oldCategory.perKmRate,
        perMinuteRate: data.perMinuteRate !== undefined ? data.perMinuteRate : oldCategory.perMinuteRate,
        minFare: data.minFare !== undefined ? data.minFare : oldCategory.minFare,
        dynamicMultiplier: data.dynamicMultiplier !== undefined ? data.dynamicMultiplier : oldCategory.dynamicMultiplier,
        rainFeeMultiplier: data.rainFeeMultiplier !== undefined ? data.rainFeeMultiplier : oldCategory.rainFeeMultiplier,
        isActive: data.isActive !== undefined ? data.isActive : oldCategory.isActive
    };

    const filter = { _id: id };
    if (data.__v !== undefined) filter.__v = data.__v;

    const category = await vehicleCategoryModel.findOneAndUpdate(
        filter,
        { $set: updateData, $inc: { __v: 1 } },
        { new: true }
    );
    if (!category) {
        const err = new Error('Esta categoria de veículo foi alterada por outro administrador enquanto você editava. Recarregue a página para ver os valores atuais antes de salvar.');
        err.statusCode = 409;
        throw err;
    }

    return { category, oldValue: oldCategory };
};

module.exports.createVehicleCategory = async (data) => {
    const { name, displayName } = data;
    if (!name || !displayName) throw new Error('Nome interno e nome de exibição são obrigatórios');

    const existing = await vehicleCategoryModel.findOne({ name });
    if (existing) throw new Error('Já existe uma categoria com este nome interno');

    const category = await vehicleCategoryModel.create({
        name,
        displayName,
        description: data.description || '',
        capacity: data.capacity !== undefined ? data.capacity : 4,
        iconKey: data.iconKey || 'car',
        sortOrder: data.sortOrder !== undefined ? data.sortOrder : 0,
        baseFare: data.baseFare !== undefined ? data.baseFare : 5.0,
        perKmRate: data.perKmRate !== undefined ? data.perKmRate : 1.5,
        perMinuteRate: data.perMinuteRate !== undefined ? data.perMinuteRate : 0.3,
        minFare: data.minFare !== undefined ? data.minFare : 8.0,
        isActive: data.isActive !== undefined ? data.isActive : true
    });

    return category;
};

// Bloco I (2026-08-02, §12): a tela de Logs não tinha filtro nenhum — inutilizável em
// qualquer volume real de ações administrativas. filters aceita adminName (busca
// parcial, case-insensitive), action, targetModel, targetId e um período (startDate/
// endDate).
module.exports.getLogs = async (page = 1, limit = 15, filters = {}) => {
    const skip = (page - 1) * limit;
    const query = {};

    if (filters.adminName) query.adminName = { $regex: filters.adminName, $options: 'i' };
    if (filters.action) query.action = filters.action;
    if (filters.targetModel) query.targetModel = filters.targetModel;
    if (filters.targetId) query.targetId = filters.targetId;
    if (filters.startDate || filters.endDate) {
        query.createdAt = {};
        if (filters.startDate) query.createdAt.$gte = new Date(filters.startDate);
        if (filters.endDate) query.createdAt.$lte = new Date(filters.endDate);
    }

    const logs = await adminLogModel.find(query).skip(skip).limit(limit).sort({ createdAt: -1 });
    const total = await adminLogModel.countDocuments(query);
    return { logs, total, pages: Math.ceil(total / limit) };
};

