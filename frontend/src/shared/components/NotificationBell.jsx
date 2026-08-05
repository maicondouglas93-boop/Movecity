import React from 'react'
import { Link } from 'react-router-dom'
import { useNotificationInbox } from '@/shared/contexts/NotificationInboxContext'

/**
 * Sino da central — usado no Header do passageiro e do motorista.
 * @param {{ to?: string }} props
 */
const NotificationBell = ({ to = '/notifications' }) => {
  const { badgeCount, ringPulse } = useNotificationInbox()
  const label = badgeCount > 0
    ? `Notificações, ${badgeCount} não lidas`
    : 'Notificações'

  return (
    <Link
      to={to}
      aria-label={label}
      className={`relative text-ink-600 active:text-brand-600 p-1 text-2xl transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center flex-shrink-0 ${ringPulse ? 'animate-bell-ring' : ''}`}
    >
      <i className="ri-notification-3-line" aria-hidden="true" />
      {badgeCount > 0 && (
        <span className="absolute top-0.5 right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-danger-500 text-white text-[10px] font-bold leading-[18px] text-center shadow-sm">
          {badgeCount > 99 ? '99+' : badgeCount}
        </span>
      )}
    </Link>
  )
}

export default NotificationBell
