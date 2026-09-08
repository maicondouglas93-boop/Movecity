import PropTypes from 'prop-types'
import { useNavigate } from 'react-router-dom'
import Button from '@/shared/components/ui/Button'

// Auditoria de UX do motorista (2026-08-02, §2.7): antes disto, um motorista com
// cadastro pendente (ou reprovado, ou suspenso) entrava direto na Home completa e só
// descobria a restrição ao tocar em "Ficar Online" e receber um alert() do navegador.
// O enum real de aprovação tem 7 estados em português — a tela antiga só sabia
// distinguir "approved" (nunca batia com nada) de "Pendente" (tudo o resto, inclusive
// reprovado/suspenso/bloqueado, sem nunca dizer ao motorista qual dos casos era o dele).
const STATUS_CONFIG = {
    expirado: {
        icon: 'ri-calendar-close-line', tone: 'text-danger-700 bg-danger-50', title: 'Prazo de documentação expirado',
        description: 'Envie os documentos para análise ou fale com o suporte. O envio não reativa a conta automaticamente.',
    },
    iniciado: {
        icon: 'ri-file-list-3-line',
        tone: 'text-blue-500 bg-blue-50',
        title: 'Cadastro incompleto',
        description: 'Ainda faltam informações ou documentos para enviarmos seu cadastro para análise.',
    },
    documentos_enviados: {
        icon: 'ri-upload-cloud-2-line',
        tone: 'text-blue-500 bg-blue-50',
        title: 'Documentos recebidos',
        description: 'Recebemos seus documentos. Consulte aqui o andamento da análise ou fale com o suporte.',
    },
    em_analise: {
        icon: 'ri-time-line',
        tone: 'text-amber-600 bg-amber-50',
        title: 'Cadastro em análise',
        description: 'Sua conta está sendo analisada pela nossa equipe. O aplicativo não informa prazo de conclusão. Você pode consultar o status novamente ou falar com o suporte.',
    },
    reprovado: {
        icon: 'ri-close-circle-line',
        tone: 'text-danger-600 bg-danger-50',
        title: 'Cadastro reprovado',
        description: 'Seu cadastro não foi aprovado. Fale com o suporte da MoveCity para entender o motivo e saber se é possível reenviar.',
    },
    suspenso: {
        icon: 'ri-pause-circle-line',
        tone: 'text-amber-600 bg-amber-50',
        title: 'Conta suspensa',
        description: 'Sua conta está temporariamente suspensa. Fale com o suporte da MoveCity para mais informações.',
    },
    blocked: {
        icon: 'ri-forbid-line',
        tone: 'text-danger-600 bg-danger-50',
        title: 'Conta bloqueada',
        description: 'Sua conta foi bloqueada pela administração da plataforma. Fale com o suporte da MoveCity para mais informações.',
    },
    bloqueado: {
        icon: 'ri-forbid-line',
        tone: 'text-danger-600 bg-danger-50',
        title: 'Conta bloqueada',
        description: 'Sua conta foi bloqueada pela administração da plataforma. Fale com o suporte da MoveCity para mais informações.',
    },
}

const ApprovalGate = ({ captain, onRefresh, refreshing }) => {
    const navigate = useNavigate()

    // isBlocked (captain.service/admin.service) é um eixo separado de approvalStatus —
    // um motorista aprovado pode ser bloqueado depois, sem que approvalStatus mude.
    const kind = captain?.isBlocked ? 'blocked' : captain?.approvalStatus
    const config = STATUS_CONFIG[kind] || {
        icon: 'ri-question-line', tone: 'text-ink-700 bg-surface', title: 'Status da conta indisponível',
        description: 'Não foi possível identificar a situação do cadastro. Consulte novamente ou fale com o suporte.',
    }

    return (
        <div className="h-full min-h-0 overflow-y-auto bg-surface-alt px-6 py-6 text-center">
            <div className="min-h-full flex flex-col items-center justify-center">
            <div className={`h-20 w-20 rounded-full flex items-center justify-center mb-6 ${config.tone}`}>
                <i className={`${config.icon} text-4xl`}></i>
            </div>
            <h2 className="text-xl font-bold text-ink-900 mb-2">{config.title}</h2>
            <p className="text-sm text-ink-600 max-w-xs mb-8">{config.description}</p>

            <div className="w-full max-w-xs flex flex-col gap-3">
                <Button variant="secondary" onClick={() => onRefresh?.()} loading={refreshing}>
                    Verificar novamente
                </Button>
                <Button variant="ghost" onClick={() => navigate('/captain/profile')}>
                    Ver meu perfil e documentos
                </Button>
                <Button variant="secondary" onClick={() => navigate('/captain/documents')}>Ver documentos e pendências</Button>
                <Button variant="secondary" onClick={() => navigate(`/captain/support?category=${captain?.isBlocked || kind === 'suspenso' ? 'account' : 'documents'}`)}>Falar com o suporte</Button>
            </div>
            </div>
        </div>
    )
}
ApprovalGate.propTypes = { captain: PropTypes.object, onRefresh: PropTypes.func, refreshing: PropTypes.bool }

export default ApprovalGate
