require('dotenv').config();
const mapService = require('./services/maps.service');

async function run() {
    try {
        console.log("=== Sem Localização (Padrão) ===");
        let res = await mapService.getAutoCompleteSuggestions("Avenida");
        console.log(res);

        console.log("\n=== Com Localização (Ex: Lajinha-MG lat:-20.1581, lng:-41.6201) ===");
        let res2 = await mapService.getAutoCompleteSuggestions("Avenida", -20.1581, -41.6201);
        console.log(res2);
    } catch (err) {
        console.error(err.message);
    }
}
run();
