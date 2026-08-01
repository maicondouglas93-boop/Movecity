import React from 'react'
import { useNavigate } from 'react-router-dom'

// Cabeçalho "seta-voltar + título", repetido à mão em 6+ subpáginas de account/.
const PageHeader = ({ title, onBack, rightSlot, className = '' }) => {
    const navigate = useNavigate()
    const handleBack = onBack || (() => navigate(-1))

    return (
        <div className={`flex items-center gap-4 p-5 bg-surface border-b border-line sticky top-0 z-panel ${className}`}>
            <button
                type="button"
                onClick={handleBack}
                aria-label="Voltar"
                className="min-w-[44px] min-h-[44px] flex items-center justify-center -ml-2 active:scale-95 transition-transform"
            >
                <i className="ri-arrow-left-line text-2xl text-ink-900" aria-hidden="true" />
            </button>
            <h2 className="text-xl font-semibold text-ink-900 flex-1">{title}</h2>
            {rightSlot}
        </div>
    )
}

export default PageHeader
