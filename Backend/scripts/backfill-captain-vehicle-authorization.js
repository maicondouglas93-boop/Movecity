const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const Captain = require('../models/captain.model');
const VehicleCategory = require('../models/vehicleCategory.model');
const {
    VALID_VEHICLE_AUTHORIZATIONS,
    vehicleFamilyFromCategory,
} = require('../services/vehicleAuthorization.service');

async function migrate() {
    try {
        const dbUri = process.env.DB_CONNECT;
        if (!dbUri) throw new Error('DB_CONNECT não encontrado no .env');

        console.log('Conectando ao banco de dados...');
        await mongoose.connect(dbUri);

        const [categories, captains] = await Promise.all([
            VehicleCategory.find({}).select('name iconKey').lean(),
            Captain.find({ vehicleAuthorization: { $nin: VALID_VEHICLE_AUTHORIZATIONS } })
                .select('_id vehicle.vehicleType')
                .lean(),
        ]);
        const categoryByName = new Map(categories.map((category) => [category.name, category]));

        const operations = [];
        const unresolved = [];
        for (const captain of captains) {
            const currentType = captain.vehicle?.vehicleType;
            const authorization = vehicleFamilyFromCategory(categoryByName.get(currentType) || currentType);
            if (!authorization) {
                unresolved.push({ captainId: String(captain._id), vehicleType: currentType || null });
                continue;
            }
            operations.push({
                updateOne: {
                    filter: {
                        _id: captain._id,
                        vehicleAuthorization: { $nin: VALID_VEHICLE_AUTHORIZATIONS },
                    },
                    update: { $set: { vehicleAuthorization: authorization } },
                },
            });
        }

        const result = operations.length
            ? await Captain.bulkWrite(operations, { ordered: false })
            : { modifiedCount: 0 };

        console.log(`Motoristas analisados: ${captains.length}`);
        console.log(`Motoristas atualizados: ${result.modifiedCount || 0}`);
        console.log(`Motoristas que exigem definição manual no ADM: ${unresolved.length}`);
        unresolved.forEach((item) => console.log(`- ${item.captainId}: categoria ${item.vehicleType || 'não informada'}`));
        console.log('Migração concluída. Uma segunda execução não altera registros já preenchidos.');
    } catch (error) {
        console.error('Erro na migração:', error);
        process.exitCode = 1;
    } finally {
        await mongoose.disconnect();
    }
}

migrate();
