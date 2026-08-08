// Monta e imprime o relatório ASCII de cada cenário — sem processo orquestrador
// separado: cada arquivo de cenário chama printScenarioReport() no fim do seu próprio
// it(), e o Jest já cuida de rodar os arquivos (test:movecity roda todos --runInBand).
function line(char = '=', len = 78) {
    return char.repeat(len);
}

function printScenarioReport({ title, status, steps, metrics, problems = [], notes = [] }) {
    const out = [];
    out.push(line());
    out.push(`SIMULADOR E2E MOVECITY — ${title}`);
    out.push(line());
    out.push(`RESULTADO: ${status === 'PASS' ? 'PASS ✅' : 'FAIL ❌'}`);
    out.push('');
    out.push('Passos executados (fluxo real, sem lógica paralela):');
    steps.forEach((step, i) => {
        out.push(`  ${String(i + 1).padStart(2, '0')}. [${step.ok ? 'OK' : 'FALHOU'}] ${step.label}${step.detail ? ` — ${step.detail}` : ''}`);
    });
    if (metrics && Object.keys(metrics).length) {
        out.push('');
        out.push('Métricas reais capturadas:');
        Object.entries(metrics).forEach(([key, value]) => {
            out.push(`  - ${key}: ${value}`);
        });
    }
    if (problems.length) {
        out.push('');
        out.push('Problemas encontrados:');
        problems.forEach((p) => {
            out.push(`  [${p.severity}] ${p.description}`);
        });
    }
    if (notes.length) {
        out.push('');
        out.push('Notas (camadas mockadas/limitações conhecidas):');
        notes.forEach((n) => out.push(`  - ${n}`));
    }
    out.push(line());
    // eslint-disable-next-line no-console
    console.log(`\n${out.join('\n')}\n`);
    return out.join('\n');
}

module.exports = { printScenarioReport };
