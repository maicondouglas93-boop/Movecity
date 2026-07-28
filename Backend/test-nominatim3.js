const axios = require('axios');
async function run() {
    try {
        const lat = -20.1596;
        const lng = -41.6237;
        
        const fetchResults = async (bounded) => {
            const viewbox = `${lng - 0.5},${lat + 0.5},${lng + 0.5},${lat - 0.5}`;
            const url = `https://nominatim.openstreetmap.org/search?q=Avenida&format=json&limit=15&viewbox=${viewbox}&bounded=${bounded}&countrycodes=br`;
            const response = await axios.get(url, { headers: { 'User-Agent': 'UberCloneApp' } });
            return response.data;
        };

        console.log("BOUNDED = 1");
        const b1 = await fetchResults(1);
        console.log(b1.map(f => f.display_name).join('\n'));

    } catch (e) {
        console.error(e.message);
    }
}
run();
