import useConnectionState from '@/shared/hooks/useConnectionState'

const ConnectionBanner = ({ inline = false }) => {
    const { internet, connected } = useConnectionState()
    if (internet && connected) return null
    return (
        <div role="status"
            className={`${inline ? 'relative shrink-0' : 'fixed top-0 left-0 z-overlay'} w-full ${!internet ? 'bg-danger-500' : 'bg-amber-500'} text-white text-sm font-semibold text-center py-2 flex items-center justify-center gap-2`}>
            {internet && <i className="ri-loader-4-line animate-spin" aria-hidden="true" />}
            {!internet ? 'Sem conexão com a internet' : 'Reconectando...'}
        </div>
    )
}

export default ConnectionBanner
