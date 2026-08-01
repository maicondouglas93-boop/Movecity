const userModel = require('../models/user.model');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const blackListTokenModel = require('../models/blacklistToken.model');
const captainModel = require('../models/captain.model');
const userService = require('../services/user.service');
const captainService = require('../services/captain.service');


module.exports.authUser = async (req, res, next) => {
    const token = req.cookies.token || req.headers.authorization?.split(' ')[ 1 ];

    if (!token) {
        return res.status(401).json({ message: 'Unauthorized' });
    }


    const isBlacklisted = await blackListTokenModel.findOne({ token: token });

    if (isBlacklisted) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    try {

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await userService.getUserProfile(decoded._id);

        if (!user) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        if (user.isBlocked) {
            return res.status(403).json({ message: 'Sua conta está bloqueada. Entre em contato com o suporte.' });
        }

        req.user = user;

        return next();

    } catch (err) {
        return res.status(401).json({ message: 'Unauthorized' });
    }
}

module.exports.authCaptain = async (req, res, next) => {
    const token = req.cookies.token || req.headers.authorization?.split(' ')[ 1 ];


    if (!token) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    const isBlacklisted = await blackListTokenModel.findOne({ token: token });



    if (isBlacklisted) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const captain = await captainService.getCaptainProfile(decoded._id);

        if (!captain) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        if (captain.isBlocked) {
            return res.status(403).json({ message: 'Sua conta está bloqueada. Entre em contato com o suporte.' });
        }

        req.captain = captain;

        return next()
    } catch (err) {
        console.log(err);

        res.status(401).json({ message: 'Unauthorized' });
    }
}

module.exports.authBoth = async (req, res, next) => {
    const token = req.cookies.token || req.headers.authorization?.split(' ')[ 1 ];

    if (!token) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    const isBlacklisted = await blackListTokenModel.findOne({ token: token });

    if (isBlacklisted) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        const user = await userService.getUserProfile(decoded._id);
        if (user) {
            if (user.isBlocked) {
                return res.status(403).json({ message: 'Sua conta está bloqueada. Entre em contato com o suporte.' });
            }
            req.user = user;
            return next();
        }

        const captain = await captainService.getCaptainProfile(decoded._id);
        if (captain) {
            if (captain.isBlocked) {
                return res.status(403).json({ message: 'Sua conta está bloqueada. Entre em contato com o suporte.' });
            }
            req.captain = captain;
            return next();
        }

        return res.status(401).json({ message: 'Unauthorized' });
    } catch (err) {
        return res.status(401).json({ message: 'Unauthorized' });
    }
}
