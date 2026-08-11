// Extraído de CaptainDetails.jsx (auditoria do app do motorista, 2026-08-11, P3) —
// era a única formatação correta ("R$ 18,50", padrão brasileiro) já usada no app;
// o resto das telas misturava "R$18.5"/"R$ 18.50"/toFixed manual sem vírgula.
export function formatBRL(value) {
    const n = Number(value) || 0
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
