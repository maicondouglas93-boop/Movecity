// Transporte isolado, respostas sintéticas. Não envia credenciais ou documentos reais.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { CaptainDataContext } from '@/driver/contexts/CaptainContext'
import { ToastProvider } from '@/shared/contexts/ToastContext'
import CaptainLogin from '@/driver/pages/CaptainLogin'
import CaptainDocuments from '@/driver/pages/CaptainDocuments'
import { CaptainPublicHelp } from '@/driver/pages/CaptainSupport'
import ApprovalGate from '@/driver/components/ApprovalGate'
import api from '@/shared/services/axios'
import { saveSession } from '@/shared/services/session'
import '@/index.css'
import 'remixicon/fonts/remixicon.css'

const mode = new URLSearchParams(window.location.search).get('mode') || 'login'
const initial = { _id: 'synthetic-driver', approvalStatus: 'em_analise', documentDeadline: '2026-09-20T12:00:00Z',
    documents: { cnhBack: { url: 'https://example.test/old-photo.jpg', reason: 'O número do documento ficou cortado. Envie uma foto completa e legível.', verified: false } } }
const fakeToken = `fixture.${btoa(JSON.stringify({ _id: initial._id, actorType: 'captain' }))}.synthetic`
if (mode !== 'login') saveSession('captain', { token: fakeToken }, { syncNative: false })
window.fixtureAccountFailure = true
api.defaults.adapter = async config => {
    const path = new URL(config.url, window.location.origin).pathname
    if (path === '/api/ready') return { config, status: 200, data: {}, headers: {} }
    if (window.fixtureAccountFailure) throw Object.assign(new Error('Falha simulada de conexão'), { code: 'ERR_NETWORK' })
    const body = typeof config.data === 'string' ? JSON.parse(config.data) : config.data
    let data
    if (path === '/uploads/document') data = { url: 'https://example.test/new-photo.jpg' }
    else if (path === '/captains/documents') data = { captain: { ...initial, documents: { [body.docType]: { url: body.url, verified: false, reason: '' } } } }
    else if (path === '/captains/document-info') data = { captain: { ...initial, ...body } }
    else if (path === '/captains/login') data = { captain: initial, token: fakeToken }
    else throw new Error('Chamada não autorizada pela fixture')
    return { config, status: 200, statusText: 'OK', data, headers: {} }
}
function Account() {
    const [captain, setCaptain] = useState(mode === 'login' ? null : initial)
    const entry = { login: '/captain-login', documents: '/captain/documents', help: '/captain-help?category=access', approval: '/approval' }[mode]
    return <CaptainDataContext.Provider value={{ captain, setCaptain }}><ToastProvider><MemoryRouter initialEntries={[entry]}>
        <div className="h-[100dvh]"><Routes>
            <Route path="/captain-login" element={<CaptainLogin />} />
            <Route path="/captain/documents" element={<CaptainDocuments />} />
            <Route path="/captain-help" element={<CaptainPublicHelp />} />
            <Route path="/approval" element={<ApprovalGate captain={captain} onRefresh={() => {}} />} />
            <Route path="/captain-home" element={<p>Entrada confirmada pela fixture</p>} />
        </Routes></div>
    </MemoryRouter></ToastProvider></CaptainDataContext.Provider>
}
createRoot(document.getElementById('root')).render(<Account />)
