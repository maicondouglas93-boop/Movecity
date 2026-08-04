const express = require('express');
const { body } = require('express-validator');
const authMiddleware = require('../middlewares/auth.middleware');
const supportController = require('../controllers/support.controller');

const router = express.Router();

router.get('/contact', supportController.getContactChannels);

router.post(
    '/tickets',
    authMiddleware.authUser,
    body('category').isIn([ 'ride_issue', 'lost_item', 'payment', 'other' ]).withMessage('Categoria inválida'),
    body('message').isString().isLength({ min: 10, max: 2000 }).withMessage('Descreva o problema com pelo menos 10 caracteres'),
    body('subject').optional().isString().isLength({ max: 120 }),
    body('rideId').optional({ values: 'falsy' }).isMongoId().withMessage('Corrida inválida'),
    supportController.createTicket
);

router.get('/tickets', authMiddleware.authUser, supportController.listMyTickets);

router.get('/tickets/:id', authMiddleware.authUser, supportController.getTicket);

module.exports = router;
