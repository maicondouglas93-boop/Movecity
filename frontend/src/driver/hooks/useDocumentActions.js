import { useContext, useEffect, useRef, useState } from 'react'
import { CaptainDataContext } from '@/driver/contexts/CaptainContext'
import { getAccessToken, getSessionOwnerId } from '@/shared/services/session'

// Serializa fotos/CNH/Pix e aplica apenas a seção confirmada, nunca um perfil antigo inteiro.
export default function useDocumentActions() {
    const { captain, setCaptain } = useContext(CaptainDataContext)
    const owner = captain?._id
    const ownerRef = useRef(owner)
    ownerRef.current = owner
    const mounted = useRef(false)
    const lock = useRef(false)
    const [busy, setBusy] = useState(null)
    const [feedback, setFeedback] = useState({})
    useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

    const run = async (key, work, success) => {
        if (lock.current) return false
        lock.current = true
        const current = () => mounted.current && ownerRef.current === owner && getSessionOwnerId('captain') === owner
        const assertCurrent = () => {
            if (!current() || !getAccessToken('captain')) throw new Error('Sessão diferente. Volte à documentação da conta atual antes de enviar.')
        }
        setBusy(key)
        setFeedback(previous => ({ ...previous, [key]: null }))
        try {
            assertCurrent()
            const { next, patch, confirmed } = await work(assertCurrent)
            assertCurrent()
            if (next?._id !== owner || !confirmed) throw new Error('O servidor não confirmou os dados enviados. Consulte o status ou tente novamente.')
            setCaptain(previous => previous?._id === owner ? patch(previous, next) : previous)
            setFeedback(previous => ({ ...previous, [key]: { ok: true, text: success } }))
            return true
        } catch (error) {
            if (mounted.current && ownerRef.current === owner) {
                const networkFailure = error.isConnectivityIssue || ['ERR_NETWORK', 'ECONNABORTED'].includes(error.code)
                const text = error.response?.data?.errors?.[0]?.msg || error.response?.data?.message || error.friendlyMessage
                    || (networkFailure ? 'Não foi possível confirmar o envio por falha de conexão. Tente novamente.' : error.message)
                    || 'Não foi possível confirmar o envio. Tente novamente.'
                setFeedback(previous => ({ ...previous, [key]: { ok: false, text } }))
            }
            return false
        } finally {
            lock.current = false
            if (mounted.current && ownerRef.current === owner) setBusy(null)
        }
    }
    return { busy, feedback, run }
}
