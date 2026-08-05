// Extraído de services/notification.service.js (Fase 4 da correção do sistema de push,
// 2026-08-02). M3 da auditoria: "envio síncrono dentro do request" — as chamadas de
// notificação disparadas por ride.controller.js já eram fire-and-forget (sem await),
// mas cada uma tratava o próprio erro no próprio call site. Este módulo formaliza esse
// desacoplamento num único lugar: quem chama enqueue() nunca espera o resultado do
// envio, e um erro que escape do job é capturado aqui (rede de segurança final antes do
// unhandledRejection global do server.js).
//
// O retry de falha transitória de rede já vive em pushTransport.service.js (nível de
// lote de tokens) — não duplicado aqui.
//
// Limitação conhecida e aceita (documentada no plano, não escondida): é uma fila em
// memória. Um restart do processo no meio de um job perde só aquele envio em voo — o
// registro em Notification já foi gravado no banco antes do envio (ver
// notificationDispatcher.service.js), então nada se perde do ponto de vista de
// histórico. Trocar por uma fila persistente (BullMQ/Redis) é uma troca deste arquivo,
// não um redesenho, se o crescimento pedir isso no futuro.
module.exports.enqueue = (job, traceId = '[AUDIT]') => {
    return Promise.resolve()
        .then(job)
        .catch((error) => {
            console.error(`${traceId} Job de notificação falhou:`, error.message);
        });
};
