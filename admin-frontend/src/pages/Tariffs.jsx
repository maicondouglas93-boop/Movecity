import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { Save, Copy, RotateCcw, CalendarClock, Beaker, FileSearch, Plus, X } from 'lucide-react';
import { useForm } from 'react-hook-form';

import TariffAdvancedSimulator from '../components/TariffAdvancedSimulator';
import TariffHistory from '../components/TariffHistory';
import TariffSchedulerModal from '../components/TariffSchedulerModal';
import TariffComparisonTable from '../components/TariffComparisonTable';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';

const fetchGlobalTariffs = async () => {
  const { data } = await api.get('/admin/tariffs');
  return data;
};

const fetchVehicleCategories = async () => {
  const { data } = await api.get('/admin/vehicle-categories');
  return data;
};

export default function Tariffs() {
  const [activeTab, setActiveTab] = useState('general');
  const [testMode, setTestMode] = useState(false);
  const [newCategoryModalOpen, setNewCategoryModalOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: globalSettings, isLoading: loadingGlobal } = useQuery({
    queryKey: ['globalTariffs'],
    queryFn: fetchGlobalTariffs
  });

  const { data: categories, isLoading: loadingCategories } = useQuery({
    queryKey: ['vehicleCategories'],
    queryFn: fetchVehicleCategories
  });

  if (loadingGlobal || loadingCategories) return <div className="text-text-muted">Carregando motor de precificação...</div>;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:justify-between md:items-end gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Motor de Precificação Avançado</h1>
          <p className="text-text-muted mt-1">Gerencie taxas, realize agendamentos e simule o faturamento.</p>
        </div>
        
        {/* Test Mode Toggle */}
        <label className={`flex items-center gap-2 px-4 py-2 rounded-full cursor-pointer transition-colors border ${testMode ? 'bg-warning/20 border-warning text-warning' : 'bg-surface border-border text-text-muted hover:text-text'}`}>
          <Beaker className="w-4 h-4" />
          <span className="text-sm font-medium">Modo Teste</span>
          <input 
            type="checkbox" 
            checked={testMode}
            onChange={(e) => setTestMode(e.target.checked)} 
            className="hidden" 
          />
        </label>
      </div>
      
      {/* Tabs */}
      <div className="block md:hidden">
        <select 
          value={activeTab} 
          onChange={(e) => setActiveTab(e.target.value)}
          className="w-full bg-surface border border-border rounded-lg px-4 py-3 text-text font-medium outline-none"
        >
          <option value="general">Configurações Globais</option>
          <option value="comparison">Tabela Comparativa</option>
          {categories?.map(cat => (
            <option key={cat._id} value={cat._id}>{cat.displayName}</option>
          ))}
        </select>
      </div>

      <div className="hidden md:flex border-b border-border overflow-x-auto no-scrollbar">
        <button
          onClick={() => setActiveTab('general')}
          className={`px-6 py-3 font-medium text-sm whitespace-nowrap transition-colors border-b-2 ${activeTab === 'general' ? 'border-primary text-primary' : 'border-transparent text-text-muted hover:text-text'}`}
        >
          Globais
        </button>
        <button
          onClick={() => setActiveTab('comparison')}
          className={`px-6 py-3 font-medium text-sm whitespace-nowrap transition-colors border-b-2 ${activeTab === 'comparison' ? 'border-primary text-primary' : 'border-transparent text-text-muted hover:text-text'}`}
        >
          Comparativo
        </button>
        {categories?.map(cat => (
          <button
            key={cat._id}
            onClick={() => setActiveTab(cat._id)}
            className={`px-6 py-3 font-medium text-sm whitespace-nowrap transition-colors border-b-2 flex items-center gap-2 ${activeTab === cat._id ? 'border-primary text-primary' : 'border-transparent text-text-muted hover:text-text'}`}
          >
            {cat.displayName}
            {!cat.isActive && <span className="w-2 h-2 rounded-full bg-danger"></span>}
          </button>
        ))}
        <button
          onClick={() => setNewCategoryModalOpen(true)}
          className="px-6 py-3 font-medium text-sm whitespace-nowrap transition-colors border-b-2 border-transparent text-primary hover:text-primary-hover flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" /> Nova Categoria
        </button>
      </div>

      {newCategoryModalOpen && (
        <NewCategoryModal
          onClose={() => setNewCategoryModalOpen(false)}
          onCreated={(newCat) => {
            queryClient.invalidateQueries({ queryKey: ['vehicleCategories'] });
            setActiveTab(newCat._id);
            setNewCategoryModalOpen(false);
          }}
        />
      )}

      {/* Tab Content */}
      <div className="mt-6">
        {activeTab === 'general' && globalSettings && (
          <GlobalSettingsCard settings={globalSettings} queryClient={queryClient} testMode={testMode} />
        )}

        {activeTab === 'comparison' && categories && (
          <TariffComparisonTable categories={categories} />
        )}

        {activeTab !== 'general' && activeTab !== 'comparison' && categories && (
          categories.find(c => c._id === activeTab) ? (
            <div className="mt-6">
              <CategorySettingsCard
                key={activeTab}
                category={categories.find(c => c._id === activeTab)}
                queryClient={queryClient}
                testMode={testMode}
                platformCommission={
                  globalSettings?.platformCommissions?.ride ?? globalSettings?.platformCommission
                }
              />
            </div>
          ) : (
            <div className="text-text-muted mt-6">Carregando categoria...</div>
          )
        )}
      </div>
    </div>
  );
}

function GlobalSettingsCard({ settings, queryClient, testMode }) {
  const toast = useToast();
  const legacyCommission = settings.platformCommission ?? 20;
  const commissions = settings.platformCommissions || {
    ride: legacyCommission,
    presential: legacyCommission,
    parcel: legacyCommission,
  };
  const { register, handleSubmit, reset, formState: { isDirty } } = useForm({
    defaultValues: {
      cancellationFee: settings.cancellationFee,
      perMinuteWaitFee: settings.perMinuteWaitFee,
      maxFreeWaitTime: settings.maxFreeWaitTime,
      dynamicPricingStatus: settings.dynamicPricingStatus,
      currentMultiplier: settings.currentMultiplier,
      manualRainFee: settings.manualRainFee,
      showAsEstimate: settings.showAsEstimate,
      platformCommissions: {
        ride: commissions.ride ?? legacyCommission,
        presential: commissions.presential ?? legacyCommission,
        parcel: commissions.parcel ?? legacyCommission,
      },
      cardFeePercent: settings.cardFeePercent,
      cardFeeFixed: settings.cardFeeFixed
    }
  });

  const updateMutation = useMutation({
    mutationFn: async (data) => {
      const payload = {
        ...data,
        platformCommissions: {
          ride: Number(data.platformCommissions?.ride),
          presential: Number(data.platformCommissions?.presential),
          parcel: Number(data.platformCommissions?.parcel),
        },
        // Legado sincronizado com corrida app.
        platformCommission: Number(data.platformCommissions?.ride),
      };
      const res = await api.put('/admin/settings/tariffs', payload);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['globalTariffs'] });
      toast.success('Configurações globais atualizadas com sucesso!');
    },
    onError: (err) => {
      // Bloco E (2026-08-02, achado C1): 409 = outro admin salvou entre o carregamento
      // desta tela e este clique — recarrega os dados em cache (não o form em edição,
      // pra não descartar o que o admin estava digitando sem avisar) e explica o motivo.
      if (err.response?.status === 409) {
        queryClient.invalidateQueries({ queryKey: ['globalTariffs'] });
      }
      toast.error(err.response?.data?.message || 'Erro ao salvar configurações globais — verifique se você tem permissão de super_admin');
    }
  });

  return (
    <form
      onSubmit={handleSubmit((data) => updateMutation.mutate({ ...data, __tariffVersion: settings.__tariffVersion, __globalSettingVersion: settings.__globalSettingVersion }))}
      className="bg-surface rounded-xl border border-border overflow-hidden"
    >
      <div className="bg-background/50 border-b border-border p-4">
        <h3 className="font-semibold text-lg">Taxas e Regras Globais</h3>
      </div>
      
      <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-text-muted mb-1">Taxa de Cancelamento (R$)</label>
          <input type="number" step="0.01" min="0" {...register('cancellationFee')} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none" />
        </div>
        <div>
          <label className="block text-sm font-medium text-text-muted mb-1">Tempo de Espera Grátis (segundos)</label>
          <input type="number" min="0" {...register('maxFreeWaitTime')} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none" />
        </div>
        <div>
          <label className="block text-sm font-medium text-text-muted mb-1">Taxa Extra de Espera (R$/min)</label>
          <input type="number" step="0.01" min="0" {...register('perMinuteWaitFee')} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none" />
        </div>
        <div>
          <label className="block text-sm font-medium text-text-muted mb-1">Status Dinâmico Global</label>
          {/* Bloco H (2026-08-02, achado F12): "Automático" foi removido daqui — o
              backend trata 'auto' exatamente igual a 'manual' hoje (nenhum cálculo de
              demanda existe). Deixar a opção no seletor prometeria algo que não existe. */}
          <select {...register('dynamicPricingStatus')} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none">
            <option value="off">Desligado</option>
            <option value="manual">Manual</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-text-muted mb-1">Multiplicador Global</label>
          <input type="number" step="0.1" min="1" {...register('currentMultiplier')} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none" />
        </div>
        <div className="md:col-span-2 space-y-3">
          <div>
            <p className="text-sm font-semibold text-text">Comissão da Plataforma (%)</p>
            <p className="text-xs text-text-muted mt-0.5">
              Percentuais independentes por tipo de serviço. O simulador de categoria usa a % de corrida (app).
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-muted mb-1">Corrida (app)</label>
              <input type="number" step="0.1" min="0" max="100" {...register('platformCommissions.ride', { valueAsNumber: true })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-muted mb-1">Corrida presencial</label>
              <input type="number" step="0.1" min="0" max="100" {...register('platformCommissions.presential', { valueAsNumber: true })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-muted mb-1">Encomendas</label>
              <input type="number" step="0.1" min="0" max="100" {...register('platformCommissions.parcel', { valueAsNumber: true })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none" />
            </div>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-text-muted mb-1">Taxa de Cartão (%)</label>
          <input type="number" step="0.01" min="0" {...register('cardFeePercent')} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none" />
        </div>
        <div>
          <label className="block text-sm font-medium text-text-muted mb-1">Taxa de Cartão Fixa (R$)</label>
          <input type="number" step="0.01" min="0" {...register('cardFeeFixed')} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none" />
        </div>
        <div className="flex items-center mt-6">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" {...register('manualRainFee')} className="w-5 h-5 rounded border-border text-primary focus:ring-primary bg-background" />
            <span className="text-sm font-medium text-text">Ativar Taxa de Chuva Global</span>
          </label>
        </div>
        {/* Bloco H (2026-08-02): antes deste bloco, este campo nem tinha controle na
            UI — era salvo só se enviado manualmente por API, e nada lia o valor. */}
        <div className="flex items-center mt-6">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" {...register('showAsEstimate')} className="w-5 h-5 rounded border-border text-primary focus:ring-primary bg-background" />
            <span className="text-sm font-medium text-text">Exibir Valor como Estimativa ao Passageiro</span>
          </label>
        </div>
      </div>
      
      <div className="bg-background/50 border-t border-border p-4 flex justify-end gap-3">
        <button type="button" onClick={() => reset()} disabled={!isDirty} className="flex items-center gap-2 text-text-muted hover:text-text px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50">
          <RotateCcw className="w-4 h-4" />
          Restaurar
        </button>
        <button type="submit" disabled={!isDirty || updateMutation.isPending || testMode} className="flex items-center gap-2 bg-primary hover:bg-primary-hover text-surface px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50">
          <Save className="w-4 h-4" />
          {updateMutation.isPending ? 'Salvando...' : 'Salvar Alterações'}
        </button>
      </div>
    </form>
  );
}

function CategorySettingsCard({ category, queryClient, testMode, platformCommission }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [schedulerOpen, setSchedulerOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const { register, handleSubmit, watch, reset, getValues, formState: { isDirty } } = useForm({
    defaultValues: {
      displayName: category.displayName,
      description: category.description || '',
      capacity: category.capacity ?? 4,
      iconKey: category.iconKey || 'car',
      baseFare: category.baseFare,
      perKmRate: category.perKmRate,
      perMinuteRate: category.perMinuteRate,
      minFare: category.minFare,
      dynamicMultiplier: category.dynamicMultiplier || 1.0,
      rainFeeMultiplier: category.rainFeeMultiplier || 1.0,
      isActive: category.isActive
    }
  });
  
  const isActive = watch('isActive');
  const liveValues = watch();

  const updateMutation = useMutation({
    mutationFn: async (data) => {
      const res = await api.put(`/admin/vehicle-categories/${category._id}/tariffs`, data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicleCategories'] });
      queryClient.invalidateQueries({ queryKey: ['tariffHistory'] });
      toast.success(`Tarifas da categoria ${category.displayName} atualizadas!`);
      setPreviewOpen(false);
      reset(getValues()); // resets isDirty state
    },
    onError: (err) => {
      // Bloco E (2026-08-02, achado C1): mesmo raciocínio de GlobalSettingsCard — em
      // conflito de versão, atualiza o cache (não o form aberto) e explica o motivo.
      if (err.response?.status === 409) {
        queryClient.invalidateQueries({ queryKey: ['vehicleCategories'] });
      }
      toast.error(err.response?.data?.message || 'Erro ao salvar tarifas — verifique se você tem permissão de super_admin');
    }
  });

  const duplicateMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post(`/admin/vehicle-categories/${category._id}/duplicate`);
      return res.data;
    },
    onSuccess: (newCat) => {
      queryClient.invalidateQueries({ queryKey: ['vehicleCategories'] });
      toast.success(`Categoria duplicada como: ${newCat.displayName}`);
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Erro ao duplicar categoria')
  });

  const onPreviewSubmit = (e) => {
    e.preventDefault();
    setPreviewOpen(true);
  };

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        <div className="lg:col-span-1 xl:col-span-2 space-y-6">
          <form onSubmit={onPreviewSubmit} className="bg-surface rounded-xl border border-border overflow-hidden flex flex-col">
            <div className="bg-background/50 border-b border-border p-4 flex flex-wrap gap-4 justify-between items-center">
              <div className="flex items-center gap-3">
                <h3 className="font-semibold text-lg">{category.displayName}</h3>
                <button
                  type="button"
                  onClick={async () => {
                    if (await confirm(`Tem certeza que deseja duplicar a categoria ${category.displayName}?`)) {
                      duplicateMutation.mutate();
                    }
                  }}
                  disabled={duplicateMutation.isPending}
                  title="Duplicar Categoria"
                  className="p-1.5 bg-background border border-border rounded-lg text-text-muted hover:text-text transition-colors disabled:opacity-50"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
              <label className="flex items-center gap-2 cursor-pointer bg-background border border-border px-3 py-1.5 rounded-full">
                <span className="text-sm font-medium">{isActive ? 'Ativo' : 'Inativo'}</span>
                <input type="checkbox" {...register('isActive')} className="hidden" />
                <div className={`w-8 h-4 rounded-full transition-colors relative ${isActive ? 'bg-primary' : 'bg-border'}`}>
                  <div className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-surface transition-transform ${isActive ? 'translate-x-4' : 'translate-x-0'}`}></div>
                </div>
              </label>
            </div>
            
            <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-5 border-b border-border">
              <div>
                <label className="block text-sm font-medium text-text-muted mb-1">Nome de Exibição (passageiro vê este nome)</label>
                <input type="text" {...register('displayName', { required: true })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-muted mb-1">Lotação (passageiros)</label>
                <input type="number" step="1" min="1" {...register('capacity', { valueAsNumber: true, min: 1 })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none" />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-text-muted mb-1">Descrição (subtítulo exibido ao passageiro)</label>
                <input type="text" {...register('description')} placeholder="Ex: Viagens diárias econômicas" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-muted mb-1">Ícone do Veículo</label>
                <select {...register('iconKey')} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none">
                  <option value="car">Carro</option>
                  <option value="moto">Moto</option>
                  <option value="auto">Auto/TukTuk</option>
                </select>
              </div>
            </div>

            <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-5 flex-1">
              <div>
                <label className="block text-sm font-medium text-text-muted mb-1">Tarifa Base (R$)</label>
                <input type="number" step="0.01" min="0" {...register('baseFare', { valueAsNumber: true, min: 0 })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-muted mb-1">Preço por Km (R$)</label>
                <input type="number" step="0.01" min="0" {...register('perKmRate', { valueAsNumber: true, min: 0 })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-muted mb-1">Preço por Minuto (R$)</label>
                <input type="number" step="0.01" min="0" {...register('perMinuteRate', { valueAsNumber: true, min: 0 })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-muted mb-1">Tarifa Mínima (R$)</label>
                <input type="number" step="0.01" min="0" {...register('minFare', { valueAsNumber: true, min: 0 })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-muted mb-1">Multiplicador de Demanda</label>
                <input type="number" step="0.1" min="1" {...register('dynamicMultiplier', { valueAsNumber: true, min: 1 })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-muted mb-1">Multiplicador de Chuva</label>
                <input type="number" step="0.1" min="1" {...register('rainFeeMultiplier', { valueAsNumber: true, min: 1 })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none" />
              </div>
            </div>
            
            <div className="bg-background/50 border-t border-border p-4 flex flex-wrap gap-3 justify-end items-center mt-auto">
              <button 
                type="button" 
                onClick={() => reset()} 
                disabled={!isDirty} 
                className="flex items-center gap-2 text-text-muted hover:text-text px-3 py-2 rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                <RotateCcw className="w-4 h-4" />
                Restaurar
              </button>
              
              <button 
                type="button" 
                onClick={() => setSchedulerOpen(true)}
                disabled={!isDirty || testMode} 
                className="flex items-center gap-2 bg-background border border-border hover:bg-surface text-text px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                <CalendarClock className="w-4 h-4" />
                Agendar
              </button>
              
              <button
                type="submit"
                disabled={!isDirty || testMode}
                className="flex items-center gap-2 bg-primary hover:bg-primary-hover text-surface px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                <FileSearch className="w-4 h-4" />
                {testMode ? 'Modo Teste Ativo' : 'Revisar & Salvar'}
              </button>
            </div>
          </form>

          {/* Histórico */}
          <TariffHistory categoryId={category._id} categoryName={category.displayName} />
        </div>
        
        <div className="lg:col-span-1 xl:col-span-1">
          <TariffAdvancedSimulator values={liveValues} platformCommission={platformCommission ?? 0} />
        </div>
      </div>

      <TariffSchedulerModal 
        isOpen={schedulerOpen} 
        onClose={() => setSchedulerOpen(false)} 
        categoryId={category._id} 
        categoryName={category.displayName}
        pendingChanges={liveValues}
      />

      {/* Preview Modal */}
      {previewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-surface rounded-xl border border-border w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-border bg-background/50">
              <h2 className="font-semibold text-lg text-text">Confirmação de Alteração</h2>
              <p className="text-sm text-text-muted">Revise as mudanças antes de aplicar as novas tarifas.</p>
            </div>
            <div className="p-5 overflow-y-auto space-y-3">
              {Object.keys(liveValues).map(key => {
                if(liveValues[key] !== category[key]) {
                  return (
                    <div key={key} className="flex justify-between items-center bg-background border border-border p-3 rounded-lg text-sm">
                      <span className="font-medium text-text-muted capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                      <div className="flex items-center gap-3">
                        <span className="line-through text-danger opacity-80">{String(category[key])}</span>
                        <span className="text-text-muted">→</span>
                        <span className="text-success font-bold text-base">{String(liveValues[key])}</span>
                      </div>
                    </div>
                  );
                }
                return null;
              })}
            </div>
            <div className="p-5 border-t border-border flex justify-end gap-3 bg-background/50 mt-auto">
              <button 
                type="button" 
                onClick={() => setPreviewOpen(false)} 
                className="px-4 py-2 text-text-muted hover:text-text font-medium transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => updateMutation.mutate({ ...liveValues, __v: category.__v })}
                disabled={updateMutation.isPending}
                className="bg-primary hover:bg-primary-hover text-surface px-6 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                <Save className="w-4 h-4" />
                {updateMutation.isPending ? 'Aplicando...' : 'Aplicar Tarifas'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function NewCategoryModal({ onClose, onCreated }) {
  const toast = useToast();
  const { register, handleSubmit, formState: { errors } } = useForm({
    defaultValues: { name: '', displayName: '', description: '', capacity: 4, iconKey: 'car' }
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const res = await api.post('/admin/vehicle-categories', data);
      return res.data;
    },
    onSuccess: (newCat) => {
      toast.success(`Categoria ${newCat.displayName} criada com sucesso!`);
      onCreated(newCat);
    },
    onError: (err) => {
      toast.error(err.response?.data?.message || 'Erro ao criar categoria');
    }
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-surface rounded-xl border border-border w-full max-w-md shadow-2xl overflow-hidden flex flex-col">
        <div className="p-5 border-b border-border bg-background/50 flex justify-between items-center">
          <div>
            <h2 className="font-semibold text-lg text-text">Nova Categoria de Veículo</h2>
            <p className="text-sm text-text-muted">Ela aparecerá para o passageiro assim que salva.</p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit((data) => createMutation.mutate(data))} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-muted mb-1">Nome interno (sem espaços, ex: van)</label>
            <input
              type="text"
              {...register('name', { required: true, pattern: /^[a-z0-9_]+$/ })}
              placeholder="van"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none"
            />
            {errors.name && <p className="text-xs text-danger mt-1">Use apenas letras minúsculas, números e "_", sem espaços.</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-text-muted mb-1">Nome de Exibição</label>
            <input
              type="text"
              {...register('displayName', { required: true })}
              placeholder="Ex: MoveVan"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-muted mb-1">Descrição</label>
            <input
              type="text"
              {...register('description')}
              placeholder="Ex: Vans para grupos"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-muted mb-1">Lotação</label>
              <input type="number" min="1" {...register('capacity', { valueAsNumber: true, min: 1 })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-muted mb-1">Ícone</label>
              <select {...register('iconKey')} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none">
                <option value="car">Carro</option>
                <option value="moto">Moto</option>
                <option value="auto">Auto/TukTuk</option>
              </select>
            </div>
          </div>
          <p className="text-xs text-text-muted">Tarifas (base, por km, por minuto) começam com valores padrão — ajuste na aba da categoria depois de criada.</p>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-text-muted hover:text-text font-medium transition-colors">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="bg-primary hover:bg-primary-hover text-surface px-6 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              {createMutation.isPending ? 'Criando...' : 'Criar Categoria'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
