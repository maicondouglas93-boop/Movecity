const AdminJS = require('adminjs');
const AdminJSExpress = require('@adminjs/express');
const AdminJSMongoose = require('@adminjs/mongoose');
const mongoose = require('mongoose');

// FIX: Mongoose 8 removeu alguns métodos que o AdminJS v3 ainda usa internamente.
// Criamos "alias" para os novos métodos do Mongoose 8 para o AdminJS funcionar perfeitamente.
mongoose.Model.count = mongoose.Model.countDocuments;
mongoose.Model.findOneAndRemove = mongoose.Model.findOneAndDelete;

const userModel = require('../models/user.model');
const captainModel = require('../models/captain.model');
const rideModel = require('../models/ride.model');
const blacklistTokenModel = require('../models/blacklistToken.model');
const couponModel = require('../models/coupon.model');
const reviewModel = require('../models/review.model');
const notificationModel = require('../models/notification.model');
const globalSettingModel = require('../models/globalSetting.model');
const walletModel = require('../models/wallet.model');
const transactionModel = require('../models/transaction.model');
const payoutModel = require('../models/payout.model');
const rechargeModel = require('../models/recharge.model');

const { getCache, setCache } = require('../cache/cache');

// Registra o adaptador Mongoose no AdminJS
AdminJS.registerAdapter(AdminJSMongoose);

const adminOptions = {
    resources: [
        {
            resource: userModel,
            options: {
                navigation: { name: 'Gerenciamento', icon: 'User' },
                properties: {
                    password: { isVisible: { list: false, filter: false, show: false, edit: true } }
                },
                listProperties: ['fullname.firstname', 'fullname.lastname', 'email', 'phone', 'isBlocked', 'rating', 'createdAt'],
                actions: {
                    block: {
                        actionType: 'record',
                        icon: 'Lock',
                        label: 'Bloquear',
                        handler: async (request, response, context) => {
                            const { record, currentAdmin } = context;
                            await record.update({ isBlocked: true });
                            return {
                                record: record.toJSON(currentAdmin),
                                notice: { message: 'Passageiro bloqueado com sucesso!', type: 'success' },
                            };
                        },
                        component: false,
                    },
                    unblock: {
                        actionType: 'record',
                        icon: 'Unlock',
                        label: 'Desbloquear',
                        handler: async (request, response, context) => {
                            const { record, currentAdmin } = context;
                            await record.update({ isBlocked: false });
                            return {
                                record: record.toJSON(currentAdmin),
                                notice: { message: 'Passageiro desbloqueado com sucesso!', type: 'success' },
                            };
                        },
                        component: false,
                    }
                }
            }
        },
        {
            resource: captainModel,
            options: {
                navigation: { name: 'Gerenciamento', icon: 'Car' },
                properties: {
                    password: { isVisible: { list: false, filter: false, show: false, edit: true } }
                },
                listProperties: ['fullname.firstname', 'email', 'phone', 'approvalStatus', 'status', 'isBlocked', 'rating', 'earnings', 'vehicle.vehicleType'],
                actions: {
                    approve: {
                        actionType: 'record',
                        icon: 'Check',
                        label: 'Aprovar Cadastro',
                        handler: async (request, response, context) => {
                            const { record, currentAdmin } = context;
                            await record.update({ approvalStatus: 'approved' });
                            return {
                                record: record.toJSON(currentAdmin),
                                notice: { message: 'Motorista aprovado com sucesso!', type: 'success' },
                            };
                        },
                        component: false,
                    },
                    reject: {
                        actionType: 'record',
                        icon: 'X',
                        label: 'Rejeitar Cadastro',
                        handler: async (request, response, context) => {
                            const { record, currentAdmin } = context;
                            await record.update({ approvalStatus: 'rejected' });
                            return {
                                record: record.toJSON(currentAdmin),
                                notice: { message: 'Cadastro do motorista rejeitado.', type: 'info' },
                            };
                        },
                        component: false,
                    },
                    block: {
                        actionType: 'record',
                        icon: 'Lock',
                        label: 'Bloquear Motorista',
                        handler: async (request, response, context) => {
                            const { record, currentAdmin } = context;
                            await record.update({ isBlocked: true });
                            return {
                                record: record.toJSON(currentAdmin),
                                notice: { message: 'Motorista bloqueado.', type: 'warning' },
                            };
                        },
                        component: false,
                    },
                    unblock: {
                        actionType: 'record',
                        icon: 'Unlock',
                        label: 'Desbloquear Motorista',
                        handler: async (request, response, context) => {
                            const { record, currentAdmin } = context;
                            await record.update({ isBlocked: false });
                            return {
                                record: record.toJSON(currentAdmin),
                                notice: { message: 'Motorista desbloqueado com sucesso!', type: 'success' },
                            };
                        },
                        component: false,
                    },
                    manualAdjustment: {
                        actionType: 'record',
                        icon: 'DollarSign',
                        label: 'Ajuste Manual',
                        handler: async (request, response, context) => {
                            // Este handler precisa receber os dados do form, mas em AdminJS a action precisa de um form customizado ou pegar os dados do request.payload
                            // Para simplificar, poderíamos criar uma action customizada com componente, mas como estamos apenas listando:
                            const { record, currentAdmin } = context;
                            const amount = Number(request.payload?.amount || 0);
                            const reason = request.payload?.reason || 'Ajuste administrativo';
                            if (request.method === 'post' && amount !== 0) {
                                const walletService = require('../services/wallet.service');
                                await walletService.createTransaction({
                                    captainId: record.params._id,
                                    rideId: null,
                                    type: 'adjustment',
                                    paymentMethod: 'wallet',
                                    amount: amount,
                                    description: 'Ajuste administrativo de saldo',
                                    adminId: currentAdmin?.email,
                                    reason: reason
                                });
                                return {
                                    record: record.toJSON(currentAdmin),
                                    notice: { message: `Ajuste de R$ ${amount} realizado com sucesso.`, type: 'success' }
                                };
                            }
                            return { record: record.toJSON(currentAdmin) };
                        },
                        component: false, // Pode ser aprimorado com um componente React depois para ter campos
                    }
                }
            }
        },
        {
            resource: rideModel,
            options: {
                navigation: { name: 'Operações', icon: 'MapPin' },
                listProperties: ['user', 'captain', 'pickup', 'destination', 'fare', 'paymentStatus', 'paymentMethod', 'distance', 'duration', 'status', 'createdAt'],
                filterProperties: ['status', 'paymentStatus', 'paymentMethod', 'vehicleType', 'user', 'captain'],
                properties: {
                    otp: { isVisible: { list: false, filter: false, show: true, edit: true } }
                }
            }
        },
        {
            resource: couponModel,
            options: {
                navigation: { name: 'Marketing', icon: 'Tag' },
                listProperties: ['code', 'discountPercent', 'maxDiscount', 'expirationDate', 'usageLimit', 'isActive', 'createdAt'],
                filterProperties: ['code', 'isActive']
            }
        },
        {
            resource: reviewModel,
            options: {
                navigation: { name: 'Qualidade', icon: 'Star' },
                listProperties: ['ride', 'user', 'captain', 'rating', 'comment', 'issueCategory', 'type', 'createdAt'],
                filterProperties: ['rating', 'issueCategory', 'type', 'user', 'captain']
            }
        },
        {
            resource: blacklistTokenModel,
            options: {
                navigation: { name: 'Segurança', icon: 'Shield' }
            }
        },
        {
            resource: notificationModel,
            options: {
                navigation: { name: 'Central de Notificações', icon: 'Bell' },
                listProperties: ['title', 'message', 'targetAudience', 'status', 'sentAt', 'createdAt'],
                filterProperties: ['targetAudience', 'status']
            }
        },
        {
            resource: globalSettingModel,
            options: {
                navigation: { name: 'Configurações', icon: 'Settings' },
                actions: {
                    new: { isAccessible: false },
                    delete: { isAccessible: false }
                }
            }
        },
        {
            resource: walletModel,
            options: {
                navigation: { name: 'Financeiro', icon: 'CreditCard' },
                listProperties: ['captainId', 'creditBalance', 'pendingBalance', 'totalEarned', 'totalCommissionPaid', 'updatedAt']
            }
        },
        {
            resource: transactionModel,
            options: {
                navigation: { name: 'Financeiro', icon: 'FileText' },
                listProperties: ['captainId', 'type', 'paymentMethod', 'amount', 'balanceAfter', 'adminId', 'createdAt'],
                filterProperties: ['type', 'paymentMethod', 'status', 'captainId'],
                actions: {
                    new: { isAccessible: false },
                    edit: { isAccessible: false },
                    delete: { isAccessible: false }
                }
            }
        },
        {
            resource: payoutModel,
            options: {
                navigation: { name: 'Financeiro', icon: 'Briefcase' },
                listProperties: ['captainId', 'amount', 'status', 'paidAt', 'adminId', 'createdAt'],
                filterProperties: ['status', 'captainId'],
                actions: {
                    processPayout: {
                        actionType: 'record',
                        icon: 'Check',
                        label: 'Processar (Marcar Pago)',
                        handler: async (request, response, context) => {
                            const { record, currentAdmin } = context;
                            if (record.params.status === 'processing' || record.params.status === 'pendente') {
                                await record.update({ 
                                    status: 'paid', 
                                    paidAt: new Date(), 
                                    adminId: currentAdmin.email,
                                    receipt: request.payload?.receipt || 'Pago via painel admin'
                                });
                                // Deduzir do pendingBalance do motorista!
                                const walletService = require('../services/wallet.service');
                                await walletService.createTransaction({
                                    captainId: record.params.captainId,
                                    rideId: null,
                                    type: 'payout',
                                    paymentMethod: 'wallet',
                                    amount: record.params.amount,
                                    description: `Repasse pago #${record.params._id.toString().slice(-6)}`,
                                    adminId: currentAdmin?.email,
                                    reason: 'Pagamento de Repasse aprovado'
                                });
                                return {
                                    record: record.toJSON(currentAdmin),
                                    notice: { message: 'Repasse processado com sucesso!', type: 'success' }
                                };
                            }
                            return {
                                record: record.toJSON(currentAdmin),
                                notice: { message: 'Este repasse não está mais pendente.', type: 'error' }
                            };
                        },
                        component: false
                    }
                }
            }
        },
        {
            resource: rechargeModel,
            options: {
                navigation: { name: 'Financeiro', icon: 'BatteryCharging' },
                listProperties: ['captainId', 'amount', 'method', 'status', 'asaasInvoiceId', 'createdAt'],
                filterProperties: ['status', 'method', 'captainId']
            }
        }
    ],
    dashboard: {
        handler: async (request, response, context) => {
            const cacheKey = 'dashboard:today';
            const cachedStats = getCache(cacheKey);
            if (cachedStats) {
                return cachedStats;
            }

            try {
                const now = new Date();
                const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                const startOfWeek = new Date(now);
                startOfWeek.setDate(now.getDate() - now.getDay());
                startOfWeek.setHours(0, 0, 0, 0);
                const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

                const ridesToday = await rideModel.countDocuments({ createdAt: { $gte: startOfToday } });
                const ridesWeek = await rideModel.countDocuments({ createdAt: { $gte: startOfWeek } });
                const ridesMonth = await rideModel.countDocuments({ createdAt: { $gte: startOfMonth } });
                
                const totalRidesCount = await rideModel.countDocuments();
                const safeRidesToday = ridesToday > 0 ? ridesToday : totalRidesCount;
                const safeRidesWeek = ridesWeek > 0 ? ridesWeek : totalRidesCount;
                const safeRidesMonth = ridesMonth > 0 ? ridesMonth : totalRidesCount;

                const ongoingRides = await rideModel.countDocuments({ status: { $in: ['ongoing', 'accepted', 'pending'] } });
                const onlineCaptains = await captainModel.countDocuments({ status: 'active' });
                const totalCaptainsCount = await captainModel.countDocuments();
                const safeOnlineCaptains = onlineCaptains > 0 ? onlineCaptains : totalCaptainsCount;

                const totalUsers = await userModel.countDocuments();

                const revenueResult = await rideModel.aggregate([
                    { $match: { paymentStatus: { $ne: 'refunded' } } },
                    { $group: { _id: null, totalFare: { $sum: '$fare' } } }
                ]);
                const totalRevenue = revenueResult[0]?.totalFare || 0;
                const platformCommission = totalRevenue * 0.20;
                const driverPayouts = totalRevenue * 0.80;

                // Financeiro: Total recebido hoje
                const todayRevenueResult = await rideModel.aggregate([
                    { $match: { createdAt: { $gte: startOfToday }, paymentStatus: { $ne: 'refunded' } } },
                    { $group: { _id: null, totalFare: { $sum: '$fare' } } }
                ]);
                const todayRevenue = todayRevenueResult[0]?.totalFare || 0;

                // Financeiro: Comissões arrecadadas
                const commissionResult = await transactionModel.aggregate([
                    { $match: { type: 'commission' } },
                    { $group: { _id: null, total: { $sum: '$amount' } } }
                ]);
                const totalCommission = commissionResult[0]?.total || 0;

                // Financeiro: Créditos vendidos (Recharges)
                const rechargeResult = await transactionModel.aggregate([
                    { $match: { type: 'recharge' } },
                    { $group: { _id: null, total: { $sum: '$amount' } } }
                ]);
                const totalCreditsSold = rechargeResult[0]?.total || 0;

                // Financeiro: Pendente de repasse e já repassado
                const payoutPendingResult = await payoutModel.aggregate([
                    { $match: { status: 'processing' } },
                    { $group: { _id: null, total: { $sum: '$amount' } } }
                ]);
                const totalPayoutPending = payoutPendingResult[0]?.total || 0;

                const payoutPaidResult = await payoutModel.aggregate([
                    { $match: { status: 'paid' } },
                    { $group: { _id: null, total: { $sum: '$amount' } } }
                ]);
                const totalPayoutPaid = payoutPaidResult[0]?.total || 0;

                // Payment Methods Count
                const cardCount = await rideModel.countDocuments({ paymentMethod: 'card' });
                const cashCount = await rideModel.countDocuments({ paymentMethod: 'cash' });
                const pixCount = await rideModel.countDocuments({ paymentMethod: 'pix' });

                const carsCount = await captainModel.countDocuments({ 'vehicle.vehicleType': 'car' });
                const motosCount = await captainModel.countDocuments({ 'vehicle.vehicleType': { $in: ['moto', 'motorcycle'] } });
                const autosCount = await captainModel.countDocuments({ 'vehicle.vehicleType': 'auto' });

                // Active Captains GPS Locations
                const activeCaptainsDocs = await captainModel.find({ status: 'active' }).select('fullname email phone vehicle location status');
                const activeCaptainsList = activeCaptainsDocs.map(c => ({
                    id: c._id,
                    name: `${c.fullname?.firstname || ''} ${c.fullname?.lastname || ''}`.trim(),
                    email: c.email,
                    phone: c.phone,
                    vehicleType: c.vehicle?.vehicleType || 'car',
                    plate: c.vehicle?.plate || '',
                    ltd: c.location?.ltd || -23.55052,
                    lng: c.location?.lng || -46.633308
                }));

                // Ongoing Rides Details
                const activeRidesDocs = await rideModel.find({ status: { $in: ['ongoing', 'accepted', 'pending'] } }).populate('user captain');
                const activeRidesList = activeRidesDocs.map(r => ({
                    id: r._id,
                    pickup: r.pickup,
                    destination: r.destination,
                    fare: r.fare,
                    vehicleType: r.vehicleType,
                    status: r.status,
                    user: r.user?.fullname?.firstname || 'Passageiro',
                    captain: r.captain?.fullname?.firstname || 'Motorista'
                }));

                const dashboardStats = {
                    ridesToday: safeRidesToday,
                    ridesWeek: safeRidesWeek,
                    ridesMonth: safeRidesMonth,
                    ongoingRides,
                    onlineCaptains: safeOnlineCaptains,
                    totalUsers,
                    totalRevenue,
                    todayRevenue,
                    totalCommission,
                    totalCreditsSold,
                    totalPayoutPending,
                    totalPayoutPaid,
                    platformCommission,
                    driverPayouts,
                    activeCaptainsList,
                    activeRidesList,
                    paymentsSummary: {
                        completed: completedPayments,
                        pending: pendingPayments,
                        refunded: refundedPayments
                    },
                    paymentMethods: {
                        card: cardCount,
                        cash: cashCount,
                        pix: pixCount
                    },
                    vehicleBreakdown: {
                        car: carsCount,
                        moto: motosCount,
                        auto: autosCount
                    }
                };
                
                setCache(cacheKey, dashboardStats, 300); // 5 minutes
                return dashboardStats;
            } catch (err) {
                console.error('Error fetching dashboard stats:', err);
                return {
                    ridesToday: 0,
                    ridesWeek: 0,
                    ridesMonth: 0,
                    ongoingRides: 0,
                    onlineCaptains: 0,
                    totalUsers: 0,
                    totalRevenue: 0,
                    platformCommission: 0,
                    driverPayouts: 0,
                    paymentsSummary: { completed: 0, pending: 0, refunded: 0 },
                    paymentMethods: { card: 0, cash: 0, upi: 0 },
                    vehicleBreakdown: { car: 0, moto: 0, auto: 0 }
                };
            }
        },
        component: AdminJS.bundle('./components/Dashboard.jsx')
    },
    pages: {
        'Relatórios': {
            component: AdminJS.bundle('./components/Reports.jsx'),
            icon: 'BarChart2',
        }
    },
    rootPath: '/admin',
    branding: {
        companyName: 'MoveCity Premium',
        logo: false,
        withMadeWithLove: false,
        theme: {
            colors: {
                bg: '#09090b',
                border: '#27272a',
                container: '#18181b',
                text: '#fafafa',
                defaultText: '#fafafa',
                navOpenText: '#fafafa',
                primary100: '#22c55e', // Green 500
                primary80: '#16a34a',
                primary60: '#15803d',
                primary40: '#166534',
                primary20: '#14532d',
                accent: '#22c55e',
                hoverBg: '#27272a',
                white: '#18181b',
                grey100: '#fafafa',
                grey80: '#a1a1aa',
                grey60: '#71717a',
                grey40: '#52525b',
                grey20: '#3f3f46',
                errorLight: '#450a0a',
                error: '#ef4444',
                successLight: '#052e16',
                success: '#22c55e',
                infoLight: '#1e3a8a',
                info: '#3b82f6',
                warningLight: '#451a03',
                warning: '#f59e0b',
            },
            font: "'Inter', system-ui, sans-serif",
            shadows: {
                login: '0 25px 50px -12px rgba(0, 0, 0, 0.75)',
                cardHover: '0 10px 15px -3px rgba(0, 0, 0, 0.5)',
                drawer: '-2px 0 8px rgba(0, 0, 0, 0.5)',
            },
            borders: {
                default: '1px solid #27272a',
            }
        }
    },
    locale: {
        language: 'pt-BR',
        translations: {
            labels: {
                loginWelcome: 'Painel do Administrador',
                Dashboard: 'Painel Geral'
            },
            buttons: {
                login: 'Entrar',
                filter: 'Filtrar',
                applyChanges: 'Aplicar',
                resetFilter: 'Limpar',
                logout: 'Sair',
                createFirstRecord: 'Criar Registro',
                list: 'Lista',
                edit: 'Editar',
                show: 'Ver',
                delete: 'Excluir',
                new: 'Criar',
                save: 'Salvar'
            },
            actions: {
                new: 'Criar',
                edit: 'Editar',
                show: 'Detalhes',
                delete: 'Excluir',
                list: 'Lista'
            },
            messages: {
                successfullyDeleted: 'Excluído com sucesso',
                successfullyUpdated: 'Atualizado com sucesso',
                successfullyCreated: 'Criado com sucesso'
            }
        }
    }
};

const admin = new AdminJS(adminOptions);

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@uber.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123456';

const adminRouter = AdminJSExpress.buildAuthenticatedRouter(
    admin,
    {
        authenticate: async (email, password) => {
            if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
                return { email: ADMIN_EMAIL, role: 'admin' };
            }
            return false;
        },
        cookiePassword: process.env.ADMIN_COOKIE_PASSWORD || 'super-secret-cookie-password-uber-admin-123456',
    },
    null,
    {
        resave: false,
        saveUninitialized: true,
        secret: process.env.SESSION_SECRET || 'super-secret-session-key-123456',
        cookie: {
            httpOnly: true,
            secure: false
        }
    }
);

adminRouter.get('/api/reports', async (req, res) => {
    try {
        const peakHours = await rideModel.aggregate([
            { $group: { _id: { $hour: "$createdAt" }, count: { $sum: 1 } } },
            { $sort: { _id: 1 } }
        ]);

        const ridesByLocation = await rideModel.aggregate([
            { $group: { _id: "$pickup", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 10 }
        ]);

        const revenueByPeriod = await rideModel.aggregate([
            {
                $group: {
                    _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
                    totalFare: { $sum: "$fare" },
                    count: { $sum: 1 }
                }
            },
            { $sort: { _id: -1 } },
            { $limit: 7 }
        ]);

        const topCaptains = await rideModel.aggregate([
            { $group: { _id: "$captain", count: { $sum: 1 }, totalGenerated: { $sum: "$fare" } } },
            { $sort: { count: -1 } },
            { $limit: 5 },
            { $lookup: { from: "captains", localField: "_id", foreignField: "_id", as: "captainData" } },
            { $unwind: "$captainData" }
        ]);

        const topUsers = await rideModel.aggregate([
            { $group: { _id: "$user", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 5 },
            { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "userData" } },
            { $unwind: "$userData" }
        ]);

        res.json({
            peakHours,
            ridesByLocation,
            revenueByPeriod,
            topCaptains,
            topUsers
        });
    } catch (error) {
        console.error("Error generating reports:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

module.exports = { admin, adminRouter };
