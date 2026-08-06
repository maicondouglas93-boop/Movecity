// Fonte única das origens permitidas — REST (app.js) e Socket.IO (socket.js).
//
// Auditoria de integração (2026-08-06): as duas listas eram escritas à mão em
// arquivos separados e divergiram. O Socket só aceitava localhost:5173 e
// FRONTEND_URL, então o WebView do APK passava no REST e era barrado no
// handshake do Socket — sem socket o motorista não envia GPS nem recebe oferta.
//
// O APK aparece com origem `https://localhost` (androidScheme: https) ou
// `http://localhost` em builds antigos; os dois ficam na lista para que a troca
// de esquema não derrube a conexão de quem ainda não atualizou o app.
const rawOrigins = [
    'http://localhost:5173',
    'http://localhost:5174',
    'https://localhost',
    'http://localhost',
    'capacitor://localhost',
    'ionic://localhost',
    process.env.FRONTEND_URL,
    process.env.ADMIN_FRONTEND_URL,
    process.env.CAPACITOR_ORIGIN,
];

const stripTrailingSlash = (url) => String(url).replace(/\/+$/, '');

const allowedOrigins = rawOrigins.filter(Boolean).map(stripTrailingSlash);

/**
 * Origem ausente = cliente não-browser (curl, health check, WebView sem Origin).
 * CORS nunca foi a camada de autenticação aqui: REST exige JWT no middleware e o
 * Socket exige JWT no evento `join` antes de aceitar qualquer dado.
 */
function isOriginAllowed(origin) {
    if (!origin) return true;
    return allowedOrigins.includes(stripTrailingSlash(origin));
}

function corsOriginCallback(origin, callback) {
    if (isOriginAllowed(origin)) {
        callback(null, true);
        return;
    }
    callback(new Error('Não permitido pelo CORS'));
}

module.exports = { allowedOrigins, isOriginAllowed, corsOriginCallback };
