const blackListTokenModel = require('../models/blacklistToken.model');
const userService = require('../services/user.service');
const captainService = require('../services/captain.service');
const authService = require('../services/auth.service');


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

        const decoded = authService.verifyAccessToken(token, 'user');
        const user = await userService.getUserProfile(decoded.subjectId);

        if (!user) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        if (user.isBlocked) {
            return res.status(403).json({ message: 'Sua conta está bloqueada. Entre em contato com o suporte.' });
        }

        req.user = user;
        req.auth = decoded;

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
        const decoded = authService.verifyAccessToken(token, 'captain');
        const captain = await captainService.getCaptainProfile(decoded.subjectId);

        if (!captain) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        if (captain.isBlocked) {
            return res.status(403).json({ message: 'Sua conta está bloqueada. Entre em contato com o suporte.' });
        }

        req.captain = captain;
        req.auth = decoded;

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
        const decoded = authService.verifyAccessToken(token, ['user', 'captain']);

        if (decoded.actorType === 'user' || decoded.legacy) {
            const user = await userService.getUserProfile(decoded.subjectId);
            if (user) {
                if (user.isBlocked) {
                    return res.status(403).json({ message: 'Sua conta está bloqueada. Entre em contato com o suporte.' });
                }
                req.user = user;
                req.auth = decoded;
                return next();
            }
        }

        if (decoded.actorType === 'captain' || decoded.legacy) {
            const captain = await captainService.getCaptainProfile(decoded.subjectId);
            if (captain) {
                if (captain.isBlocked) {
                    return res.status(403).json({ message: 'Sua conta está bloqueada. Entre em contato com o suporte.' });
                }
                req.captain = captain;
                req.auth = decoded;
                return next();
            }
        }

        return res.status(401).json({ message: 'Unauthorized' });
    } catch (err) {
        return res.status(401).json({ message: 'Unauthorized' });
    }
}
