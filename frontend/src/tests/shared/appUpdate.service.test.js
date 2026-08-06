import { describe, it, expect } from 'vitest'
import { compareSemver, evaluateUpdate } from '@/shared/platform/appUpdate.logic'

describe('compareSemver', () => {
  it('compara major/minor/patch corretamente', () => {
    expect(compareSemver('1.10.0', '1.9.0')).toBe(1)
    expect(compareSemver('1.9.0', '1.10.0')).toBe(-1)
    expect(compareSemver('1.11.0', '1.10.0')).toBe(1)
    expect(compareSemver('2.0.0', '1.11.0')).toBe(1)
    expect(compareSemver('1.5.0', '1.5.0')).toBe(0)
  })
})

describe('evaluateUpdate', () => {
  const remoteBase = {
    isActive: true,
    apkUrl: 'https://cdn.example.com/app.apk',
    version: '1.5.0',
    versionCode: 15,
    minimumVersion: '1.4.0',
    minimumVersionCode: 14,
    mandatory: false,
  }

  it('detecta versão nova via versionCode', () => {
    const r = evaluateUpdate({ versionName: '1.4.0', versionCode: 14 }, remoteBase)
    expect(r.available).toBe(true)
    expect(r.mandatory).toBe(false)
  })

  it('marca obrigatória abaixo do minimumVersionCode', () => {
    const r = evaluateUpdate({ versionName: '1.3.0', versionCode: 13 }, remoteBase)
    expect(r.mandatory).toBe(true)
    expect(r.belowMinimum).toBe(true)
  })

  it('respeita mandatory=true', () => {
    const r = evaluateUpdate(
      { versionName: '1.4.5', versionCode: 14 },
      { ...remoteBase, mandatory: true },
    )
    expect(r.available).toBe(true)
    expect(r.mandatory).toBe(true)
  })

  it('up-to-date quando codes iguais', () => {
    const r = evaluateUpdate({ versionName: '1.5.0', versionCode: 15 }, remoteBase)
    expect(r.available).toBe(false)
    expect(r.mandatory).toBe(false)
  })
})
