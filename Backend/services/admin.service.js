const adminUserModel = require('../models/adminUser.model');
const adminLogModel = require('../models/adminLog.model');
const rideModel = require('../models/ride.model');
const captainModel = require('../models/captain.model');
const userModel = require('../models/user.model');
const transactionModel = require('../models/transaction.model');
const payoutModel = require('../models/payout.model');

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

    const token = admin.generateAuthToken();
    const refreshToken = admin.generateRefreshToken();

    admin.refreshToken = refreshToken;
    await admin.save();

    return { admin, token, refreshToken };
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
    const totalCaptains = await captainModel.countDocuments();
    const onlineCaptains = await captainModel.countDocuments({ isOnline: true });
    const availableCaptains = await captainModel.countDocuments({ isOnline: true, canReceiveRides: true });
    const inRideCaptains = await captainModel.countDocuments({ isOnline: true, canReceiveRides: false });
    const offlineCaptains = totalCaptains - onlineCaptains;

    // --- QUALITY ---
    const getQualityStats = async (start, end) => {
        // Mocks for now as requested, we return null so frontend handles as "Not Available" if not implemented yet
        return {
            avgSearchTimeSeconds: null, // To be implemented with logs
            cancelRate: currentRides.total > 0 ? (currentRides.cancelled / currentRides.total) * 100 : 0,
            acceptRate: null, // Need ride request logs
            avgRating: 4.8 // Fixed global rating for now until aggregate from reviews
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

module.exports.updateUserTags = async (userId, tags, admin) => {
    const user = await userModel.findByIdAndUpdate(userId, { tags }, { new: true });
    
    await module.exports.logAction({
        adminId: admin._id,
        adminName: admin.name,
        action: 'update_user_tags',
        targetId: userId.toString(),
        targetModel: 'User',
        reason: 'Atualização de tags de risco/perfil do passageiro',
        newValue: { tags },
        ipAddress: '0.0.0.0'
    });
    
    return user;
};

module.exports.addUserObservation = async (userId, text, admin) => {
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
    const totalCaptains = await captainModel.countDocuments();
    const online = await captainModel.countDocuments({ isOnline: true });
    const inRide = await captainModel.countDocuments({ isOnline: true, canReceiveRides: false });
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

module.exports.updateCaptainApproval = async (captainId, approvalStatus, reason, admin, ip) => {
    const captain = await captainModel.findByIdAndUpdate(captainId, { approvalStatus }, { new: true });
    
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

module.exports.toggleCaptainBlock = async (captainId, isBlocked, reason, admin, ip) => {
    const captain = await captainModel.findByIdAndUpdate(captainId, { isBlocked }, { new: true });
    
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

module.exports.updateCaptainDocument = async (captainId, docType, verified, reason, admin) => {
    const captain = await captainModel.findById(captainId);
    if (!captain || !captain.documents || !captain.documents[docType]) {
        throw new Error('Documento não encontrado');
    }
    
    captain.documents[docType].verified = verified;
    await captain.save();

    await module.exports.logAction({
        adminId: admin._id,
        adminName: admin.name,
        action: verified ? 'approve_document' : 'reject_document',
        targetId: captain._id.toString(),
        targetModel: 'Captain',
        reason: reason || `Verificação de documento: ${docType}`,
        newValue: { document: docType, verified },
        ipAddress: '0.0.0.0'
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
    // Mocks for now, real implementation would sum transactions
    const wallet = {
        balance: captain.earnings || 0,
        pending: 0,
        commissions: 0,
        lastRecharge: new Date().toISOString()
    };
    return wallet;
};

module.exports.getCaptainTimeline = async (captainId) => {
    const logs = await module.exports.getLogs(1, 50, '', { targetId: captainId.toString() });
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

module.exports.cancelRide = async (id, reason, admin) => {
    const ride = await rideModel.findById(id);
    if (!ride) throw new Error('Corrida não encontrada');
    if (['finished', 'cancelled'].includes(ride.status)) throw new Error('Corrida já finalizada ou cancelada');

    ride.status = 'cancelled';
    if (reason) ride.observation = reason;
    await ride.save();

    await module.exports.logAction({
        adminId: admin._id,
        adminName: admin.name,
        action: 'cancel_ride',
        targetId: ride._id.toString(),
        targetModel: 'Ride',
        reason: reason || 'Cancelada pelo painel admin',
        ipAddress: '0.0.0.0' // Should pass req.ip ideally
    });

    return ride;
};

module.exports.reassignRide = async (id, admin) => {
    const ride = await rideModel.findById(id);
    if (!ride) throw new Error('Corrida não encontrada');
    if (['finished', 'cancelled'].includes(ride.status)) throw new Error('Corrida não pode ser reatribuída');

    // Desvincula o motorista atual e volta para requested
    const oldCaptain = ride.captain;
    ride.captain = null;
    ride.status = 'requested';
    await ride.save();

    await module.exports.logAction({
        adminId: admin._id,
        adminName: admin.name,
        action: 'reassign_ride',
        targetId: ride._id.toString(),
        targetModel: 'Ride',
        reason: 'Corrida reatribuída para busca de novo motorista',
        oldValue: { captain: oldCaptain },
        ipAddress: '0.0.0.0'
    });

    return ride;
};

module.exports.bulkActionRides = async (rideIds, actionType, reason, admin) => {
    if (!rideIds || !rideIds.length) throw new Error('Nenhuma corrida selecionada');

    let updatedCount = 0;
    
    if (actionType === 'cancel') {
        const result = await rideModel.updateMany(
            { _id: { $in: rideIds }, status: { $nin: ['finished', 'cancelled'] } },
            { $set: { status: 'cancelled', observation: reason } }
        );
        updatedCount = result.modifiedCount;
        
        await module.exports.logAction({
            adminId: admin._id,
            adminName: admin.name,
            action: 'bulk_cancel_rides',
            targetModel: 'Ride',
            reason: `Cancelamento em lote de ${updatedCount} corridas. Motivo: ${reason}`,
            ipAddress: '0.0.0.0'
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
    
    // Simplification for search: we'd ideally use aggregation to search inside populated captain.
    // We'll leave search out of the mongoose query here and let frontend filter if complex, or just use exact ID.

    const payouts = await payoutModel.find(query)
        .populate('captainId', 'fullname email phone pixKey status isBlocked approvalStatus earnings')
        .skip(skip).limit(limit).sort({ createdAt: -1 });
        
    const total = await payoutModel.countDocuments(query);
    
    // Aggregations for summary
    const [pendingSum] = await payoutModel.aggregate([{ $match: { status: { $in: ['requested', 'in_analysis', 'approved', 'processing'] } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]);
    const [paidTodaySum] = await payoutModel.aggregate([{ $match: { status: 'paid', paidAt: { $gte: new Date(new Date().setHours(0,0,0,0)) } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]);
    const [paidMonthSum] = await payoutModel.aggregate([{ $match: { status: 'paid', paidAt: { $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]);
    const rejectedCount = await payoutModel.countDocuments({ status: 'rejected' });

    return { 
        payouts, 
        total, 
        pages: Math.ceil(total / limit),
        summary: {
            pendingAmount: pendingSum?.total || 0,
            paidToday: paidTodaySum?.total || 0,
            paidMonth: paidMonthSum?.total || 0,
            rejectedCount,
            platformBalance: null // Not available yet
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
    
    return { payout, logs };
};

module.exports.approvePayout = async (payoutId, admin, ip) => {
    const payout = await payoutModel.findById(payoutId).populate('captainId');
    if (!payout) throw new Error('Repasse não encontrado');
    if (payout.status === 'paid' || payout.status === 'rejected') throw new Error('Este repasse já foi finalizado');
    
    const captain = payout.captainId;
    if (captain.isBlocked) throw new Error('Não é possível aprovar: Motorista está bloqueado');
    if (captain.approvalStatus !== 'aprovado') throw new Error('Não é possível aprovar: Motorista não está com cadastro aprovado');
    // MOCK: Checking if pixKey exists, for real app we'd check captain.pix.key
    if (!payout.bankDetailsSnapshot || !payout.bankDetailsSnapshot.pixKey) {
        throw new Error('Não é possível aprovar: Chave PIX não encontrada para este motorista');
    }
    // MOCK: check sufficient balance (simulated)
    // if (captain.earnings < payout.amount) throw new Error('Saldo insuficiente');

    // Update status to paid (simulate manual instant payment for now)
    payout.status = 'paid';
    payout.paidAt = new Date();
    payout.adminId = admin.email;
    payout.operatorId = admin._id;
    await payout.save();
    
    // Deduct from captain earnings (simulate)
    captain.earnings -= payout.amount;
    await captain.save();

    await module.exports.logAction({
        adminId: admin._id,
        adminName: admin.name,
        action: 'approve_payout',
        targetId: payout._id.toString(),
        targetModel: 'Payout',
        reason: 'Repasse aprovado e processado manualmente',
        newValue: { status: 'paid', amount: payout.amount },
        ipAddress: ip || '0.0.0.0'
    });

    return payout;
};

module.exports.rejectPayout = async (payoutId, reason, admin, ip) => {
    if (!reason) throw new Error('Motivo da rejeição é obrigatório');
    
    const payout = await payoutModel.findById(payoutId);
    if (!payout) throw new Error('Repasse não encontrado');
    if (payout.status === 'paid' || payout.status === 'rejected') throw new Error('Este repasse já foi finalizado');
    
    payout.status = 'rejected';
    payout.reason = reason;
    payout.operatorId = admin._id;
    await payout.save();

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

    const payouts = await payoutModel.find({ _id: { $in: payoutIds }, status: { $nin: ['paid', 'rejected'] } }).populate('captainId');
    let approvedCount = 0;
    
    for (const payout of payouts) {
        const captain = payout.captainId;
        // Skip invalid payouts
        if (captain.isBlocked || captain.approvalStatus !== 'aprovado' || !payout.bankDetailsSnapshot?.pixKey) continue;
        
        payout.status = 'paid';
        payout.paidAt = new Date();
        payout.operatorId = admin._id;
        await payout.save();
        
        captain.earnings -= payout.amount;
        await captain.save();
        
        approvedCount++;
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

module.exports.getTariffs = async () => {
    let tariff = await tariffSettingModel.findOne();
    if (!tariff) {
        tariff = await tariffSettingModel.create({});
    }
    return tariff;
};

module.exports.updateGlobalSettings = async (data) => {
    let tariff = await tariffSettingModel.findOne();
    if (tariff) {
        Object.assign(tariff, data);
        await tariff.save();
    } else {
        tariff = await tariffSettingModel.create(data);
    }
    return tariff;
};

module.exports.getVehicleCategories = async () => {
    const categories = await vehicleCategoryModel.find();
    return categories;
};

module.exports.updateVehicleCategory = async (id, data) => {
    const oldCategory = await vehicleCategoryModel.findById(id).lean();
    if (!oldCategory) throw new Error('Categoria não encontrada');
    
    // extrair campos permitidos
    const updateData = {
        baseFare: data.baseFare !== undefined ? data.baseFare : oldCategory.baseFare,
        perKmRate: data.perKmRate !== undefined ? data.perKmRate : oldCategory.perKmRate,
        perMinuteRate: data.perMinuteRate !== undefined ? data.perMinuteRate : oldCategory.perMinuteRate,
        minFare: data.minFare !== undefined ? data.minFare : oldCategory.minFare,
        dynamicMultiplier: data.dynamicMultiplier !== undefined ? data.dynamicMultiplier : oldCategory.dynamicMultiplier,
        rainFeeMultiplier: data.rainFeeMultiplier !== undefined ? data.rainFeeMultiplier : oldCategory.rainFeeMultiplier,
        isActive: data.isActive !== undefined ? data.isActive : oldCategory.isActive
    };

    const category = await vehicleCategoryModel.findByIdAndUpdate(id, updateData, { new: true });
    
    return { category, oldValue: oldCategory };
};

module.exports.getLogs = async (page = 1, limit = 15) => {
    const skip = (page - 1) * limit;
    const logs = await adminLogModel.find().skip(skip).limit(limit).sort({ createdAt: -1 });
    const total = await adminLogModel.countDocuments();
    return { logs, total, pages: Math.ceil(total / limit) };
};

