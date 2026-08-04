import React, { useContext, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import { CaptainDataContext } from '@/driver/contexts/CaptainContext'
import { getAccessToken } from '@/shared/services/session'
import { useToast } from '@/shared/contexts/ToastContext'
import PageHeader from '@/shared/components/ui/PageHeader'
import Card from '@/shared/components/ui/Card'
import StatusBadge from '@/shared/components/ui/StatusBadge'
import Button from '@/shared/components/ui/Button'

// Simplificação do cadastro do motorista (2026-08-04): tela dedicada ao envio da
// documentação, fora do cadastro inicial. Reaproveita exatamente o mesmo pipeline de
// upload que já existia (POST /uploads/document → PATCH /captains/documents) — antes
// só acessível embutido no formulário gigante de cadastro, agora extraído pra cá e
// alcançável pelo perfil a qualquer momento, inclusive para reenvio.
const DOCUMENT_FIELDS = [
    { key: 'cnhFront', label: 'CNH (frente)' },
    { key: 'cnhBack', label: 'CNH (verso)' },
    { key: 'crlv', label: 'CRLV' },
    { key: 'vehicleFront', label: 'Foto do veículo' },
    { key: 'selfie', label: 'Selfie com a CNH' },
]

const DocumentUploadRow = ({ docKey, label, doc, onUploaded }) => {
    const [ uploading, setUploading ] = useState(false)
    const { addToast } = useToast()

    const handleFileChange = async (e) => {
        const file = e.target.files[0]
        if (!file) return
        setUploading(true)
        try {
            const formData = new FormData()
            formData.append('image', file)
            formData.append('docType', docKey)
            const uploadRes = await axios.post(`${import.meta.env.VITE_BASE_URL}/uploads/document`, formData, {
                headers: { Authorization: `Bearer ${getAccessToken('captain')}` }
            })
            const patchRes = await axios.patch(`${import.meta.env.VITE_BASE_URL}/captains/documents`, {
                docType: docKey,
                url: uploadRes.data.url
            }, {
                headers: { Authorization: `Bearer ${getAccessToken('captain')}` }
            })
            onUploaded(patchRes.data.captain)
            addToast(`${label} enviado.`, 'success')
        } catch (err) {
            addToast(err.response?.data?.message || `Falha ao enviar ${label}.`, 'error')
        } finally {
            setUploading(false)
            e.target.value = ''
        }
    }

    const sent = !!doc?.url
    const verified = !!doc?.verified
    const rejected = sent && !verified && !!doc?.reason

    return (
        <div className="py-3 border-b border-line last:border-b-0">
            <div className="flex justify-between items-center gap-3">
                <span className="text-sm font-medium text-ink-900">{label}</span>
                {verified ? (
                    <StatusBadge tone="success"><i className="ri-checkbox-circle-fill mr-1"></i> Aprovado</StatusBadge>
                ) : sent ? (
                    rejected
                        ? <StatusBadge tone="danger"><i className="ri-close-circle-fill mr-1"></i> Rejeitado</StatusBadge>
                        : <StatusBadge tone="info"><i className="ri-time-line mr-1"></i> Em análise</StatusBadge>
                ) : (
                    <StatusBadge tone="neutral"><i className="ri-close-line mr-1"></i> Não enviado</StatusBadge>
                )}
            </div>

            {rejected && (
                <p className="text-xs text-danger-600 mt-1">{doc.reason}</p>
            )}

            <label className={`mt-2 flex items-center justify-center gap-2 border-2 border-dashed rounded-panel py-2.5 text-sm font-medium cursor-pointer transition-colors ${uploading ? 'opacity-60 pointer-events-none' : ''} ${verified ? 'border-line text-ink-400' : 'border-brand-200 text-brand-700 hover:bg-brand-50'}`}>
                <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} disabled={uploading} />
                <i className={uploading ? 'ri-loader-4-line animate-spin' : 'ri-upload-cloud-2-line'}></i>
                {uploading ? 'Enviando...' : sent ? 'Reenviar' : 'Enviar foto'}
            </label>
        </div>
    )
}

const CaptainDocuments = () => {
    const { captain, setCaptain } = useContext(CaptainDataContext)
    const navigate = useNavigate()
    const { addToast } = useToast()

    const documents = captain?.documents || {}

    // CNH — pré-preenchido com o que já foi salvo, se houver.
    const [ cnhNumber, setCnhNumber ] = useState(captain?.cnh?.number || '')
    const [ cnhCategory, setCnhCategory ] = useState(captain?.cnh?.category || '')
    const [ cnhExpiration, setCnhExpiration ] = useState(captain?.cnh?.expiration ? captain.cnh.expiration.slice(0, 10) : '')
    const [ cnhUf, setCnhUf ] = useState(captain?.cnh?.uf || '')
    const [ cnhEar, setCnhEar ] = useState(!!captain?.cnh?.ear)
    const [ savingCnh, setSavingCnh ] = useState(false)

    // PIX
    const [ pixKeyType, setPixKeyType ] = useState(captain?.pix?.keyType || '')
    const [ pixKey, setPixKey ] = useState(captain?.pix?.key || '')
    const [ savingPix, setSavingPix ] = useState(false)

    const saveDocumentInfo = async (payload, setSaving, successLabel) => {
        setSaving(true)
        try {
            const res = await axios.patch(`${import.meta.env.VITE_BASE_URL}/captains/document-info`, payload, {
                headers: { Authorization: `Bearer ${getAccessToken('captain')}` }
            })
            setCaptain(res.data.captain)
            addToast(`${successLabel} salvo.`, 'success')
        } catch (err) {
            addToast(err.response?.data?.errors?.[0]?.msg || err.response?.data?.message || 'Falha ao salvar', 'error')
        } finally {
            setSaving(false)
        }
    }

    // Só manda o que foi de fato preenchido — o backend trata 'optional()' como "campo
    // ausente", não como "presente e vazio": mandar uma string vazia em cnh.expiration,
    // por exemplo, falharia isISO8601() mesmo que a intenção fosse só deixar em branco
    // por enquanto (envio parcial é permitido, ver PATCH /captains/document-info).
    const submitCnh = (e) => {
        e.preventDefault()
        const cnh = { ear: cnhEar }
        if (cnhNumber.trim()) cnh.number = cnhNumber.trim()
        if (cnhCategory.trim()) cnh.category = cnhCategory.trim()
        if (cnhExpiration) cnh.expiration = cnhExpiration
        if (cnhUf.trim()) cnh.uf = cnhUf.trim()
        saveDocumentInfo({ cnh }, setSavingCnh, 'CNH')
    }

    const submitPix = (e) => {
        e.preventDefault()
        const pix = {}
        if (pixKeyType) pix.keyType = pixKeyType
        if (pixKey.trim()) pix.key = pixKey.trim()
        saveDocumentInfo({ pix }, setSavingPix, 'PIX')
    }

    return (
        <div className="h-screen bg-surface-alt flex flex-col pt-24">
            <PageHeader
                title="Documentação"
                className="shadow-raised"
                onBack={() => navigate('/captain/profile')}
            />

            <div className="flex-1 overflow-y-auto p-4 pb-10 space-y-6">
                <Card shadow="raised" padding="p-5">
                    <h3 className="font-semibold text-ink-900 mb-4">Fotos dos documentos</h3>
                    <div>
                        {DOCUMENT_FIELDS.map(({ key, label }) => (
                            <DocumentUploadRow
                                key={key}
                                docKey={key}
                                label={label}
                                doc={documents[key]}
                                onUploaded={setCaptain}
                            />
                        ))}
                    </div>
                </Card>

                <Card shadow="raised" padding="p-5">
                    <h3 className="font-semibold text-ink-900 mb-4">Carteira de Motorista (CNH)</h3>
                    <form onSubmit={submitCnh} className="space-y-3">
                        <div className="flex gap-3">
                            <input className='bg-surface-alt text-ink-900 border border-line focus:border-brand-500 w-1/2 rounded-panel px-4 py-3 outline-none' type="text" placeholder='Número da CNH' aria-label='Número da CNH' value={cnhNumber} onChange={(e) => setCnhNumber(e.target.value)} />
                            <input className='bg-surface-alt text-ink-900 border border-line focus:border-brand-500 w-1/4 rounded-panel px-4 py-3 outline-none' type="text" placeholder='Cat.' aria-label='Categoria' value={cnhCategory} onChange={(e) => setCnhCategory(e.target.value)} />
                            <input className='bg-surface-alt text-ink-900 border border-line focus:border-brand-500 w-1/4 rounded-panel px-4 py-3 outline-none' type="text" placeholder='UF' aria-label='UF' value={cnhUf} onChange={(e) => setCnhUf(e.target.value)} />
                        </div>
                        <div className="flex gap-3 items-center">
                            <input className='bg-surface-alt text-ink-900 border border-line focus:border-brand-500 w-1/2 rounded-panel px-4 py-3 outline-none text-sm' type="date" aria-label="Validade da CNH" value={cnhExpiration} onChange={(e) => setCnhExpiration(e.target.value)} />
                            <label className='flex items-center gap-2 text-ink-600 cursor-pointer w-1/2 text-sm'>
                                <input type="checkbox" checked={cnhEar} onChange={(e) => setCnhEar(e.target.checked)} className='w-5 h-5 text-brand-600 rounded focus:ring-brand-500' />
                                <span>Exerce Atividade Remunerada</span>
                            </label>
                        </div>
                        <Button type="submit" loading={savingCnh} disabled={savingCnh} variant="secondary">Salvar CNH</Button>
                    </form>
                </Card>

                <Card shadow="raised" padding="p-5">
                    <h3 className="font-semibold text-ink-900 mb-4">Recebimento (PIX)</h3>
                    <form onSubmit={submitPix} className="space-y-3">
                        <div className="flex gap-3">
                            <select aria-label="Tipo de Chave Pix" className='bg-surface-alt text-ink-900 border border-line focus:border-brand-500 w-1/3 rounded-panel px-4 py-3 outline-none' value={pixKeyType} onChange={(e) => setPixKeyType(e.target.value)}>
                                <option value="" disabled>Tipo de Chave</option>
                                <option value="cpf">CPF</option>
                                <option value="celular">Celular</option>
                                <option value="email">E-mail</option>
                                <option value="aleatoria">Aleatória</option>
                            </select>
                            <input className='bg-surface-alt text-ink-900 border border-line focus:border-brand-500 w-2/3 rounded-panel px-4 py-3 outline-none' type="text" placeholder='Chave Pix' aria-label='Chave Pix' value={pixKey} onChange={(e) => setPixKey(e.target.value)} />
                        </div>
                        <Button type="submit" loading={savingPix} disabled={savingPix} variant="secondary">Salvar PIX</Button>
                    </form>
                </Card>
            </div>
        </div>
    )
}

export default CaptainDocuments
