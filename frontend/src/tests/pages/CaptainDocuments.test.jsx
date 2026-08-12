import { fireEvent, render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CaptainDataContext } from '@/driver/contexts/CaptainContext'
import CaptainDocuments from '@/driver/pages/CaptainDocuments'

vi.mock('@/shared/services/axios', () => ({
    default: { patch: vi.fn() },
}))
vi.mock('@/shared/services/session', () => ({
    getAccessToken: vi.fn(() => 'captain-token'),
}))
vi.mock('@/shared/services/imageUpload', async () => {
    const actual = await vi.importActual('@/shared/services/imageUpload')
    return { ...actual, postDocumentImageUpload: vi.fn() }
})
vi.mock('@/shared/contexts/ToastContext', () => ({
    useToast: () => ({ addToast: vi.fn() }),
}))

import api from '@/shared/services/axios'
import { postDocumentImageUpload } from '@/shared/services/imageUpload'

describe('CaptainDocuments', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        postDocumentImageUpload.mockResolvedValue({ data: { url: 'https://storage.test/cnh.webp' } })
        api.patch.mockResolvedValue({ data: { captain: { documents: {} } } })
    })

    it('usa o pipeline de documentos compatível com a plataforma', async () => {
        const setCaptain = vi.fn()
        const { container } = render(
            <MemoryRouter>
                <CaptainDataContext.Provider value={{ captain: { documents: {} }, setCaptain }}>
                    <CaptainDocuments />
                </CaptainDataContext.Provider>
            </MemoryRouter>,
        )
        const file = new File(['verso'], 'cnh-verso.jpg', { type: 'image/jpeg' })
        const inputs = container.querySelectorAll('input[type="file"]')

        fireEvent.change(inputs[1], { target: { files: [file] } })

        await waitFor(() => expect(postDocumentImageUpload).toHaveBeenCalledWith(
            expect.stringContaining('/uploads/document'),
            file,
            {
                token: 'captain-token',
                docType: 'cnhBack',
            },
        ))
        await waitFor(() => expect(api.patch).toHaveBeenCalledWith(
            expect.stringContaining('/captains/documents'),
            { docType: 'cnhBack', url: 'https://storage.test/cnh.webp' },
            { headers: { Authorization: 'Bearer captain-token' } },
        ))
        expect(setCaptain).toHaveBeenCalled()
    })
})
