import React, { createContext, useContext, useState, useCallback, useRef } from 'react'

const ToastContext = createContext(null)

/**
 * Toast types:
 *  'success'  – green   (ride started, payment done)
 *  'info'     – blue    (looking for driver, OTP)
 *  'warning'  – yellow  (waiting, pickup)
 *  'error'    – red     (failed)
 *  'dark'     – black   (new ride for captain)
 */
const ICONS = {
    success: 'ri-checkbox-circle-fill',
    info:    'ri-information-line',
    warning: 'ri-time-line',
    error:   'ri-error-warning-fill',
    dark:    'ri-car-fill',
    otp:     'ri-lock-2-line',
    money:   'ri-money-rupee-circle-line',
    ride:    'ri-route-fill',
}

const COLORS = {
    success: 'bg-green-500',
    info:    'bg-blue-600',
    warning: 'bg-yellow-500 text-black',
    error:   'bg-red-500',
    dark:    'bg-gray-900',
    otp:     'bg-indigo-600',
    money:   'bg-emerald-600',
    ride:    'bg-blue-700',
}

export const ToastProvider = ({ children }) => {
    const [toasts, setToasts] = useState([])
    const idRef = useRef(0)

    const addToast = useCallback((message, type = 'info', duration = 4000, subtitle = null) => {
        const id = ++idRef.current
        setToasts(prev => [
            ...prev,
            { id, message, subtitle, type, duration }
        ])
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id))
        }, duration)
    }, [])

    const removeToast = useCallback((id) => {
        setToasts(prev => prev.filter(t => t.id !== id))
    }, [])

    return (
        <ToastContext.Provider value={{ addToast }}>
            {children}

            {/* Global Toast Stack — top-center, highest z-index */}
            <div
                className='fixed top-4 left-1/2 z-[99999] flex flex-col gap-2 items-center pointer-events-none'
                style={{ transform: 'translateX(-50%)', width: 'max-content', maxWidth: '90vw' }}
            >
                {toasts.map(toast => (
                    <div
                        key={toast.id}
                        onClick={() => removeToast(toast.id)}
                        className={`flex items-start gap-3 px-4 py-3 rounded-2xl shadow-2xl text-white text-sm font-semibold pointer-events-auto
                            ${COLORS[toast.type] || 'bg-gray-800'}`}
                        style={{ animation: 'toastIn 0.3s cubic-bezier(0.34,1.56,0.64,1)' }}
                    >
                        <i className={`${ICONS[toast.type] || 'ri-notification-fill'} text-xl mt-0.5 flex-shrink-0`}></i>
                        <div className='min-w-0'>
                            <p className='leading-tight'>{toast.message}</p>
                            {toast.subtitle && (
                                <p className='text-xs opacity-80 leading-tight mt-0.5'>{toast.subtitle}</p>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            <style>{`
                @keyframes toastIn {
                    from { opacity: 0; transform: translateY(-16px) scale(0.92); }
                    to   { opacity: 1; transform: translateY(0) scale(1); }
                }
            `}</style>
        </ToastContext.Provider>
    )
}

export const useToast = () => {
    const ctx = useContext(ToastContext)
    if (!ctx) throw new Error('useToast must be used inside ToastProvider')
    return ctx
}
