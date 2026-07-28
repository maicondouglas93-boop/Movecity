const mongoose = require('mongoose');
const dotenv = require('dotenv');
const dns = require('dns');

try {
    dns.setServers(['8.8.8.8', '8.8.4.4']);
} catch (err) {
    console.warn('DNS setServers failed:', err.message);
}

dotenv.config();

async function run() {
    try {
        await mongoose.connect(process.env.DB_CONNECT);
        console.log('Connected to Database');

        // Clear all stale socketId fields in User and Captain collections
        const userRes = await mongoose.connection.collection('users').updateMany(
            { socketId: { $exists: true } },
            { $set: { socketId: null } }
        );
        console.log(`Cleared socket IDs for ${userRes.modifiedCount} users.`);

        const captainRes = await mongoose.connection.collection('captains').updateMany(
            { socketId: { $exists: true } },
            { $set: { socketId: null } }
        );
        console.log(`Cleared socket IDs for ${captainRes.modifiedCount} captains.`);

        console.log('\nStale socket database cleanup completed successfully.');
        process.exit(0);
    } catch (err) {
        console.error('Error clearing stale sockets:', err);
        process.exit(1);
    }
}

run();
