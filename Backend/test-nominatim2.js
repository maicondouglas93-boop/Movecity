const axios = require('axios');
async function run() {
    try {
        const lat = -20.1596;
        const lng = -41.6237;
        const viewbox = `${lng - 0.5},${lat + 0.5},${lng + 0.5},${lat - 0.5}`;
        const url = `https://nominatim.openstreetmap.org/search?q=travessa+benedito&format=json&limit=15&viewbox=${viewbox}&bounded=0&countrycodes=br`;
        const response = await axios.get(url, { headers: { 'User-Agent': 'UberCloneApp' } });
        console.log(response.data.map(f => f.display_name).join('\n\n'));
    } catch (e) {
        console.error(e.message);
    }
}
run();
