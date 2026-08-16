import React, { useEffect } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes, Outlet, useNavigate } from 'react-router-dom'
import { vi } from 'vitest'

// Otimização de mapa persistente (2026-08-16): Home/CaptainHome viraram uma rota "sem
// path" (layout route) com as telas de conta como filhas via <Outlet />, pra parar de
// desmontar (e recriar do zero) o mapa a cada ida-e-volta pra Carteira/Perfil/etc. Este
// teste reproduz só o mecanismo de roteamento (não a Home real, que exige muitos
// contexts) e prova a garantia central: o elemento pai NÃO desmonta ao navegar entre
// as rotas filhas — só ao sair do grupo inteiro.
const mountSpy = vi.fn()
const unmountSpy = vi.fn()

const Shell = () => {
    useEffect(() => {
        mountSpy()
        return unmountSpy
    }, [])
    return (
        <div data-testid="shell">
            shell
            <Outlet />
        </div>
    )
}

const Wallet = () => <div data-testid="wallet">wallet</div>
const OutsideGroup = () => <div data-testid="outside">outside</div>

// Navega dentro do MESMO router já montado (fireEvent.click), diferente de trocar
// initialEntries — que o MemoryRouter só lê na primeira renderização.
const NavigateTo = ({ to, testId }) => {
    const navigate = useNavigate()
    return <button type="button" data-testid={testId} onClick={() => navigate(to)}>ir</button>
}

const TestApp = () => (
    <MemoryRouter initialEntries={['/home']}>
        <NavigateTo to="/wallet" testId="go-wallet" />
        <NavigateTo to="/outside" testId="go-outside" />
        <Routes>
            <Route path="/outside" element={<OutsideGroup />} />
            <Route element={<Shell />}>
                <Route path="/home" element={null} />
                <Route path="/wallet" element={<Wallet />} />
            </Route>
        </Routes>
    </MemoryRouter>
)

describe('rota "sem path" com Outlet (mapa persistente)', () => {
    beforeEach(() => {
        mountSpy.mockClear()
        unmountSpy.mockClear()
    })

    it('não desmonta o shell ao navegar entre /home e /wallet', () => {
        render(<TestApp />)
        expect(screen.getByTestId('shell')).toBeInTheDocument()
        expect(mountSpy).toHaveBeenCalledTimes(1)

        fireEvent.click(screen.getByTestId('go-wallet'))

        expect(screen.getByTestId('shell')).toBeInTheDocument()
        expect(screen.getByTestId('wallet')).toBeInTheDocument()
        // A prova central: navegar pra uma rota filha não disparou um novo mount nem
        // um unmount do shell — é o mesmo componente vivo, só o Outlet mudou de conteúdo.
        expect(mountSpy).toHaveBeenCalledTimes(1)
        expect(unmountSpy).not.toHaveBeenCalled()
    })

    it('desmonta o shell ao navegar pra fora do grupo', () => {
        render(<TestApp />)
        expect(mountSpy).toHaveBeenCalledTimes(1)

        fireEvent.click(screen.getByTestId('go-outside'))

        expect(screen.getByTestId('outside')).toBeInTheDocument()
        expect(screen.queryByTestId('shell')).not.toBeInTheDocument()
        expect(unmountSpy).toHaveBeenCalledTimes(1)
    })
})
