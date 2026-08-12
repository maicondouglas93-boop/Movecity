import api from '@/shared/services/axios'
import { isNativePlatform } from '@/shared/platform/platform'

/** Android WebView às vezes devolve type vazio em content:// — aceita por extensão. */
export function isImageFile(file) {
    if (!file) return false
    if (typeof file.type === 'string' && file.type.startsWith('image/')) return true
    return /\.(jpe?g|png|webp|gif|heic|heif|bmp)$/i.test(file.name || '')
}

/**
 * Upload multipart com campo `image`.
 * NÃO definir Content-Type manualmente — sem boundary o multer recebe req.file=undefined
 * ("Nenhuma imagem enviada"), especialmente no WebView do APK.
 */
export async function postImageUpload(url, file, { token, timeout = 60000, fields = {} } = {}) {
    const formData = new FormData()
    formData.append('image', file, file.name || 'photo.jpg')
    Object.entries(fields).forEach(([key, value]) => {
        if (value !== undefined && value !== null) formData.append(key, String(value))
    })
    const headers = {}
    if (token) headers.Authorization = `Bearer ${token}`
    return api.post(url, formData, { headers, timeout })
}

/**
 * Documentos no APK usam corpo binário em vez de multipart. Alguns WebViews Android
 * expõem a foto escolhida como File, mas perdem a parte `image` ao serializar o
 * FormData pelo XMLHttpRequest; o backend então recebe req.file=undefined.
 *
 * A versão web mantém o multipart tradicional. No Android, ler o ArrayBuffer antes
 * da requisição garante que os bytes realmente existem e evita o parser multipart.
 */
export async function postDocumentImageUpload(url, file, {
    token,
    docType,
    timeout = 60000,
} = {}) {
    if (!isNativePlatform()) {
        return postImageUpload(url, file, {
            token,
            timeout,
            fields: { docType },
        })
    }

    const bytes = typeof file.arrayBuffer === 'function'
        ? await file.arrayBuffer()
        : await new Response(file).arrayBuffer()
    if (!bytes.byteLength) {
        throw new Error('A imagem selecionada está vazia.')
    }

    const binaryUrl = url.replace(/\/document\/?$/, '/document-binary')
    const headers = { 'Content-Type': 'application/octet-stream' }
    if (token) headers.Authorization = `Bearer ${token}`

    return api.post(binaryUrl, bytes, {
        headers,
        params: { docType },
        timeout,
    })
}
