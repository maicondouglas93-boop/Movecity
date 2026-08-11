import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const androidDir = path.join(frontendDir, 'android-passenger')
const gradle = process.platform === 'win32' ? 'gradlew.bat' : './gradlew'
const args = process.argv.slice(2)

if (args.length === 0) {
    console.error('Informe uma tarefa Gradle, por exemplo: assembleDebug')
    process.exit(1)
}

const result = spawnSync(gradle, args, {
    cwd: androidDir,
    env: {
        ...process.env,
        GRADLE_USER_HOME: process.env.GRADLE_USER_HOME
            || path.join(os.tmpdir(), 'movecity-passenger-gradle'),
    },
    stdio: 'inherit',
    shell: process.platform === 'win32',
})

if (result.error) throw result.error
process.exit(result.status ?? 1)
