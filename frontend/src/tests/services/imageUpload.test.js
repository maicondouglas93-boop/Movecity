import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/services/axios', () => ({
    default: { post: vi.fn() },
}))

import api from '@/shared/services/axios'
import { isImageFile, postImageUpload } from '@/shared/services/imageUpload'

describe('imageUpload', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        api.post.mockResolvedValue({ data: { url: 'https://storage.test/document.webp' } })
    })

    it('envia o documento Android como arquivo multipart com os campos extras', async () => {
        const file = new File(['foto'], 'cnh-frente.jpg', { type: 'image/jpeg' })

        await postImageUpload('/uploads/document', file, {
            token: 'captain-token',
            fields: { docType: 'cnhFront' },
        })

        expect(api.post).toHaveBeenCalledTimes(1)
        const [url, body, config] = api.post.mock.calls[0]
        expect(url).toBe('/uploads/document')
        expect(body).toBeInstanceOf(FormData)
        expect(body.get('image')).toBeInstanceOf(File)
        expect(body.get('image').name).toBe('cnh-frente.jpg')
        expect(body.get('docType')).toBe('cnhFront')
        expect(config).toEqual({
            headers: { Authorization: 'Bearer captain-token' },
            timeout: 60000,
        })
        expect(config.headers).not.toHaveProperty('Content-Type')
    })

    it('aceita imagem do seletor Android quando o MIME type vem vazio', () => {
        const file = new File(['foto'], 'documento.heic', { type: '' })
        expect(isImageFile(file)).toBe(true)
    })
})
