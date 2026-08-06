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
          <h1 className="text-2xl font-bold tracking-tight">Motor de Precificação Unificado</h1>
          <p className="text-text-muted mt-1">Gerencie a tarifa única para todos os serviços (Motos, Carros, Encomendas).</p>
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
          <option value="general">Tarifa Unificada Global</option>
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
          Tarifa Unificada Global
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

        {activeTab !== 'general' && categories && (
          categories.find(c => c._id === activeTab) ? (
            <div className="mt-6">
              <CategorySettingsCard
                key={activeTab}
                category={categories.find(c => c._id === activeTab)}
                queryClient={queryClient}
                testMode={testMode}
                platformCommission={globalSettings?.platformCommission}
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
  const optionalPrices = settings.optionalPrices || {};
  
  const { register, handleSubmit, reset, watch, formState: { isDirty } } = useForm({
    defaultValues: {
      baseFare: settings.baseFare ?? 5.0,
      perKm: settings.perKm ?? 2.0,
      perMinute: settings.perMinute ?? 0.5,
      minimumFare: settings.minimumFare ?? 7.0,
      platformCommission: settings.platformCommission ?? 20,
      surcharges: {
        waiting: {
            active: settings.surcharges?.waiting?.active ?? true,
            freeMinutes: settings.surcharges?.waiting?.freeMinutes ?? 5,
            valuePerMinute: settings.surcharges?.waiting?.valuePerMinute ?? 0.5,
        },
        extraStops: {
            active: settings.surcharges?.extraStops?.active ?? false,
            valuePerStop: settings.surcharges?.extraStops?.valuePerStop ?? 3.0,
        },
        cancellation: {
            active: settings.surcharges?.cancellation?.active ?? true,
            value: settings.surcharges?.cancellation?.value ?? 5.0,
        }
      },
      optionalPrices: {
        porta_malas: optionalPrices.porta_malas ?? 0,
        aceita_animais: optionalPrices.aceita_animais ?? 3,
        aceita_encomendas: optionalPrices.aceita_encomendas ?? 5,
        adaptado_cadeirante: optionalPrices.adaptado_cadeirante ?? 0,
        disposicao_passageiro: optionalPrices.disposicao_passageiro ?? 15,
      }
    }
  });

  const liveValues = watch();

  const updateMutation = useMutation({
    mutationFn: async (data) => {
      const payload = {
        ...data,
      };
      const res = await api.put('/admin/settings/tariffs', payload);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['globalTariffs'] });
      toast.success('Configurações globais unificadas salvas com sucesso!');
    },
    onError: (err) => {
      if (err.response?.status === 409) {
        queryClient.invalidateQueries({ queryKey: ['globalTariffs'] });
      }
      toast.error(err.response?.data?.message || 'Erro ao salvar configurações');
    }
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
      <div className="lg:col-span-1 xl:col-span-2 space-y-6">
        <form
          onSubmit={handleSubmit((data) => updateMutation.mutate({ ...data, __tariffVersion: settings.__tariffVersion }))}
          className="bg-surface rounded-xl border border-border overflow-hidden"
        >
          <div className="bg-background/50 border-b border-border p-4">
            <h3 className="font-semibold text-lg">Tarifa Unificada Global</h3>
            <p className="text-sm text-text-muted mt-1">Essa tabela se aplica a TODOS os serviços: Corridas de Moto, Carro, Presenciais e Encomendas.</p>
          </div>
          
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="md:col-span-2 grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-muted mb-1">Base (R$)</label>
                <input type="number" step="0.01" min="0" {...register('baseFare', { valueAsNumber: true })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-muted mb-1">Por Km (R$)</label>
                <input type="number" step="0.01" min="0" {...register('perKm', { valueAsNumber: true })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-muted mb-1">Por Minuto (R$)</label>
                <input type="number" step="0.01" min="0" {...register('perMinute', { valueAsNumber: true })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-muted mb-1">Tarifa Mínima (R$)</label>
                <input type="number" step="0.01" min="0" {...register('minimumFare', { valueAsNumber: true })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none" />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-muted mb-1">Comissão da Plataforma (%)</label>
              <input type="number" step="0.1" min="0" max="100" {...register('platformCommission', { valueAsNumber: true })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none" />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-muted mb-1">Taxa de Cancelamento (R$)</label>
              <input type="number" step="0.01" min="0" {...register('surcharges.cancellation.value', { valueAsNumber: true })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none" />
            </div>

            <div className="md:col-span-2 border-t border-border pt-4">
              <h4 className="font-medium text-text mb-3">Regras de Espera</h4>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-muted mb-1">Minutos Grátis</label>
                  <input type="number" min="0" {...register('surcharges.waiting.freeMinutes', { valueAsNumber: true })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-muted mb-1">R$ por Minuto Excedente</label>
                  <input type="number" step="0.01" min="0" {...register('surcharges.waiting.valuePerMinute', { valueAsNumber: true })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none" />
                </div>
              </div>
            </div>

            <div className="md:col-span-2 space-y-3 pt-4 border-t border-border">
              <div>
                <p className="text-sm font-semibold text-text">Preços dos Opcionais (R$)</p>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-muted mb-1">Porta-malas</label>
                  <input type="number" step="0.01" min="0" {...register('optionalPrices.porta_malas', { valueAsNumber: true })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-muted mb-1">Animais</label>
                  <input type="number" step="0.01" min="0" {...register('optionalPrices.aceita_animais', { valueAsNumber: true })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-muted mb-1">Encomendas</label>
                  <input type="number" step="0.01" min="0" {...register('optionalPrices.aceita_encomendas', { valueAsNumber: true })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none" />
                </div>
              </div>
            </div>
          </div>
          
          <div className="bg-background/50 border-t border-border p-4 flex justify-end gap-3">
            <button type="submit" disabled={!isDirty || updateMutation.isPending || testMode} className="flex items-center gap-2 bg-primary hover:bg-primary-hover text-surface px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50">
              <Save className="w-4 h-4" />
              {updateMutation.isPending ? 'Salvando...' : 'Salvar Alterações'}
            </button>
          </div>
        </form>
      </div>

      <div className="lg:col-span-1 xl:col-span-1">
        <TariffAdvancedSimulator values={liveValues} platformCommission={liveValues.platformCommission} />
      </div>
    </div>
  );
}

function CategorySettingsCard({ category, queryClient, testMode }) {
  const toast = useToast();

  const { register, handleSubmit, watch, formState: { isDirty } } = useForm({
    defaultValues: {
      displayName: category.displayName,
      description: category.description || '',
      capacity: category.capacity ?? 4,
      iconKey: category.iconKey || 'car',
      isActive: category.isActive
    }
  });
  
  const isActive = watch('isActive');

  const updateMutation = useMutation({
    mutationFn: async (data) => {
      const res = await api.put(`/admin/vehicle-categories/${category._id}/tariffs`, data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicleCategories'] });
      toast.success(`Categoria ${category.displayName} atualizada!`);
    },
    onError: (err) => {
      toast.error(err.response?.data?.message || 'Erro ao salvar categoria');
    }
  });

  return (
    <div className="max-w-2xl">
      <form onSubmit={handleSubmit((data) => updateMutation.mutate(data))} className="bg-surface rounded-xl border border-border overflow-hidden flex flex-col">
        <div className="bg-background/50 border-b border-border p-4 flex flex-wrap gap-4 justify-between items-center">
          <div className="flex items-center gap-3">
            <h3 className="font-semibold text-lg">{category.displayName}</h3>
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
        </div>
        
        <div className="bg-background/50 border-t border-border p-4 flex justify-end">
          <button type="submit" disabled={!isDirty || updateMutation.isPending || testMode} className="flex items-center gap-2 bg-primary hover:bg-primary-hover text-surface px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50">
            <Save className="w-4 h-4" />
            Salvar Categoria
          </button>
        </div>
      </form>
    </div>
  );
}

function NewCategoryModal({ onClose, onCreated }) {
  const toast = useToast();
  const { register, handleSubmit } = useForm();
  
  const createMutation = useMutation({
    mutationFn: async (data) => {
      const res = await api.post('/admin/vehicle-categories', data);
      return res.data;
    },
    onSuccess: (data) => {
      toast.success('Categoria criada!');
      onCreated(data);
    },
    onError: () => toast.error('Erro ao criar categoria')
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-surface rounded-xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex justify-between items-center">
          <h2 className="text-lg font-bold">Nova Categoria de Veículo</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text"><X className="w-5 h-5"/></button>
        </div>
        <form onSubmit={handleSubmit((data) => createMutation.mutate(data))} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-muted mb-1">Nome Interno</label>
            <input type="text" {...register('name')} placeholder="Ex: suv" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text outline-none" required />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-muted mb-1">Nome de Exibição</label>
            <input type="text" {...register('displayName')} placeholder="Ex: SUV Premium" className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text outline-none" required />
          </div>
          <div className="pt-2 flex justify-end gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg font-medium border border-border text-text">Cancelar</button>
            <button type="submit" disabled={createMutation.isPending} className="px-4 py-2 rounded-lg font-medium bg-primary text-surface">Criar</button>
          </div>
        </form>
      </div>
    </div>
  );
}
