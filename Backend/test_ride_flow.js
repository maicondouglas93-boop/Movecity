const axios = require('axios');
const io = require('socket.io-client');
const dns = require('dns');

// Set DNS to Google resolver to bypass local connection errors
dns.setServers(['8.8.8.8', '8.8.4.4']);

const BASE_URL = 'https://uber-demo-backend.onrender.com';

async function runTest() {
    console.log('--- STARTING END-TO-END RIDE FLOW TEST ---');

    try {
        // 1. Log in passenger
        console.log('Logging in passenger...');
        const passengerLogin = await axios.post(`${BASE_URL}/users/login`, {
            email: 'user@example.com',
            password: 'password123'
        });
        const passengerToken = passengerLogin.data.token;
        const passengerId = passengerLogin.data.user._id;
        console.log('Passenger logged in successfully. ID:', passengerId);

        // 2. Log in captain
        console.log('Logging in captain...');
        const captainLogin = await axios.post(`${BASE_URL}/captains/login`, {
            email: 'captain@example.com',
            password: 'password123'
        });
        const captainToken = captainLogin.data.token;
        const captainId = captainLogin.data.captain._id;
        console.log('Captain logged in successfully. ID:', captainId);

        // 3. Connect captain socket
        console.log('Connecting captain socket...');
        const captainSocket = io(BASE_URL, {
            transports: ['websocket']
        });

        await new Promise((resolve) => {
            captainSocket.on('connect', () => {
                console.log('Captain socket connected! Emitting join...');
                captainSocket.emit('join', { userType: 'captain', userId: captainId });
                resolve();
            });
        });

        // 4. Connect passenger socket
        console.log('Connecting passenger socket...');
        const passengerSocket = io(BASE_URL, {
            transports: ['websocket']
        });

        await new Promise((resolve) => {
            passengerSocket.on('connect', () => {
                console.log('Passenger socket connected! Emitting join...');
                passengerSocket.emit('join', { userType: 'user', userId: passengerId });
                resolve();
            });
        });

        // Setup passenger ride confirmed listener
        let confirmedRideOtp = null;
        passengerSocket.on('ride-confirmed', (data) => {
            console.log('Passenger Socket Event: ride-confirmed received! OTP is:', data.otp);
            confirmedRideOtp = data.otp;
        });

        passengerSocket.on('ride-started', (data) => {
            console.log('Passenger Socket Event: ride-started received! Status is:', data.status);
        });

        // 5. Create ride (Passenger)
        console.log('Booking ride from Hazaribagh to Ranchi...');
        const createRideRes = await axios.post(`${BASE_URL}/rides/create`, {
            pickup: 'Hazaribagh',
            destination: 'Ranchi',
            vehicleType: 'car'
        }, {
            headers: { Authorization: `Bearer ${passengerToken}` }
        });

        const ride = createRideRes.data;
        const rideId = ride._id;
        console.log('Ride created successfully! Ride ID:', rideId);
        console.log('Ride OTP returned in creation response:', ride.otp);

        // Wait for captain to receive new-ride socket notification
        console.log('Waiting for captain to receive socket event...');
        const receivedRide = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Captain did not receive new-ride event')), 10000);
            captainSocket.on('new-ride', (data) => {
                clearTimeout(timeout);
                console.log('Captain Socket Event: new-ride received!');
                console.log('Ride details sent to Captain (OTP should be hidden/undefined):', data.otp);
                resolve(data);
            });
        });

        // 6. Confirm/accept ride (Captain)
        console.log('Captain accepting/confirming ride...');
        const confirmRideRes = await axios.post(`${BASE_URL}/rides/confirm`, {
            rideId: rideId
        }, {
            headers: { Authorization: `Bearer ${captainToken}` }
        });

        console.log('Ride accepted! Confirm response (OTP should be hidden/undefined):', confirmRideRes.data.otp);

        // Wait a short moment to allow the socket events to propagate
        await new Promise(r => setTimeout(r, 2000));

        if (!confirmedRideOtp) {
            throw new Error('Passenger did not receive the OTP via ride-confirmed socket event');
        }

        // 7. Start ride (Captain)
        console.log(`Captain starting the ride with verified OTP: ${confirmedRideOtp}...`);
        const startRideRes = await axios.get(`${BASE_URL}/rides/start-ride`, {
            params: {
                rideId: rideId,
                otp: confirmedRideOtp
            },
            headers: { Authorization: `Bearer ${captainToken}` }
        });

        console.log('Ride started successfully! Status:', startRideRes.data.status);

        // 8. End ride (Captain)
        console.log('Captain ending the ride...');
        const endRideRes = await axios.post(`${BASE_URL}/rides/end-ride`, {
            rideId: rideId
        }, {
            headers: { Authorization: `Bearer ${captainToken}` }
        });

        console.log('Ride ended successfully! Status:', endRideRes.data.status);

        console.log('--- TEST COMPLETED SUCCESSFULLY ---');
        cleanup();
    } catch (error) {
        console.error('Test Failed:', error.response?.data || error.message);
        cleanup();
        process.exit(1);
    }

    function cleanup() {
        process.exit(0);
    }
}

runTest();
