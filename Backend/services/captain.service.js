const captainModel = require('../models/captain.model');
const { getCache, setCache, deleteCache } = require('../cache/cache');
const mongoose = require('mongoose');

// Separação disponibilidade x conexão (2026-08-03) — ver
// docs/plans/2026-08-03-disponibilidade-vs-conexao-motorista.md.
//
// Quanto tempo depois do último contato real o motorista ainda é considerado
// disponível. Sem esse limite, alguém que ficou online e fechou o app há dias
// continuaria recebendo ofertas, e o passageiro esperaria por quem não vai responder.
// Mais alto = mais alcance via push; mais baixo = menos oferta para quem sumiu.
const AVAILABILITY_TTL_MINUTES = Number(process.env.CAPTAIN_AVAILABILITY_TTL_MINUTES) || 15;

module.exports.AVAILABILITY_TTL_MINUTES = AVAILABILITY_TTL_MINUTES;

// Definição ÚNICA de "disponível para receber corrida", usada tanto pelo despacho
// (maps.service.js) quanto pelas contagens do painel administrativo — para as duas
// nunca divergirem, que é como o painel acabaria mostrando uma frota online que o
// despacho não enxerga.
//
// Note que `socketId` NÃO entra aqui: era justamente essa exigência que tirava do
// despacho o motorista com o app fechado, tornando a push de corrida nova inalcançável.
module.exports.availabilityFilter = () => ({
    isOnline: true,
    lastSeenAt: { $gte: new Date(Date.now() - AVAILABILITY_TTL_MINUTES * 60 * 1000) },
    canReceiveRides: { $ne: false },
    isBlocked: { $ne: true },
    approvalStatus: 'aprovado'
});

// Heartbeat: registra que o servidor teve contato real com este motorista agora.
// Chamado do socket (join e atualização de localização) e do toggle-online.
module.exports.touchLastSeen = async (captainId) => {
    if (!captainId) return;
    await captainModel.findByIdAndUpdate(captainId, { lastSeenAt: new Date() });
};

// Simplificação do cadastro (2026-08-04): cadastro inicial só precisa de conta +
// veículo — cpf/phone/cnh/pix saíram (ver PATCH /captains/document-info) e não são
// mais exigidos aqui.
const DOCUMENT_DEADLINE_DAYS = 5;

module.exports.DOCUMENT_DEADLINE_DAYS = DOCUMENT_DEADLINE_DAYS;

module.exports.createCaptain = async ({
    firstname, lastname, email, password,
    color, plate, capacity, vehicleType, marca, modelo, ano,
}) => {
    if (!firstname || !email || !password || !color || !plate || !capacity || !vehicleType) {
        throw new Error('Required fields are missing');
    }

    // Prazo de documentação: SEMPRE calculado aqui (backend), nunca no frontend — é a
    // única fonte de verdade sobre quando o motorista precisa terminar de enviar os
    // documentos. `now` também alimenta implicitamente createdAt (timestamps:true),
    // então os dois nascem do mesmo instante.
    const now = new Date();
    const documentDeadline = new Date(now.getTime() + DOCUMENT_DEADLINE_DAYS * 24 * 60 * 60 * 1000);

    const captain = await captainModel.create({
        fullname: {
            firstname,
            lastname
        },
        email,
        password,
        documentDeadline,
        vehicle: {
            marca,
            modelo,
            ano,
            color,
            plate,
            capacity,
            vehicleType
        }
    })

    return captain;
}

/**
 * @param {string|object} id
 * @param {{ skipCache?: boolean }} [opts] — skipCache: lê sempre do Mongo (perfil / "Verificar novamente").
 *
 * Cache é por processo (NodeCache). Admin em outra instância (ex.: Render) invalida
 * só o cache dela; o Backend local do APK podia servir approvalStatus velho por 10 min.
 * Em HIT, revalidamos flags de autorização no banco (query leve).
 */
module.exports.getCaptainProfile = async (id, { skipCache = false } = {}) => {
    const cacheKey = `profile:captain:${id}`;

    if (skipCache) {
        deleteCache(cacheKey);
    } else {
        const cachedCaptain = getCache(cacheKey);
        if (cachedCaptain) {
            const flags = await captainModel.findById(id)
                .select('approvalStatus isBlocked canReceiveRides')
                .lean();
            if (!flags) return null;
            if (typeof cachedCaptain.set === 'function') {
                cachedCaptain.set('approvalStatus', flags.approvalStatus);
                cachedCaptain.set('isBlocked', flags.isBlocked);
                if (Object.prototype.hasOwnProperty.call(flags, 'canReceiveRides')) {
                    cachedCaptain.set('canReceiveRides', flags.canReceiveRides);
                }
                return cachedCaptain;
            }
            return Object.assign(
                typeof cachedCaptain.toObject === 'function' ? cachedCaptain.toObject() : { ...cachedCaptain },
                flags
            );
        }
    }

    const captain = await captainModel.findById(id);
    if (captain) {
        setCache(cacheKey, captain, 600); // 10 minutos
    }

    return captain;
}

// Recalcula captain.rating a partir da média real das avaliações recebidas (reviews
// passenger_to_driver). Se ainda não tem nenhuma avaliação, mantém o valor atual
// (o default do schema, 5.0) em vez de forçar 0 — "sem avaliações" não é o mesmo que
// "nota zero".
module.exports.recalculateRating = async (captainId) => {
    const reviewModel = require('../models/review.model');
    const [stats] = await reviewModel.aggregate([
        { $match: { captain: new mongoose.Types.ObjectId(captainId), type: 'passenger_to_driver' } },
        { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } }
    ]);

    if (stats && stats.count > 0) {
        const rating = Math.round(stats.avg * 10) / 10;
        await captainModel.findByIdAndUpdate(captainId, { rating });
        return rating;
    }
    return null;
};

// Recalcula cancellationRate/cancelledRides a partir de TODAS as corridas já
// atribuídas a este motorista (não incremental — evita drift se algum caminho de
// cancelamento for esquecido). Chamado sempre que uma corrida com captain definido
// vira 'cancelled'.
module.exports.recalculateCancellationStats = async (captainId) => {
    if (!captainId) return;
    const rideModel = require('../models/ride.model');
    const [stats] = await rideModel.aggregate([
        { $match: { captain: new mongoose.Types.ObjectId(captainId) } },
        { $group: {
            _id: null,
            total: { $sum: 1 },
            cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } }
        }}
    ]);

    const total = stats?.total || 0;
    const cancelled = stats?.cancelled || 0;
    const cancellationRate = total > 0 ? Math.round((cancelled / total) * 100) : 0;

    await captainModel.findByIdAndUpdate(captainId, { cancellationRate, cancelledRides: cancelled });
};

function startOfToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
}

// Auditoria de UX do motorista (2026-08-02, Etapa 8): a tela de Ganhos só mostrava
// captain.earnings — um total acumulado vitalício, sem nenhum recorte temporal nem
// detalhe por corrida. 'day' usa o mesmo corte de meia-noite já usado em getSummary;
// 'week'/'month' são janelas rolantes (últimos 7/30 dias), não limites de calendário —
// mais simples e mais útil pra um motorista conferir "quanto ganhei nos últimos X dias".
module.exports.getEarningsBreakdown = async (captainId, range = 'day') => {
    const rideModel = require('../models/ride.model');

    // Auditoria do app do motorista (2026-08-11, P1): 'all' alimenta o card "Ganhos
    // Totais" da tela de Ganhos com a MESMA metodologia (só corridas, líquido) dos
    // cards de período logo abaixo — antes esse card lia captain.earnings (bruto,
    // nunca subtrai comissão), que nunca batia com a soma exibida na mesma tela.
    let startDate = null;
    if (range === 'week') {
        startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    } else if (range === 'month') {
        startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    } else if (range !== 'all') {
        startDate = startOfToday();
    }

    const query = {
        captain: captainId,
        status: 'finished',
    };
    if (startDate) {
        query.updatedAt = { $gte: startDate };
    }

    const rides = await rideModel.find(query).sort({ updatedAt: -1 });

    let totalEarnings = 0;
    let totalCommission = 0;
    const breakdown = rides.map(ride => {
        const grossFare = ride.finalPrice || ride.fare || 0;
        const commission = ride.commissionAmount || 0;
        const netEarnings = grossFare - commission;
        totalEarnings += netEarnings;
        totalCommission += commission;
        return {
            rideId: ride._id,
            date: ride.updatedAt,
            pickup: ride.pickup,
            destination: ride.destination,
            grossFare,
            commission,
            netEarnings
        };
    });

    return {
        range,
        totalEarnings: Math.round(totalEarnings * 100) / 100,
        totalCommission: Math.round(totalCommission * 100) / 100,
        totalRides: rides.length,
        rides: breakdown
    };
};

// Início de uma sessão online real (chamado quando o motorista fica online, seja por
// toggle-online explícito ou por reconexão de socket).
module.exports.startOnlineSession = async (captainId) => {
    await captainModel.findByIdAndUpdate(captainId, { onlineSince: new Date() });
};

// Fim de uma sessão online real — soma o tempo decorrido no acumulado vitalício e no
// acumulado de hoje (zerando o de hoje se a sessão atravessou a virada do dia).
// Chamado tanto pelo toggle-online quanto pelo disconnect do socket (motorista que
// fecha o app sem avisar não deve continuar contando tempo online para sempre).
module.exports.endOnlineSession = async (captainId) => {
    const captain = await captainModel.findById(captainId);
    if (!captain || !captain.onlineSince) return;

    const elapsedSeconds = Math.max(0, Math.round((Date.now() - captain.onlineSince.getTime()) / 1000));
    const today = startOfToday();

    let todaySeconds = captain.todayOnlineDate && captain.todayOnlineDate.getTime() === today.getTime()
        ? (captain.todayOnlineSeconds || 0)
        : 0;
    todaySeconds += elapsedSeconds;

    await captainModel.findByIdAndUpdate(captainId, {
        onlineSince: null,
        onlineTimeSeconds: (captain.onlineTimeSeconds || 0) + elapsedSeconds,
        todayOnlineSeconds: todaySeconds,
        todayOnlineDate: today
    });
};

// Tempo online de hoje, incluindo a sessão em andamento se o motorista estiver online
// agora. Busca o documento direto do banco (sem cache) para não exibir um valor
// desatualizado logo após o motorista trocar de status.
module.exports.getTodayOnlineSeconds = async (captainId) => {
    const captain = await captainModel.findById(captainId);
    if (!captain) return 0;

    const today = startOfToday();
    let todaySeconds = captain.todayOnlineDate && captain.todayOnlineDate.getTime() === today.getTime()
        ? (captain.todayOnlineSeconds || 0)
        : 0;

    if (captain.isOnline && captain.onlineSince) {
        todaySeconds += Math.max(0, Math.round((Date.now() - captain.onlineSince.getTime()) / 1000));
    }

    return todaySeconds;
};