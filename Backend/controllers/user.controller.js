const userModel = require('../models/user.model');
const userService = require('../services/user.service');
const { validationResult } = require('express-validator');
const blackListTokenModel = require('../models/blacklistToken.model');
const { getAuth } = require('firebase-admin/auth');

module.exports.registerUser = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { fullname, email, password } = req.body;

        const isUserAlready = await userModel.findOne({ email });

        if (isUserAlready) {
            return res.status(400).json({ message: 'User already exist' });
        }

        const hashedPassword = await userModel.hashPassword(password);

        const user = await userService.createUser({
            firstname: fullname.firstname,
            lastname: fullname.lastname,
            email,
            password: hashedPassword
        });

        const token = user.generateAuthToken();

        res.status(201).json({ token, user });
    } catch (err) {
        console.error('Error in registerUser:', err);
        res.status(500).json({ message: 'Internal server error', error: err.message });
    }
}

module.exports.loginUser = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { email, password } = req.body;

        const user = await userModel.findOne({ email }).select('+password');

        if (!user) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }

        const isMatch = await user.comparePassword(password);

        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }

        const token = user.generateAuthToken();

        res.cookie('token', token);

        res.status(200).json({ token, user });
    } catch (err) {
        console.error('Error in loginUser:', err);
        res.status(500).json({ message: 'Internal server error', error: err.message });
    }
}

module.exports.getUserProfile = async (req, res, next) => {
    try {
        res.status(200).json(req.user);
    } catch (err) {
        res.status(500).json({ message: 'Internal server error', error: err.message });
    }
}

module.exports.logoutUser = async (req, res, next) => {
    try {
        res.clearCookie('token');
        const token = req.cookies.token || req.headers.authorization.split(' ')[ 1 ];

        await blackListTokenModel.create({ token });

        res.status(200).json({ message: 'Logged out' });
    } catch (err) {
        console.error('Error in logoutUser:', err);
        res.status(500).json({ message: 'Internal server error', error: err.message });
    }
}

module.exports.googleLogin = async (req, res, next) => {
    try {
        const { idToken } = req.body;
        if (!idToken) return res.status(400).json({ message: 'No ID token provided' });

        // Verify token with Firebase Admin
        let decodedToken;
        try {
            decodedToken = await getAuth().verifyIdToken(idToken);
        } catch (error) {
            console.error('Error verifying Firebase ID token:', error);
            return res.status(401).json({ message: 'Invalid ID token' });
        }

        const { email, name, picture, uid } = decodedToken;

        // Try to find user
        let user = await userModel.findOne({ email });

        if (!user) {
            const nameParts = name ? name.split(' ') : ['Google', 'User'];
            const firstname = nameParts[0];
            const lastname = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '';
            
            // Random password since they authenticate via Google
            const randomPassword = Math.random().toString(36).slice(-10) + Math.random().toString(36).slice(-10);
            const hashedPassword = await userModel.hashPassword(randomPassword);

            user = await userService.createUser({
                firstname,
                lastname,
                email,
                password: hashedPassword,
                profilePicture: picture || ''
            });
        } else if (picture && user.profilePicture !== picture) {
            user.profilePicture = picture;
            await user.save();
        }

        // Generate our JWT
        const token = user.generateAuthToken();

        res.cookie('token', token);
        res.status(200).json({ token, user });
    } catch (err) {
        console.error('Error in googleLogin:', err);
        res.status(500).json({ message: 'Internal server error', error: err.message });
    }
}