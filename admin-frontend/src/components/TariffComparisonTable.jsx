import React from 'react';

export default function TariffComparisonTable({ categories }) {
  if (!categories || categories.length === 0) return null;

  return (
    <div className="bg-surface rounded-xl border border-border overflow-hidden">
      <div className="bg-background/50 border-b border-border p-4">
        <h3 className="font-semibold text-lg">Comparativo de Categorias</h3>
        <p className="text-sm text-text-muted mt-1">Visualize facilmente as diferenças tarifárias entre as modalidades.</p>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead className="bg-background/30 text-text-muted border-b border-border">
            <tr>
              <th className="p-4 font-medium">Categoria</th>
              <th className="p-4 font-medium">Status</th>
              <th className="p-4 font-medium">Base (R$)</th>
              <th className="p-4 font-medium">Por Km (R$)</th>
              <th className="p-4 font-medium">Por Min (R$)</th>
              <th className="p-4 font-medium">Mínima (R$)</th>
              <th className="p-4 font-medium">Chuva</th>
              <th className="p-4 font-medium">Demanda</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {categories.map((cat) => (
              <tr key={cat._id} className="hover:bg-background/30 transition-colors">
                <td className="p-4 font-medium text-text">{cat.displayName}</td>
                <td className="p-4">
                  <span className={`px-2 py-1 rounded-full text-[10px] font-bold tracking-wide uppercase ${cat.isActive ? 'bg-success/20 text-success' : 'bg-danger/20 text-danger'}`}>
                    {cat.isActive ? 'Ativo' : 'Inativo'}
                  </span>
                </td>
                <td className="p-4 font-medium">{cat.baseFare?.toFixed(2)}</td>
                <td className="p-4">{cat.perKmRate?.toFixed(2)}</td>
                <td className="p-4">{cat.perMinuteRate?.toFixed(2)}</td>
                <td className="p-4 text-primary font-medium">{cat.minFare?.toFixed(2)}</td>
                <td className="p-4 text-info">x{cat.rainFeeMultiplier?.toFixed(1) || '1.0'}</td>
                <td className="p-4 text-warning">x{cat.dynamicMultiplier?.toFixed(1) || '1.0'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
