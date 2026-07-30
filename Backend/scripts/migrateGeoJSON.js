const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

// Carrega as variáveis de ambiente corretas
dotenv.config({ path: path.join(__dirname, '../.env') });

const captainModel = require('../models/captain.model');

async function migrate() {
    try {
        console.log("Conectando ao banco de dados...");
        const dbUri = process.env.DB_CONNECT;
        if (!dbUri) throw new Error("DB_CONNECT não encontrado no .env");

        await mongoose.connect(dbUri);
        console.log("Conectado! Iniciando migração de GeoJSON...");

        // Busca todos os motoristas
        const captains = await captainModel.find({});
        console.log(`Encontrados ${captains.length} motoristas para verificar.`);

        let updated = 0;

        for (const captain of captains) {
            // Verifica se tem location mas o geoJSON ainda está vazio ou default [0,0]
            if (captain.location && captain.location.ltd && captain.location.lng) {
                const geoJSON = captain.locationGeoJSON;
                if (!geoJSON || !geoJSON.coordinates || (geoJSON.coordinates[0] === 0 && geoJSON.coordinates[1] === 0)) {
                    captain.locationGeoJSON = {
                        type: 'Point',
                        coordinates: [captain.location.lng, captain.location.ltd]
                    };
                    await captain.save();
                    updated++;
                }
            }
        }

        console.log(`Migração concluída com sucesso! Motoristas atualizados: ${updated}`);
    } catch (error) {
        console.error("Erro na migração:", error);
    } finally {
        await mongoose.disconnect();
        console.log("Desconectado.");
        process.exit(0);
    }
}

migrate();
