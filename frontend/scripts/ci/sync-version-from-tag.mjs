#!/usr/bin/env node
/**
 * Alinha VERSION_NAME em version.properties com a TAG de release (ex.: v1.5.0 → 1.5.0).
 * VERSION_CODE continua sendo a fonte no arquivo (deve ser incrementado antes da TAG).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const versionFile = path.resolve(__dirname, '../../android/version.properties')

const tag = (process.env.GITHUB_REF_NAME || process.argv[2] || '').trim()
if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
    console.error(`TAG invalida: "${tag}". Use vX.Y.Z (ex.: v1.5.0).`)
    process.exit(1)
}

const versionName = tag.slice(1)
if (!fs.existsSync(versionFile)) {
    console.error(`Arquivo nao encontrado: ${versionFile}`)
    process.exit(1)
}

const raw = fs.readFileSync(versionFile, 'utf8')
const props = {}
for (const line of raw.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i === -1) continue
    props[t.slice(0, i).trim()] = t.slice(i + 1).trim()
}

const versionCode = Number(props.VERSION_CODE)
if (!Number.isInteger(versionCode) || versionCode < 1) {
    console.error('VERSION_CODE invalido em version.properties. Incremente antes da TAG.')
    process.exit(1)
}

const previousName = props.VERSION_NAME || ''
props.VERSION_NAME = versionName
props.VERSION_CODE = String(versionCode)

const out = [
    '# Versionamento do APK MoveCity Motorista.',
    '# VERSION_NAME e sincronizado pela TAG de release (GitHub Actions).',
    '# Incremente VERSION_CODE manualmente antes de cada TAG de distribuicao.',
    '# Ver docs/ANDROID_RELEASE.md',
    `VERSION_CODE=${props.VERSION_CODE}`,
    `VERSION_NAME=${props.VERSION_NAME}`,
    '',
].join('\n')

fs.writeFileSync(versionFile, out, 'utf8')

console.log(
    JSON.stringify({
        tag,
        versionName,
        versionCode,
        previousVersionName: previousName,
        versionFile,
    }),
)
