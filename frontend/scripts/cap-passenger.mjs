import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const passengerConfigDir = path.join(frontendDir, 'capacitor-passenger')
const capacitorCli = path.join(frontendDir, 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor')
const args = process.argv.slice(2)

if (args.length === 0) {
    console.error('Informe um comando do Capacitor, por exemplo: sync android')
    process.exit(1)
}

const result = spawnSync(process.execPath, [capacitorCli, ...args], {
    cwd: passengerConfigDir,
    env: process.env,
    stdio: 'inherit',
})

if (result.error) throw result.error
process.exit(result.status ?? 1)
