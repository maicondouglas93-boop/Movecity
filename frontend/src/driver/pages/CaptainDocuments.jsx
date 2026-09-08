import { useContext, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { Link, useNavigate } from 'react-router-dom'
import api from '@/shared/services/axios'
import { CaptainDataContext } from '@/driver/contexts/CaptainContext'
import { getAccessToken } from '@/shared/services/session'
import { isImageFile, postDocumentImageUpload } from '@/shared/services/imageUpload'
import { withHardTimeout } from '@/shared/utils/hardTimeout'
import useDocumentActions from '@/driver/hooks/useDocumentActions'
import PageHeader from '@/shared/components/ui/PageHeader'

const DOCUMENT_FIELDS = [['cnhFront', 'CNH (frente)'], ['cnhBack', 'CNH (verso)'], ['crlv', 'CRLV'], ['vehicleFront', 'Foto do veículo'], ['selfie', 'Selfie com a CNH']]
const INPUT = 'mt-1 w-full min-w-0 rounded-panel border border-line bg-surface p-3 text-ink-900'
const ACTION = 'min-h-[48px] rounded-panel border border-line px-4 py-2 font-semibold text-brand-700 disabled:opacity-50'
function Feedback({ value }) {
    return value ? <p role={value.ok ? 'status' : 'alert'} className={`mt-3 text-sm ${value.ok ? 'text-brand-800' : 'text-danger-700'}`}>{value.text}</p> : null
}
Feedback.propTypes = { value: PropTypes.object }

function DocumentRow({ docKey, label, doc, actions }) {
    const pending = useRef(null)
    const inputRef = useRef(null)
    const [localError, setLocalError] = useState('')
    const [replaceApproved, setReplaceApproved] = useState(false)
    const status = doc?.verified === true ? 'Aprovado' : doc?.reason ? 'Rejeitado' : doc?.url ? 'Em análise' : 'Não enviado'
    const send = async () => {
        const selection = pending.current
        if (!selection) return
        const ok = await actions.run(docKey, async assertCurrent => {
            if (!selection.url) {
                const upload = await withHardTimeout(postDocumentImageUpload(`${import.meta.env.VITE_BASE_URL}/uploads/document`, selection.file, {
                    token: getAccessToken('captain'), docType: docKey,
                }), 65000)
                assertCurrent()
                const url = upload?.data?.url
                if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) throw new Error('O envio da foto não foi confirmado. Selecione a imagem novamente ou tente reenviar.')
                selection.url = url
            }
            assertCurrent()
            const { data } = await withHardTimeout(api.patch(`${import.meta.env.VITE_BASE_URL}/captains/documents`, { docType: docKey, url: selection.url }, {
                headers: { Authorization: `Bearer ${getAccessToken('captain')}` },
            }))
            return { next: data?.captain, confirmed: data?.captain?.documents?.[docKey]?.url === selection.url && data?.captain?.documents?.[docKey]?.verified === false,
                patch: (previous, next) => ({ ...previous, documents: { ...previous.documents, [docKey]: next.documents[docKey] } }),
            }
        }, `${label}: envio confirmado. A foto precisa de análise; isso não aprova a conta automaticamente.`)
        if (ok) { pending.current = null; setReplaceApproved(false) }
    }
    const selectFile = event => {
        if (actions.busy) return
        const file = event.target.files?.[0]
        event.target.value = ''
        if (!file) return
        setLocalError('')
        if (!isImageFile(file) || file.size === 0) { setLocalError('Selecione uma foto válida, não vazia.'); return }
        if (file.size > 5 * 1024 * 1024) { setLocalError('A foto deve ter no máximo 5 MB.'); return }
        pending.current = { file, url: null }
        void send()
    }
    return <section aria-label={label} className="py-4 border-b border-line last:border-b-0">
        <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">{label}</h3><span className="text-sm font-medium">{status}</span></div>
        {doc?.reason && !doc.verified && <p className="mt-2 text-sm text-danger-700">Motivo informado: {doc.reason}</p>}
        {doc?.verified && !replaceApproved
            ? <button className={`${ACTION} mt-3`} type="button" disabled={Boolean(actions.busy)} onClick={() => setReplaceApproved(true)}>Substituir foto aprovada</button>
            : <>
                {doc?.verified && <p className="mt-2 text-sm text-ink-600">A substituição retira a aprovação desta foto e exige nova análise.</p>}
                <input ref={inputRef} type="file" accept="image/*" aria-label={`Foto: ${label}`} className="sr-only" tabIndex={-1} disabled={Boolean(actions.busy)} onChange={selectFile} />
                <button className={`${ACTION} mt-3`} type="button" disabled={Boolean(actions.busy)} onClick={() => inputRef.current?.click()}>
                    {actions.busy === docKey ? 'Enviando...' : doc?.url ? 'Selecionar outra foto' : 'Selecionar foto'}
                </button>
            </>}
        {localError && <p role="alert" className="mt-3 text-sm text-danger-700">{localError}</p>}
        <Feedback value={actions.feedback[docKey]} />
        {actions.feedback[docKey]?.ok === false && pending.current && <button type="button" className={`${ACTION} mt-3`} disabled={Boolean(actions.busy)} onClick={send}>Tentar este envio novamente</button>}
    </section>
}
DocumentRow.propTypes = { docKey: PropTypes.string.isRequired, label: PropTypes.string.isRequired, doc: PropTypes.object, actions: PropTypes.object.isRequired }

function DocumentForm() {
    const { captain } = useContext(CaptainDataContext)
    const actions = useDocumentActions()
    const navigate = useNavigate()
    const deadline = Date.parse(captain.documentDeadline)
    const saveInfo = (event, area) => {
        event.preventDefault()
        if (actions.busy) return
        const form = new FormData(event.currentTarget)
        const fields = area === 'cnh' ? ['number', 'category', 'expiration', 'uf'] : ['keyType', 'key']
        const values = Object.fromEntries(fields.map(name => [name, String(form.get(name) || '').trim()]).filter(([, value]) => value))
        if (area === 'cnh') values.ear = form.get('ear') === 'on'
        void actions.run(area, async assertCurrent => {
            if (area === 'pix' && (!values.keyType || !values.key)) throw new Error('Informe o tipo e a chave Pix antes de salvar.')
            assertCurrent()
            const { data } = await withHardTimeout(api.patch(`${import.meta.env.VITE_BASE_URL}/captains/document-info`, { [area]: values }, {
                headers: { Authorization: `Bearer ${getAccessToken('captain')}` },
            }))
            const next = data?.captain
            const confirmed = Object.entries(values).every(([name, value]) => name === 'expiration'
                ? next?.[area]?.[name]?.slice(0, 10) === value : next?.[area]?.[name] === value)
            return { next, confirmed, patch: (previous, ack) => ({ ...previous, [area]: ack[area] }) }
        }, `${area === 'cnh' ? 'CNH' : 'Pix'}: dados salvos e confirmados.`)
    }
    return <div className="h-full min-h-0 bg-surface-alt flex flex-col">
        <PageHeader title="Documentação" onBack={() => navigate('/captain/profile')} />
        <main className="flex-1 min-h-0 overflow-y-auto p-4 pb-10 space-y-5 text-ink-900">
            <div className="space-y-2 text-sm">
                <p>Fotos legíveis, sem cortar o documento. Envie uma imagem de até 5 MB por vez.</p>
                {Number.isFinite(deadline) && <p>Prazo para envio informado na conta: <strong>{new Date(deadline).toLocaleDateString('pt-BR')}</strong>. Este não é um prazo de aprovação.</p>}
                <p>O envio não aprova nem desbloqueia a conta automaticamente. Consulte o status após a análise.</p>
                <Link to="/captain/support?category=documents" className="inline-flex min-h-[44px] items-center text-brand-700 underline">Ajuda com documentos</Link>
            </div>
            {actions.busy && <p role="status" className="p-3 rounded-panel bg-blue-50">Aguarde a confirmação deste envio antes de iniciar outro. Mantenha esta tela aberta.</p>}
            <div className="rounded-panel border border-line bg-surface p-4">
                <h2 className="text-lg font-semibold">Fotos dos documentos</h2>
                {DOCUMENT_FIELDS.map(([key, label]) => <DocumentRow key={key} docKey={key} label={label} doc={captain.documents?.[key]} actions={actions} />)}
            </div>
            <section className="rounded-panel border border-line bg-surface p-4" aria-label="Dados da CNH">
                <h2 className="text-lg font-semibold mb-3">Carteira de Motorista (CNH)</h2>
                <form onSubmit={event => saveInfo(event, 'cnh')}>
                    <fieldset disabled={Boolean(actions.busy)} className="min-w-0 space-y-3">
                        <label className="block">Número da CNH<input name="number" defaultValue={captain.cnh?.number || ''} className={INPUT} /></label>
                        <div className="grid grid-cols-2 gap-3">
                            <label className="block">Categoria<input name="category" defaultValue={captain.cnh?.category || ''} className={INPUT} /></label>
                            <label className="block">UF<input name="uf" maxLength={2} defaultValue={captain.cnh?.uf || ''} className={INPUT} /></label>
                        </div>
                        <label className="block">Validade da CNH<input name="expiration" type="date" defaultValue={captain.cnh?.expiration?.slice(0, 10) || ''} className={INPUT} /></label>
                        <label className="flex gap-3 items-start py-2"><input name="ear" type="checkbox" defaultChecked={captain.cnh?.ear === true} className="w-5 h-5 shrink-0 mt-1" />Exerce Atividade Remunerada</label>
                        <button type="submit" className={`${ACTION} w-full`}>{actions.busy === 'cnh' ? 'Salvando...' : 'Salvar CNH'}</button>
                    </fieldset>
                    <Feedback value={actions.feedback.cnh} />
                </form>
            </section>
            <section className="rounded-panel border border-line bg-surface p-4" aria-label="Recebimento Pix">
                <h2 className="text-lg font-semibold mb-3">Recebimento (Pix)</h2>
                <form onSubmit={event => saveInfo(event, 'pix')}>
                    <fieldset disabled={Boolean(actions.busy)} className="min-w-0 space-y-3">
                        <label className="block">Tipo de chave Pix<select name="keyType" defaultValue={captain.pix?.keyType || ''} className={INPUT} required>
                            <option value="">Selecione o tipo</option><option value="cpf">CPF</option><option value="celular">Celular</option><option value="email">E-mail</option><option value="aleatoria">Aleatória</option>
                        </select></label>
                        <label className="block">Chave Pix<input name="key" defaultValue={captain.pix?.key || ''} className={INPUT} required /></label>
                        <button type="submit" className={`${ACTION} w-full`}>{actions.busy === 'pix' ? 'Salvando...' : 'Salvar PIX'}</button>
                    </fieldset>
                    <Feedback value={actions.feedback.pix} />
                </form>
            </section>
        </main>
    </div>
}

export default function CaptainDocuments() {
    const { captain } = useContext(CaptainDataContext)
    return captain?._id ? <DocumentForm key={captain._id} /> : <p role="status" className="p-4">Aguardando identificação da conta...</p>
}
