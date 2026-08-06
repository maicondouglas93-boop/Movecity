const mongoose = require('mongoose');
require('dotenv').config(); // Load .env
const VehicleCategory = require('../models/vehicleCategory.model');
const TariffSetting = require('../models/tariffSetting.model');

// Replace this with your actual MongoDB URI if not using .env
const MONGODB_URI = process.env.DB_CONNECT || process.env.MONGODB_URI || 'mongodb://localhost:27017/movecity';

async function runMigration() {
    console.log('--- Início da Migração de Preços (VehicleCategory) ---');
    try {
        await mongoose.connect(MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('Conectado ao MongoDB.');

        const globalTariff = await TariffSetting.findOne();
        
        let globalOptionals = [];
        let globalPlatformCommission = 20;

        if (globalTariff) {
            console.log('Tabela TariffSetting Global encontrada. Extraindo regras legadas...');
            globalPlatformCommission = globalTariff.platformCommission ?? 20;
            
            // Map legacy optionals
            if (globalTariff.optionalPrices) {
                for (const [key, value] of Object.entries(globalTariff.optionalPrices)) {
                    if (typeof value === 'number') {
                        // Converter nome da chave para um nome amigável simples
                        const name = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                        globalOptionals.push({
                            id: key,
                            name: name,
                            value: value,
                            isActive: true
                        });
                    }
                }
            }
        } else {
            console.log('Aviso: TariffSetting Global não encontrado. Valores padrão serão usados.');
        }

        const categories = await VehicleCategory.find();
        console.log(`Encontradas ${categories.length} categorias de veículos.`);

        for (const cat of categories) {
            console.log(`Migrando categoria: ${cat.displayName} (${cat.name})...`);
            
            // Construir o novo objeto pricing com base nos valores legados da categoria e do TariffSetting
            const newPricing = {
                baseFare: cat.baseFare || 5.0,
                perKm: cat.perKmRate || 2.0,
                perMinute: cat.perMinuteRate || 0.5,
                minimumFare: cat.minFare || 7.0,
                platformCommission: globalPlatformCommission,
                surcharges: {
                    night: { active: false, type: 'multiplier', value: 1.2, startTime: '22:00', endTime: '06:00' },
                    waiting: { active: true, freeMinutes: 5, valuePerMinute: 0.5 },
                    extraStops: { active: false, valuePerStop: 3.0 },
                    cancellation: { active: true, value: 5.0 }
                },
                optionals: [...globalOptionals] // Copia os opcionais extraídos
            };

            // Atualiza a categoria com o novo objeto pricing
            cat.pricing = newPricing;
            await cat.save();
            console.log(`  -> Categoria ${cat.name} atualizada com sucesso.`);
        }

        console.log('--- Migração concluída com sucesso! ---');

    } catch (err) {
        console.error('Erro na migração:', err);
    } finally {
        await mongoose.disconnect();
        console.log('Desconectado do MongoDB.');
    }
}

runMigration();
