const { getApps, initializeApp } = require('firebase-admin/app');
const pushTransport = require('../../notification/pushTransport.service');

// Correção crítica do push de corrida (2026-08-03). A regressão: o despacho passou a
// mandar `fare` como NÚMERO dentro de `data`, e o FCM exige que todos os valores de
// `data` sejam strings — o firebase-admin rejeitava a mensagem inteira com
// `messaging/invalid-payload` ANTES de qualquer rede, então nenhuma push de "Nova
// corrida" saía. Nenhum teste pegou porque todos mockavam o SDK. Estes testes exercitam
// a validação REAL do firebase-admin (que roda offline), sem mock.
describe('pushTransport — contrato do payload com o FCM', () => {
    it('converte valores não-string de data (a regressão do fare numérico)', () => {
        expect(pushTransport.sanitizeDataValues({
            rideId: 'abc',
            fare: 12.5,
            flag: true,
            nested: { a: 1 },
            vazio: null,
            indefinido: undefined,
        })).toEqual({
            rideId: 'abc',
            fare: '12.5',
            flag: 'true',
            nested: '{"a":1}',
        });
    });

    it('o payload real de NEW_RIDE passa na validação do SDK (não morre em invalid-payload)', async () => {
        if (getApps().length === 0) {
            initializeApp({ projectId: 'movecity-teste' });
        }
        const { getMessaging } = require('firebase-admin/messaging');

        // Exatamente o que dispatchRideToCaptains manda hoje: fare numérico e o bloco
        // webpush com os botões Aceitar/Recusar (que devem continuar funcionando).
        const data = pushTransport.sanitizeDataValues({
            rideId: 'abc123',
            fare: 12.5,
            apiUrl: 'https://api.exemplo.com',
            deepLink: '/captain-home',
        });

        const result = await getMessaging().sendEachForMulticast({
            tokens: ['token-invalido-de-teste'],
            notification: { title: '🚗 Nova corrida disponível', body: 'Passageiro próximo • R$ 12,50' },
            data,
            webpush: {
                headers: { Urgency: 'high' },
                notification: {
                    actions: [
                        { action: 'accept', title: '✅ Aceitar' },
                        { action: 'reject', title: '❌ Recusar' },
                        { action: 'open', title: '📱 Abrir App' },
                    ],
                    requireInteraction: true,
                    vibrate: [300, 100, 300, 100, 300],
                    badge: '/movecity-icon.jpg',
                    tag: 'ride-abc123',
                },
                fcmOptions: { link: '/captain-home' },
            },
        });

        // Sem credenciais neste ambiente o envio para na AUTENTICAÇÃO (ou, com
        // credenciais, no token falso) — o que este teste garante é que ele nunca mais
        // morre na VALIDAÇÃO do payload, que era o erro da regressão.
        expect(result.successCount).toBe(0);
        const error = result.responses[0].error;
        expect(error).toBeTruthy();
        expect(error.code).not.toBe('messaging/invalid-payload');
    }, 20000);
});
