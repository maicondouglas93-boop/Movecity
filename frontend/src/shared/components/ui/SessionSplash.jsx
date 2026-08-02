import React from 'react';

// Auditoria de sessão persistente (2026-08-02): o estado de carregamento dos
// ProtectWrappers era um `<div>Loading...</div>` cru. Como agora a verificação de
// sessão pode incluir uma renovação silenciosa (uma ida ao servidor), essa tela
// aparece com mais frequência — e precisa parecer o app iniciando, não uma página
// quebrada. Fundo igual ao do app pra não "piscar" branco antes de entrar.
export default function SessionSplash({ label = 'Carregando...' }) {
    return (
        <div className="h-screen w-full bg-surface flex flex-col items-center justify-center gap-4">
            <div className="h-12 w-12 rounded-full border-4 border-line border-t-brand-500 animate-spin" role="status" aria-label={label} />
            <p className="text-sm text-ink-600">{label}</p>
        </div>
    );
}
