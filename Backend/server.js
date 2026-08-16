const http = require('http');
const app = require('./app');
const connectToDb = require('./db/db');
const { initializeSocket } = require('./socket');
const port = process.env.PORT || 3000;

// C5 da auditoria de push (2026-08-02): rede de segurança final — os try/catch
// específicos adicionados em notification.service.js e o .catch() em cada chamada de
// ride.controller.js já cobrem os casos conhecidos; isto aqui só evita que um erro
// não-tratado em QUALQUER outro ponto do processo derrube a API inteira e tire do ar
// todos os usuários por causa de uma falha isolada (ex: instabilidade momentânea do
// Firebase ou do Mongo durante um envio de notificação). Só loga — não mascara bug, só
// impede que um bug vire uma queda total do serviço.
process.on('unhandledRejection', (reason) => {
    console.error('[FATAL EVITADO] Unhandled Promise Rejection:', reason);
});
process.on('uncaughtException', (error) => {
    console.error('[FATAL EVITADO] Uncaught Exception:', error);
    // EADDRINUSE e erros de boot não podem deixar o processo "vivo" sem HTTP
    // (Mongo/cron continuam e a porta fica bloqueada para o próximo npm run dev).
    if (error && (error.code === 'EADDRINUSE' || error.syscall === 'listen')) {
        process.exit(1);
    }
});

const server = http.createServer(app);

initializeSocket(server);

server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`[BOOT] Porta ${port} já em uso. Encerre o processo anterior ou defina outra PORT.`);
        process.exit(1);
    }
    console.error('[BOOT] Erro ao iniciar servidor HTTP:', error);
    process.exit(1);
});

// Plano de correção (Fase 2.3, 2026-08-16, Passo 3): antes, connectToDb() era
// disparado sem await dentro de app.js e server.listen() rodava logo em seguida —
// o processo aceitava requisição HTTP antes do Mongo estar conectado. Como o
// Mongoose enfileira comandos por padrão, essas requisições não falhavam rápido:
// ficavam penduradas até o timeout de seleção de servidor, pior que uma falha clara.
// Agora a porta só abre depois que o banco conecta de verdade.
connectToDb()
    .then(() => {
        server.listen(port, () => {
            console.log(`Server is running on port ${port}`);
        });
    })
    .catch((err) => {
        console.error('[BOOT] Falha ao conectar ao banco antes de iniciar o servidor:', err);
        process.exit(1);
    });