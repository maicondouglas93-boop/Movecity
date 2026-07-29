const rideModel = require('../models/ride.model');
const mapService = require('./maps.service');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { getCache, setCache } = require('../cache/cache');

const PricingEngine = require('./pricingEngine.service');

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
        breakdown: fareBreakdownData
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
    user, pickup, destination, vehicleType, paymentMethod = 'cash'
}) => {
    if (!user || !pickup || !destination || !vehicleType) {
        throw new Error('All fields are required');
    }

    // Calcular rota e tempo real
    const distanceTime = await mapService.getDistanceTime(pickup, destination);
    const distance = distanceTime.distance.value;
    const time = distanceTime.duration.value;

    // Usar o Pricing Engine Oficial
    const pricing = await PricingEngine.calculateFare({
        distance,
        time,
        vehicleType,
        paymentMethod
    });

    const ride = await rideModel.create({
        user,
        pickup,
        destination,
        otp: getOtp(6),
        fare: pricing.finalFare,
        paymentMethod,
        vehicleType,
        status: 'requested',
        estimatedDistance: distance,
        estimatedTime: time,
        estimatedPriceMin: pricing.finalFare,
        estimatedPriceMax: pricing.finalFare,
        commissionPercent: pricing.fareBreakdown.platformCommission > 0 
            ? Math.round((pricing.fareBreakdown.platformCommission / pricing.finalFare) * 100) : 0, // Fallback fallback calculation
        commissionAmount: pricing.commissionAmount,
        fareBreakdown: pricing.fareBreakdown,
        distance,
        duration: time
    })

    return ride;
}

module.exports.confirmRide = async ({
    rideId, captain
}) => {
    if (!rideId) {
        throw new Error('Ride id is required');
    }

    await rideModel.findOneAndUpdate({
        _id: rideId
    }, {
        status: 'accepted',
        captain: captain._id
    })

    const ride = await rideModel.findOne({
        _id: rideId
    }).populate('user').populate('captain').select('+otp');

    if (!ride) {
        throw new Error('Ride not found');
    }

    return ride;

}

module.exports.startRide = async ({ rideId, otp, captain }) => {
    if (!rideId || !otp) {
        throw new Error('Ride id and OTP are required');
    }

    const ride = await rideModel.findOne({
        _id: rideId
    }).populate('user').populate('captain').select('+otp');

    if (!ride) {
        throw new Error('Ride not found');
    }

    if (ride.status !== 'accepted') {
        throw new Error('Ride not accepted');
    }

    if (ride.otp !== otp) {
        throw new Error('Invalid OTP');
    }

    await rideModel.findOneAndUpdate({
        _id: rideId
    }, {
        status: 'started'
    })

    const updatedRide = await rideModel.findOne({ _id: rideId }).populate('user').populate('captain').select('+otp');
    return updatedRide;
}

module.exports.updateRideStatus = async ({ rideId, captain, status }) => {
    if (!rideId || !status) {
        throw new Error('Ride id and status are required');
    }

    const validStatuses = ['requested', 'accepted', 'going_to_pickup', 'arrived', 'waiting_passenger', 'started', 'finished', 'cancelled'];
    if (!validStatuses.includes(status)) {
        throw new Error('Invalid status');
    }

    const ride = await rideModel.findOneAndUpdate({
        _id: rideId,
        captain: captain._id
    }, {
        status: status
    }, { new: true }).populate('user').populate('captain').select('+otp');

    if (!ride) {
        throw new Error('Ride not found');
    }

    return ride;
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

    if (ride.status !== 'started' && ride.status !== 'ongoing') {
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
                paymentMethod: ride.paymentMethod
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
    
    await rideModel.findOneAndUpdate({
        _id: rideId
    }, {
        status: 'finished',
        actualTime: actualTimeSeconds,
        finalPrice: finalPrice,
        paymentStatus: 'pending' // Awaiting driver to confirm cash received
    })
    
    const updatedRide = await rideModel.findById(rideId).populate('user').populate('captain');
    return updatedRide;
}

module.exports.confirmPaymentReceived = async ({ rideId, captain }) => {
    if (!rideId) {
        throw new Error('Ride id is required');
    }

    const ride = await rideModel.findOne({
        _id: rideId,
        captain: captain._id
    }).populate('user').populate('captain');

    if (!ride) {
        throw new Error('Ride not found');
    }

    if (ride.status !== 'finished') {
        throw new Error('Ride not finished yet');
    }

    if (ride.paymentStatus === 'paid') {
        throw new Error('Payment already confirmed');
    }

    const walletService = require('./wallet.service');
    const finalFare = ride.finalPrice || ride.fare;

    if (ride.paymentMethod === 'card') {
        // Se for cartão, credita o valor líquido no pendingBalance do motorista.
        // A plataforma processou via Asaas.
        const driverNetEarnings = finalFare - ride.commissionAmount;

        // Registra o ganho da corrida
        await walletService.createTransaction({
            captainId: captain._id,
            rideId: ride._id,
            type: 'ride_payment',
            paymentMethod: 'card',
            amount: driverNetEarnings,
            description: `Repasse da Corrida #${ride._id.toString().slice(-6)} (Cartão)`
        });
        
    } else {
        // Se for dinheiro ou pix, motorista fica com o valor total e descontamos a comissão
        await walletService.createTransaction({
            captainId: captain._id,
            rideId: ride._id,
            type: 'ride_payment',
            paymentMethod: ride.paymentMethod,
            amount: finalFare,
            description: `Corrida #${ride._id.toString().slice(-6)} (${ride.paymentMethod})`
        });

        // Deduz a comissão do creditBalance
        await walletService.createTransaction({
            captainId: captain._id,
            rideId: ride._id,
            type: 'commission',
            paymentMethod: 'wallet',
            amount: ride.commissionAmount,
            description: `Comissão corrida #${ride._id.toString().slice(-6)} (${ride.commissionPercent}%)`
        });
    }

    // Mark payment as paid
    await rideModel.findOneAndUpdate({
        _id: rideId
    }, {
        paymentStatus: 'paid'
    });

    // Update captain stats
    const captainModel = require('../models/captain.model');
    await captainModel.findByIdAndUpdate(captain._id, {
        $inc: { totalRides: 1, earnings: finalFare }
    });

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

module.exports.cancelRide = async ({ rideId, user }) => {
    if (!rideId || !user) {
        throw new Error('Ride id and user are required');
    }

    const ride = await rideModel.findOne({
        _id: rideId,
        user
    });

    if (!ride) {
        throw new Error('Ride not found');
    }

    if (['started', 'ongoing', 'completed', 'cancelled'].includes(ride.status)) {
        throw new Error('Ride cannot be cancelled at this stage');
    }

    ride.status = 'cancelled';
    await ride.save();

    return ride;
}

