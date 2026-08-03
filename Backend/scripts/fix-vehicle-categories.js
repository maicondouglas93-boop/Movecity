const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

// Carrega as variáveis de ambiente corretas
dotenv.config({ path: path.join(__dirname, '../.env') });

const VehicleCategory = require('../models/vehicleCategory.model');

// Corrige categorias já gravadas antes do seedTariff.js passar a definir `iconKey`
// explicitamente. O schema tem default 'car', então 'moto' e 'auto' ficaram gravadas
// com ícone de carro. Também desativa 'auto' (TukTuk), que não faz parte da frota.
// Idempotente: rodar de novo depois de já corrigido não altera nada.
const FIXES = {
    moto: { iconKey: 'moto' },
    auto: { iconKey: 'auto', isActive: false }
};

async function migrate() {
    try {
        console.log("Conectando ao banco de dados...");
        const dbUri = process.env.DB_CONNECT;
        if (!dbUri) throw new Error("DB_CONNECT não encontrado no .env");

        await mongoose.connect(dbUri);
        console.log("Conectado! Corrigindo categorias de veículo...");

        let updated = 0;

        for (const [name, fix] of Object.entries(FIXES)) {
            const category = await VehicleCategory.findOne({ name });
            if (!category) {
                console.log(`Categoria '${name}' não encontrada, pulando.`);
                continue;
            }

            const needsUpdate = Object.entries(fix).some(([key, value]) => category[key] !== value);
            if (needsUpdate) {
                Object.assign(category, fix);
                await category.save();
                updated++;
                console.log(`Categoria '${name}' corrigida:`, fix);
            } else {
                console.log(`Categoria '${name}' já estava correta.`);
            }
        }

        console.log(`Migração concluída com sucesso! Categorias atualizadas: ${updated}`);
    } catch (error) {
        console.error("Erro na migração:", error);
    } finally {
        await mongoose.disconnect();
        console.log("Desconectado.");
        process.exit(0);
    }
}

migrate();
