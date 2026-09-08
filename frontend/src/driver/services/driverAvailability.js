// Limiar apenas de apresentação: não altera despacho, tarifa ou coleta de GPS.
export const HOME_LOCATION_FRESH_MS = 60_000

export function hasRecentLocation(location, now = Date.now()) {
    return Number.isFinite(location?.lat) && Math.abs(location.lat) <= 90
        && Number.isFinite(location?.lng) && Math.abs(location.lng) <= 180
        && Number.isFinite(location?.timestamp)
        && now >= location.timestamp && now - location.timestamp <= HOME_LOCATION_FRESH_MS
}

export function driverAvailability({ captain, active, busy, changing, uncertain, internet, connected, locationError, location, now }) {
    if (active) return { key: 'occupied', title: 'Atendimento em andamento', description: 'Retome o atendimento pelo botão acima. Você não está livre para novas solicitações.', tone: 'neutral' }
    if (busy) return { key: 'accepting', title: 'Confirmando atendimento', description: 'Aguarde a confirmação antes de iniciar outro serviço.', tone: 'warning' }
    if (changing) return { key: 'changing', title: 'Confirmando disponibilidade', description: 'A alteração só vale depois da confirmação do servidor.', tone: 'neutral' }
    if (uncertain) return { key: 'uncertain', title: 'Disponibilidade a confirmar', description: 'A resposta não chegou. Confirme o mesmo pedido antes de fazer outra alteração.', tone: 'warning' }
    if (captain?.isBlocked || captain?.approvalStatus !== 'aprovado') return { key: 'account', title: 'Cadastro indisponível', description: 'Confira a situação do cadastro no perfil.', tone: 'warning' }
    if (!captain?.isOnline) return { key: 'offline', title: 'Você está offline', description: 'Fique online para receber solicitações pelo MoveCity.', tone: 'neutral' }
    if (!internet || !connected) return { key: 'reconnecting', title: 'Reconectando ao MoveCity', description: 'Sua escolha de ficar online foi mantida. Aguardando conexão para atualizar as solicitações.', tone: 'warning' }
    if (captain?.canReceiveRides === false) return { key: 'credits', title: 'Recebimento bloqueado por créditos', description: 'Confira seus créditos na carteira para voltar a receber solicitações.', tone: 'warning' }
    if (locationError || !hasRecentLocation(location, now)) return { key: 'gps', title: 'Aguardando localização', description: locationError || 'Ainda não recebemos uma posição recente do GPS. Confira se a localização está ligada.', tone: 'warning' }
    return { key: 'available', title: 'Disponível para solicitações', description: 'Online, conectado e com localização recente. Aguarde uma oferta.', tone: 'available' }
}
