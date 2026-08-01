import React from 'react'

// Placeholder com a forma do conteúdo final, pro carregamento inicial de listas
// (histórico, sugestões) não depender só de um spinner central — reduz a sensação
// de espera quando o formato do conteúdo já é previsível. Ver item 11 da auditoria de UX.
const Skeleton = ({ className = '' }) => (
    <div className={`animate-pulse bg-surface-alt rounded-panel ${className}`} />
)

// Formato específico do card de corrida usado em Activity.jsx — ícone + 2 linhas de
// texto à esquerda, preço + selo à direita, repetido N vezes durante o carregamento.
export const RideCardSkeleton = () => (
    <div className="bg-surface p-4 rounded-panel border border-line flex items-center justify-between">
        <div className="flex items-center gap-4 flex-1">
            <Skeleton className="h-12 w-12 flex-shrink-0" />
            <div className="flex-1 flex flex-col gap-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
            </div>
        </div>
        <div className="flex flex-col items-end gap-2 ml-4">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-3 w-16" />
        </div>
    </div>
)

export default Skeleton
