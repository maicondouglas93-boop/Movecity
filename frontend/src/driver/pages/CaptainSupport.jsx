import { Link } from 'react-router-dom'
import DriverSupportContent from '@/driver/components/DriverSupportContent'
import PageHeader from '@/shared/components/ui/PageHeader'

export default function CaptainSupport() {
    return <div className="h-full min-h-0 flex flex-col bg-surface-alt">
        <PageHeader title="Ajuda ao motorista" />
        <main className="flex-1 min-h-0 overflow-y-auto p-4 pb-8"><DriverSupportContent /></main>
    </div>
}

// Rota pública separada: login negado ou indisponível não bloqueia o suporte.
export function CaptainPublicHelp() {
    return <div className="min-h-[100dvh] bg-surface text-ink-900 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-8">
        <div className="max-w-xl mx-auto">
            <Link to="/captain-login" className="inline-flex min-h-[48px] items-center underline text-brand-700">Voltar à entrada do motorista</Link>
            <h1 className="my-5 text-2xl font-semibold">Ajuda ao motorista</h1>
            <DriverSupportContent />
        </div>
    </div>
}
