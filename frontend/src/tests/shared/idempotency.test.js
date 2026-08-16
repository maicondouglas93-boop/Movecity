import { describe, expect, it } from 'vitest'
import { newIdempotencyKey } from '@/shared/utils/idempotency'

describe('newIdempotencyKey', () => {
  it('gera UUIDs v4 válidos e diferentes para comandos novos', () => {
    const first = newIdempotencyKey()
    const second = newIdempotencyKey()
    const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

    expect(first).toMatch(uuidV4)
    expect(second).toMatch(uuidV4)
    expect(second).not.toBe(first)
  })
})
