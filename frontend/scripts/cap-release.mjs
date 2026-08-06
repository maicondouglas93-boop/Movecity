import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const frontendRoot = path.resolve(__dirname, '..')
const androidDir = path.join(frontendRoot, 'android')
const isWin = process.platform === 'win32'
const gradlew = path.join(androidDir, isWin ? 'gradlew.bat' : 'gradlew')

function run(command, args, cwd) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd,
            stdio: 'inherit',
            shell: isWin,
        })
        child.on('exit', (code) => {
            if (code === 0) resolve()
            else reject(new Error(`${command} exited ${code}`))
        })
    })
}

async function main() {
    console.log('[cap:release] build:driver + cap sync…')
    await run(isWin ? 'npm.cmd' : 'npm', ['run', 'cap:sync'], frontendRoot)

    console.log('[cap:release] assembleRelease…')
    await run(gradlew, ['assembleRelease'], androidDir)

    const apk = path.join(
        androidDir,
        'app',
        'build',
        'outputs',
        'apk',
        'release',
        'app-release.apk'
    )
    console.log(`[cap:release] OK → ${apk}`)
    console.log('[cap:release] Sem keystore.properties o APK é assinado com DEBUG (não publicar).')
}

main().catch((err) => {
    console.error('[cap:release]', err.message || err)
    process.exit(1)
})
