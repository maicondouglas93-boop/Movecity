const dotenv = require('dotenv');
dotenv.config();
require('./config/firebase-admin');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const app = express();

// Plano de correção (Fase 1.3, 2026-08-16): sem isto, req.ip é sempre o IP do proxy
// do Render (um único hop reverso na frente do serviço web — documentado pela própria
// Render para apps Node/Express), nunca o do cliente. O rate limiter por IP
// (loginLimiter, rideStartPinLimiter etc.) e qualquer log de auditoria por IP ficavam
// olhando pro mesmo endereço pra todo mundo. '1' confia só no primeiro hop — um valor
// maior deixaria o cliente forjar X-Forwarded-For e escolher o próprio "IP".
app.set('trust proxy', 1);

const cookieParser = require('cookie-parser');
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
const accountDeletionRoutes = require('./routes/accountDeletion.routes');
require('./services/tariffScheduler.service'); // registra o cron que aplica tarifas agendadas
require('./services/captainDeadline.service'); // registra o cron do prazo de documentação do motorista
require('./services/schedule.service'); // registra o cron que ativa corridas/encomendas agendadas
require('./services/rideHealth.service'); // registra o cron que detecta corridas travadas
require('./services/accountDeletion.service'); // anonimiza contas 30 dias após a solicitação

const adminRoutes = require('./routes/admin.routes');
const appVersionRoutes = require('./routes/appVersion.routes');

const { corsOriginCallback } = require('./config/corsOrigins');
const { csrfProtection } = require('./middlewares/csrfProtection.middleware');

// A validação de origem precisa enxergar os cookies antes do CORS. Assim, uma
// mutação cross-site autenticada por cookie recebe 403 antes de chegar às rotas.
app.use(cookieParser());
app.use(csrfProtection);

app.use(cors({
    origin: corsOriginCallback,
    credentials: true,
    exposedHeaders: [
        'X-Maps-Session-Token',
        'X-Driver-Map-Subscription',
        'X-Driver-Map-Expires-At',
    ],
}));

app.use(helmet());

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 1000, // limite de requests por IP
    message: "Muitas requisições deste IP, tente novamente mais tarde."
});

app.use(limiter);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Plano de correção (Fase 2.3, 2026-08-16, Passo 3): conectar ao banco não é mais um
// efeito colateral de importar este módulo (era fire-and-forget aqui, sem await, e
// server.js já chamava server.listen() logo em seguida — o processo aceitava tráfego
// HTTP antes do Mongo estar pronto). Quem decide QUANDO conectar agora é server.js,
// o único consumidor real deste módulo fora de teste — ele espera a conexão terminar
// antes de abrir a porta.

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
// /db-test removido (auditoria 2026-08-06): era público e vazava host/user da
// connection string. Use GET /api/health (databaseState sem URI).

// Plano de correção (Fase 2.1, 2026-08-16, Passo 1): /api/health é liveness (processo
// vivo) — sempre 200, mesmo com o Mongo caído, de propósito, pra não derrubar um
// healthcheck que só confere "o processo não travou". /api/ready é readiness de
// verdade: só 200 quando o banco está conectado. Ainda NÃO é o que o Render usa pra
// decidir tráfego (render.yaml continua apontando pra /api/health) — esse é só o
// primeiro passo, adicionar o endpoint e provar em produção antes de trocar o que
// está no ar decidindo isso.
app.get('/api/ready', (req, res) => {
    const ready = mongoose.connection.readyState === 1;
    res.status(ready ? 200 : 503).json({
        status: ready ? 'ready' : 'not_ready',
        databaseState: ready ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString()
    });
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
app.use('/account-deletion', accountDeletionRoutes);

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
