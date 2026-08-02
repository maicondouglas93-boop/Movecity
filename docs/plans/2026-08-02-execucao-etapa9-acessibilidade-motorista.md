# Execução — Etapa 9 (Acessibilidade) — App do Motorista

**Base:** [auditoria de UX/UI de 2026-08-02](2026-08-02-auditoria-ux-motorista.md), §7 e item 9 do plano ("Baixo").
**Escopo:** `aria-*`, `htmlFor`, `type="button"`, tipografia mínima de 12px, alvos de toque de 44px, contraste.
**Status:** ✅ concluído e verificado em 2026-08-02. Nada commitado.

## Ponto de partida real (remedido antes de agir)

As Etapas 3-8 já adotaram o UI kit (`Button`, `PageHeader`, `DetailRow`, `BottomSheet`, `ConnectionBanner`) em todo o módulo, e esses componentes já nasceram acessíveis (o `Button` sempre usa `type="button"` internamente, `PageHeader` tem `aria-label="Voltar"`, `BottomSheet` tem `aria-label="Fechar"`, `ConnectionBanner` tem `role="status"`). Por isso remedi os números do relatório original antes de planejar esta etapa, em vez de assumir que os 26/104/etc. do relatório de 2026-08-02 ainda valiam:

| Métrica | Relatório original | Antes desta etapa (remedido) |
|---|---|---|
| `aria-*` | 0 | 3 |
| `htmlFor` | 0 | 0 |
| `<button>` sem `type` | 20 de 21 | 12 de 12 (os outros já eram `<Button>`) |
| `onClick` em elemento não-semântico | 3 | 0 (as alças manuais viraram `BottomSheet`) |
| Texto < 12px | 26 | 20 |
| Alvo de toque < 44px | 8 | 10 |

## O que muda

| Item | Onde |
|---|---|
| `type="button"` nos 12 `<button>` restantes | `CaptainDetails`, `FinishRide` (já tinha), `CaptainEarnings`, `CaptainProfile`, `CaptainRiding` ×2, `CaptainWallet` ×3 |
| `aria-label` em botões só-de-ícone | Chat e "voltar pra Home" em `CaptainRiding`/`CaptainWallet`, fechar modal em `CaptainWallet` |
| `htmlFor`/`id` em labels | Login (email/senha), OTP em `ConfirmRidePopUp`, os 5 `FileInput` do cadastro |
| `aria-label` em campos sem `<label>` | Todo input/select de `CaptainSignup.jsx` que só tinha `placeholder` (17 campos) |
| `autoComplete` | Login (email/senha) e Signup (nome, sobrenome, telefone, e-mail, nova senha) |
| Texto < 12px → `text-xs` (12px) | Os 20 restantes, em `CaptainDetails`, `CaptainHeader`, `CaptainEarnings`, `CaptainRiding`, `CaptainSignup`, `CaptainWallet` |
| Alvo de toque → 44px (`h-11 w-11`) | Os 4 botões de ícone da barra superior de `CaptainRiding` (home/navegar/ligar/chat), o botão Home de `CaptainWallet`, o X de fechar do modal de recarga |
| Contraste (`ink-400` → `ink-600`) | Legendas/textos informativos não-decorativos (labels de métricas, "Redirecionando...", data de transação, aviso de reCAPTCHA) — mantido `ink-400` só em ícones decorativos e `placeholder` (convenção aceita) |

**Como verifico:** build limpo, suíte na baseline, remedição das métricas, verificação ao vivo confirmando `htmlFor`/`aria-label`/`type` no DOM real.

**Nada será commitado sem pedido explícito.**

---

## Detalhes da execução

**Status: concluído e verificado em 2026-08-02.**

Boa parte do trabalho pesado desta etapa já tinha sido feito de graça pelas Etapas 3-8, ao adotar o UI kit — por isso o volume real de mudança aqui foi menor do que os números originais do relatório sugeriam. O que sobrou foi majoritariamente mecânico: tipografia, `type`, e rótulos de formulário.

**`CaptainSignup.jsx` foi o arquivo com mais mudança:** 17 campos ganharam `aria-label` (usando o próprio texto do `placeholder` como valor, sem mudar nada visualmente), os 2 `<select>` sem rótulo visível ganharam `aria-label` explícito, o input de data sem `placeholder` ganhou `aria-label="Validade da CNH"`, e os 5 `FileInput` ganharam `id`/`htmlFor` (cada um com um id único, passado como prop nova no componente). `autoComplete` adicionado nos 5 campos com token padrão óbvio (nome, sobrenome, telefone, e-mail, nova senha) — não adicionado em campos sem token padrão real (CPF, número da CNH, placa, etc.).

**Decisão sobre o formulário de cadastro como um todo:** optei por `aria-label` em vez de reestruturar todo o formulário pra usar `<label>` visíveis antes de cada campo — a segunda opção mudaria o layout visual inteiro (hoje é só `placeholder`), um escopo bem maior que o classificado como "Baixo" nesta etapa. `aria-label` resolve a falta de nome acessível sem tocar no design.

**Contraste:** não bumpei `text-ink-400` indiscriminadamente — mantive em ícones decorativos (nunca carregam informação sozinhos) e em `placeholder` de input (convenção aceita amplamente, inclusive pelo WCAG, que não exige que placeholder atinja o mesmo contraste de texto real). Bumpei pra `ink-600` só onde havia texto informativo de verdade sendo lido (rótulos de métricas, timestamps, avisos).

**Não mexido, por decisão consciente:** o `<div onClick>` que cobre toda a barra inferior de `CaptainRiding.jsx` (abre o painel de finalizar corrida ao tocar em qualquer lugar do card) continua não-semântico — mas a mesma ação já está disponível através do botão real "Concluir" logo ao lado, então motorista de teclado/leitor de tela não perde a funcionalidade, só não tem esse atalho de "tocar em qualquer lugar do card". Considerei desproporcional adicionar `role="button"`/`tabIndex`/`onKeyDown` a um wrapper cuja função já é 100% coberta por um controle acessível de verdade.

**Build:** `vite build` limpo. **Testes:** frontend na baseline de sempre (`3 falhas | 4 passes`) — esta etapa não tocou backend, suíte do backend inalterada em `92 passes`.

**Verificação ao vivo (servidor de dev real, navegador real):** confirmado no DOM renderizado (não só no código-fonte): `label[for="captain-login-email"]` existe e aponta pro campo certo; o campo de e-mail do login tem `autocomplete="email"`; o botão "Ficar Online" expõe seu texto como nome acessível; o atalho "Carteira" tem `type="button"` de verdade no DOM; o campo "Nome" do cadastro tem `aria-label="Nome"`; o upload da CNH (frente) tem `label[for="file-cnh-front"]` associado ao input real.

**Nada foi commitado.**
