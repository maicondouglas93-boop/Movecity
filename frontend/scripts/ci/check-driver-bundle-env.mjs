#!/usr/bin/env node
/**
 * Gate de release do APK: valida o BUNDLE gerado, não a variável de ambiente.
 *
 * Auditoria de integração (2026-08-06): o workflow buildava sem nenhuma VITE_*,
 * o Vite injetava `undefined` e o APK saía apontando para a origem do WebView
 * (http://localhost) em vez da API. Um check que só olha `process.env` não pega
 * esse caso — o build pode ter a env e mesmo assim não injetar. Por isso aqui a
 * verificação é feita em cima de dist-driver/.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const distDir = resolve(root, 'dist-driver')
const errors = []

function fail(msg) {
  errors.push(msg)
}

const baseUrl = String(process.env.VITE_BASE_URL || '').trim()

if (!baseUrl) {
  fail('VITE_BASE_URL não definida no ambiente de build (configure o GitHub Secret)')
} else {
  let parsed
  try {
    parsed = new URL(baseUrl)
  } catch {
    fail(`VITE_BASE_URL não é uma URL válida: ${baseUrl}`)
  }
  if (parsed) {
    if (parsed.protocol !== 'https:') {
      fail(`VITE_BASE_URL deve usar HTTPS em release (recebido: ${parsed.protocol}//)`)
    }
    if (/^(localhost|127\.0\.0\.1|10\.0\.2\.2)$/i.test(parsed.hostname) || /^192\.168\./.test(parsed.hostname)) {
      fail(`VITE_BASE_URL aponta para host local (${parsed.hostname}) — inválido para APK distribuído`)
    }
  }
}

function collectJsFiles(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return collectJsFiles(full)
    return full.endsWith('.js') ? [full] : []
  })
}

const jsFiles = collectJsFiles(distDir)

if (jsFiles.length === 0) {
  fail(`Nenhum bundle .js encontrado em ${distDir} — o build:driver rodou?`)
} else if (baseUrl) {
  const origin = (() => {
    try {
      return new URL(baseUrl).origin
    } catch {
      return baseUrl
    }
  })()

  let foundOrigin = false
  const undefinedBaseUrl = []

  for (const file of jsFiles) {
    const content = readFileSync(file, 'utf8')
    if (content.includes(origin)) foundOrigin = true
    // Assinatura do bug original: o Vite substitui a env ausente por `void 0`.
    if (/baseURL\s*:\s*(void 0|undefined)/.test(content)) {
      undefinedBaseUrl.push(file.replace(`${root}/`, ''))
    }
  }

  if (!foundOrigin) {
    fail(`A origem "${origin}" não aparece em nenhum bundle de dist-driver — a URL não foi injetada`)
  }
  if (undefinedBaseUrl.length > 0) {
    fail(`baseURL indefinida no bundle: ${undefinedBaseUrl.join(', ')}`)
  }
}

if (errors.length > 0) {
  console.error('FAIL: bundle do motorista inválido para release\n')
  errors.forEach((e) => console.error(`  - ${e}`))
  console.error('\nO APK não pode ser publicado sem a URL da API embutida.')
  process.exit(1)
}

console.log(`OK: bundle do motorista aponta para ${new URL(baseUrl).origin}`)
console.log(`OK: ${jsFiles.length} arquivo(s) .js verificado(s) em dist-driver`)
