const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');
const dns = require('dns');

try {
    dns.setServers(['8.8.8.8', '8.8.4.4']);
} catch (err) {
    console.warn('DNS setServers failed:', err.message);
}

dotenv.config();

const userSchema = new mongoose.Schema({
    fullname: {
        firstname: { type: String, required: true },
        lastname: { type: String }
    },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true }
});

const captainSchema = new mongoose.Schema({
    fullname: {
        firstname: { type: String, required: true },
        lastname: { type: String }
    },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    vehicle: {
        color: { type: String, required: true },
        plate: { type: String, required: true },
        capacity: { type: Number, required: true },
        vehicleType: { type: String, required: true }
    }
});

const userModel = mongoose.models.user || mongoose.model('user', userSchema);
const captainModel = mongoose.models.captain || mongoose.model('captain', captainSchema);

async function run() {
    try {
        await mongoose.connect(process.env.DB_CONNECT);
        console.log('Connected to Database');

        const testUserEmail = 'user@test.com';
        const testCaptainEmail = 'captain@test.com';
        const exampleUserEmail = 'user@example.com';
        const exampleCaptainEmail = 'captain@example.com';
        const rawPassword = 'password123';
        const hashedPassword = await bcrypt.hash(rawPassword, 10);

        // Seed User (test)
        const existingUser = await userModel.findOne({ email: testUserEmail });
        if (!existingUser) {
            await userModel.create({
                fullname: { firstname: 'John', lastname: 'Doe' },
                email: testUserEmail,
                password: hashedPassword
            });
            console.log(`Created User: ${testUserEmail}`);
        } else {
            existingUser.password = hashedPassword;
            await existingUser.save();
            console.log(`Updated password for existing User: ${testUserEmail}`);
        }

        // Seed User (example)
        const existingExampleUser = await userModel.findOne({ email: exampleUserEmail });
        if (!existingExampleUser) {
            await userModel.create({
                fullname: { firstname: 'John', lastname: 'Example' },
                email: exampleUserEmail,
                password: hashedPassword
            });
            console.log(`Created User: ${exampleUserEmail}`);
        } else {
            existingExampleUser.password = hashedPassword;
            await existingExampleUser.save();
            console.log(`Updated password for existing User: ${exampleUserEmail}`);
        }

        // Seed Captain (Car - test)
        const existingCaptain = await captainModel.findOne({ email: testCaptainEmail });
        if (!existingCaptain) {
            await captainModel.create({
                fullname: { firstname: 'Captain', lastname: 'Car' },
                email: testCaptainEmail,
                password: hashedPassword,
                vehicle: {
                    color: 'White',
                    plate: 'MH-12-CAR-1111',
                    capacity: 4,
                    vehicleType: 'car'
                }
            });
            console.log(`Created Captain (Car): ${testCaptainEmail}`);
        } else {
            existingCaptain.password = hashedPassword;
            existingCaptain.vehicle = {
                color: 'White',
                plate: 'MH-12-CAR-1111',
                capacity: 4,
                vehicleType: 'car'
            };
            await existingCaptain.save();
            console.log(`Updated password and vehicle for existing Captain: ${testCaptainEmail}`);
        }

        // Seed Captain (Car - example)
        const existingExampleCaptain = await captainModel.findOne({ email: exampleCaptainEmail });
        if (!existingExampleCaptain) {
            await captainModel.create({
                fullname: { firstname: 'Captain', lastname: 'ExampleCar' },
                email: exampleCaptainEmail,
                password: hashedPassword,
                vehicle: {
                    color: 'Black',
                    plate: 'MH-12-CAR-2222',
                    capacity: 4,
                    vehicleType: 'car'
                }
            });
            console.log(`Created Captain (Car): ${exampleCaptainEmail}`);
        } else {
            existingExampleCaptain.password = hashedPassword;
            existingExampleCaptain.vehicle = {
                color: 'Black',
                plate: 'MH-12-CAR-2222',
                capacity: 4,
                vehicleType: 'car'
            };
            await existingExampleCaptain.save();
            console.log(`Updated password and vehicle for existing Captain: ${exampleCaptainEmail}`);
        }

        // Seed Captain (Auto)
        const autoCaptainEmail = 'captain-auto@example.com';
        const existingAutoCaptain = await captainModel.findOne({ email: autoCaptainEmail });
        if (!existingAutoCaptain) {
            await captainModel.create({
                fullname: { firstname: 'Captain', lastname: 'Auto' },
                email: autoCaptainEmail,
                password: hashedPassword,
                vehicle: {
                    color: 'Yellow',
                    plate: 'MH-12-AUTO-3333',
                    capacity: 3,
                    vehicleType: 'auto'
                }
            });
            console.log(`Created Captain (Auto): ${autoCaptainEmail}`);
        } else {
            existingAutoCaptain.password = hashedPassword;
            existingAutoCaptain.vehicle = {
                color: 'Yellow',
                plate: 'MH-12-AUTO-3333',
                capacity: 3,
                vehicleType: 'auto'
            };
            await existingAutoCaptain.save();
            console.log(`Updated password and vehicle for existing Captain (Auto): ${autoCaptainEmail}`);
        }

        // Seed Captain (Moto)
        const motoCaptainEmail = 'captain-moto@example.com';
        const existingMotoCaptain = await captainModel.findOne({ email: motoCaptainEmail });
        if (!existingMotoCaptain) {
            await captainModel.create({
                fullname: { firstname: 'Captain', lastname: 'Moto' },
                email: motoCaptainEmail,
                password: hashedPassword,
                vehicle: {
                    color: 'Red',
                    plate: 'MH-12-MOTO-4444',
                    capacity: 1,
                    vehicleType: 'moto'
                }
            });
            console.log(`Created Captain (Moto): ${motoCaptainEmail}`);
        } else {
            existingMotoCaptain.password = hashedPassword;
            existingMotoCaptain.vehicle = {
                color: 'Red',
                plate: 'MH-12-MOTO-4444',
                capacity: 1,
                vehicleType: 'moto'
            };
            await existingMotoCaptain.save();
            console.log(`Updated password and vehicle for existing Captain (Moto): ${motoCaptainEmail}`);
        }

        console.log('\n======================================');
        console.log('TEST CREDENTIALS REGISTERED SUCCESSFULLY');
        console.log('======================================');
        console.log(`Passenger Emails : ${testUserEmail} , ${exampleUserEmail}`);
        console.log(`Captain (Car)    : ${testCaptainEmail} , ${exampleCaptainEmail}`);
        console.log(`Captain (Auto)   : ${autoCaptainEmail}`);
        console.log(`Captain (Moto)   : ${motoCaptainEmail}`);
        console.log(`Password         : ${rawPassword}`);
        console.log('======================================\n');

        process.exit(0);
    } catch (err) {
        console.error('Error seeding database:', err);
        process.exit(1);
    }
}

run();
