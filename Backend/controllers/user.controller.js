const userModel = require('../models/user.model');
const userService = require('../services/user.service');
const { validationResult } = require('express-validator');
const blackListTokenModel = require('../models/blacklistToken.model');
const { getAuth } = require('firebase-admin/auth');

// Configuração padronizada e segura para os Cookies JWT
const COOKIE_OPTIONS = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 24 * 60 * 60 * 1000 // 1 dia em milissegundos
};

module.exports.registerUser = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { fullname, email, password, cpf, phone } = req.body;

        const isUserAlready = await userModel.findOne({ email });
        if (isUserAlready) {
            return res.status(400).json({ message: 'O usuário já existe' });
        }

        const hashedPassword = await userModel.hashPassword(password);

        const user = await userService.createUser({
            firstname: fullname.firstname,
            lastname: fullname.lastname,
            email,
            password: hashedPassword,
            cpf,
            phone
        });

        const token = user.generateAuthToken();

        res.cookie('token', token, COOKIE_OPTIONS);
        return res.status(201).json({ token, user });
    } catch (err) {
        console.error('Error in registerUser:', err);
        return res.status(500).json({ message: 'Erro interno do servidor' });
    }
};

module.exports.loginUser = async (req, res, next) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        const { email, password } = req.body;

        const user = await userModel.findOne({ email }).select('+password');
        if (!user) {
            return res.status(401).json({ message: 'E-mail ou senha inválidos' });
        }

        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return res.status(401).json({ message: 'E-mail ou senha inválidos' });
        }

        const token = user.generateAuthToken();

        res.cookie('token', token, COOKIE_OPTIONS);
        return res.status(200).json({ token, user });
    } catch (err) {
        console.error('Error in loginUser:', err);
        return res.status(500).json({ message: 'Erro interno do servidor' });
    }
};

module.exports.getUserProfile = async (req, res, next) => {
    try {
        return res.status(200).json(req.user);
    } catch (err) {
        return res.status(500).json({ message: 'Erro interno do servidor' });
    }
};

module.exports.logoutUser = async (req, res, next) => {
    try {
        res.clearCookie('token', COOKIE_OPTIONS);

        // Prevenção de crash usando encadeamento opcional (?.)
        const token = req.cookies?.token || req.headers?.authorization?.split(' ')[1];

        if (token) {
            await blackListTokenModel.create({ token });
        }

        return res.status(200).json({ message: 'Deslogado com sucesso' });
    } catch (err) {
        console.error('Error in logoutUser:', err);
        return res.status(500).json({ message: 'Erro interno do servidor' });
    }
};

module.exports.googleLogin = async (req, res, next) => {
    try {
        const { idToken } = req.body;
        if (!idToken) {
            return res.status(400).json({ message: 'ID token não fornecido' });
        }

        let decodedToken;
        try {
            decodedToken = await getAuth().verifyIdToken(idToken);
        } catch (error) {
            console.error('Error verifying Firebase ID token:', error);
            return res.status(401).json({ message: 'ID token inválido' });
        }

        const { email, name, picture } = decodedToken;

        let user = await userModel.findOne({ email });

        if (!user) {
            const nameParts = name ? name.trim().split(/\s+/) : ['Google', 'User'];
            const firstname = nameParts[0] || 'Google';
            const lastname = nameParts.length > 1 ? nameParts.slice(1).join(' ') : 'User';

            // Senha aleatória criptografada para usuários OAuth
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

        const token = user.generateAuthToken();

        res.cookie('token', token, COOKIE_OPTIONS);
        return res.status(200).json({ token, user });
    } catch (err) {
        console.error('Error in googleLogin:', err);
        return res.status(500).json({ message: 'Erro interno do servidor' });
    }
};