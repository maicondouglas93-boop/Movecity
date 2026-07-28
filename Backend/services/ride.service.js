const rideModel = require('../models/ride.model');
const mapService = require('./maps.service');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { getCache, setCache } = require('../cache/cache');

async function getFare(pickup, destination) {

    if (!pickup || !destination) {
        throw new Error('Pickup and destination are required');
    }

    const cacheKey = `fare:${pickup}:${destination}`;
    const cached = getCache(cacheKey);
    if (cached) return cached;

    const distanceTime = await mapService.getDistanceTime(pickup, destination);

    const baseFare = {
        auto: 30,
        car: 50,
        moto: 20
    };

    const perKmRate = {
        auto: 10,
        car: 15,
        moto: 8
    };

    const perMinuteRate = {
        auto: 2,
        car: 3,
        moto: 1.5
    };

    const fare = {
        auto: Math.round(baseFare.auto + ((distanceTime.distance.value / 1000) * perKmRate.auto) + ((distanceTime.duration.value / 60) * perMinuteRate.auto)),
        car: Math.round(baseFare.car + ((distanceTime.distance.value / 1000) * perKmRate.car) + ((distanceTime.duration.value / 60) * perMinuteRate.car)),
        moto: Math.round(baseFare.moto + ((distanceTime.distance.value / 1000) * perKmRate.moto) + ((distanceTime.duration.value / 60) * perMinuteRate.moto))
    };

    const maxDistance = distanceTime.distance.value + 1000; // +1km extra for max price
    const fareMax = {
        auto: Math.round(baseFare.auto + ((maxDistance / 1000) * perKmRate.auto) + ((distanceTime.duration.value / 60) * perMinuteRate.auto)),
        car: Math.round(baseFare.car + ((maxDistance / 1000) * perKmRate.car) + ((distanceTime.duration.value / 60) * perMinuteRate.car)),
        moto: Math.round(baseFare.moto + ((maxDistance / 1000) * perKmRate.moto) + ((distanceTime.duration.value / 60) * perMinuteRate.moto))
    };

    const result = {
        fare,
        fareMax,
        distance: distanceTime.distance.value,
        maxDistance,
        time: distanceTime.duration.value,
        polyline: distanceTime.polyline // ensure we pass polyline
    };

    setCache(cacheKey, result, 1800); // 30 minutes

    return result;


}

module.exports.getFare = getFare;


function getOtp(num) {
    function generateOtp(num) {
        const otp = crypto.randomInt(Math.pow(10, num - 1), Math.pow(10, num)).toString();
        return otp;
    }
    return generateOtp(num);
}


module.exports.createRide = async ({
    user, pickup, destination, vehicleType
}) => {
    if (!user || !pickup || !destination || !vehicleType) {
        throw new Error('All fields are required');
    }

    const estimatedData = await getFare(pickup, destination);
    const estimatedDistance = estimatedData.distance;
    const estimatedTime = estimatedData.time;
    
    // Set fixed commission at 10%
    const commissionPercent = 10;
    const estimatedPrice = estimatedData.fare[vehicleType];
    const estimatedPriceMax = estimatedData.fareMax[vehicleType];
    const commissionAmount = Math.round(estimatedPrice * (commissionPercent / 100));

    const ride = rideModel.create({
        user,
        pickup,
        destination,
        otp: getOtp(6),
        fare: estimatedPrice,
        vehicleType,
        status: 'requested',
        estimatedDistance,
        estimatedTime,
        estimatedPriceMin: estimatedPrice,
        estimatedPriceMax: estimatedPriceMax,
        commissionPercent,
        commissionAmount,
        distance: estimatedDistance,
        duration: estimatedTime
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
    // Calculate elapsed time in seconds (or mock if not tracked properly, we can use updatedAt - createdAt)
    // Actually we don't have start time explicitly stored, let's use updatedAt - createdAt for now, or just fallback to estimatedTime if it's too fast.
    let actualTimeSeconds = Math.round((Date.now() - new Date(ride.createdAt).getTime()) / 1000);
    if (actualTimeSeconds < 60) actualTimeSeconds = ride.estimatedTime; // Sanity check

    const baseFare = { auto: 30, car: 50, moto: 20 };
    const perKmRate = { auto: 10, car: 15, moto: 8 };
    const perMinuteRate = { auto: 2, car: 3, moto: 1.5 };
    const vType = ride.vehicleType || 'car';

    const calcPrice = Math.round(
        baseFare[vType] + 
        ((actualDistance / 1000) * perKmRate[vType]) + 
        ((actualTimeSeconds / 60) * perMinuteRate[vType])
    );
    
    // Fallback to estimated price if for some reason distance is 0 (GPS issues)
    const finalPrice = actualDistance > 0 ? calcPrice : ride.fare;
    
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

// Driver clicks "Pagamento Recebido" — deducts commission from wallet
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

    if (ride.paymentStatus === 'completed') {
        throw new Error('Payment already confirmed');
    }

    // Deduct commission from driver's credit wallet
    const walletService = require('./wallet.service');
    await walletService.createTransaction({
        captainId: captain._id,
        rideId: ride._id,
        type: 'commission',
        paymentMethod: 'wallet',
        amount: ride.commissionAmount,
        description: `Comissão corrida #${ride._id.toString().slice(-6)} (${ride.commissionPercent}%)`
    });

    // Mark payment as completed
    await rideModel.findOneAndUpdate({
        _id: rideId
    }, {
        paymentStatus: 'completed'
    });

    // Update captain stats
    const captainModel = require('../models/captain.model');
    await captainModel.findByIdAndUpdate(captain._id, {
        $inc: { totalRides: 1, earnings: ride.finalPrice || ride.fare }
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

