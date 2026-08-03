// Fachada (Fase 4 da correção do sistema de push, 2026-08-02): a lógica real foi
// dividida em Backend/notification/{tokenRegistry,pushTransport,notificationDispatcher,
// queue}.service.js — cada módulo com uma responsabilidade só (ver docs/plans/
// 2026-08-02-correcao-sistema-notificacoes-push.md). Este arquivo só reexporta,
// mantendo exatamente os mesmos nomes que ride.controller.js e admin.controller.js já
// importam (`notificationService.sendNewRide(...)`, etc.) — pra não quebrar ninguém.
module.exports = require('../notification/notificationDispatcher.service');
