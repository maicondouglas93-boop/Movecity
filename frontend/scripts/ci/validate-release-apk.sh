#!/usr/bin/env bash
# Valida APK de produção antes de criar a GitHub Release.
set -euo pipefail

APK="${1:?APK path required}"
EXPECT_VERSION="${2:?versionName required}"
EXPECT_CODE="${3:?versionCode required}"
EXPECT_PACKAGE="${4:-br.com.movecity.driver}"

if [[ ! -f "$APK" ]]; then
  echo "FAIL: APK não encontrado: $APK"
  exit 1
fi

SIZE="$(stat -c%s "$APK" 2>/dev/null || stat -f%z "$APK")"
if [[ "$SIZE" -le 0 ]]; then
  echo "FAIL: APK com tamanho zero"
  exit 1
fi
echo "APK size: $SIZE bytes"

BUILD_TOOLS_DIR="${ANDROID_HOME:-/usr/local/lib/android/sdk}/build-tools"
AAPT="$(ls -1d "$BUILD_TOOLS_DIR"/*/aapt 2>/dev/null | sort -V | tail -n1 || true)"
APKSIGNER="$(ls -1d "$BUILD_TOOLS_DIR"/*/apksigner 2>/dev/null | sort -V | tail -n1 || true)"

if [[ -z "$AAPT" || ! -x "$AAPT" ]]; then
  echo "FAIL: aapt não encontrado em $BUILD_TOOLS_DIR"
  exit 1
fi

BADGING="$("$AAPT" dump badging "$APK")"
PACKAGE="$(echo "$BADGING" | sed -n "s/.*package: name='\([^']*\)'.*/\1/p" | head -n1)"
VNAME="$(echo "$BADGING" | sed -n "s/.*versionName='\([^']*\)'.*/\1/p" | head -n1)"
VCODE="$(echo "$BADGING" | sed -n "s/.*versionCode='\([^']*\)'.*/\1/p" | head -n1)"

echo "package=$PACKAGE versionName=$VNAME versionCode=$VCODE"

if [[ "$PACKAGE" != "$EXPECT_PACKAGE" ]]; then
  echo "FAIL: applicationId esperado $EXPECT_PACKAGE, obtido $PACKAGE"
  exit 1
fi
if [[ "$VNAME" != "$EXPECT_VERSION" ]]; then
  echo "FAIL: versionName esperado $EXPECT_VERSION, obtido $VNAME"
  exit 1
fi
if [[ "$VCODE" != "$EXPECT_CODE" ]]; then
  echo "FAIL: versionCode esperado $EXPECT_CODE, obtido $VCODE"
  exit 1
fi

if [[ -n "$APKSIGNER" && -x "$APKSIGNER" ]]; then
  "$APKSIGNER" verify --verbose "$APK"
  echo "apksigner: OK (assinatura presente)"
else
  echo "FAIL: apksigner não encontrado"
  exit 1
fi

# Rejeitar APK típico de debug (certificado Android Debug)
CERTS="$("$APKSIGNER" verify --print-certs "$APK" 2>&1 || true)"
if echo "$CERTS" | grep -qi "CN=Android Debug"; then
  echo "FAIL: APK assinado com certificado DEBUG — não publicar"
  exit 1
fi

echo "VALIDATE_OK"
