import api from '@/shared/services/axios'

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
export async function postImageUpload(url, file, { token, timeout = 60000 } = {}) {
    const formData = new FormData()
    formData.append('image', file, file.name || 'photo.jpg')
    const headers = {}
    if (token) headers.Authorization = `Bearer ${token}`
    return api.post(url, formData, { headers, timeout })
}
