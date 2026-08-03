const http = require('http');
const app = require('./app');
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
});

const server = http.createServer(app);

initializeSocket(server);

server.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});