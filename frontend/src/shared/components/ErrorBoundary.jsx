import React from 'react'

export default class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props)
        this.state = { hasError: false, message: '' }
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, message: error?.message || 'Erro inesperado' }
    }

    componentDidCatch(error, info) {
        console.error('[ErrorBoundary]', error, info)
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-6 bg-surface-alt text-center">
                    <p className="text-lg font-semibold text-ink-900">Algo deu errado</p>
                    <p className="text-sm text-ink-600 max-w-sm">{this.state.message}</p>
                    <button
                        type="button"
                        className="mt-2 px-4 py-2 rounded-panel bg-brand-600 text-white text-sm font-medium"
                        onClick={() => {
                            this.setState({ hasError: false, message: '' })
                            window.location.reload()
                        }}
                    >
                        Recarregar
                    </button>
                </div>
            )
        }
        return this.props.children
    }
}
