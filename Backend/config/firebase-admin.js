const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const serviceAccountPath = path.join(__dirname, 'firebase-service-account.json');

if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({
        credential: admin.cert(serviceAccount),
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'movecity-12a8d.firebasestorage.app'
    });
    console.log('Firebase Admin SDK inicializado.');
} else {
    console.warn('AVISO: Arquivo firebase-service-account.json não encontrado. Firebase Admin não foi inicializado. Por favor, crie este arquivo na pasta config/.');
}

module.exports = admin;
