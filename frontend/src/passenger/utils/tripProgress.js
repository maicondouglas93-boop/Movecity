export const getTripProgressMessage = ({ progress = 0, remainingKm, etaMinutes } = {}) => {
    const safeProgress = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0
    const distance = Number.isFinite(remainingKm) ? remainingKm : null
    const minutes = Number.isFinite(etaMinutes) ? Math.max(1, Math.round(etaMinutes)) : null

    if (safeProgress >= 0.8) {
        const details = [
            distance != null ? `${distance.toFixed(1)} km` : null,
            minutes != null ? `${minutes} min` : null,
        ].filter(Boolean).join(' e ')

        return {
            icon: 'ri-flag-fill',
            title: 'Estamos chegando!',
            text: details
                ? `Sua viagem está perto do final. Faltam apenas ${details}.`
                : 'Sua viagem está perto do final.',
        }
    }

    if (safeProgress >= 0.45) {
        return {
            icon: 'ri-route-fill',
            title: 'Já estamos na metade do caminho',
            text: 'Siga tranquilo — você está cada vez mais perto do destino.',
        }
    }

    return {
        icon: 'ri-sparkling-2-fill',
        title: 'Sua viagem começou',
        text: 'Aproveite o caminho. Acompanharemos o trajeto com você.',
    }
}
