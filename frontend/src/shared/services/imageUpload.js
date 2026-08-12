import api from '@/shared/services/axios'
import { CapacitorHttp } from '@capacitor/core'
import { isNativePlatform } from '@/shared/platform/platform'

/** Android WebView às vezes devolve type vazio em content:// — aceita por extensão. */
export function isImageFile(file) {
    if (!file) return false
    if (typeof file.type === 'string' && file.type.startsWith('image/')) return true
    return /\.(jpe?g|png|webp|gif|heic|heif|bmp)$/i.test(file.name || '')
}

const NATIVE_BINARY_ROUTES = new Map([
    ['/uploads/profile', '/uploads/profile-binary'],
    ['/uploads/captain-profile', '/uploads/captain-profile-binary'],
    ['/uploads/document', '/uploads/document-binary'],
])

function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
            const result = String(reader.result || '')
            const base64 = result.includes(',') ? result.slice(result.indexOf(',') + 1) : result
            if (!base64) reject(new Error('A imagem selecionada está vazia.'))
            else resolve(base64)
        }
        reader.onerror = () => reject(reader.error || new Error('Não foi possível ler a imagem selecionada.'))
        reader.readAsDataURL(file)
    })
}

function nativeBinaryUrl(url) {
    for (const [route, binaryRoute] of NATIVE_BINARY_ROUTES) {
        if (url.endsWith(route)) return `${url.slice(0, -route.length)}${binaryRoute}`
    }
    return null
}

async function postNativeImageUpload(url, file, { token, timeout, params } = {}) {
    const binaryUrl = nativeBinaryUrl(url)
    if (!binaryUrl) return null

    const base64 = await readFileAsBase64(file)
    const headers = { 'Content-Type': 'application/octet-stream' }
    if (token) headers.Authorization = `Bearer ${token}`

    const response = await CapacitorHttp.request({
        url: binaryUrl,
        method: 'POST',
        headers,
        params,
        data: base64,
        dataType: 'file',
        connectTimeout: timeout,
        readTimeout: timeout,
        responseType: 'json',
    })

    if (response.status >= 200 && response.status < 300) return response

    const error = new Error(response.data?.message || 'Falha ao enviar a imagem.')
    error.response = {
        status: response.status,
        data: response.data,
        headers: response.headers,
    }
    throw error
}

/**
 * Upload multipart com campo `image`.
 * NÃO definir Content-Type manualmente — sem boundary o multer recebe req.file=undefined
 * ("Nenhuma imagem enviada"), especialmente no WebView do APK.
 */
export async function postImageUpload(url, file, { token, timeout = 60000, fields = {} } = {}) {
    if (isNativePlatform() && Object.keys(fields).length === 0) {
        const nativeResponse = await postNativeImageUpload(url, file, { token, timeout })
        if (nativeResponse) return nativeResponse
    }

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
 * Documentos no APK usam o CapacitorHttp diretamente. A ponte nativa recebe o
 * arquivo em base64 com dataType=file, decodifica e envia os bytes originais.
 *
 * Não passar ArrayBuffer pelo axios: no Capacitor 6 o XHR interceptado trata esse
 * objeto como JSON e o servidor recebe texto em vez da imagem.
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

    return postNativeImageUpload(url, file, {
        token,
        timeout,
        params: { docType },
    })
}
