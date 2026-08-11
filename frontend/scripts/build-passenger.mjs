import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const viteCli = path.join(frontendDir, 'node_modules', 'vite', 'bin', 'vite.js')
const firebaseConfig = path.join(
    frontendDir,
    'android-passenger',
    'app',
    'google-services.json'
)
const nativePushEnabled = existsSync(firebaseConfig)

console.log(
    nativePushEnabled
        ? '[passenger] Firebase Android encontrado: push nativo habilitado.'
        : '[passenger] google-services.json ausente: push nativo desabilitado neste build.'
)

const result = spawnSync(process.execPath, [viteCli, 'build', '--mode', 'passenger'], {
    cwd: frontendDir,
    env: {
        ...process.env,
        // Variáveis do processo têm precedência sobre arquivos .env do Vite.
        VITE_NATIVE_PUSH_ENABLED: nativePushEnabled ? 'true' : 'false',
    },
    stdio: 'inherit',
})

if (result.error) throw result.error
process.exit(result.status ?? 1)
