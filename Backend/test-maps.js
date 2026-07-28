require('dotenv').config();
const mongoose = require('mongoose');
const mapService = require('./services/maps.service');

async function run() {
    try {
        console.log(await mapService.getAddressCoordinate("Rua Exemplo, Centro (-20.1573, -41.6207)"));
        console.log(await mapService.getAddressCoordinate("-20.1581, -41.6201"));
        console.log(await mapService.getAddressCoordinate("rua orland Station, Mumbai"));
        
        console.log(await mapService.getDistanceTime("-20.1581, -41.6201", "rua orland Station, Mumbai"));
    } catch (err) {
        console.error(err);
    }
}
run();
