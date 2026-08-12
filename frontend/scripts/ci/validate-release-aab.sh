#!/usr/bin/env bash
set -euo pipefail

AAB="${1:-}"
EXPECTED_NAME="${2:-}"
EXPECTED_CODE="${3:-}"

if [[ -z "$AAB" || -z "$EXPECTED_NAME" || -z "$EXPECTED_CODE" ]]; then
  echo "Uso: $0 <arquivo.aab> <versionName> <versionCode>"
  exit 2
fi

test -s "$AAB" || { echo "FAIL: AAB ausente/vazio: $AAB"; exit 1; }
unzip -tq "$AAB" >/dev/null
unzip -l "$AAB" | grep -q 'base/manifest/AndroidManifest.xml'
unzip -l "$AAB" | grep -q 'base/dex/classes.dex'
jarsigner -verify -strict "$AAB" >/dev/null

if ! jarsigner -verify -verbose -certs "$AAB" 2>&1 | grep -q 'X.509'; then
  echo "FAIL: certificado X.509 não encontrado no AAB"
  exit 1
fi

SIZE="$(stat -c%s "$AAB" 2>/dev/null || stat -f%z "$AAB")"
HASH="$(sha256sum "$AAB" 2>/dev/null | awk '{print $1}' || shasum -a 256 "$AAB" | awk '{print $1}')"
echo "OK AAB assinado: versionName=$EXPECTED_NAME versionCode=$EXPECTED_CODE bytes=$SIZE sha256=$HASH"
