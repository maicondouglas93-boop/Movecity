const captainModel = require('../models/captain.model');
const captainService = require('../services/captain.service');
const blackListTokenModel = require('../models/blacklistToken.model');
const { validationResult } = require('express-validator');
const { getCache, setCache, deleteByPrefix } = require('../cache/cache');


module.exports.registerCaptain = async (req, res, next) => {

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { fullname, email, password, vehicle } = req.body;

    const isCaptainAlreadyExist = await captainModel.findOne({ email });

    if (isCaptainAlreadyExist) {
        return res.status(400).json({ message: 'Captain already exist' });
    }


    const hashedPassword = await captainModel.hashPassword(password);

    const captain = await captainService.createCaptain({
        firstname: fullname.firstname,
        lastname: fullname.lastname,
        email,
        password: hashedPassword,
        color: vehicle.color,
        plate: vehicle.plate,
        capacity: vehicle.capacity,
        vehicleType: vehicle.vehicleType
    });

    const token = captain.generateAuthToken();

    res.status(201).json({ token, captain });

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

    const token = captain.generateAuthToken();

    res.cookie('token', token);

    res.status(200).json({ token, captain });
}

module.exports.getCaptainProfile = async (req, res, next) => {
    res.status(200).json({ captain: req.captain });
}

module.exports.logoutCaptain = async (req, res, next) => {
    const token = req.cookies.token || req.headers.authorization?.split(' ')[ 1 ];

    await blackListTokenModel.create({ token });

    res.clearCookie('token');

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
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { amount } = req.body;
    try {
        const walletService = require('../services/wallet.service');
        const result = await walletService.createTransaction({
            captainId: req.captain._id,
            type: 'recharge',
            paymentMethod: 'pix',
            amount: parseFloat(amount),
            description: 'Recarga de carteira via PIX'
        });
        res.status(200).json(result);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
}

module.exports.toggleOnline = async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    const { isOnline } = req.body;

    try {
        if (isOnline) {
            const walletService = require('../services/wallet.service');
            const wallet = await walletService.getWallet(req.captain._id);
            if (wallet.balance < 0) {
                return res.status(403).json({ message: 'Inadimplente. Saldo negativo não permite ficar online. Recarregue a carteira.' });
            }
        }

        const captain = await captainModel.findByIdAndUpdate(req.captain._id, { isOnline }, { new: true });
        
        deleteByPrefix(`profile:captain:${req.captain._id}`);
        deleteByPrefix(`drivers:`); // clear drivers cache since online status changed
        
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
        const rideModel = require('../models/ride.model');
        const wallet = await walletService.getWallet(req.captain._id);

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
            walletBalance: wallet.balance,
            walletBlocked: wallet.blockedBalance || 0,
            onlineTime: "05:32", // Mocked or calculated if we store session time
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