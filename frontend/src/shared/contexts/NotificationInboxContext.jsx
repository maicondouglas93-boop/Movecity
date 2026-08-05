import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import api from '@/shared/services/axios'
import { SocketContext } from '@/shared/contexts/SocketContext'
import { useToast } from '@/shared/contexts/ToastContext'
import { getAccessToken } from '@/shared/services/session'

const NotificationInboxContext = createContext(null)

function playSoftChime() {
  try {
    const audio = new Audio('/sounds/new-ride.wav')
    audio.volume = 0.35
    audio.play().catch(() => {})
  } catch {
    /* ignore */
  }
}

export function NotificationInboxProvider({ children }) {
  const { socket } = useContext(SocketContext)
  const { addToast } = useToast()
  const [unreadCount, setUnreadCount] = useState(0)
  const [badgeCount, setBadgeCount] = useState(0)
  const [ringPulse, setRingPulse] = useState(false)
  const badgeClearedRef = useRef(false)
  const pulseTimerRef = useRef(null)

  // Fase 3 (M1, 2026-08-05): limpa o timer do pulse no unmount do provider.
  useEffect(() => () => {
    if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current)
  }, [])

  const hasSession = Boolean(getAccessToken('user') || getAccessToken('captain'))

  const refreshUnread = useCallback(async () => {
    if (!getAccessToken('user') && !getAccessToken('captain')) {
      setUnreadCount(0)
      setBadgeCount(0)
      return
    }
    try {
      const { data } = await api.get('/notifications/unread')
      const count = Number(data?.count) || 0
      setUnreadCount(count)
      if (!badgeClearedRef.current) {
        setBadgeCount(count)
      }
    } catch {
      /* silencioso — central não pode quebrar a home */
    }
  }, [])

  /** Abrir a central zera só o badge; itens continuam não lidos até o clique. */
  const clearBadge = useCallback(() => {
    badgeClearedRef.current = true
    setBadgeCount(0)
  }, [])

  const onNotificationCreated = useCallback((dto) => {
    setUnreadCount((c) => c + 1)
    badgeClearedRef.current = false
    setBadgeCount((c) => c + 1)
    setRingPulse(true)
    // Fase 3 (M1, 2026-08-05): rastreia o timer do pulse — notificações em sequência
    // não empilham timers, e o unmount não deixa setState pendente pra trás.
    if (pulseTimerRef.current) clearTimeout(pulseTimerRef.current)
    pulseTimerRef.current = setTimeout(() => setRingPulse(false), 1200)
    playSoftChime()
    if (dto?.title) {
      addToast(dto.title, 'info', 4000, dto.description || dto.message)
    }
  }, [addToast])

  const markReadLocal = useCallback((id) => {
    setUnreadCount((c) => Math.max(0, c - 1))
    setBadgeCount((c) => Math.max(0, c - 1))
  }, [])

  const markAllReadLocal = useCallback(() => {
    setUnreadCount(0)
    setBadgeCount(0)
    badgeClearedRef.current = true
  }, [])

  useEffect(() => {
    if (!hasSession) return undefined
    refreshUnread()
    const t = setInterval(refreshUnread, 60_000)
    return () => clearInterval(t)
  }, [hasSession, refreshUnread])

  useEffect(() => {
    if (!socket) return undefined
    const handler = (data) => onNotificationCreated(data)
    socket.on('notification-created', handler)
    return () => socket.off('notification-created', handler)
  }, [socket, onNotificationCreated])

  const value = useMemo(() => ({
    unreadCount,
    badgeCount,
    ringPulse,
    refreshUnread,
    clearBadge,
    markReadLocal,
    markAllReadLocal,
    onNotificationCreated,
  }), [
    unreadCount,
    badgeCount,
    ringPulse,
    refreshUnread,
    clearBadge,
    markReadLocal,
    markAllReadLocal,
    onNotificationCreated,
  ])

  return (
    <NotificationInboxContext.Provider value={value}>
      {children}
    </NotificationInboxContext.Provider>
  )
}

export function useNotificationInbox() {
  const ctx = useContext(NotificationInboxContext)
  if (!ctx) {
    return {
      unreadCount: 0,
      badgeCount: 0,
      ringPulse: false,
      refreshUnread: async () => {},
      clearBadge: () => {},
      markReadLocal: () => {},
      markAllReadLocal: () => {},
      onNotificationCreated: () => {},
    }
  }
  return ctx
}

export default NotificationInboxContext
