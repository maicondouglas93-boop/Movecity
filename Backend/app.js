const dotenv = require('dotenv');
dotenv.config();
require('./config/firebase-admin');
const express = require('express');
const cors = require('cors');
const app = express();
const cookieParser = require('cookie-parser');
const connectToDb = require('./db/db');
const userRoutes = require('./routes/user.routes');
const captainRoutes = require('./routes/captain.routes');
const mapsRoutes = require('./routes/maps.routes');
const rideRoutes = require('./routes/ride.routes');
const uploadRoutes = require('./routes/upload.routes');
const notificationRoutes = require('./routes/notification.routes');

const { adminRouter } = require('./admin/admin.config');

connectToDb();

app.use('/admin', adminRouter);

app.use(cors({
    origin: '*',
    methods: [ 'GET', 'POST', 'PUT', 'DELETE', 'OPTIONS' ],
    allowedHeaders: [ 'Content-Type', 'Authorization' ],
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.get('/', (req, res) => {
    res.send('Hello World');
});

const mongoose = require('mongoose');
app.get('/db-test', async (req, res) => {
    const rawUri = process.env.DB_CONNECT || '';
    let maskedUri = 'undefined';
    if (rawUri) {
        maskedUri = rawUri.replace(/:([^:@\/\?]+)@/, ':******@');
    }

    const state = mongoose.connection.readyState;
    const states = {
        0: 'disconnected',
        1: 'connected',
        2: 'connecting',
        3: 'disconnecting'
    };

    try {
        if (state === 1) {
            await mongoose.connection.db.admin().ping();
            return res.json({
                status: 'OK',
                connectionState: states[state],
                uri: maskedUri,
                ping: 'success'
            });
        } else {
            return res.json({
                status: 'ERROR',
                connectionState: states[state],
                uri: maskedUri,
                message: 'Mongoose is not connected. Check Render environment variables.'
            });
        }
    } catch (err) {
        res.status(500).json({
            status: 'ERROR',
            connectionState: states[state],
            uri: maskedUri,
            error: err.message
        });
    }
});

app.use('/users', userRoutes);
app.use('/captains', captainRoutes);
app.use('/maps', mapsRoutes);
app.use('/rides', rideRoutes);
app.use('/uploads', uploadRoutes);
app.use('/notifications', notificationRoutes);

module.exports = app;
