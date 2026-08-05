import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '@/shared/services/axios'
import PageHeader from '@/shared/components/ui/PageHeader'
import { useNotificationInbox } from '@/shared/contexts/NotificationInboxContext'
import { useToast } from '@/shared/contexts/ToastContext'

const FILTERS = [
  { id: 'all', label: 'Todas' },
  { id: 'unread', label: 'Não lidas' },
  { id: 'ride', label: 'Corridas' },
  { id: 'parcel', label: 'Encomendas' },
  { id: 'schedule', label: 'Agendamentos' },
  { id: 'promotion', label: 'Promoções' },
  { id: 'coupon', label: 'Cupons' },
  { id: 'admin', label: 'Admin' },
  { id: 'payment', label: 'Pagamentos' },
  { id: 'system', label: 'Sistema' },
]

function startOfDay(d) {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function groupLabel(dateStr) {
  const d = startOfDay(new Date(dateStr))
  const today = startOfDay(new Date())
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const weekAgo = new Date(today)
  weekAgo.setDate(weekAgo.getDate() - 7)

  if (d.getTime() === today.getTime()) return 'Hoje'
  if (d.getTime() === yesterday.getTime()) return 'Ontem'
  if (d >= weekAgo) return 'Esta semana'
  return 'Mais antigas'
}

function formatTime(dateStr) {
  try {
    return new Date(dateStr).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

function formatDate(dateStr) {
  try {
    return new Date(dateStr).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
  } catch {
    return ''
  }
}

/**
 * Central de notificações compartilhada (passageiro + motorista).
 * @param {{ backTo?: string, homeTo?: string }} props
 */
const NotificationCenter = ({ backTo = '/home' }) => {
  const navigate = useNavigate()
  const { addToast } = useToast()
  const { clearBadge, markReadLocal, markAllReadLocal, refreshUnread } = useNotificationInbox()

  const [filter, setFilter] = useState('all')
  const [items, setItems] = useState([])
  const [cursor, setCursor] = useState(null)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const pullStartY = useRef(null)

  // Ao abrir a tela: zera só o contador do sino
  useEffect(() => {
    clearBadge()
  }, [clearBadge])

  const fetchPage = useCallback(async ({ reset = false, nextCursor = null } = {}) => {
    const params = { limit: 30 }
    if (filter === 'unread') params.unread = 'true'
    else if (filter !== 'all') params.category = filter
    if (!reset && nextCursor) params.cursor = nextCursor

    const { data } = await api.get('/notifications', { params })
    const list = data?.items || []
    setItems((prev) => (reset ? list : [...prev, ...list]))
    setCursor(data?.nextCursor || null)
    setHasMore(Boolean(data?.hasMore))
  }, [filter])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        await fetchPage({ reset: true })
      } catch (err) {
        if (!cancelled) addToast(err.response?.data?.message || 'Não foi possível carregar', 'error')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [fetchPage, addToast])

  const loadMore = async () => {
    if (!hasMore || loadingMore || !cursor) return
    setLoadingMore(true)
    try {
      await fetchPage({ nextCursor: cursor })
    } catch {
      addToast('Falha ao carregar mais', 'error')
    } finally {
      setLoadingMore(false)
    }
  }

  const onRefresh = async () => {
    setRefreshing(true)
    try {
      await fetchPage({ reset: true })
      await refreshUnread()
    } finally {
      setRefreshing(false)
    }
  }

  const grouped = useMemo(() => {
    const map = new Map()
    for (const item of items) {
      const label = groupLabel(item.createdAt)
      if (!map.has(label)) map.set(label, [])
      map.get(label).push(item)
    }
    return [...map.entries()]
  }, [items])

  const openItem = async (item) => {
    try {
      if (!item.read && !item.lida) {
        await api.patch(`/notifications/${item.id}/read`)
        markReadLocal(item.id)
        setItems((prev) => prev.map((n) => (
          n.id === item.id ? { ...n, read: true, lida: true, readAt: new Date().toISOString() } : n
        )))
      }
    } catch {
      /* ainda navega */
    }
    const action = item.action || item.acao
    if (action && typeof action === 'string' && action.startsWith('/')) {
      navigate(action)
    }
  }

  const markAll = async () => {
    try {
      await api.patch('/notifications/read-all')
      markAllReadLocal()
      setItems((prev) => prev.map((n) => ({ ...n, read: true, lida: true })))
      addToast('Todas marcadas como lidas', 'success')
    } catch {
      addToast('Não foi possível marcar todas', 'error')
    }
  }

  const onTouchStart = (e) => {
    if (window.scrollY <= 0) pullStartY.current = e.touches[0].clientY
  }
  const onTouchEnd = (e) => {
    if (pullStartY.current == null) return
    const dy = e.changedTouches[0].clientY - pullStartY.current
    pullStartY.current = null
    if (dy > 70) onRefresh()
  }

  return (
    <div
      className="min-h-screen bg-surface pb-8"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <PageHeader
        title="Notificações"
        onBack={() => navigate(backTo)}
        rightSlot={(
          <button
            type="button"
            onClick={markAll}
            className="text-xs font-semibold text-brand-600 px-2 py-1"
          >
            Marcar todas
          </button>
        )}
      />

      <div className="px-4 pt-3 sticky top-[72px] z-10 bg-surface border-b border-line">
        <div className="flex gap-2 overflow-x-auto pb-3 scrollbar-none">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                filter === f.id
                  ? 'bg-brand-500 text-white border-brand-500'
                  : 'bg-surface-alt text-ink-600 border-line'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {refreshing && (
          <p className="text-xs text-ink-400 pb-2">Atualizando…</p>
        )}
      </div>

      <div className="px-4 mt-3 space-y-5">
        {loading && (
          <p className="text-sm text-ink-400 text-center py-10">Carregando…</p>
        )}
        {!loading && items.length === 0 && (
          <div className="text-center py-16">
            <span className="text-4xl" aria-hidden="true">🔔</span>
            <p className="mt-3 text-ink-900 font-semibold">Nenhuma notificação</p>
            <p className="text-sm text-ink-400 mt-1">Quando houver novidades, elas aparecem aqui.</p>
          </div>
        )}

        {grouped.map(([label, group]) => (
          <section key={label}>
            <h2 className="text-xs font-bold uppercase tracking-wide text-ink-400 mb-2">{label}</h2>
            <ul className="space-y-2">
              {group.map((item) => {
                const unread = !(item.read || item.lida)
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => openItem(item)}
                      className={`w-full text-left rounded-panel border px-3 py-3 flex gap-3 active:scale-[0.99] transition-transform ${
                        unread
                          ? 'bg-brand-50/60 border-brand-200'
                          : 'bg-surface-alt border-line'
                      }`}
                    >
                      <span className="text-2xl shrink-0 w-10 h-10 rounded-full bg-surface flex items-center justify-center border border-line">
                        {item.icon || item.icone || '🔔'}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start justify-between gap-2">
                          <span className={`text-sm ${unread ? 'font-bold text-ink-900' : 'font-semibold text-ink-800'}`}>
                            {item.title || item.titulo}
                          </span>
                          {unread && (
                            <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide bg-brand-500 text-white px-1.5 py-0.5 rounded">
                              Nova
                            </span>
                          )}
                        </span>
                        <span className="block text-xs text-ink-500 mt-0.5 line-clamp-2">
                          {item.description || item.descricao || item.message}
                        </span>
                        <span className="block text-[11px] text-ink-400 mt-1.5">
                          {formatDate(item.createdAt)} · {formatTime(item.createdAt)}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}

        {hasMore && (
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="w-full min-h-[44px] rounded-panel border border-line text-sm font-semibold text-ink-700 disabled:opacity-50"
          >
            {loadingMore ? 'Carregando…' : 'Carregar mais'}
          </button>
        )}
      </div>
    </div>
  )
}

export default NotificationCenter
