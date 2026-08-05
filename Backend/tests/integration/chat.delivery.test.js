const request = require('supertest');
const { createServer } = require('http');
const Client = require('socket.io-client');
const app = require('../../app');
const { initializeSocket } = require('../../socket');
const { generateAuthToken } = require('../setup/authHelper');
const { createUser } = require('../factories/user.factory');
const { createCaptain } = require('../factories/captain.factory');
const { createRide } = require('../factories/ride.factory');
const parcelModel = require('../../models/parcel.model');
const messageModel = require('../../models/message.model');
const Notification = require('../../models/notification.model');
const NotificationToken = require('../../models/notificationToken.model');

const waitFor = async (queryFn, { attempts = 30, delayMs = 50 } = {}) => {
    for (let i = 0; i < attempts; i += 1) {
        const found = await queryFn();
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return null;
};

const createParcel = ({ user, captain, status = 'provider_accepted' }) => parcelModel.create({
    user,
    captain,
    vehicleType: 'moto',
    pickup: 'Rua A',
    destination: 'Rua B',
    sender: { name: 'Remetente', phone: '33999999999' },
    recipient: { name: 'Destinatário', phone: '33888888888' },
    itemName: 'Envelope',
    category: 'documento',
    weightKg: 1,
    size: 'small',
    fare: 15,
    deliveryPin: '4321',
    status,
});

describe('Chat persistido e entrega do PIN', () => {
    let httpServer;
    let port;

    beforeAll((done) => {
        httpServer = createServer();
        initializeSocket(httpServer);
        httpServer.listen(() => {
            port = httpServer.address().port;
            done();
        });
    });

    afterAll((done) => {
        httpServer.close(done);
    });

    const connectClient = () => new Promise((resolve) => {
        const client = new Client(`http://localhost:${port}`);
        client.on('connect', () => resolve(client));
    });

    it('ride: persiste antes do realtime e motorista autenticado recupera o histórico', async () => {
        const passenger = await createUser();
        const captain = await createCaptain();
        const ride = await createRide({
            user: passenger._id,
            captain: captain._id,
            status: 'accepted',
        });
        const passengerToken = generateAuthToken(passenger);
        const captainToken = generateAuthToken(captain, 'captain');
        const captainSocket = await connectClient();

        captainSocket.emit('join-chat', {
            subjectType: 'ride',
            subjectId: ride._id.toString(),
            rideId: ride._id.toString(),
            token: captainToken,
        });
        await new Promise((resolve) => setTimeout(resolve, 100));

        const receivedPromise = new Promise((resolve) => captainSocket.once('receive-message', resolve));
        const response = await request(app)
            .post('/chat/send')
            .set('Authorization', `Bearer ${passengerToken}`)
            .send({
                subjectType: 'ride',
                subjectId: ride._id.toString(),
                message: 'Estou no local',
                type: 'text',
            })
            .expect(201);

        const received = await receivedPromise;
        expect(received._id.toString()).toBe(response.body._id);
        expect(await messageModel.countDocuments({ subjectId: ride._id })).toBe(1);

        const history = await request(app)
            .get(`/chat/ride/${ride._id}`)
            .set('Authorization', `Bearer ${captainToken}`)
            .expect(200);
        expect(history.body.messages).toHaveLength(1);
        expect(history.body.messages[0].message).toBe('Estou no local');
        expect(history.body.messages[0].recipientType).toBe('captain');

        captainSocket.close();
    });

    it('parcel: PIN offline fica persistido e gera push seguro para o motorista', async () => {
        const passenger = await createUser();
        const captain = await createCaptain();
        const parcel = await createParcel({ user: passenger._id, captain: captain._id });
        const passengerToken = generateAuthToken(passenger);
        const captainToken = generateAuthToken(captain, 'captain');
        await NotificationToken.create({
            captainId: captain._id,
            token: `pin-token-${captain._id}`,
            device: 'test',
        });

        const response = await request(app)
            .post('/chat/send')
            .set('Authorization', `Bearer ${passengerToken}`)
            .send({
                subjectType: 'parcel',
                subjectId: parcel._id.toString(),
                message: 'valor controlado pelo cliente',
                type: 'text',
                operationalType: 'delivery_pin',
            })
            .expect(201);

        expect(response.body.message).toBe('PIN da entrega: 4321');
        expect(response.body.operationalType).toBe('delivery_pin');
        expect(response.body.recipientId).toBe(captain._id.toString());

        const push = await waitFor(() => Notification.findOne({
            captainId: captain._id,
            type: 'CHAT',
        }));
        expect(push).toBeTruthy();
        expect(push.message).toBe('Você recebeu um PIN pelo chat. Abra o app para visualizar.');
        expect(push.action).toBe('/captain-parcel');

        const history = await request(app)
            .get(`/chat/parcel/${parcel._id}`)
            .set('Authorization', `Bearer ${captainToken}`)
            .expect(200);
        expect(history.body.messages).toHaveLength(1);
        expect(history.body.messages[0].message).toBe('PIN da entrega: 4321');
        expect(history.body.messages[0].operationalType).toBe('delivery_pin');
    });
});
