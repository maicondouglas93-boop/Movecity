import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import DriverOperationalDialog from '@/driver/components/DriverOperationalDialog'
import { dismissDriverOverlay } from '@/shared/services/driverOverlayBack'

describe('diálogo operacional: foco e Voltar', () => {
    it('foca o diálogo, contém Tab/Shift+Tab e restaura foco após recolher', async () => {
        const close = vi.fn()
        const view = render(<button>Abrir oferta</button>)
        const opener = screen.getByRole('button')
        opener.focus()
        view.rerender(<><button>Abrir oferta</button><DriverOperationalDialog title="Oferta" onClose={close}><button>Aceitar</button><button>Ignorar</button></DriverOperationalDialog></>)
        const dialog = screen.getByRole('dialog')
        expect(dialog).toHaveFocus()
        fireEvent.keyDown(document, { key: 'Tab' })
        expect(screen.getByRole('button', { name: 'Recolher atendimento' })).toHaveFocus()
        fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
        expect(screen.getByRole('button', { name: 'Ignorar' })).toHaveFocus()
        fireEvent.keyDown(document, { key: 'Tab' })
        expect(screen.getByRole('button', { name: 'Recolher atendimento' })).toHaveFocus()
        fireEvent.keyDown(document, { key: 'Escape' })
        expect(close).toHaveBeenCalledTimes(1)
        view.rerender(<button>Abrir oferta</button>)
        await act(async () => {})
        expect(screen.getByRole('button')).toHaveFocus()
        expect(dismissDriverOverlay()).toBe(false)
    })
    it('consome Voltar/Escape sem desmontar durante uma ação em andamento', () => {
        const close = vi.fn()
        render(<DriverOperationalDialog title="Embarque" onClose={close} busy><button disabled>Salvando</button></DriverOperationalDialog>)
        expect(dismissDriverOverlay()).toBe(true)
        fireEvent.keyDown(document, { key: 'Escape' })
        expect(close).not.toHaveBeenCalled()
        expect(screen.getByRole('button', { name: 'Recolher atendimento' })).toBeDisabled()
    })
})
