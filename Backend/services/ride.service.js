const mongoose = require('mongoose');
const rideModel = require('../models/ride.model');
const userModel = require('../models/user.model');
const paymentModel = require('../models/payment.model');
const mapService = require('./maps.service');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { getCache, setCache } = require('../cache/cache');

const PricingEngine = require('./pricingEngine.service');

// Máquina de estados da corrida (P2.1 da auditoria de concorrência, 2026-08-02) — toda
// transição de status passa por `transitionRide`, que faz um único `findOneAndUpdate`
// atômico com o(s) status de origem permitido(s) no próprio filtro. Antes, cada função
// (startRide, cancelRide, endRide, updateRideStatus...) validava o status em memória
// (`if (!['accepted', ...].includes(ride.status))`) e só DEPOIS gravava — entre a leitura
// e a escrita havia uma janela real de corrida (aceitar × cancelar, iniciar × cancelar
// simultâneos podiam produzir estados impossíveis, ver C3/C4 na auditoria). `finished` e
// `cancelled` são terminais: nenhuma chave abaixo os lista como origem de nada.
const VALID_ORIGINS_BY_TARGET = {
    accepted: ['requested'],
    going_to_pickup: ['accepted'],
    arrived: ['going_to_pickup', 'accepted'],
    started: ['accepted', 'going_to_pickup', 'arrived', 'waiting_passenger'],
    finished: ['started'],
    cancelled: ['requested', 'accepted', 'going_to_pickup', 'arrived', 'waiting_passenger'],
    // Única reversão da máquina (todo o resto é progressão linear ou término): motorista
    // desiste de uma corrida já aceita, mas antes de iniciar (auditoria de UX, 2026-08-02).
    // Não é um avanço nem um estado terminal — devolve a corrida ao pool de despacho pra
    // outro motorista aceitar, em vez de forçar o passageiro a pedir tudo de novo.
    requested: ['accepted', 'going_to_pickup', 'arrived', 'waiting_passenger'],
};

// `extraFilter` permite exigir dono (captain/user) e outras condições (ex.: OTP) no
// mesmo `findOneAndUpdate` atômico — não só o status. `extraUnset` cobre o caso do
// motorista desistindo (acima): `captain` e `otp` precisam sair do documento, não só
// mudar de valor. Retorna `null` quando a transição não é válida a partir do estado
// atual (ou quando `extraFilter` não bate), e quem chama decide a mensagem/status HTTP.
async function transitionRide(rideId, toStatus, extraFilter = {}, extraSet = {}, extraUnset = {}) {
    const validOrigins = VALID_ORIGINS_BY_TARGET[toStatus];
    if (!validOrigins) {
        throw new Error(`Transição de status desconhecida: ${toStatus}`);
    }
    const update = { $set: { status: toStatus, ...extraSet } };
    if (Object.keys(extraUnset).length > 0) {
        update.$unset = extraUnset;
    }
    return rideModel.findOneAndUpdate(
        { _id: rideId, status: { $in: validOrigins }, ...extraFilter },
        update,
        { new: true }
    );
}

async function getFare(pickup, destination) {
    if (!pickup || !destination) {
        throw new Error('Pickup and destination are required');
    }

    const cacheKey = `fare:${pickup}:${destination}`;
    const cached = getCache(cacheKey);
    if (cached) return cached;

    const distanceTime = await mapService.getDistanceTime(pickup, destination);
    const distance = distanceTime.distance.value;
    const time = distanceTime.duration.value;

    const VehicleCategory = require('../models/vehicleCategory.model');
    const categories = await VehicleCategory.find({ isActive: true });

    if (categories.length === 0) {
        throw new Error("Nenhuma categoria de veículo ativa configurada.");
    }

    const fare = {};
    const fareCard = {};
    const fareBreakdownData = {};

    for (const cat of categories) {
        // Simulação Dinheiro
        const cashCalc = await PricingEngine.calculateFare({
            distance,
            time,
            vehicleType: cat.name,
            paymentMethod: 'cash'
        });
        fare[cat.name] = cashCalc.finalFare;
        
        // Salva breakdown do dinheiro para referência
        fareBreakdownData[cat.name] = cashCalc.fareBreakdown;

        // Simulação Cartão
        const cardCalc = await PricingEngine.calculateFare({
            distance,
            time,
            vehicleType: cat.name,
            paymentMethod: 'card'
        });
        fareCard[cat.name] = cardCalc.finalFare;
    }

    const result = {
        fare,
        fareMax: fare, // Mocking max until dynamic range is implemented
        fareCard,
        fareCardMax: fareCard, // Mocking max
        distance,
        time,
        polyline: distanceTime.polyline,
        breakdown: fareBreakdownData,
        eta: {
            car: Math.floor(Math.random() * 5) + 2, // 2 to 6 mins
            moto: Math.floor(Math.random() * 3) + 1, // 1 to 3 mins
            auto: Math.floor(Math.random() * 4) + 2  // 2 to 5 mins
        }
    };

    setCache(cacheKey, result, 1800);
    return result;
}

module.exports.getFare = getFare;

function getOtp(num) {
    function generateOtp(num) {
        return crypto.randomInt(Math.pow(10, num - 1), Math.pow(10, num)).toString();
    }
    return generateOtp(num);
}

module.exports.createRide = async ({
    user, pickup, destination, vehicleType, paymentMethod = 'cash', optionals = [], observation = '', useWalletBalance = false, requestFemaleDriver = false
}) => {
    if (!user || !pickup || !destination || !vehicleType) {
        throw new Error('All fields are required');
    }

    // Calcular rota e tempo real
    const distanceTime = await mapService.getDistanceTime(pickup, destination);
    const distance = distanceTime.distance.value;
    const time = distanceTime.duration.value;

    // Congela a configuração de tarifa/comissão vigente agora (P2.2 da auditoria de
    // concorrência, 2026-08-02) — guardada na corrida e reutilizada em endRide, pra uma
    // mudança de tarifa feita pelo admin durante a corrida não alterar o valor que o
    // passageiro já viu e aceitou na confirmação.
    const pricingSnapshot = await PricingEngine.buildConfigSnapshot({ vehicleType });

    // Usar o Pricing Engine Oficial
    const pricing = await PricingEngine.calculateFare({
        distance,
        time,
        vehicleType,
        paymentMethod: paymentMethod === 'carteira' ? 'pix' : paymentMethod, // Use a fallback method for calculation if carteira
        configSnapshot: pricingSnapshot
    });

    // Calcular opcionais
    const optionalPrices = {
        'porta_malas': 0,
        'aceita_animais': 3,
        'aceita_encomendas': 5,
        'adaptado_cadeirante': 0,
        'disposicao_passageiro': 15
    };
    
    let optionalsTotal = 0;
    const processedOptionals = [];
    if (Array.isArray(optionals)) {
        optionals.forEach(opt => {
            const type = typeof opt === 'string' ? opt : opt.type;
            const price = optionalPrices[type] || 0;
            optionalsTotal += price;
            processedOptionals.push({ type, price });
        });
    }

    let finalPrice = pricing.finalFare + optionalsTotal;
    let walletAmountUsed = 0;

    if (useWalletBalance) {
        const userData = await userModel.findById(user);
        if (userData && userData.walletBalance > 0) {
            if (userData.walletBalance >= finalPrice) {
                walletAmountUsed = finalPrice;
                paymentMethod = 'carteira'; // Fully paid with wallet
            } else {
                walletAmountUsed = userData.walletBalance;
            }
            userData.walletBalance -= walletAmountUsed;
            await userData.save();
        }
    }

    // Amount to be paid via normal method
    const paymentAmount = finalPrice - walletAmountUsed;

    const ride = await rideModel.create({
        user,
        pickup,
        destination,
        otp: getOtp(6),
        fare: pricing.finalFare,
        finalPrice: finalPrice,
        walletAmountUsed,
        paymentMethod,
        optionals: processedOptionals,
        observation,
        requestFemaleDriver,
        vehicleType,
        status: 'requested',
        estimatedDistance: distance,
        estimatedTime: time,
        estimatedPriceMin: pricing.finalFare,
        estimatedPriceMax: pricing.finalFare,
        commissionPercent: pricing.fareBreakdown.platformCommission > 0 
            ? Math.round((pricing.fareBreakdown.platformCommission / pricing.finalFare) * 100) : 0,
        commissionAmount: pricing.commissionAmount,
        fareBreakdown: pricing.fareBreakdown,
        pricingSnapshot,
        distance,
        duration: time
    });

    if (paymentAmount > 0 || walletAmountUsed > 0) {
        await paymentModel.create({
            rideId: ride._id,
            userId: user,
            amount: finalPrice,
            method: paymentMethod,
            status: paymentMethod === 'carteira' ? 'approved' : 'pending'
        });
    }

    return ride;
}

// Único caminho de aceite de corrida no sistema (P1.3 da auditoria de concorrência,
// 2026-08-01) — usado tanto por POST /rides/:id/accept quanto por POST /rides/confirm
// (mantida como alias de compatibilidade no controller). Antes existiam dois caminhos:
// este, atômico, e um segundo em ride.service.js (`confirmRide`, removido) que fazia
// `findOneAndUpdate({_id})` sem checar status — dois motoristas aceitando a mesma
// corrida recebiam 200 os dois, e o segundo aceite conseguia rebaixar até uma corrida
// já `finished`/`cancelled` de volta pra `accepted`. O filtro `status:'requested'`
// abaixo é a garantia real: só um `findOneAndUpdate` ganha a corrida.
module.exports.acceptRideAtomic = async ({
    rideId, captain
}) => {
    if (!rideId) {
        throw new Error('Ride id is required');
    }

    let updatedRide;
    try {
        updatedRide = await transitionRide(rideId, 'accepted', {}, { captain: captain._id });
    } catch (err) {
        // Índice único parcial em ride.model.js (C2 da auditoria de concorrência): este
        // motorista já tem outra corrida ativa. Erro de chave duplicada do Mongo, não uma
        // falha de servidor — traduzido pra uma mensagem que o app sabe mostrar.
        if (err.code === 11000) {
            throw new Error('CAPTAIN_ALREADY_HAS_ACTIVE_RIDE');
        }
        throw err;
    }

    if (!updatedRide) {
        // Find out if it doesn't exist or was already accepted
        const existingRide = await rideModel.findById(rideId);
        if (!existingRide) {
            throw new Error('RIDE_NOT_FOUND');
        }
        throw new Error('RIDE_ALREADY_ACCEPTED');
    }

    const ride = await rideModel.findOne({
        _id: rideId
    }).populate('user').populate('captain').select('+otp');

    return ride;
}

module.exports.startRide = async ({ rideId, otp, captain }) => {
    if (!rideId || !otp) {
        throw new Error('Ride id and OTP are required');
    }

    // Pré-checagem só pra mensagens de erro precisas (OTP errado vs. corrida em estado
    // errado) — a garantia real de concorrência é o findOneAndUpdate atômico abaixo.
    const ride = await rideModel.findOne({
        _id: rideId
    }).populate('user').populate('captain').select('+otp');

    if (!ride) {
        throw new Error('Ride not found');
    }

    if (!VALID_ORIGINS_BY_TARGET.started.includes(ride.status)) {
        throw new Error('Ride not accepted');
    }

    if (ride.otp !== otp) {
        throw new Error('Invalid OTP');
    }

    // Taxa de espera: se o motorista já tinha marcado "cheguei" (arrivedAt) e o
    // passageiro demorou além do tempo grátis configurado, soma a taxa por minuto
    // excedente — acertada com o motorista junto do resto da corrida, igual a taxa
    // normal (o app não processa pagamento, só calcula e informa).
    let waitTimeFeeCharged = 0;
    if (ride.arrivedAt) {
        const TariffSetting = require('../models/tariffSetting.model');
        const tariffSetting = await TariffSetting.findOne();
        const maxFreeWaitTime = tariffSetting?.maxFreeWaitTime || 0;
        const perMinuteWaitFee = tariffSetting?.perMinuteWaitFee || 0;
        const waitSeconds = Math.max(0, (Date.now() - ride.arrivedAt.getTime()) / 1000);
        if (waitSeconds > maxFreeWaitTime && perMinuteWaitFee > 0) {
            waitTimeFeeCharged = Math.round(((waitSeconds - maxFreeWaitTime) / 60) * perMinuteWaitFee * 100) / 100;
        }
    }

    // Guarda atômica de verdade: status de origem E otp certo no mesmo filtro. Se outro
    // request (cancelamento, ou outra tentativa de start) mudou o status entre a leitura
    // acima e aqui, isto retorna null em vez de gravar por cima de um estado inválido.
    const updatedRide = await transitionRide(rideId, 'started', { otp }, { waitTimeFeeCharged });
    if (!updatedRide) {
        throw new Error('Ride not accepted');
    }

    return rideModel.findOne({ _id: rideId }).populate('user').populate('captain').select('+otp');
}

// Só cobre as transições de deslocamento do motorista até o embarque (a caminho /
// cheguei). 'started'/'finished'/'cancelled' têm funções dedicadas (startRide/endRide/
// cancelRide) com validação de OTP, cálculo de tarifa e efeitos de carteira que este
// endpoint genérico não faz — permitir esses destinos aqui seria uma forma de
// contorná-los (P2.1 da auditoria de concorrência: nenhum endpoint deve conseguir
// aplicar uma transição de status sem passar pela lógica que ela exige).
const UPDATE_STATUS_ALLOWED_TARGETS = ['going_to_pickup', 'arrived', 'waiting_passenger'];

module.exports.updateRideStatus = async ({ rideId, captain, status }) => {
    if (!rideId || !status) {
        throw new Error('Ride id and status are required');
    }

    if (!UPDATE_STATUS_ALLOWED_TARGETS.includes(status)) {
        throw new Error('Invalid status');
    }

    const extraSet = {};
    if (status === 'arrived') {
        extraSet.arrivedAt = new Date();
    }

    const ride = await transitionRide(rideId, status, { captain: captain._id }, extraSet);

    if (!ride) {
        throw new Error('Ride not found or invalid transition');
    }

    return rideModel.findOne({ _id: rideId }).populate('user').populate('captain').select('+otp');
}

module.exports.endRide = async ({ rideId, captain }) => {
    if (!rideId) {
        throw new Error('Ride id is required');
    }

    const ride = await rideModel.findOne({
        _id: rideId,
        captain: captain._id
    }).populate('user').populate('captain').select('+otp');

    if (!ride) {
        throw new Error('Ride not found');
    }

    // 'ongoing' nunca existiu no enum de status (Backend/models/ride.model.js) — checagem
    // morta removida, `started` é a única origem real de `finished`.
    if (!VALID_ORIGINS_BY_TARGET.finished.includes(ride.status)) {
        throw new Error('Ride not started');
    }

    const actualDistance = ride.actualDistance || 0;
    // Calculate elapsed time in seconds
    let actualTimeSeconds = Math.round((Date.now() - new Date(ride.createdAt).getTime()) / 1000);
    if (actualTimeSeconds < 60) actualTimeSeconds = ride.estimatedTime; // Sanity check

    let finalPrice = ride.fare;
    if (actualDistance > 0) {
        try {
            const pricing = await PricingEngine.calculateFare({
                distance: actualDistance,
                time: actualTimeSeconds,
                vehicleType: ride.vehicleType,
                paymentMethod: ride.paymentMethod,
                // Recalcula com a tarifa/comissão CONGELADAS no momento em que a corrida foi
                // pedida (P2.2 da auditoria de concorrência) — só distância/tempo variam pro
                // valor real. Sem isso, uma mudança de tarifa feita pelo admin enquanto a
                // corrida estava em andamento mudava o preço cobrado no final.
                // `|| null` cobre corridas criadas antes desta mudança (sem snapshot
                // guardado) — cai de volta pro comportamento antigo (config vigente).
                configSnapshot: ride.pricingSnapshot || null
            });
            finalPrice = pricing.finalFare;

            // Atualizar o breakdown real se a distância foi maior
            await rideModel.findByIdAndUpdate(rideId, {
                fareBreakdown: pricing.fareBreakdown,
                commissionAmount: pricing.commissionAmount
            });
        } catch (e) {
            console.error("Erro recalculando tarifa no final da corrida:", e);
        }
    }

    // Taxa de espera calculada no startRide (motorista esperou além do tempo grátis) —
    // soma ao valor final, acertado direto com o motorista igual ao resto da tarifa.
    finalPrice += ride.waitTimeFeeCharged || 0;

    const updated = await transitionRide(rideId, 'finished', { captain: captain._id }, {
        actualTime: actualTimeSeconds,
        finalPrice: finalPrice,
        paymentStatus: 'pending' // Awaiting driver to confirm cash received
    });
    if (!updated) {
        throw new Error('Ride not started');
    }

    const updatedRide = await rideModel.findById(rideId).populate('user').populate('captain');
    return updatedRide;
}

// Idempotente e transacional (P1.1 da auditoria de concorrência, 2026-08-01): duas
// chamadas concorrentes (duplo clique, retry de rede) não podem creditar o motorista
// duas vezes. A marcação paymentStatus:'paid' é o "claim" da operação — só quem
// consegue gravá-la de fato move dinheiro. Tudo roda dentro de uma transação Mongo;
// se qualquer passo falhar, nada é aplicado. `session.withTransaction` já faz retry
// automático de conflitos transitórios (duas transações disputando o mesmo documento),
// então uma corrida perdida na gravação cai de volta na pré-checagem, que já vê o
// resultado da outra transação após o commit dela.
module.exports.confirmPaymentReceived = async ({ rideId, captain }) => {
    if (!rideId) {
        throw new Error('Ride id is required');
    }

    const walletService = require('./wallet.service');
    const captainModel = require('../models/captain.model');

    const session = await mongoose.startSession();
    let sideEffectCallbacks = [];
    let finalFare;

    try {
        await session.withTransaction(async () => {
            sideEffectCallbacks = [];

            const existing = await rideModel.findOne({
                _id: rideId,
                captain: captain._id
            }).session(session);

            if (!existing) {
                throw new Error('Ride not found');
            }
            if (existing.status !== 'finished') {
                throw new Error('Ride not finished yet');
            }
            if (existing.paymentStatus === 'paid') {
                throw new Error('Payment already confirmed');
            }

            // Guarda atômica: só segue se ainda ninguém marcou como paga entre a leitura
            // acima e este update. Em concorrência real isso normalmente nem dispara —
            // o WriteConflict do Mongo já força um retry que refaz a pré-checagem acima.
            const claimed = await rideModel.findOneAndUpdate(
                { _id: rideId, captain: captain._id, status: 'finished', paymentStatus: { $ne: 'paid' } },
                { $set: { paymentStatus: 'paid' } },
                { new: true, session }
            );
            if (!claimed) {
                throw new Error('Payment already confirmed');
            }

            finalFare = claimed.finalPrice || claimed.fare;

            if (claimed.paymentMethod === 'card') {
                // Se for cartão, credita o valor líquido no pendingBalance do motorista.
                // A plataforma processou via Asaas.
                const driverNetEarnings = finalFare - claimed.commissionAmount;

                const result = await walletService.createTransaction({
                    captainId: captain._id,
                    rideId: claimed._id,
                    type: 'ride_payment',
                    paymentMethod: 'card',
                    amount: driverNetEarnings,
                    description: `Repasse da Corrida #${claimed._id.toString().slice(-6)} (Cartão)`,
                    session
                });
                sideEffectCallbacks.push(result.applySideEffects);
            } else {
                // Se for dinheiro ou pix, motorista fica com o valor total e descontamos a comissão
                const result1 = await walletService.createTransaction({
                    captainId: captain._id,
                    rideId: claimed._id,
                    type: 'ride_payment',
                    paymentMethod: claimed.paymentMethod,
                    amount: finalFare,
                    description: `Corrida #${claimed._id.toString().slice(-6)} (${claimed.paymentMethod})`,
                    session
                });
                sideEffectCallbacks.push(result1.applySideEffects);

                const result2 = await walletService.createTransaction({
                    captainId: captain._id,
                    rideId: claimed._id,
                    type: 'commission',
                    paymentMethod: 'wallet',
                    amount: claimed.commissionAmount,
                    description: `Comissão corrida #${claimed._id.toString().slice(-6)} (${claimed.commissionPercent}%)`,
                    session
                });
                sideEffectCallbacks.push(result2.applySideEffects);
            }

            await captainModel.findByIdAndUpdate(captain._id, {
                $inc: { totalRides: 1, earnings: finalFare }
            }, { session });

            // Update User CRM fields
            await userModel.findByIdAndUpdate(existing.user, {
                $inc: { totalRides: 1, totalSpent: finalFare, totalDistance: claimed.distance || 0 },
                $set: { lastRideAt: new Date() }
            }, { session });
        });
    } finally {
        await session.endSession();
    }

    // Efeitos colaterais (socket + invalidação de cache) só depois do commit — emiti-los
    // de dentro da transação avisaria o motorista de um dinheiro que pode nunca ter sido
    // efetivado, se ela abortasse.
    for (const applySideEffects of sideEffectCallbacks) {
        await applySideEffects();
    }

    const updatedRide = await rideModel.findById(rideId).populate('user').populate('captain');
    return updatedRide;
}

module.exports.payRide = async ({ rideId, user }) => {
    if (!rideId) {
        throw new Error('Ride id is required');
    }

    const crypto = require('crypto');
    const paymentId = 'pay_' + crypto.randomBytes(8).toString('hex');
    const orderId = 'order_' + crypto.randomBytes(8).toString('hex');
    const signature = crypto.randomBytes(16).toString('hex');

    const ride = await rideModel.findOneAndUpdate({
        _id: rideId,
        user: user._id
    }, {
        paymentID: paymentId,
        orderId: orderId,
        signature: signature
    }, { new: true }).populate('user').populate('captain');

    if (!ride) {
        throw new Error('Ride not found');
    }

    return ride;
}

module.exports.getCurrentRide = async ({ user }) => {
    if (!user) {
        throw new Error('User is required');
    }

    let ride = await rideModel.findOne({
        user,
        status: { $in: [ 'requested', 'accepted', 'going_to_pickup', 'arrived', 'waiting_passenger', 'started', 'ongoing' ] }
    }).populate('user').populate('captain');

    // Auto-expire stale 'requested' rides (older than 10 minutes)
    if (ride && ride.status === 'requested') {
        const diffInMinutes = (Date.now() - new Date(ride.createdAt).getTime()) / 60000;
        if (diffInMinutes > 10) {
            ride.status = 'cancelled';
            await ride.save();
            ride = null;
        }
    }

    return ride;
}

// Auditoria de UX do motorista (2026-08-02): não existia equivalente de getCurrentRide
// para o motorista — um refresh de página (ou o app derrubado em segundo plano) durante
// uma corrida ativa perdia todo o estado, porque CaptainRiding.jsx dependia só do
// location.state do react-router, que não sobrevive a um reload.
module.exports.getCurrentRideForCaptain = async ({ captain }) => {
    if (!captain) {
        throw new Error('Captain is required');
    }

    const ride = await rideModel.findOne({
        captain,
        status: { $in: [ 'accepted', 'going_to_pickup', 'arrived', 'waiting_passenger', 'started' ] }
    }).populate('user').populate('captain');

    return ride;
}

// Auditoria de UX do motorista (2026-08-02): o botão "Cancelar" do ConfirmRidePopUp só
// fechava os painéis no frontend — a corrida continuava atribuída a esse motorista no
// banco (e, com o índice único de corrida ativa por motorista, ele ficava impedido de
// aceitar qualquer outra corrida). Diferente de cancelRide (passageiro), aqui a corrida
// NÃO termina: volta para 'requested' sem motorista nem OTP, pra reentrar no despacho.
// Sem taxa de cancelamento — desistir é responsabilidade do motorista, não do passageiro.
module.exports.cancelRideByCaptain = async ({ rideId, captain }) => {
    if (!rideId || !captain) {
        throw new Error('Ride id and captain are required');
    }

    const ride = await rideModel.findOne({ _id: rideId, captain });
    if (!ride) {
        throw new Error('Ride not found');
    }

    if (!VALID_ORIGINS_BY_TARGET.requested.includes(ride.status)) {
        throw new Error('Ride cannot be cancelled at this stage');
    }

    const updated = await transitionRide(
        rideId,
        'requested',
        { captain },
        {},
        { captain: 1, otp: 1 }
    );
    if (!updated) {
        throw new Error('Ride cannot be cancelled at this stage');
    }

    return updated;
}

// Auditoria de concorrência do painel administrativo (2026-08-02, Bloco E): antes,
// admin.service.js fazia `ride.captain = null; ride.status = 'requested'; ride.save()`
// direto — sem passar pela máquina de estados, aceitava reatribuir uma corrida em
// `started` (com o passageiro dentro do carro) e não redespachava pra ninguém, deixando
// a corrida travada em `requested` pra sempre. Reaproveita a mesma transição de
// cancelRideByCaptain (volta pra 'requested', limpa captain/otp), mas sem o filtro de
// dono — o admin pode forçar a reatribuição de qualquer corrida, não só a sua própria.
// VALID_ORIGINS_BY_TARGET.requested não inclui 'started', então essa transição sozinha
// já barra a reatribuição de uma corrida em andamento.
module.exports.reassignRideByAdmin = async (rideId) => {
    if (!rideId) {
        throw new Error('Ride id is required');
    }

    const ride = await rideModel.findById(rideId);
    if (!ride) {
        throw new Error('Ride not found');
    }
    if (!VALID_ORIGINS_BY_TARGET.requested.includes(ride.status)) {
        throw new Error('Ride cannot be reassigned at this stage');
    }
    const previousCaptain = ride.captain;

    const updated = await transitionRide(
        rideId,
        'requested',
        {},
        {},
        { captain: 1, otp: 1 }
    );
    if (!updated) {
        throw new Error('Ride cannot be reassigned at this stage');
    }

    return { ride: updated, previousCaptain };
};

module.exports.cancelRide = async ({ rideId, user }) => {
    if (!rideId || !user) {
        throw new Error('Ride id and user are required');
    }

    // Pré-checagem só pra mensagem de erro e pra decidir a taxa de cancelamento a partir
    // do status atual — a garantia real de concorrência é o findOneAndUpdate atômico
    // abaixo (P2.1 da auditoria: sem isso, um `cancel` e um `start`/`confirm` simultâneos
    // podiam ambos passar pela checagem em memória e produzir um estado impossível).
    const ride = await rideModel.findOne({
        _id: rideId,
        user
    });

    if (!ride) {
        throw new Error('Ride not found');
    }

    if (!VALID_ORIGINS_BY_TARGET.cancelled.includes(ride.status)) {
        throw new Error('Ride cannot be cancelled at this stage');
    }

    // Taxa de cancelamento: só se aplica quando já existe um motorista comprometido
    // com a corrida (aceitou e está a caminho/esperando) — cancelar antes de qualquer
    // motorista aceitar não gera taxa. Igual à taxa de espera, é informativa: acertada
    // diretamente com o motorista, o app não processa nenhuma cobrança.
    const capturedByDriver = ['accepted', 'going_to_pickup', 'arrived', 'waiting_passenger'].includes(ride.status);
    let cancellationFeeCharged = 0;
    if (capturedByDriver && ride.captain) {
        const TariffSetting = require('../models/tariffSetting.model');
        const tariffSetting = await TariffSetting.findOne();
        cancellationFeeCharged = tariffSetting?.cancellationFee || 0;
    }

    const updated = await transitionRide(rideId, 'cancelled', { user }, { cancellationFeeCharged });
    if (!updated) {
        throw new Error('Ride cannot be cancelled at this stage');
    }

    if (updated.captain) {
        const captainService = require('./captain.service');
        captainService.recalculateCancellationStats(updated.captain).catch(console.error);
    }

    return updated;
}

module.exports.submitReview = async ({ rideId, user, rating, comment, issueCategory }) => {
    if (!rideId || !user || !rating) {
        throw new Error('Ride id, user and rating are required');
    }

    const ride = await rideModel.findOne({ _id: rideId, user });
    if (!ride) {
        throw new Error('Ride not found');
    }
    if (ride.status !== 'finished') {
        throw new Error('Only finished rides can be reviewed');
    }
    if (!ride.captain) {
        throw new Error('Ride has no captain to review');
    }

    const reviewModel = require('../models/review.model');
    const existing = await reviewModel.findOne({ ride: rideId, user, type: 'passenger_to_driver' });
    if (existing) {
        throw new Error('Ride already reviewed');
    }

    const review = await reviewModel.create({
        ride: rideId,
        user,
        captain: ride.captain,
        rating,
        comment,
        issueCategory: issueCategory || 'none',
        type: 'passenger_to_driver'
    });

    const captainService = require('./captain.service');
    await captainService.recalculateRating(ride.captain);

    return review;
}

// Espelha submitReview (acima), na direção motorista → passageiro. Auditoria de UX do
// motorista (2026-08-02, Etapa 7, relatório: "Avaliação... Não existe. O motorista
// nunca avalia o passageiro, embora reviewApi.js exista no projeto") — o schema de
// review já tinha o tipo 'driver_to_passenger' pronto, só nada no backend o usava.
module.exports.submitCaptainReview = async ({ rideId, captain, rating, comment }) => {
    if (!rideId || !captain || !rating) {
        throw new Error('Ride id, captain and rating are required');
    }

    const ride = await rideModel.findOne({ _id: rideId, captain });
    if (!ride) {
        throw new Error('Ride not found');
    }
    if (ride.status !== 'finished') {
        throw new Error('Only finished rides can be reviewed');
    }

    const reviewModel = require('../models/review.model');
    const existing = await reviewModel.findOne({ ride: rideId, captain, type: 'driver_to_passenger' });
    if (existing) {
        throw new Error('Ride already reviewed');
    }

    const review = await reviewModel.create({
        ride: rideId,
        user: ride.user,
        captain,
        rating,
        comment,
        type: 'driver_to_passenger'
    });

    const userService = require('./user.service');
    await userService.recalculateRating(ride.user);

    return review;
}

