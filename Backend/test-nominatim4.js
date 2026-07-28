const axios = require('axios');
async function run() {
    try {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent('Travessa Benedito Pinel 50')}&format=json&limit=5&addressdetails=1`;
        const response = await axios.get(url, { headers: { 'User-Agent': 'UberCloneApp' } });
        console.log(response.data.map(f => f.display_name).join('\n'));
    } catch (e) {
        console.error(e.message);
    }
}
run();
