import { useCallback, useRef, useState } from 'react'

// Auditoria PWA (2026-08-07, P3/P4/P8): antes, a lógica de "qual oferta mostrar
// agora" ficava espalhada em handleNewRide/handleNewParcel (CaptainHome.jsx) —
// uma oferta de corrida chegando enquanto havia encomenda pendente (ou
// vice-versa) era descartada silenciosamente, e duas ofertas do mesmo tipo em
// sequência faziam a mais nova substituir a mais antiga sem fila. Esta fila
// única (corrida + encomenda, uma em destaque por vez) corrige os dois casos
// sem mudar a regra de despacho do backend (que legitimamente pode oferecer
// duas corridas a um motorista ocioso).
//
// Dedup por offerId com janela curta (mesmo valor do H2 nativo, RideOfferNotifier
// no Android) — protege contra a MESMA oferta chegando duas vezes quase juntas
// (socket + reconexão, socket + FCM), não contra uma oferta genuinamente nova.
const DEDUPE_WINDOW_MS = 8_000

export function useOfferQueue() {
    const [queue, setQueue] = useState([])
    const seenRef = useRef(new Map()) // offerId -> timestamp do último enqueue aceito

    // `front: true` — usado quando o motorista tocou numa notificação/deep link
    // pedindo especificamente por ESTA oferta: ela deve aparecer na hora, não
    // esperar atrás de outra já enfileirada.
    const enqueue = useCallback((kind, data, { front = false } = {}) => {
        if (!data?._id) return false
        const offerId = String(data._id)
        const now = Date.now()

        const lastSeen = seenRef.current.get(offerId)
        const isDupe = lastSeen != null && now - lastSeen <= DEDUPE_WINDOW_MS
        if (isDupe && !front) return false
        seenRef.current.set(offerId, now)
        // Limpeza oportunista — o mapa nunca cresce sem limite numa sessão longa.
        for (const [id, ts] of seenRef.current) {
            if (now - ts > DEDUPE_WINDOW_MS) seenRef.current.delete(id)
        }

        let accepted = true
        setQueue((prev) => {
            const rest = prev.filter((o) => o.offerId !== offerId)
            if (!front && rest.length !== prev.length) {
                // Já estava na fila (não é dupe recente, ex.: dado mais fresco do
                // pull) — atualiza os dados sem mudar a posição nem o destaque.
                const idx = prev.findIndex((o) => o.offerId === offerId)
                const next = [...prev]
                next[idx] = { kind, offerId, data }
                return next
            }
            const entry = { kind, offerId, data }
            return front ? [entry, ...rest] : [...rest, entry]
        })
        return accepted
    }, [])

    // Tira uma oferta específica da fila (aceita/recusada/tomada por outro/
    // cancelada) — funciona tanto para a que está em destaque quanto para
    // qualquer uma esperando atrás dela.
    const remove = useCallback((offerId) => {
        const id = String(offerId)
        setQueue((prev) => prev.filter((o) => o.offerId !== id))
    }, [])

    const clear = useCallback(() => setQueue([]), [])

    const active = queue[0] || null
    return { active, queueLength: queue.length, enqueue, remove, clear }
}
