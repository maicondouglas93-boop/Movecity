/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // Tokens do sistema de design (auditoria de UI/UX, 2026-08-01). Só adiciona —
      // nenhum token padrão do Tailwind é sobrescrito, então nada que já usa
      // green-500/gray-800/rounded-xl/etc em telas ainda não migradas quebra.
      colors: {
        brand: {
          50: '#eefdf3',
          100: '#d9f9e4',
          500: '#22c55e', // mesmo tom do green-500 já usado — vira o nome semântico
          600: '#16a34a', // mesmo tom do green-600 (hover/active) — ok como fundo, mas
                           // ~3.4:1 sobre branco, abaixo do AA (4.5:1) pra texto normal
          700: '#15803d', // ~4.5:1 sobre branco — reservado pra texto/link solto em
                           // verde (item 15 da auditoria de UX); 500/600 continuam ok
                           // como fundo de botão (texto branco por cima) ou ícone.
        },
        ink: {
          900: '#111827', // texto principal
          600: '#4b5563', // texto secundário
          400: '#9ca3af', // texto auxiliar / placeholder
        },
        surface: {
          DEFAULT: '#ffffff', // fundo de página / cartão
          alt: '#f9fafb',     // fundo de área "rebaixada" (inputs, chips)
        },
        line: '#e5e7eb', // única cor de borda do sistema novo
        danger: {
          50: '#fef2f2',
          500: '#ef4444',
          600: '#dc2626',
        },
      },
      // Escala de elevação fechada em 3 níveis — ver §4.2 do plano de redesign.
      boxShadow: {
        raised: '0 2px 12px rgba(15, 23, 42, 0.08)',
        floating: '0 12px 40px rgba(15, 23, 42, 0.16)',
      },
      // Nome novo (não sobrescreve rounded-md/xl/2xl já usados) para não afetar
      // nenhuma tela ainda não migrada ao novo sistema.
      borderRadius: {
        panel: '14px',
      },
      // Convenção de camadas — ver §4.6 do plano. Uso: z-base/z-panel/z-overlay/z-modal.
      zIndex: {
        base: '0',
        panel: '10',
        overlay: '40',
        modal: '50',
      },
    },
  },
  plugins: [],
}

