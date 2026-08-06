#!/usr/bin/env node
/**
 * Gate de release: APK motorista sem push nativo é inválido para soft-launch.
 * - google-services.json presente e não vazio
 * - VITE_NATIVE_PUSH_ENABLED não desligado no .env.driver
 */
import { readFileSync, existsSync, statSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
let failed = false

function fail(msg) {
  console.error(`FAIL: ${msg}`)
  failed = true
}

const services = resolve(root, 'android/app/google-services.json')
if (!existsSync(services)) {
  fail('android/app/google-services.json ausente')
} else {
  const size = statSync(services).size
  if (size < 32) fail('google-services.json vazio ou inválido')
  else {
    try {
      const json = JSON.parse(readFileSync(services, 'utf8'))
      const pkg = json?.client?.[0]?.client_info?.android_client_info?.package_name
      if (pkg && pkg !== 'br.com.movecity.driver') {
        fail(`package_name inesperado em google-services.json: ${pkg}`)
      } else {
        console.log('OK google-services.json')
      }
    } catch (e) {
      fail(`google-services.json JSON inválido: ${e.message}`)
    }
  }
}

const envDriver = resolve(root, '.env.driver')
if (!existsSync(envDriver)) {
  fail('.env.driver ausente')
} else {
  const text = readFileSync(envDriver, 'utf8')
  const match = text.match(/^\s*VITE_NATIVE_PUSH_ENABLED\s*=\s*(.+)\s*$/m)
  const value = (match ? match[1] : 'true').trim().replace(/^["']|["']$/g, '').toLowerCase()
  if (value === 'false' || value === '0' || value === 'off') {
    fail('VITE_NATIVE_PUSH_ENABLED está desligado no .env.driver — release exige push nativo')
  } else {
    console.log(`OK VITE_NATIVE_PUSH_ENABLED=${value || 'true (default)'}`)
  }
}

if (failed) process.exit(1)
console.log('Native push config OK for Android release')
