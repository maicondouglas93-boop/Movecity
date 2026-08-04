const cloudinary = require('cloudinary').v2;

// Migração de Firebase Storage para Cloudinary (2026-08-03): confirmado empiricamente
// (upload real contra o projeto de produção, credenciais reais) que o bucket do
// Firebase Storage nunca existiu — "404 The specified bucket does not exist". No plano
// Spark (gratuito) o Storage não provisiona bucket padrão sozinho, só no Blaze (pago).
// Cloudinary tem plano gratuito com bucket/conta prontos na hora, sem esse problema.
if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
    cloudinary.config({
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
        secure: true,
    });
    console.log('Cloudinary configurado.');
} else {
    console.warn('AVISO: Credenciais do Cloudinary não encontradas (CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET). Upload de imagens não vai funcionar.');
}

module.exports = cloudinary;
