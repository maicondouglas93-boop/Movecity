import { useEffect, useRef } from 'react'

// Faz o botão/gesto físico de voltar fechar um painel/fluxo aberto em vez de sair da
// tela inteira — apps nativos (Uber/99) ganham isso de graça da pilha de navegação do
// sistema; na web precisamos simular com o History API. Empurra UMA entrada sintética
// quando `isActive` fica true (não uma por painel — evita empilhar entradas a cada
// passo interno do fluxo) e a consome ao fechar, seja por voltar ou por qualquer outra
// ação (toque, confirmação), para o histórico nunca acumular voltas fantasmas.
// Ver item 8 do relatório de UX (docs/plans/2026-08-01-redesign-ux-passageiro.md).
export function useBackToClose(isActive, onClose) {
    const pushedRef = useRef(false)
    const onCloseRef = useRef(onClose)
    onCloseRef.current = onClose

    useEffect(() => {
        if (isActive && !pushedRef.current) {
            window.history.pushState({ __sheetOpen: true }, '')
            pushedRef.current = true
        } else if (!isActive && pushedRef.current) {
            pushedRef.current = false
            window.history.back()
        }
    }, [isActive])

    useEffect(() => {
        const handlePopState = () => {
            if (pushedRef.current) {
                pushedRef.current = false
                onCloseRef.current()
            }
        }
        window.addEventListener('popstate', handlePopState)
        return () => window.removeEventListener('popstate', handlePopState)
    }, [])
}
