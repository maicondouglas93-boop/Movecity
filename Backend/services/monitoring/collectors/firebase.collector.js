const admin = require('firebase-admin');
const User = require('../../../models/user.model');
const Captain = require('../../../models/captain.model');
const Notification = require('../../../models/notification.model');
const Campaign = require('../../../models/notificationCampaign.model');
const { withAudit } = require('../audit');
const { monthBounds } = require('../constants');
const { upsertAlert, resolveAlert } = require('../alerts');

async function collectFirebase() {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const month = monthBounds();
    const monthStart = new Date(`${month.from}T00:00:00.000Z`);

    const configured = Boolean(admin.apps?.length);
    let authUsers = null;
    let authSource = 'internal';

    if (configured) {
        const listed = await withAudit('firebase', 'auth.listUsers', async () => {
            let count = 0;
            let pageToken;
            let pages = 0;
            do {
                const res = await admin.auth().listUsers(1000, pageToken);
                count += res.users.length;
                pageToken = res.pageToken;
                pages += 1;
            } while (pageToken && pages < 20);
            return { count, truncated: Boolean(pageToken) };
        }, { retries: 1 });

        if (listed.ok) {
            authUsers = listed.data.count;
            authSource = listed.data.truncated ? 'official_partial' : 'official';
        }
    }

    const [usersDb, captainsDb] = await Promise.all([
        User.countDocuments({}),
        Captain.countDocuments({}),
    ]);
    if (authUsers == null) {
        authUsers = usersDb + captainsDb;
        authSource = 'internal';
    }

    const [userLogins, captainLogins] = await Promise.all([
        User.countDocuments({ lastLoginAt: { $gte: todayStart } }).catch(() => 0),
        Captain.countDocuments({ lastLoginAt: { $gte: todayStart } }).catch(() => 0),
    ]);
    const loginsToday = userLogins + captainLogins;

    const [notificationsSent, notificationsFailed, notificationsToday] = await Promise.all([
        Notification.countDocuments({ status: 'sent', createdAt: { $gte: monthStart } }).catch(() => 0),
        Notification.countDocuments({ status: 'failed', createdAt: { $gte: monthStart } }).catch(() => 0),
        Notification.countDocuments({ status: 'sent', createdAt: { $gte: todayStart } }).catch(() => 0),
    ]);

    let campaignDelivered = 0;
    let campaignFailed = 0;
    try {
        const camps = await Campaign.aggregate([
            { $match: { updatedAt: { $gte: monthStart } } },
            {
                $group: {
                    _id: null,
                    delivered: { $sum: '$metrics.delivered' },
                    failed: { $sum: '$metrics.failed' },
                    sent: { $sum: '$metrics.sent' },
                },
            },
        ]);
        campaignDelivered = camps[0]?.delivered || 0;
        campaignFailed = camps[0]?.failed || 0;
    } catch (_) { /* ignore */ }

    const fcmSent = notificationsSent + campaignDelivered;
    const fcmFailed = notificationsFailed + campaignFailed;
    const fcmTotal = fcmSent + fcmFailed;
    const successRate = fcmTotal > 0 ? Math.round((fcmSent / fcmTotal) * 1000) / 10 : 100;

    const failPercent = 100 - successRate;
    let status = 'healthy';
    if (!configured) status = 'unavailable';
    else if (failPercent >= 25) status = 'critical';
    else if (failPercent >= 10) status = 'attention';

    if (fcmFailed > 0 && failPercent >= 10) {
        await upsertAlert({
            service: 'firebase',
            code: 'fcm_failing',
            severity: failPercent >= 25 ? 'critical' : 'warning',
            title: 'Notificações falhando',
            message: `Taxa de sucesso FCM em ${successRate}% este mês (${fcmFailed} falhas).`,
            value: successRate,
        });
    } else {
        await resolveAlert('firebase', 'fcm_failing');
    }

    return {
        service: 'firebase',
        status,
        plan: configured ? (process.env.FIREBASE_PLAN || 'Spark/Blaze') : 'Não configurado',
        usagePercent: failPercent > 0 ? failPercent : null,
        source: configured ? 'hybrid' : 'internal',
        summary: {
            authUsers,
            projectId: process.env.FIREBASE_PROJECT_ID || null,
            fcmSuccessRate: successRate,
            notificationsMonth: fcmSent,
        },
        details: {
            authentication: {
                registeredUsers: authUsers,
                source: authSource,
                usersInDb: usersDb,
                captainsInDb: captainsDb,
                loginsToday,
                loginsMonth: null,
                loginFailures: null,
                note: 'Logins/falhas detalhados exigem Identity Platform / Cloud Logging.',
            },
            cloudMessaging: {
                sent: fcmSent,
                delivered: campaignDelivered || fcmSent,
                failed: fcmFailed,
                successRate,
                sentToday: notificationsToday,
            },
            storage: {
                used: false,
                note: 'Upload migrou para ImageKit; Firebase Storage não é usado.',
            },
            firestore: {
                used: false,
                note: 'Firestore/Realtime Database não estão em uso neste projeto.',
            },
        },
    };
}

module.exports = { collectFirebase };
