const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

const serviceAccountPath = path.join(__dirname, 'firebase-service-account.json');

let serviceAccount = null;

if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
    serviceAccount = {
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    };
    console.log('Firebase credentials carregadas via variáveis de ambiente (Produção).');
} else if (fs.existsSync(serviceAccountPath)) {
    serviceAccount = require(serviceAccountPath);
    console.log('Firebase credentials carregadas via arquivo JSON (Desenvolvimento).');
}

if (serviceAccount) {
    admin.initializeApp({
        credential: admin.cert(serviceAccount),
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'movecity-12a8d.firebasestorage.app'
    });
    console.log('Firebase Admin SDK inicializado.');
} else {
    console.warn('AVISO: Credenciais do Firebase não encontradas. Firebase Admin não foi inicializado.');
}

module.exports = admin;
