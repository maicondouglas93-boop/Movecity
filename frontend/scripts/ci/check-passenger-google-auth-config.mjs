import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const configPath = path.join(frontendDir, 'android-passenger', 'app', 'google-services.json')
const packageId = 'br.com.movecity.passenger'

function fail(message) {
  console.error(`[passenger-google-auth] ${message}`)
  process.exit(1)
}

let services
try {
  services = JSON.parse(readFileSync(configPath, 'utf8'))
} catch (error) {
  fail(`google-services.json ausente ou inválido: ${error.message}`)
}

const clients = services.client?.filter(
  (client) => client?.client_info?.android_client_info?.package_name === packageId,
) || []
const oauthClients = clients.flatMap((client) => client.oauth_client || [])

if (!oauthClients.some((client) => client.client_type === 3)) {
  fail('falta o cliente OAuth Web usado para gerar o Firebase ID token')
}

if (!oauthClients.some((client) => (
  client.client_type === 1
  && client.android_info?.package_name === packageId
  && client.android_info?.certificate_hash
))) {
  fail(
    'falta o cliente OAuth Android com SHA-1. Cadastre no Firebase o SHA-1 da chave de assinatura do app da Play e atualize PASSENGER_GOOGLE_SERVICES_JSON_BASE64.',
  )
}

console.log('[passenger-google-auth] OAuth Web + Android/SHA-1 configurados.')
