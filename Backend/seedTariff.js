const mongoose = require('mongoose');
require('dotenv').config();

const TariffSetting = require('./models/tariffSetting.model');
const VehicleCategory = require('./models/vehicleCategory.model');
const GlobalSetting = require('./models/globalSetting.model');
const PricingRule = require('./models/pricingRule.model');

async function seed() {
    try {
        await mongoose.connect(process.env.DB_CONNECT || 'mongodb://localhost:27017/uber', {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log("Connected to DB for Seeding Tariff Engine");

        // 1. TariffSetting
        const tsCount = await TariffSetting.countDocuments();
        if (tsCount === 0) {
            await TariffSetting.create({
                minDistanceIncluded: 0,
                minTimeIncluded: 0,
                maxFreeWaitTime: 300,
                perMinuteWaitFee: 0.50,
                cancellationFee: 5.00,
                roundingRule: 'none',
                showAsEstimate: true,
                dynamicPricingStatus: 'off'
            });
            console.log("TariffSetting created");
        }

        // 2. VehicleCategories (car, moto, auto)
        // iconKey precisa ser explícito: o schema tem default 'car', então omitir aqui
        // fazia TODAS as categorias serem gravadas com ícone de carro — a "Moto Rápida"
        // aparecia com desenho de carro na tela de escolha de veículo do passageiro.
        // 'auto' nasce inativa: o TukTuk não faz parte da frota (pode ser reativado pelo
        // painel admin, aba Tarifas, se um dia entrar).
        const categories = [
            { name: 'car', displayName: 'Carro Econômico', iconKey: 'car', baseFare: 50, perKmRate: 15, perMinuteRate: 3, minFare: 20 },
            { name: 'moto', displayName: 'Moto Rápida', iconKey: 'moto', baseFare: 20, perKmRate: 8, perMinuteRate: 1.5, minFare: 10 },
            { name: 'auto', displayName: 'TukTuk (Auto)', iconKey: 'auto', baseFare: 30, perKmRate: 10, perMinuteRate: 2, minFare: 15, isActive: false }
        ];

        for (const cat of categories) {
            const exists = await VehicleCategory.findOne({ name: cat.name });
            if (!exists) {
                await VehicleCategory.create(cat);
                console.log(`VehicleCategory '${cat.name}' created`);
            }
        }

        // 3. GlobalSettings (ensure it exists)
        const gsCount = await GlobalSetting.countDocuments();
        if (gsCount === 0) {
            await GlobalSetting.create({
                platformCommission: 20,
                cardFeePercent: 1.99,
                cardFeeFixed: 0.50
            });
            console.log("GlobalSetting created");
        }
        
        // 4. Sample PricingRule (Chuva)
        const prCount = await PricingRule.countDocuments({ name: 'Taxa de Chuva' });
        if (prCount === 0) {
            await PricingRule.create({
                name: 'Taxa de Chuva',
                type: 'weather',
                modificationType: 'percentage',
                value: 20, // +20%
                priority: 1,
                isActive: false // Deixar inativa por padrão
            });
            console.log("PricingRule 'Taxa de Chuva' created");
        }

        console.log("Seeding complete!");
        process.exit(0);

    } catch (e) {
        console.error("Erro no seed:", e);
        process.exit(1);
    }
}

seed();
