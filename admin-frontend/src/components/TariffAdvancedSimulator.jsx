import React, { useState, useEffect } from 'react';
import { Calculator, TrendingUp, DollarSign, Info } from 'lucide-react';
import api from '../services/api';

export default function TariffAdvancedSimulator({ values, platformCommission = 20, categories = [] }) {
  const [distance, setDistance] = useState(10);
  const [time, setTime] = useState(20);
  const [waitTime, setWaitTime] = useState(0);
  const [extraStops, setExtraStops] = useState(0);
  const [dailyRides, setDailyRides] = useState(100);

  // Calcula baseado nos valores ao vivo do formulário (watch)
  const base = parseFloat(values?.baseFare) || 5.0;
  const kmRate = parseFloat(values?.perKm) || 2.0;
  const minRate = parseFloat(values?.perMinute) || 0.5;
  const minimum = parseFloat(values?.minimumFare) || 7.0;
  const commPct = parseFloat(values?.platformCommission) || platformCommission;
  
  const distanceFare = distance * kmRate;
  const timeFare = time * minRate;
  let subtotal = base + distanceFare + timeFare;

  let minAdjust = 0;
  if (subtotal < minimum) {
    minAdjust = minimum - subtotal;
    subtotal = minimum;
  }

  // Surcharges
  let waitCharge = 0;
  if (values?.surcharges?.waiting?.active && waitTime > (values?.surcharges?.waiting?.freeMinutes || 0)) {
    waitCharge = (waitTime - (values?.surcharges?.waiting?.freeMinutes || 0)) * (values?.surcharges?.waiting?.valuePerMinute || 0);
  }

  let stopsCharge = 0;
  if (values?.surcharges?.extraStops?.active) {
    stopsCharge = extraStops * (values?.surcharges?.extraStops?.valuePerStop || 0);
  }

  // Optionals
  const [selectedOptionals, setSelectedOptionals] = useState({});
  let optionalsCharge = 0;
  
  const categoryOptionals = values?.optionals || [];
  categoryOptionals.forEach(opt => {
      if (opt.isActive && selectedOptionals[opt.id]) {
          optionalsCharge += opt.value;
      }
  });

  let total = subtotal + waitCharge + stopsCharge + optionalsCharge;

  // Comissão (apenas uma aproximação local)
  const platformFee = total * (commPct / 100);
  const driverEarnings = total - platformFee;

  // Calculo Diário
  const avgTicket = total;
  const estimatedRevenue = avgTicket * dailyRides;
  const estimatedPlatformRevenue = platformFee * dailyRides;

  return (
    <div className="bg-surface rounded-xl border border-border overflow-hidden flex flex-col h-full shadow-lg">
      <div className="bg-primary/10 border-b border-border p-4 flex items-center gap-2">
        <Calculator className="w-5 h-5 text-primary" />
        <h3 className="font-semibold text-lg text-primary">Simulador (Valores em Edição)</h3>
      </div>
      
      <div className="p-5 space-y-5 flex-1 overflow-y-auto no-scrollbar">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Distância (km)</label>
            <input type="number" min="1" step="0.5" value={distance} onChange={(e) => setDistance(Number(e.target.value) || 0)} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Tempo (min)</label>
            <input type="number" min="1" step="1" value={time} onChange={(e) => setTime(Number(e.target.value) || 0)} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Tempo de Espera (min)</label>
            <input type="number" min="0" step="1" value={waitTime} onChange={(e) => setWaitTime(Number(e.target.value) || 0)} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1">Paradas Extras</label>
            <input type="number" min="0" step="1" value={extraStops} onChange={(e) => setExtraStops(Number(e.target.value) || 0)} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none" />
          </div>
        </div>

        {categoryOptionals.length > 0 && (
          <div className="pt-2">
            <label className="block text-xs font-medium text-text-muted mb-2">Simular Adicionais</label>
            <div className="flex flex-wrap gap-2">
              {categoryOptionals.filter(o => o.isActive).map(opt => (
                <label key={opt.id} className="flex items-center gap-1.5 bg-background border border-border px-2 py-1 rounded-md cursor-pointer hover:border-primary transition-colors">
                  <input 
                    type="checkbox" 
                    checked={!!selectedOptionals[opt.id]}
                    onChange={(e) => setSelectedOptionals(prev => ({...prev, [opt.id]: e.target.checked}))}
                  />
                  <span className="text-xs font-medium">{opt.name}</span>
                </label>
              ))}
            </div>
          </div>
        )}

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
            <span>Subtotal (sem mínimos/adicionais)</span>
            <span>R$ <span>{(base + distanceFare + timeFare).toFixed(2)}</span></span>
          </div>

          {minAdjust > 0 && (
            <div className="flex justify-between text-danger font-medium bg-danger/10 px-2 py-1 rounded">
              <span>Ajuste Tarifa Mínima</span>
              <span>+ R$ <span>{minAdjust.toFixed(2)}</span></span>
            </div>
          )}

          {waitCharge > 0 && (
            <div className="flex justify-between text-warning">
              <span>Taxa de Espera</span>
              <span>R$ <span>{waitCharge.toFixed(2)}</span></span>
            </div>
          )}

          {stopsCharge > 0 && (
            <div className="flex justify-between text-warning">
              <span>Paradas Extras</span>
              <span>R$ <span>{stopsCharge.toFixed(2)}</span></span>
            </div>
          )}

          {optionalsCharge > 0 && (
            <div className="flex justify-between text-warning">
              <span>Adicionais (Opcionais)</span>
              <span>R$ <span>{optionalsCharge.toFixed(2)}</span></span>
            </div>
          )}
        </div>
        
        <div className="border-t border-border pt-3 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-success font-medium">Motorista Recebe ({(100 - commPct).toFixed(0)}%)</span>
            <span className="text-success">R$ <span>{driverEarnings.toFixed(2)}</span></span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-primary font-medium">Plataforma Recebe ({commPct}%)</span>
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
