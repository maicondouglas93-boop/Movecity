const AdminJS = require('adminjs');
const AdminJSExpress = require('@adminjs/express');
const AdminJSMongoose = require('@adminjs/mongoose');

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
                listProperties: ['captainId', 'balance', 'blockedBalance', 'pendingBalance', 'updatedAt']
            }
        },
        {
            resource: transactionModel,
            options: {
                navigation: { name: 'Financeiro', icon: 'FileText' },
                listProperties: ['captainId', 'type', 'paymentMethod', 'amount', 'balanceAfter', 'status', 'createdAt'],
                filterProperties: ['type', 'paymentMethod', 'status', 'captainId']
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

                // Payment Statuses Count
                const completedPayments = await rideModel.countDocuments({ paymentStatus: 'completed' });
                const pendingPayments = await rideModel.countDocuments({ paymentStatus: 'pending' });
                const refundedPayments = await rideModel.countDocuments({ paymentStatus: 'refunded' });

                // Payment Methods Count
                const cardCount = await rideModel.countDocuments({ paymentMethod: 'card' });
                const cashCount = await rideModel.countDocuments({ paymentMethod: 'cash' });
                const upiCount = await rideModel.countDocuments({ paymentMethod: 'upi' });

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

                return {
                    ridesToday: safeRidesToday,
                    ridesWeek: safeRidesWeek,
                    ridesMonth: safeRidesMonth,
                    ongoingRides,
                    onlineCaptains: safeOnlineCaptains,
                    totalUsers,
                    totalRevenue,
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
                        upi: upiCount
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
        companyName: 'Uber Admin',
        logo: false,
        withMadeWithLove: false,
        theme: {
            colors: {
                primary100: '#000000', // Preto absoluto
                primary80: '#333333',
                primary60: '#666666',
                primary40: '#FFC043', // Amarelo Uber
                primary20: '#FFE5A3',
                accent: '#FFC043',
                hoverBg: '#FFC043',
                navOpenText: '#FFC043'
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
