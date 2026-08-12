import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/services/axios', () => ({
    default: { post: vi.fn() },
}))
vi.mock('@/shared/platform/platform', () => ({
    isNativePlatform: vi.fn(() => false),
}))

import api from '@/shared/services/axios'
import { isNativePlatform } from '@/shared/platform/platform'
import { isImageFile, postDocumentImageUpload, postImageUpload } from '@/shared/services/imageUpload'

describe('imageUpload', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        isNativePlatform.mockReturnValue(false)
        api.post.mockResolvedValue({ data: { url: 'https://storage.test/document.webp' } })
    })

    it('envia arquivo multipart com nome e campos extras', async () => {
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

    it('envia bytes puros pela rota binária no APK Android', async () => {
        isNativePlatform.mockReturnValue(true)
        const bytes = new Uint8Array([137, 80, 78, 71]).buffer
        const file = {
            name: 'cnh-frente.png',
            type: 'image/png',
            arrayBuffer: vi.fn().mockResolvedValue(bytes),
        }

        await postDocumentImageUpload('/uploads/document', file, {
            token: 'captain-token',
            docType: 'cnhFront',
        })

        expect(file.arrayBuffer).toHaveBeenCalledTimes(1)
        expect(api.post).toHaveBeenCalledWith('/uploads/document-binary', bytes, {
            headers: {
                Authorization: 'Bearer captain-token',
                'Content-Type': 'application/octet-stream',
            },
            params: { docType: 'cnhFront' },
            timeout: 60000,
        })
    })

    it('mantém multipart para envio de documentos na versão web', async () => {
        const file = new File(['foto'], 'crlv.jpg', { type: 'image/jpeg' })

        await postDocumentImageUpload('/uploads/document', file, {
            token: 'captain-token',
            docType: 'crlv',
        })

        const [, body] = api.post.mock.calls[0]
        expect(body).toBeInstanceOf(FormData)
        expect(body.get('image')).toBeInstanceOf(File)
        expect(body.get('docType')).toBe('crlv')
    })
})
