import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import api from '../services/api';
import {
  Gift, Tag, DollarSign, MapPin, Calculator, Copy,
  PauseCircle, PlayCircle, BarChart3, Wallet, CheckCircle2
} from 'lucide-react';
import { useToast } from '../contexts/ToastContext';
import { formatMoney } from '../utils/format';

// Auditoria de UX/produção (2026-08-10) — status "efetivo" calculado pelo backend
// (getPromotions) cobre também expired/exhausted, que não existem no enum
// persistido (promotion.model.js:57) mas refletem a regra real de resgate.
const PROMO_STATUS_LABELS = {
  active: 'Ativa',
  paused: 'Pausada',
  draft: 'Rascunho',
  scheduled: 'Agendada',
  finished: 'Finalizada',
  cancelled: 'Cancelada',
  expired: 'Expirada',
  exhausted: 'Orçamento esgotado',
};
const PROMO_STATUS_COLORS = {
  active: 'bg-primary/10 text-primary border-primary/20',
  paused: 'bg-warning/10 text-warning border-warning/20',
  draft: 'bg-background text-text-muted border-border',
  scheduled: 'bg-info/10 text-info border-info/20',
  finished: 'bg-background text-text-muted border-border',
  cancelled: 'bg-danger/10 text-danger border-danger/20',
  expired: 'bg-danger/10 text-danger border-danger/20',
  exhausted: 'bg-warning/10 text-warning border-warning/20',
};

export default function Promotions() {
  const [activeTab, setActiveTab] = useState('new');
  const [simulation, setSimulation] = useState({ rideValue: 50, result: null });
  const queryClient = useQueryClient();
  const toast = useToast();

  const { register, handleSubmit, watch, reset } = useForm({
    defaultValues: {
      type: 'coupon',
      code: '',
      title: '',
      description: '',
      discountType: 'percentage',
      value: 10,
      maxDiscountLimit: '',
      rules: {
        cities: '',
        vehicleCategories: [],
        paymentMethods: [],
        userTags: [],
        timeWindow: { startTime: '', endTime: '' },
        firstRideOnly: false
      },
      startDate: new Date().toISOString().split('T')[0],
      endDate: '',
      budgetLimit: '',
      globalUsageLimit: '',
      usagePerUserLimit: 1,
      sendPush: false
    }
  });

  const formValues = watch();

  const { data: promosData, isLoading } = useQuery({
    queryKey: ['promotions'],
    queryFn: async () => {
      const res = await api.get('/admin/promotions');
      return res.data;
    },
    enabled: activeTab === 'list'
  });

  const createMutation = useMutation({
    mutationFn: async (data) => await api.post('/admin/promotions', data),
    onSuccess: () => {
      toast.success('Cupom criado com sucesso!');
      reset();
      queryClient.invalidateQueries({ queryKey: ['promotions'] });
      setActiveTab('list');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Erro ao criar cupom')
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }) => await api.put(`/admin/promotions/${id}/status`, { status }),
    onSuccess: () => {
      toast.success('Status atualizado!');
      queryClient.invalidateQueries({ queryKey: ['promotions'] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Erro ao atualizar status do cupom')
  });

  const simulateMutation = useMutation({
    mutationFn: async (data) => await api.post('/admin/promotions/simulate', data),
    onSuccess: (res) => setSimulation(prev => ({ ...prev, result: res.data })),
    onError: (err) => toast.error(err.response?.data?.message || 'Erro ao simular cupom')
  });

  const onSubmit = (data) => {
    const payload = { ...data, type: 'coupon', code: data.code.trim().toUpperCase() };
    // Process CSV strings to arrays
    if (payload.rules.cities) {
      payload.rules.cities = payload.rules.cities.split(',').map(s => s.trim());
    } else {
      payload.rules.cities = [];
    }
    // Parse numeric fields safely
    payload.value = Number(payload.value);
    payload.maxDiscountLimit = payload.discountType === 'percentage' && payload.maxDiscountLimit
      ? Number(payload.maxDiscountLimit)
      : undefined;
    payload.budgetLimit = payload.budgetLimit ? Number(payload.budgetLimit) : undefined;
    payload.globalUsageLimit = payload.globalUsageLimit ? Number(payload.globalUsageLimit) : undefined;
    payload.usagePerUserLimit = payload.usagePerUserLimit ? Number(payload.usagePerUserLimit) : 1;
    
    createMutation.mutate(payload);
  };

  const handleSimulate = () => {
    simulateMutation.mutate({
      rideValue: simulation.rideValue,
      promotionData: formValues
    });
  };

  const handleDuplicate = (promo) => {
    reset({
      type: 'coupon',
      title: promo.title + ' (Cópia)',
      code: promo.code ? `${promo.code.slice(0, 25)}_COPY` : '',
      description: promo.description || '',
      discountType: ['percentage', 'fixed'].includes(promo.discountType) ? promo.discountType : 'percentage',
      value: promo.value,
      maxDiscountLimit: promo.maxDiscountLimit || '',
      rules: {
        ...promo.rules,
        cities: promo.rules.cities?.join(', ') || ''
      },
      startDate: new Date().toISOString().split('T')[0],
      endDate: '',
      budgetLimit: promo.budgetLimit || '',
      globalUsageLimit: promo.globalUsageLimit || '',
      usagePerUserLimit: promo.usagePerUserLimit || 1,
      sendPush: false
    });
    setActiveTab('new');
    toast.success('Cupom carregado no formulário!');
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-20">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Cupons de Desconto</h1>
        <p className="text-text-muted mt-1">Crie cupons por porcentagem ou valor fixo e controle validade, regras e orçamento.</p>
      </div>

      <div className="flex border-b border-border">
        <button onClick={() => setActiveTab('new')} className={`px-6 py-3 font-medium text-sm transition-colors border-b-2 ${activeTab === 'new' ? 'border-primary text-primary' : 'border-transparent text-text-muted hover:text-text'}`}>Criar Cupom</button>
        <button onClick={() => setActiveTab('list')} className={`px-6 py-3 font-medium text-sm transition-colors border-b-2 ${activeTab === 'list' ? 'border-primary text-primary' : 'border-transparent text-text-muted hover:text-text'}`}>Cupons Cadastrados</button>
      </div>

      {activeTab === 'new' && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
          <div className="xl:col-span-2 space-y-6">
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              
              {/* Seção 1: Básico */}
              <div className="bg-surface border border-border p-6 rounded-xl space-y-5">
                <h2 className="text-sm font-bold uppercase tracking-wider text-text flex items-center gap-2"><Tag className="w-4 h-4" /> 1. Configuração Básica</h2>
                
                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">Código do Cupom</label>
                  <input type="text" {...register('code')} required minLength={3} maxLength={30} placeholder="Ex: CARNAVAL20" className="w-full bg-background border border-border rounded-lg p-3 text-sm focus:border-primary outline-none uppercase" />
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">Título do Cupom (Interno/App)</label>
                  <input type="text" {...register('title')} required placeholder="Ex: Especial de Carnaval" className="w-full bg-background border border-border rounded-lg p-3 text-sm focus:border-primary outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">Descrição</label>
                  <input type="text" {...register('description')} placeholder="Válido para todas as corridas no feriado" className="w-full bg-background border border-border rounded-lg p-3 text-sm focus:border-primary outline-none" />
                </div>
              </div>

              {/* Seção 2: Benefício */}
              <div className="bg-surface border border-border p-6 rounded-xl space-y-5">
                <h2 className="text-sm font-bold uppercase tracking-wider text-text flex items-center gap-2"><Gift className="w-4 h-4" /> 2. O Benefício</h2>
                
                <div className={`grid grid-cols-1 ${formValues.discountType === 'percentage' ? 'sm:grid-cols-3' : 'sm:grid-cols-2'} gap-4`}>
                  <div>
                    <label className="block text-xs font-medium text-text-muted mb-1">Mecânica</label>
                    <select {...register('discountType')} className="w-full bg-background border border-border rounded-lg p-3 text-sm focus:border-primary outline-none">
                      <option value="percentage">Porcentagem (%)</option>
                      <option value="fixed">Valor Fixo (R$)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-muted mb-1">{formValues.discountType === 'percentage' ? 'Porcentagem (%)' : 'Desconto (R$)'}</label>
                    <input type="number" {...register('value')} required min="0.01" max={formValues.discountType === 'percentage' ? 100 : undefined} step="0.01" className="w-full bg-background border border-border rounded-lg p-3 text-sm focus:border-primary outline-none" />
                  </div>
                  {formValues.discountType === 'percentage' && (
                    <div>
                      <label className="block text-xs font-medium text-text-muted mb-1">Teto Máximo (R$)</label>
                      <input type="number" {...register('maxDiscountLimit')} min="0.01" step="0.01" placeholder="Sem limite" className="w-full bg-background border border-border rounded-lg p-3 text-sm focus:border-primary outline-none" />
                    </div>
                  )}
                </div>
              </div>

              {/* Seção 3: Segmentação */}
              <div className="bg-surface border border-border p-6 rounded-xl space-y-5">
                <h2 className="text-sm font-bold uppercase tracking-wider text-text flex items-center gap-2"><MapPin className="w-4 h-4" /> 3. Segmentação (Opcional)</h2>
                
                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">Cidades Permitidas (Separar por vírgula)</label>
                  <input type="text" {...register('rules.cities')} placeholder="Ex: Lajinha, Mutum, Ibatiba" className="w-full bg-background border border-border rounded-lg p-3 text-sm focus:border-primary outline-none" />
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <label className="flex items-center gap-3 p-3 border border-border rounded-lg bg-background cursor-pointer hover:border-primary/50 transition-colors">
                    <input type="checkbox" {...register('rules.firstRideOnly')} className="w-4 h-4 text-primary bg-surface border-border rounded focus:ring-primary" />
                    <span className="text-sm font-medium">Apenas Primeira Corrida (Novos)</span>
                  </label>
                  <label className="flex items-center gap-3 p-3 border border-border rounded-lg bg-background cursor-pointer hover:border-primary/50 transition-colors">
                    <input type="checkbox" value="pix" {...register('rules.paymentMethods')} className="w-4 h-4 text-primary bg-surface border-border rounded focus:ring-primary" />
                    <span className="text-sm font-medium">Obrigatório pagar via PIX</span>
                  </label>
                  <label className="flex items-center gap-3 p-3 border border-border rounded-lg bg-background cursor-pointer hover:border-primary/50 transition-colors">
                    <input type="checkbox" value="Moto" {...register('rules.vehicleCategories')} className="w-4 h-4 text-primary bg-surface border-border rounded focus:ring-primary" />
                    <span className="text-sm font-medium">Restringir para Moto</span>
                  </label>
                  <div className="flex gap-2">
                    <input type="time" {...register('rules.timeWindow.startTime')} className="flex-1 bg-background border border-border rounded-lg p-2 text-xs focus:border-primary outline-none" />
                    <span className="flex items-center text-text-muted text-xs">às</span>
                    <input type="time" {...register('rules.timeWindow.endTime')} className="flex-1 bg-background border border-border rounded-lg p-2 text-xs focus:border-primary outline-none" />
                  </div>
                </div>
              </div>

              {/* Seção 4: Orçamento e Agendamento */}
              <div className="bg-surface border border-border p-6 rounded-xl space-y-5">
                <h2 className="text-sm font-bold uppercase tracking-wider text-text flex items-center gap-2"><DollarSign className="w-4 h-4" /> 4. Orçamento & Validade</h2>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-text-muted mb-1">Data Início</label>
                    <input type="date" {...register('startDate')} required className="w-full bg-background border border-border rounded-lg p-3 text-sm focus:border-primary outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-muted mb-1">Data Fim (Opcional)</label>
                    <input type="date" {...register('endDate')} className="w-full bg-background border border-border rounded-lg p-3 text-sm focus:border-primary outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-muted mb-1">Orçamento Máximo (R$)</label>
                    <input type="number" {...register('budgetLimit')} min="0.01" step="0.01" placeholder="Sem teto" className="w-full bg-background border border-border rounded-lg p-3 text-sm focus:border-primary outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-muted mb-1">Máx. de Usos do Cupom</label>
                    <input type="number" {...register('globalUsageLimit')} min="1" placeholder="Sem limite" className="w-full bg-background border border-border rounded-lg p-3 text-sm focus:border-primary outline-none" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-muted mb-1">Max Usos (Por Usuário)</label>
                    <input type="number" {...register('usagePerUserLimit')} min="1" className="w-full bg-background border border-border rounded-lg p-3 text-sm focus:border-primary outline-none" />
                  </div>
                </div>
              </div>
              
              <div className="flex gap-4 p-4 bg-primary/10 border border-primary/20 rounded-xl items-center">
                <input type="checkbox" {...register('sendPush')} id="sendPush" className="w-5 h-5 text-primary bg-surface border-primary rounded focus:ring-primary" />
                <label htmlFor="sendPush" className="font-bold text-primary cursor-pointer">Enviar notificação aos passageiros com o código do cupom</label>
              </div>

              <div className="pt-4 pb-10">
                <button type="submit" disabled={createMutation.isPending} className="w-full bg-primary hover:bg-primary/90 text-white font-medium py-4 rounded-xl flex items-center justify-center gap-2 transition-colors shadow-lg disabled:opacity-50 text-lg">
                  Criar e Ativar Cupom
                </button>
              </div>
            </form>
          </div>

          {/* Sidebar: Simulador */}
          <div className="xl:col-span-1 space-y-6">
            <div className="sticky top-6">
              <div className="bg-surface border border-border rounded-xl shadow-sm p-6 overflow-hidden relative">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-primary to-info"></div>
                <h3 className="text-lg font-bold flex items-center gap-2 mb-6 text-text">
                  <Calculator className="w-5 h-5 text-primary" /> Simulador do Cupom
                </h3>

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-text-muted mb-1">Valor da Corrida Simulado (R$)</label>
                    <div className="flex gap-2">
                      <input 
                        type="number" 
                        value={simulation.rideValue} 
                        onChange={(e) => setSimulation({ ...simulation, rideValue: Number(e.target.value) })}
                        className="flex-1 bg-background border border-border rounded-lg p-3 text-sm font-bold focus:border-primary outline-none" 
                      />
                      <button onClick={handleSimulate} disabled={simulateMutation.isPending} className="px-4 bg-primary/10 text-primary hover:bg-primary/20 rounded-lg font-bold transition-colors">
                        Simular
                      </button>
                    </div>
                  </div>

                  {simulation.result ? (
                    <div className="mt-6 pt-6 border-t border-border space-y-4 animate-slide-up">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-text-muted">Valor Original:</span>
                        <span className="font-bold line-through text-text-muted">R$ {simulation.result.rideValue.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between items-center text-success">
                        <span className="text-sm font-bold">Desconto Aplicado:</span>
                        <span className="font-bold">- R$ {simulation.result.discountApplied.toFixed(2)}</span>
                      </div>
                      
                      <div className="bg-background rounded-lg p-4 mt-4 border border-border space-y-3">
                        <div className="flex justify-between items-center">
                          <span className="text-sm font-medium text-text">Cliente Paga:</span>
                          <span className="text-lg font-black text-text">R$ {simulation.result.clientPays.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-medium text-primary">Subsídio (MoveCity paga):</span>
                          <span className="text-sm font-bold text-primary">R$ {simulation.result.subsidy.toFixed(2)}</span>
                        </div>
                      </div>
                      
                      <p className="text-[10px] text-text-muted text-center pt-2">Simulação não considera taxas dinâmicas ou retenção do motorista. Exibe o impacto bruto da promoção.</p>
                    </div>
                  ) : (
                    <div className="py-12 text-center text-text-muted flex flex-col items-center justify-center opacity-50">
                      <BarChart3 className="w-12 h-12 mb-3" />
                      <p className="text-sm">Clique em simular para ver<br/>quem paga a conta.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'list' && (
        <div className="space-y-6">
          {/* Auditoria de UX/produção (2026-08-10): removido o card "Receita Estimada" —
              somava metrics.revenueGenerated, campo que existe no schema mas nenhum
              lugar do backend jamais escreve (sempre R$ 0,00, dado fantasma). */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-surface p-5 rounded-xl border border-border flex items-center gap-4">
              <div className="p-3 bg-primary/20 text-primary rounded-lg"><Tag className="w-6 h-6" /></div>
              <div><p className="text-xs text-text-muted uppercase font-bold">Ativas agora</p><p className="text-2xl font-black">{promosData?.promotions?.filter(p => p.effectiveStatus === 'active').length || 0}</p></div>
            </div>
            <div className="bg-surface p-5 rounded-xl border border-border flex items-center gap-4">
              <div className="p-3 bg-primary/20 text-primary rounded-lg"><CheckCircle2 className="w-6 h-6" /></div>
              <div><p className="text-xs text-text-muted uppercase font-bold">Resgates Totais</p><p className="text-2xl font-black">{promosData?.promotions?.reduce((acc, p) => acc + (p.metrics?.uses || 0), 0) || 0}</p></div>
            </div>
            <div className="bg-surface p-5 rounded-xl border border-border flex items-center gap-4">
              <div className="p-3 bg-danger/20 text-danger rounded-lg"><Wallet className="w-6 h-6" /></div>
              <div>
                <p className="text-xs text-text-muted uppercase font-bold">Subsídio Gasto</p>
                <p className="text-xl font-black">{formatMoney(promosData?.promotions?.reduce((acc, p) => acc + (p.metrics?.totalDiscountGiven || 0), 0))}</p>
              </div>
            </div>
          </div>

          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-background/50 border-b border-border text-text-muted">
                <tr>
                  <th className="p-4 font-bold uppercase text-[11px] tracking-wider">Cupom</th>
                  <th className="p-4 font-bold uppercase text-[11px] tracking-wider">Benefício</th>
                  <th className="p-4 font-bold uppercase text-[11px] tracking-wider">Orçamento / Uso</th>
                  <th className="p-4 font-bold uppercase text-[11px] tracking-wider">Status</th>
                  <th className="p-4 font-bold uppercase text-[11px] tracking-wider text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading ? (
                  <tr><td colSpan="5" className="p-8 text-center text-text-muted">Carregando cupons...</td></tr>
                ) : promosData?.promotions?.length === 0 ? (
                  <tr><td colSpan="5" className="p-8 text-center text-text-muted">Nenhum cupom cadastrado.</td></tr>
                ) : (
                  promosData?.promotions?.map(promo => {
                    const budgetUsed = promo.currentBudgetUsed || 0;
                    const budgetTotal = promo.budgetLimit;
                    const budgetPercent = budgetTotal ? Math.min(100, (budgetUsed / budgetTotal) * 100) : 0;
                    
                    return (
                      <tr key={promo._id} className="hover:bg-background/30 transition-colors">
                        <td className="p-4">
                          <p className="font-bold text-text mb-1 truncate max-w-[200px]" title={promo.title}>{promo.title}</p>
                          <div className="flex gap-2 items-center">
                            {promo.code ? (
                              <span className="text-[10px] font-mono bg-text/10 text-text px-1.5 py-0.5 rounded border border-border">{promo.code}</span>
                            ) : <span className="text-[10px] text-danger font-bold">Sem código</span>}
                            {promo.rules?.cities?.length > 0 && <span className="text-[10px] text-text-muted">📍 Local</span>}
                          </div>
                        </td>
                        <td className="p-4">
                          <p className="font-bold text-primary">
                            {promo.discountType === 'percentage' && `${promo.value}% OFF`}
                            {promo.discountType === 'fixed' && `${formatMoney(promo.value)} OFF`}
                          </p>
                          {promo.maxDiscountLimit && <p className="text-[10px] text-text-muted">Máximo R$ {promo.maxDiscountLimit}</p>}
                        </td>
                        <td className="p-4 w-48">
                          {budgetTotal ? (
                            <div>
                              <div className="flex justify-between text-[11px] mb-1">
                                <span className="font-medium text-text">R$ {budgetUsed.toFixed(0)}</span>
                                <span className="text-text-muted">R$ {budgetTotal}</span>
                              </div>
                              <div className="w-full bg-background rounded-full h-1.5 overflow-hidden border border-border">
                                <div className={`h-full ${budgetPercent > 90 ? 'bg-danger' : 'bg-primary'}`} style={{ width: `${budgetPercent}%` }}></div>
                              </div>
                            </div>
                          ) : (
                            <span className="text-[11px] text-text-muted bg-background px-2 py-1 rounded-full border border-border">Ilimitado</span>
                          )}
                        </td>
                        <td className="p-4">
                          {/* Auditoria de UX/produção (2026-08-10): status persistido nunca
                              transicionava sozinho quando orçamento acabava ou a data
                              passava — uma promoção esgotada ou vencida continuava com
                              badge verde "active" pra sempre. effectiveStatus (calculado
                              no backend a cada listagem, sem gravar nada) cobre isso. */}
                          <div className={`px-2 py-1 rounded-md text-[11px] font-bold w-max uppercase tracking-wider border ${PROMO_STATUS_COLORS[promo.effectiveStatus] || PROMO_STATUS_COLORS[promo.status] || 'bg-background text-text-muted border-border'}`}>
                            {PROMO_STATUS_LABELS[promo.effectiveStatus] || PROMO_STATUS_LABELS[promo.status] || promo.status}
                          </div>
                        </td>
                        <td className="p-4 text-right relative">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => handleDuplicate(promo)} className="p-2 text-text-muted hover:text-primary transition-colors" title="Duplicar">
                              <Copy className="w-4 h-4" />
                            </button>
                            {promo.status === 'active' ? (
                              <button onClick={() => statusMutation.mutate({ id: promo._id, status: 'paused' })} className="p-2 text-text-muted hover:text-warning transition-colors" title="Pausar">
                                <PauseCircle className="w-4 h-4" />
                              </button>
                            ) : (
                              <button onClick={() => statusMutation.mutate({ id: promo._id, status: 'active' })} className="p-2 text-text-muted hover:text-success transition-colors" title="Ativar">
                                <PlayCircle className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
