import { useContext, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CaptainDataContext } from '@/driver/contexts/CaptainContext'
import { getInstalledVersion, getDriverUpdateChannel } from '@/shared/platform/appUpdate.service'
import { SUPPORT_EMAIL, supportEmailUrl, supportWhatsAppUrl } from '@/shared/utils/supportContacts'

const CATEGORIES = [
    ['access', 'Acesso e senha'], ['documents', 'Documentos e cadastro'],
    ['ride', 'Corrida'], ['payment', 'Pagamento'], ['vehicle', 'Veículo'],
    ['account', 'Conta'], ['safety', 'Segurança'], ['app', 'Aplicativo'], ['other', 'Outros'],
]

export default function DriverSupportContent() {
    const { captain } = useContext(CaptainDataContext) || {}
    const [params] = useSearchParams()
    const requestedCategory = params.get('category')
    const [category, setCategory] = useState(() => CATEGORIES.some(([id]) => id === params.get('category')) ? params.get('category') : 'app')
    const [description, setDescription] = useState('')
    const [shareOwner, setShareOwner] = useState(null)
    const [version, setVersion] = useState('Não informada')
    useEffect(() => {
        if (CATEGORIES.some(([id]) => id === requestedCategory)) setCategory(requestedCategory)
    }, [requestedCategory])
    useEffect(() => { setDescription(''); setShareOwner(null) }, [captain?._id])
    useEffect(() => {
        let active = true
        getInstalledVersion().then(info => {
            if (active && info.versionName && info.versionName !== '0.0.0') setVersion(info.versionName)
        }).catch(() => {})
        return () => { active = false }
    }, [])
    const label = CATEGORIES.find(([id]) => id === category)[1]
    const channel = { play: 'Google Play', sideload: 'APK externo', web: 'Navegador' }[getDriverUpdateChannel()]
    const includeOwner = Boolean(captain?._id && shareOwner === captain._id)
    const message = [
        `MoveCity Motorista — ${label}`, `Versão: ${version} · Canal: ${channel}`,
        ...(includeOwner ? [`Conta: ${captain._id}`] : []),
        description.trim() || 'Preciso de orientação sobre este assunto.',
    ].join('\n')
    return <div className="space-y-5 text-ink-900">
        <p>Escolha o assunto e revise a mensagem antes de abrir um canal de atendimento.</p>
        <label className="block font-medium">Assunto
            <select value={category} onChange={event => setCategory(event.target.value)} className="mt-2 w-full min-h-[48px] rounded-panel border border-line p-3 bg-surface">
                {CATEGORIES.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
        </label>
        {category === 'access' && <section aria-label="Recuperação de acesso" className="rounded-panel border border-line p-4 space-y-3">
            <h2 className="font-semibold">Não consegue entrar?</h2>
            <p>Confira o e-mail usado no cadastro e use “Mostrar senha” na tela de entrada. Se o erro for de conexão, tente novamente quando o sinal voltar.</p>
            <p>Esqueceu a senha ou perdeu acesso ao e-mail? Solicite orientação ao suporte pelos canais abaixo. Este aplicativo ainda não oferece redefinição automática de senha.</p>
            <p>Não desinstale nem limpe os dados para tentar entrar: isso pode apagar informações de corridas ainda não sincronizadas.</p>
        </section>}
        {category === 'documents' && <p className="rounded-panel bg-surface-alt p-4">Confira o motivo de rejeição em Documentação. Uma foto reenviada precisa ser analisada novamente. Não há prazo de análise informado no aplicativo.</p>}
        {category === 'safety' && <p role="status" className="rounded-panel bg-amber-50 p-4">Este canal é de suporte do aplicativo e não substitui atendimento de emergência. Em risco imediato, procure o serviço de emergência local.</p>}
        <label className="block font-medium">Descreva o problema (opcional)
            <textarea value={description} onChange={event => setDescription(event.target.value)} rows={4} maxLength={1000}
                aria-describedby="support-privacy" className="mt-2 w-full rounded-panel border border-line p-3 font-normal" />
        </label>
        <p id="support-privacy" className="text-sm text-ink-600">Não inclua senha, código de verificação, dados bancários ou fotos de documentos. Nenhum arquivo, localização ou histórico de corridas será anexado automaticamente.</p>
        {captain?._id && <label className="flex items-start gap-3 min-h-[44px]">
            <input type="checkbox" checked={includeOwner} onChange={event => setShareOwner(event.target.checked ? captain._id : null)} className="mt-1 h-5 w-5 shrink-0" />
            Incluir identificação da minha conta na mensagem
        </label>}
        <label className="block font-medium">Mensagem que será aberta
            <textarea readOnly value={message} rows={5} className="mt-2 w-full rounded-panel border border-line p-3 bg-surface-alt font-normal text-sm" />
        </label>
        <div className="flex flex-col gap-3">
            <a href={supportWhatsAppUrl(message)} target="_blank" rel="noopener noreferrer" className="rounded-panel bg-brand-700 text-white p-3 text-center font-semibold min-h-[48px]">Abrir WhatsApp do suporte</a>
            <a href={supportEmailUrl(message, `Motorista — ${label}`)} className="rounded-panel border border-line p-3 text-center font-semibold min-h-[48px]">Abrir e-mail do suporte</a>
        </div>
        <p className="text-sm text-ink-600 break-all">Se não houver um aplicativo de e-mail configurado, use: {SUPPORT_EMAIL}</p>
        <p className="text-sm text-ink-600">Você revisa e envia a mensagem no WhatsApp ou e-mail. Abrir o canal não cria um protocolo nem confirma atendimento. O envio depende de conexão.</p>
    </div>
}
