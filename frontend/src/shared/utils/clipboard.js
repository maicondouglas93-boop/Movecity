export async function copyTextToClipboard(text) {
    const value = String(text ?? '')
    if (!value) return false

    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value)
        return true
    }

    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    const copied = document.execCommand?.('copy') === true
    textarea.remove()
    if (!copied) throw new Error('Clipboard unavailable')
    return true
}
