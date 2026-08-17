import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const role = process.argv[2]

const config = {
    driver: {
        androidDir: path.join(frontendDir, 'android'),
        googleServices: path.join(frontendDir, 'android', 'app', 'google-services.json'),
        sync: ['run', 'cap:sync'],
        gradleTask: 'bundlePlayRelease',
        output: path.join('app', 'build', 'outputs', 'bundle', 'playRelease', 'app-play-release.aab'),
        packageId: 'br.com.movecity.driver',
    },
    passenger: {
        androidDir: path.join(frontendDir, 'android-passenger'),
        googleServices: path.join(frontendDir, 'android-passenger', 'app', 'google-services.json'),
        sync: ['run', 'cap:sync:passenger'],
        gradleTask: 'bundleRelease',
        output: path.join('app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab'),
        packageId: 'br.com.movecity.passenger',
    },
}[role]

if (!config) {
    console.error('Uso: node scripts/build-play-bundle.mjs <driver|passenger>')
    process.exit(1)
}

function fail(message) {
    console.error(`[aab:${role}] ${message}`)
    process.exit(1)
}

if (!existsSync(config.googleServices)) {
    fail(`google-services.json ausente para ${config.packageId}; o AAB Play não pode sair sem push nativo`)
}

try {
    const services = JSON.parse(readFileSync(config.googleServices, 'utf8'))
    const packageIds = services.client
        ?.map((client) => client?.client_info?.android_client_info?.package_name)
        .filter(Boolean) || []
    if (!packageIds.includes(config.packageId)) {
        fail(`google-services.json não contém o package ${config.packageId}`)
    }
} catch (error) {
    fail(`google-services.json inválido: ${error.message}`)
}

if (!existsSync(path.join(config.androidDir, 'keystore.properties'))) {
    fail('keystore.properties ausente; configure a upload key antes de gerar o AAB')
}

function run(command, args, cwd, env = process.env) {
    const result = spawnSync(command, args, {
        cwd,
        env,
        stdio: 'inherit',
        shell: process.platform === 'win32',
    })
    if (result.error) throw result.error
    if (result.status !== 0) process.exit(result.status ?? 1)
}

function findAabs(directory) {
    if (!existsSync(directory)) return []

    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const entryPath = path.join(directory, entry.name)
        if (entry.isDirectory()) return findAabs(entryPath)
        return entry.isFile() && entry.name.endsWith('.aab') ? [entryPath] : []
    })
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
// Caminho absoluto no Windows: com shell:true, spawnSync não honra `cwd` na
// resolução do próprio comando (só nos args/execução) — um nome relativo
// como 'gradlew.bat' falha com "não é reconhecido" mesmo estando em cwd.
const gradle = process.platform === 'win32'
    ? path.join(config.androidDir, 'gradlew.bat')
    : 'bash'
const releaseEnv = {
    ...process.env,
    CI_REQUIRE_RELEASE_SIGNING: 'true',
    GRADLE_USER_HOME: process.env.GRADLE_USER_HOME
        || path.join(os.tmpdir(), 'movecity-play-gradle'),
    VITE_DISTRIBUTION_CHANNEL: 'play',
}

if (role === 'passenger') {
    run(
        process.execPath,
        ['scripts/ci/check-passenger-google-auth-config.mjs'],
        frontendDir,
        releaseEnv,
    )
}

console.log(`[aab:${role}] sincronizando web + Capacitor`)
run(npm, config.sync, frontendDir, releaseEnv)

console.log(`[aab:${role}] executando ${config.gradleTask}`)
run(
    gradle,
    process.platform === 'win32'
        ? [config.gradleTask, '--no-daemon', '--stacktrace']
        : ['gradlew', config.gradleTask, '--no-daemon', '--stacktrace'],
    config.androidDir,
    releaseEnv,
)

const output = path.join(config.androidDir, config.output)
if (!existsSync(output)) {
    const bundleRoot = path.join(config.androidDir, 'app', 'build', 'outputs', 'bundle')
    const generatedAabs = findAabs(bundleRoot)

    if (generatedAabs.length !== 1) {
        const found = generatedAabs.length
            ? generatedAabs.map((file) => path.relative(config.androidDir, file)).join(', ')
            : 'nenhum'
        fail(`AAB esperado não encontrado em ${output}; encontrados: ${found}`)
    }

    mkdirSync(path.dirname(output), { recursive: true })
    copyFileSync(generatedAabs[0], output)
    console.log(
        `[aab:${role}] saída normalizada: ${path.relative(config.androidDir, generatedAabs[0])}`
        + ` -> ${path.relative(config.androidDir, output)}`,
    )
}
console.log(`[aab:${role}] OK -> ${output}`)
