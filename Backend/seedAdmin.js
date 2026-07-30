const mongoose = require('mongoose');
const dotenv = require('dotenv');
const adminUserModel = require('./models/adminUser.model');

dotenv.config();

mongoose.connect(process.env.DB_CONNECT)
    .then(async () => {
        console.log('Connected to DB');

        const email = process.env.ADMIN_EMAIL || 'admin@movecity.com';
        const password = process.env.ADMIN_PASSWORD || 'admin123456';
        const name = 'Admin Master';

        const existingAdmin = await adminUserModel.findOne({ email });

        if (existingAdmin) {
            console.log(`Admin ${email} already exists.`);
        } else {
            await adminUserModel.create({
                name: name,
                email: email,
                password: password,
                role: 'OWNER',
                active: true
            });
            console.log(`Admin ${email} created successfully.`);
        }

        mongoose.connection.close();
    })
    .catch(err => {
        console.error('Error connecting to DB:', err);
        process.exit(1);
    });
