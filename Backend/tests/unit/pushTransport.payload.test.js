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

    it('o payload data-only de NEW_RIDE passa na validação do SDK (não morre em invalid-payload)', async () => {
        if (getApps().length === 0) {
            initializeApp({ projectId: 'movecity-teste' });
        }
        const { getMessaging } = require('firebase-admin/messaging');

        // Heads-up (2026-08-04): NEW_RIDE é data-only — sem notification{} no topo.
        // Fare numérico ainda precisa virar string via sanitize.
        const data = pushTransport.sanitizeDataValues({
            type: 'NEW_RIDE',
            title: '🚗 Nova corrida disponível',
            message: 'R$ 12,50 • Av. Paulista → Faria Lima',
            rideId: 'abc123',
            fare: 12.5,
            apiUrl: 'https://api.exemplo.com',
            deepLink: '/captain-home?rideOffer=abc123',
            canAcceptInline: 'true',
        });

        const result = await getMessaging().sendEachForMulticast({
            tokens: ['token-invalido-de-teste'],
            data,
            webpush: {
                headers: { Urgency: 'high' },
                fcmOptions: { link: '/captain-home?rideOffer=abc123' },
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

    it('buildFcmMessage com dataOnly omite o bloco notification do FCM', () => {
        const msg = pushTransport.buildFcmMessage({
            title: '🚗 Nova corrida disponível',
            message: 'R$ 12,50',
            dataOnly: true,
            data: { type: 'NEW_RIDE', rideId: 'r1', fare: 12.5 },
            webpush: { headers: { Urgency: 'high' } },
        });

        expect(msg.notification).toBeUndefined();
        expect(msg.data.type).toBe('NEW_RIDE');
        expect(msg.data.fare).toBe('12.5');
        expect(msg.data.title).toBe('🚗 Nova corrida disponível');
        expect(msg.webpush.headers.Urgency).toBe('high');
    });

    it('buildFcmMessage sem dataOnly mantém notification (outros tipos de push)', () => {
        const msg = pushTransport.buildFcmMessage({
            title: 'Corrida Aceita!',
            message: 'O motorista está a caminho.',
            data: { type: 'RIDE_ACCEPTED', deepLink: '/riding' },
        });

        expect(msg.notification).toEqual({
            title: 'Corrida Aceita!',
            body: 'O motorista está a caminho.',
        });
        expect(msg.data.type).toBe('RIDE_ACCEPTED');
    });

    it('buildFcmMessage propaga bloco android (prioridade alta no APK)', () => {
        const msg = pushTransport.buildFcmMessage({
            title: 'Nova corrida',
            message: 'Oferta',
            dataOnly: true,
            data: { type: 'NEW_RIDE', rideId: 'r1' },
            android: { priority: 'high', ttl: 60000 },
        });

        expect(msg.notification).toBeUndefined();
        expect(msg.android).toEqual({ priority: 'high', ttl: 60000 });
        expect(msg.data.type).toBe('NEW_RIDE');
    });

    it('NEW_RIDE/NEW_PARCEL forçam data-only mesmo sem dataOnly no payload', () => {
        for (const type of ['NEW_RIDE', 'NEW_PARCEL']) {
            const msg = pushTransport.buildFcmMessage({
                title: 'Oferta',
                message: 'Teste',
                dataOnly: false,
                data: { type, rideId: 'r1' },
            });
            expect(msg.notification).toBeUndefined();
            expect(msg.data.type).toBe(type);
        }
    });
});
