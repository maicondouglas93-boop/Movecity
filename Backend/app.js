const dotenv = require('dotenv');
dotenv.config();
require('./config/firebase-admin');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const app = express();
const cookieParser = require('cookie-parser');
const connectToDb = require('./db/db');
const userRoutes = require('./routes/user.routes');
const captainRoutes = require('./routes/captain.routes');
const mapsRoutes = require('./routes/maps.routes');
const rideRoutes = require('./routes/ride.routes');
const parcelRoutes = require('./routes/parcel.routes');
const scheduleRoutes = require('./routes/schedule.routes');
const uploadRoutes = require('./routes/upload.routes');
const notificationRoutes = require('./routes/notification.routes');
const chatRoutes = require('./routes/chat.routes');
const webhookRoutes = require('./routes/webhook.routes');
const vehicleCategoryRoutes = require('./routes/vehicleCategory.routes');
const supportRoutes = require('./routes/support.routes');
require('./services/tariffScheduler.service'); // registra o cron que aplica tarifas agendadas
require('./services/captainDeadline.service'); // registra o cron do prazo de documentação do motorista
require('./services/schedule.service'); // registra o cron que ativa corridas/encomendas agendadas

const adminRoutes = require('./routes/admin.routes');
const appVersionRoutes = require('./routes/appVersion.routes');

const rawOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  // Capacitor Android/iOS WebView (capacitor.config androidScheme: https)
  "https://localhost",
  "http://localhost",
  "capacitor://localhost",
  "ionic://localhost",
  process.env.FRONTEND_URL,
  process.env.ADMIN_FRONTEND_URL,
  process.env.CAPACITOR_ORIGIN,
];

// Remove barras no final (trailing slashes) e ignora valores vazios
const allowedOrigins = rawOrigins
  .filter(Boolean)
  .map(url => url.replace(/\/+$/, ''));

app.use(cors({
    origin: function(origin, callback){
        if(!origin || allowedOrigins.includes(origin)){
            callback(null, true);
        } else {
            callback(new Error("Não permitido pelo CORS"));
        }
    },
    credentials: true
}));

app.use(helmet());

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 1000, // limite de requests por IP
    message: "Muitas requisições deste IP, tente novamente mais tarde."
});

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 5, // max 5 tentativas
    message: { message: "Muitas tentativas de login. Tente novamente em 15 minutos." }
});

app.use(limiter);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

if (process.env.NODE_ENV !== 'test') {
    connectToDb();
}

app.use('/api/admin', adminRoutes);
// Versão do APK motorista (público, somente leitura)
app.use('/api/app-version', appVersionRoutes);

app.get('/', (req, res) => {
    res.send('Hello World');
});

const mongoose = require('mongoose');
const imagekitConfig = require('./config/imagekit');

app.get('/api/health', (req, res) => {
    const memory = process.memoryUsage();
    res.status(200).json({
        status: 'OK',
        uptime: process.uptime(),
        memory: {
            rss: `${Math.round(memory.rss / 1024 / 1024)} MB`,
            heapTotal: `${Math.round(memory.heapTotal / 1024 / 1024)} MB`,
            heapUsed: `${Math.round(memory.heapUsed / 1024 / 1024)} MB`
        },
        databaseState: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        // Migração Cloudinary → ImageKit (2026-08-04): variável de ambiente salva no
        // painel do Render só entra no processo depois de um redeploy — sem este campo,
        // a única forma de saber se as credenciais chegaram de fato era abrir o log do
        // deploy e procurar a linha "ImageKit configurado.". Booleano derivado de
        // isConfigured(): NUNCA expõe endpoint, chave pública ou privada.
        storage: imagekitConfig.isConfigured() ? 'configured' : 'missing',
        timestamp: new Date().toISOString()
    });
});
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
app.use('/parcels', parcelRoutes);
app.use('/schedules', scheduleRoutes);
app.use('/uploads', uploadRoutes);
app.use('/notifications', notificationRoutes);
app.use('/chat', chatRoutes);
app.use('/webhooks', webhookRoutes);
app.use('/vehicle-categories', vehicleCategoryRoutes);
app.use('/support', supportRoutes);

// Global Error Handler
app.use((err, req, res, next) => {
    console.error('Global Error:', err);
    if (process.env.NODE_ENV === 'production') {
        res.status(500).json({ message: 'Internal Server Error' });
    } else {
        res.status(500).json({ message: err.message, stack: err.stack });
    }
});

module.exports = app;
