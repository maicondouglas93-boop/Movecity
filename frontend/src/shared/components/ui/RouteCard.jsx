import React from 'react'

/**
 * Partida → destino com os dois pontos ligados.
 *
 * Antes cada tela desenhava isso do seu jeito — duas linhas empilhadas, ou lado a lado
 * separadas por um traço — e nenhuma mostrava que os dois endereços são as pontas de um
 * mesmo trajeto. O conector é o que transforma dois textos soltos numa rota.
 *
 * `layout="stacked"` empilha (mais legível para endereço longo); `layout="split"` divide
 * em duas colunas (cabe em painel apertado, como o do motorista a caminho).
 */
const RouteCard = ({
    pickup,
    destination,
    pickupLabel = 'Partida',
    destinationLabel = 'Destino',
    layout = 'stacked',
    className = '',
}) => {
    const texto = (valor) => {
        if (!valor) return ''
        if (typeof valor === 'object') return valor.address || ''
        return valor
    }

    const origem = texto(pickup)
    const destino = texto(destination)

    if (layout === 'split') {
        return (
            <div className={`flex items-stretch gap-3 rounded-panel bg-surface-alt border border-line p-3 ${className}`}>
                <div className='flex-1 min-w-0'>
                    <p className='flex items-center gap-1.5 text-[11px] font-semibold text-brand-600'>
                        <i className="ri-map-pin-user-fill text-sm" aria-hidden="true" />
                        {pickupLabel}
                    </p>
                    <p className='text-sm font-semibold text-ink-900 truncate mt-0.5'>{origem}</p>
                </div>

                <div className='w-px self-stretch border-l border-dashed border-line' aria-hidden="true" />

                <div className='flex-1 min-w-0'>
                    <p className='flex items-center gap-1.5 text-[11px] font-semibold text-danger-500'>
                        <i className="ri-map-pin-2-fill text-sm" aria-hidden="true" />
                        {destinationLabel}
                    </p>
                    <p className='text-sm font-semibold text-ink-900 truncate mt-0.5'>{destino}</p>
                </div>
            </div>
        )
    }

    return (
        <div className={`rounded-panel bg-surface-alt border border-line p-3 ${className}`}>
            <div className='flex gap-3'>
                {/* Trilho: pino de partida, linha tracejada, pino de destino. Puramente
                    decorativo — os endereços ao lado é que carregam a informação. */}
                <div className='flex flex-col items-center flex-shrink-0 pt-1' aria-hidden="true">
                    <i className="ri-map-pin-user-fill text-brand-500 text-base leading-none" />
                    <div className='flex-1 w-px my-1 border-l border-dashed border-line min-h-[18px]' />
                    <i className="ri-map-pin-2-fill text-danger-500 text-base leading-none" />
                </div>

                <div className='flex-1 min-w-0 flex flex-col justify-between gap-3'>
                    <div className='min-w-0'>
                        <p className='text-[11px] font-semibold text-brand-600'>{pickupLabel}</p>
                        <p className='text-sm font-semibold text-ink-900 truncate'>{origem}</p>
                    </div>
                    <div className='min-w-0'>
                        <p className='text-[11px] font-semibold text-danger-500'>{destinationLabel}</p>
                        <p className='text-sm font-semibold text-ink-900 truncate'>{destino}</p>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default RouteCard
