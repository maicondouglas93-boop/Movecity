// Auditoria do painel administrativo (2026-08-02, Bloco J, achado S7): as 3 exportações
// de CSV concatenavam string direto, sem escapar. Duas falhas reais:
// 1) Um valor com vírgula/aspas/quebra de linha (nome de passageiro, endereço) quebrava
//    o alinhamento das colunas do arquivo inteiro.
// 2) Um valor começando com =, +, -, @ é interpretado como fórmula por Excel/Sheets —
//    um nome de passageiro tipo "=HYPERLINK(...)" executa ao abrir o arquivo exportado
//    (CSV injection). Neutralizado prefixando com um apóstrofo.
export function escapeCsvField(value) {
  const str = value === null || value === undefined ? '' : String(value);
  const neutralized = /^[=+\-@]/.test(str) ? `'${str}` : str;
  if (/[",\n\r]/.test(neutralized)) {
    return `"${neutralized.replace(/"/g, '""')}"`;
  }
  return neutralized;
}

// headers: string[]; rows: array de arrays (mesma ordem dos headers)
export function buildCsv(headers, rows) {
  const lines = [headers.map(escapeCsvField).join(',')];
  rows.forEach((row) => {
    lines.push(row.map(escapeCsvField).join(','));
  });
  return 'data:text/csv;charset=utf-8,' + encodeURIComponent(lines.join('\n'));
}

export function downloadCsv(dataUri, filename) {
  const link = document.createElement('a');
  link.setAttribute('href', dataUri);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
