import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/services/axios', () => ({
    default: { post: vi.fn() },
}))
vi.mock('@capacitor/core', () => ({
    CapacitorHttp: { request: vi.fn() },
}))
vi.mock('@/shared/platform/platform', () => ({
    isNativePlatform: vi.fn(() => false),
}))

import api from '@/shared/services/axios'
import { CapacitorHttp } from '@capacitor/core'
import { isNativePlatform } from '@/shared/platform/platform'
import { isImageFile, postDocumentImageUpload, postImageUpload } from '@/shared/services/imageUpload'

describe('imageUpload', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        isNativePlatform.mockReturnValue(false)
        api.post.mockResolvedValue({ data: { url: 'https://storage.test/document.webp' } })
        CapacitorHttp.request.mockResolvedValue({
            status: 200,
            data: { url: 'https://storage.test/document.webp' },
            headers: {},
        })
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

    it('envia documento pela ponte nativa como arquivo base64 no APK Android', async () => {
        isNativePlatform.mockReturnValue(true)
        const file = new File([new Uint8Array([137, 80, 78, 71])], 'cnh-frente.png', {
            type: 'image/png',
        })

        await postDocumentImageUpload('/uploads/document', file, {
            token: 'captain-token',
            docType: 'cnhFront',
        })

        expect(api.post).not.toHaveBeenCalled()
        expect(CapacitorHttp.request).toHaveBeenCalledWith({
            url: '/uploads/document-binary',
            method: 'POST',
            headers: {
                Authorization: 'Bearer captain-token',
                'Content-Type': 'application/octet-stream',
            },
            params: { docType: 'cnhFront' },
            data: 'iVBORw==',
            dataType: 'file',
            connectTimeout: 60000,
            readTimeout: 60000,
            responseType: 'json',
        })
    })

    it('envia foto de perfil do motorista pela mesma ponte nativa', async () => {
        isNativePlatform.mockReturnValue(true)
        const file = new File(['perfil'], 'perfil.jpg', { type: 'image/jpeg' })

        await postImageUpload('https://api.test/uploads/captain-profile', file, {
            token: 'captain-token',
        })

        expect(api.post).not.toHaveBeenCalled()
        expect(CapacitorHttp.request).toHaveBeenCalledWith(expect.objectContaining({
            url: 'https://api.test/uploads/captain-profile-binary',
            method: 'POST',
            data: 'cGVyZmls',
            dataType: 'file',
        }))
    })

    it('propaga erro HTTP nativo no mesmo formato usado pelas telas', async () => {
        isNativePlatform.mockReturnValue(true)
        CapacitorHttp.request.mockResolvedValue({
            status: 500,
            data: { message: 'Erro ao fazer upload da imagem' },
            headers: {},
        })
        const file = new File(['perfil'], 'perfil.jpg', { type: 'image/jpeg' })

        await expect(postImageUpload('/uploads/captain-profile', file, {
            token: 'captain-token',
        })).rejects.toMatchObject({
            response: {
                status: 500,
                data: { message: 'Erro ao fazer upload da imagem' },
            },
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
