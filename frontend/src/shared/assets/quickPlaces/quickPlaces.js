import igrejaIcon from './igreja-nazare.jpg'
import prontoSocorroIcon from './pronto-socorro.png'
import coocafeIcon from './coocafe.png'
import belizarioIcon from './supermercado-belizario.jpg'
import juvenilIcon from './supermercado-juvenil.jpg'

/**
 * Locais fixos de Lajinha-MG, mostrados como atalho no topo da lista de sugestões
 * de endereço (origem e destino) — antes mesmo do passageiro digitar qualquer coisa.
 *
 * `query` é o texto de busca enviado pra mesma API de sugestões que o autocomplete
 * já usa (/maps/get-suggestions): a coordenada exata vem do provider de mapas
 * (Google Places ou OSM, conforme MAPS_PROVIDER), não é fixada aqui. Endereços
 * confirmados pelo usuário (morador de Lajinha) em 2026-08-17.
 */
export const QUICK_PLACES = [
    {
        id: 'igreja-nazare',
        label: 'Paróquia N. Sra. de Nazaré',
        subtitle: 'R. Dom Cavati, 47 - Lajinha, MG',
        query: 'Paróquia Nossa Senhora de Nazaré, R. Dom Cavati, 47, Lajinha, MG',
        icon: igrejaIcon,
    },
    {
        id: 'pronto-socorro',
        label: 'Pronto Socorro',
        subtitle: 'R. Advenir Ferreira da Silva, 519 - Lajinha, MG',
        query: 'Pronto Socorro, R. Advenir Ferreira da Silva, 519, Lajinha, MG',
        icon: prontoSocorroIcon,
    },
    {
        id: 'coocafe',
        label: 'Coocafé',
        subtitle: 'Córrego do Areado - Lajinha, MG',
        query: 'Coocafé, Córrego do Areado, Lajinha, MG',
        icon: coocafeIcon,
    },
    {
        id: 'belizario',
        label: 'Supermercado Belizário',
        subtitle: 'R. Américo Misael, 550 - Centro, Lajinha, MG',
        query: 'Supermercado Belizário, R. Américo Misael, 550, Centro, Lajinha, MG',
        icon: belizarioIcon,
    },
    {
        id: 'juvenil',
        label: 'Juvenil Supermercados',
        subtitle: 'Av. Natal Rodrigues Pereira, 477 - Lajinha, MG',
        query: 'Juvenil Supermercados, Av. Natal Rodrigues Pereira, 477, Lajinha, MG',
        icon: juvenilIcon,
    },
]
