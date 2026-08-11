// Badge de status única para o painel (auditoria de UX, 2026-08-10) — antes cada tela
// montava sua própria <span> com classes de cor inline, repetindo o mesmo markup.
export default function StatusBadge({ label, colorClass, className = '' }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border whitespace-nowrap ${colorClass || 'bg-background text-text-muted border-border'} ${className}`}
    >
      {label}
    </span>
  );
}
