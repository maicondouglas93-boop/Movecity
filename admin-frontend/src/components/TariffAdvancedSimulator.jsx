import React, { useState, useEffect } from 'react';
import { Calculator, MapPin, TrendingUp, DollarSign, Info } from 'lucide-react';

export default function TariffAdvancedSimulator({ values, platformCommission = 15 }) {
  const [distance, setDistance] = useState(10);
  const [time, setTime] = useState(20);
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [dailyRides, setDailyRides] = useState(100);
  const [useApi, setUseApi] = useState(false);

  // Calcula baseado nos valores ao vivo do formulário (watch)
  const base = parseFloat(values?.baseFare) || 0;
  const kmRate = parseFloat(values?.perKmRate) || 0;
  const minRate = parseFloat(values?.perMinuteRate) || 0;
  const minimum = parseFloat(values?.minFare) || 0;
  
  const distanceFare = distance * kmRate;
  const timeFare = time * minRate;
  let subtotal = base + distanceFare + timeFare;
  
  const dynMult = parseFloat(values?.dynamicMultiplier) || 1.0;
  const rainMult = parseFloat(values?.rainFeeMultiplier) || 1.0;
  let totalSemMinimo = subtotal * dynMult * rainMult;
  
  let total = totalSemMinimo;
  let isMinimumApplied = false;
  if (total < minimum) {
    total = minimum;
    isMinimumApplied = true;
  }
  
  const platformFee = total * (platformCommission / 100);
  const driverEarnings = total - platformFee;

  // Calculo Diário
  const avgTicket = total;
  const estimatedRevenue = avgTicket * dailyRides;
  const estimatedPlatformRevenue = platformFee * dailyRides;

  return (
    <div className="bg-surface rounded-xl border border-border overflow-hidden flex flex-col h-full shadow-lg">
      <div className="bg-primary/10 border-b border-border p-4 flex items-center gap-2">
        <Calculator className="w-5 h-5 text-primary" />
        <h3 className="font-semibold text-lg text-primary">Simulador Avançado</h3>
      </div>
      
      <div className="p-5 space-y-5 flex-1 overflow-y-auto no-scrollbar">
        {/* Toggle Real/Manual */}
        <div className="flex gap-2 p-1 bg-background rounded-lg border border-border">
          <button 
            type="button"
            onClick={() => setUseApi(false)}
            className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${!useApi ? 'bg-surface text-text shadow-sm' : 'text-text-muted hover:text-text'}`}
          >
            Manual (Km/Min)
          </button>
          <button 
            type="button"
            onClick={() => setUseApi(true)}
            className={`flex-1 py-1.5 text-sm font-medium rounded-md transition-colors ${useApi ? 'bg-surface text-text shadow-sm' : 'text-text-muted hover:text-text'}`}
          >
            Real (Mapa API)
          </button>
        </div>

        {/* Inputs */}
        {!useApi ? (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Distância (km)</label>
              <input type="number" min="1" step="0.5" value={distance} onChange={(e) => setDistance(Number(e.target.value) || 0)} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Tempo (min)</label>
              <input type="number" min="1" step="1" value={time} onChange={(e) => setTime(Number(e.target.value) || 0)} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none" />
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Endereço de Origem</label>
              <div className="relative">
                <MapPin className="absolute left-3 top-2.5 w-4 h-4 text-text-muted" />
                <input type="text" placeholder="Ex: Av. Paulista, 1000" className="w-full bg-background border border-border rounded-lg pl-9 pr-3 py-2 text-text focus:border-primary outline-none" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">Endereço de Destino</label>
              <div className="relative">
                <MapPin className="absolute left-3 top-2.5 w-4 h-4 text-text-muted" />
                <input type="text" placeholder="Ex: Aeroporto de Guarulhos" className="w-full bg-background border border-border rounded-lg pl-9 pr-3 py-2 text-text focus:border-primary outline-none" />
              </div>
            </div>
            <button type="button" className="w-full bg-primary/20 hover:bg-primary/30 text-primary py-2 rounded-lg font-medium text-sm transition-colors border border-primary/30">
              Traçar Rota via Google Maps
            </button>
          </div>
        )}

        {/* Fórmula Explicada */}
        <div className="bg-background/50 border border-border rounded-lg p-3 text-xs">
          <div className="flex items-center gap-1.5 text-text-muted mb-2">
            <Info className="w-3.5 h-3.5" />
            <span className="font-semibold">Fórmula Aplicada</span>
          </div>
          <p className="font-mono text-[11px] leading-relaxed break-words text-text-muted">
            ( Base + (Km × R$Km) + (Min × R$Min) ) × Demanda × Chuva = Total
          </p>
        </div>

        {/* Breakdown */}
        <div className="space-y-2 text-sm pt-2">
          <div className="flex justify-between">
            <span className="text-text-muted">Base Tarifária</span>
            <span>R$ <span>{base.toFixed(2)}</span></span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-muted">Distância (<span>{distance}</span> km)</span>
            <span>R$ <span>{distanceFare.toFixed(2)}</span></span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-muted">Tempo (<span>{time}</span> min)</span>
            <span>R$ <span>{timeFare.toFixed(2)}</span></span>
          </div>
          
          <div className="border-t border-border/50 my-1"></div>
          
          <div className="flex justify-between font-medium">
            <span>Subtotal</span>
            <span>R$ <span>{subtotal.toFixed(2)}</span></span>
          </div>

          {(dynMult !== 1.0 || rainMult !== 1.0) && (
            <>
              {dynMult !== 1.0 && (
                <div className="flex justify-between text-warning">
                  <span>Alta Demanda</span>
                  <span>x<span>{dynMult.toFixed(2)}</span></span>
                </div>
              )}
              {rainMult !== 1.0 && (
                <div className="flex justify-between text-info">
                  <span>Taxa de Chuva</span>
                  <span>x<span>{rainMult.toFixed(2)}</span></span>
                </div>
              )}
              <div className="flex justify-between font-medium text-text">
                <span>Subtotal com Multiplicador</span>
                <span>R$ <span>{totalSemMinimo.toFixed(2)}</span></span>
              </div>
            </>
          )}

          {isMinimumApplied && (
            <div className="flex justify-between text-danger font-medium bg-danger/10 px-2 py-1 rounded">
              <span>Garantia de Tarifa Mínima</span>
              <span>R$ <span>{minimum.toFixed(2)}</span></span>
            </div>
          )}
        </div>
        
        <div className="border-t border-border pt-3 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-success font-medium">Motorista Recebe ({(100 - platformCommission)}% · corrida app)</span>
            <span className="text-success">R$ <span>{driverEarnings.toFixed(2)}</span></span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-primary font-medium">Plataforma Recebe ({platformCommission}% · corrida app)</span>
            <span className="text-primary">R$ <span>{platformFee.toFixed(2)}</span></span>
          </div>
        </div>
        
      </div>
      
      <div className="bg-background border-t border-border p-5">
        <div className="flex justify-between items-end mb-4">
          <span className="text-text-muted font-medium">Passageiro Paga</span>
          <span className="text-3xl font-bold text-text">R$ <span>{total.toFixed(2)}</span></span>
        </div>
        
        {/* Simular Lucro */}
        <div className="bg-surface border border-border rounded-lg p-3 space-y-3">
          <div className="flex items-center gap-1.5 text-text-muted mb-1 text-xs font-semibold uppercase tracking-wider">
            <TrendingUp className="w-3.5 h-3.5" />
            <span>Projeção de Faturamento Diário</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="block text-[10px] text-text-muted uppercase">Corridas/Dia</label>
              <input type="number" min="1" value={dailyRides} onChange={(e) => setDailyRides(Number(e.target.value) || 0)} className="w-full bg-background border border-border rounded px-2 py-1 text-sm text-text focus:border-primary outline-none mt-1" />
            </div>
            <div className="flex-1 text-right">
              <label className="block text-[10px] text-text-muted uppercase">Receita Bruta</label>
              <div className="font-semibold text-text mt-1.5">R$ <span>{estimatedRevenue.toFixed(0)}</span></div>
            </div>
            <div className="flex-1 text-right">
              <label className="block text-[10px] text-primary uppercase">Receita Plataforma</label>
              <div className="font-bold text-primary mt-1.5">R$ <span>{estimatedPlatformRevenue.toFixed(0)}</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
