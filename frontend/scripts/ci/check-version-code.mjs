#!/usr/bin/env node
/**
 * Garante que VERSION_CODE da release atual é maior que o máximo já publicado
 * nas GitHub Releases (campo "VersionCode:" no corpo).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const versionFile = path.resolve(__dirname, '../../android/version.properties')

function readVersionCode() {
    const raw = fs.readFileSync(versionFile, 'utf8')
    const m = raw.match(/^\s*VERSION_CODE\s*=\s*(\d+)\s*$/m)
    if (!m) throw new Error('VERSION_CODE não encontrado em version.properties')
    return Number(m[1])
}

function parseMaxPublishedCode(releasesJson) {
    let max = 0
    const list = Array.isArray(releasesJson) ? releasesJson : []
    for (const rel of list) {
        const body = String(rel.body || '')
        const matches = body.matchAll(/VersionCode:\s*(\d+)/gi)
        for (const m of matches) {
            const n = Number(m[1])
            if (Number.isFinite(n) && n > max) max = n
        }
        // Fallback: tag v1.2.3 sem body antigo — não infere versionCode
    }
    return max
}

const current = readVersionCode()
const releasesPath = process.argv[2]
let maxPublished = 0

if (releasesPath && fs.existsSync(releasesPath)) {
    const data = JSON.parse(fs.readFileSync(releasesPath, 'utf8'))
    maxPublished = parseMaxPublishedCode(data)
} else if (process.env.PREVIOUS_RELEASES_JSON) {
    maxPublished = parseMaxPublishedCode(JSON.parse(process.env.PREVIOUS_RELEASES_JSON))
}

if (current <= maxPublished) {
    console.error(
        [
            `VERSION_CODE ${current} não é maior que o máximo já publicado (${maxPublished}).`,
            'Incremente VERSION_CODE em frontend/android/version.properties antes da TAG.',
            'Ex.: última release VersionCode 14 → nova release precisa VersionCode >= 15.',
        ].join('\n'),
    )
    process.exit(1)
}

console.log(
    JSON.stringify({
        versionCode: current,
        maxPublishedVersionCode: maxPublished,
        ok: true,
    }),
)
