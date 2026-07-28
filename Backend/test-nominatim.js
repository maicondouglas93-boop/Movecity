const axios = require('axios');
async function run() {
    try {
        const response = await axios.get("https://nominatim.openstreetmap.org/search?q=Avenida&format=json&limit=5", {
            headers: { 'User-Agent': 'UberCloneApp' },
            timeout: 5000
        });
        console.log(response.data);
    } catch (e) {
        console.error(e.message);
    }
}
run();
