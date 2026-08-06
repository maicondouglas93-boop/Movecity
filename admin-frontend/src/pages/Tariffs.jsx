import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { Save, Beaker, Plus, X, Edit, Trash2, Power } from 'lucide-react';
import { useForm, useFieldArray } from 'react-hook-form';

import TariffAdvancedSimulator from '../components/TariffAdvancedSimulator';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';

const fetchVehicleCategories = async () => {
  const { data } = await api.get('/admin/vehicle-categories');
  return data;
};

export default function Tariffs() {
  const [activeTab, setActiveTab] = useState(null);
  const [testMode, setTestMode] = useState(false);
  const [newCategoryModalOpen, setNewCategoryModalOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: categories, isLoading } = useQuery({
    queryKey: ['vehicleCategories'],
    queryFn: fetchVehicleCategories,
    onSuccess: (data) => {
      if (!activeTab && data && data.length > 0) {
        setActiveTab(data[0]._id);
      }
    }
  });

  // Ensure activeTab is set initially
  React.useEffect(() => {
    if (!activeTab && categories && categories.length > 0) {
      setActiveTab(categories[0]._id);
    }
  }, [categories, activeTab]);

  if (isLoading) return <div className="text-text-muted">Carregando motor de precificação...</div>;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:justify-between md:items-end gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tarifas por Categoria</h1>
          <p className="text-text-muted mt-1">Configure os preços individualmente para cada tipo de veículo.</p>
        </div>
        
        {/* Test Mode Toggle */}
        <label className={`flex items-center gap-2 px-4 py-2 rounded-full cursor-pointer transition-colors border ${testMode ? 'bg-warning/20 border-warning text-warning' : 'bg-surface border-border text-text-muted hover:text-text'}`}>
          <Beaker className="w-4 h-4" />
          <span className="text-sm font-medium">Modo Simulação</span>
          <input 
            type="checkbox" 
            checked={testMode}
            onChange={(e) => setTestMode(e.target.checked)} 
            className="hidden" 
          />
        </label>
      </div>
      
      {/* Tabs Dinâmicas (Mobile) */}
      <div className="block md:hidden">
        <select 
          value={activeTab || ''} 
          onChange={(e) => setActiveTab(e.target.value)}
          className="w-full bg-surface border border-border rounded-lg px-4 py-3 text-text font-medium outline-none"
        >
          {categories?.map(cat => (
            <option key={cat._id} value={cat._id}>{cat.displayName}</option>
          ))}
        </select>
      </div>

      {/* Tabs Dinâmicas (Desktop) */}
      <div className="hidden md:flex border-b border-border overflow-x-auto no-scrollbar">
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
      </div>

      {/* Tab Content */}
      <div className="mt-6">
        {categories && activeTab && categories.find(c => c._id === activeTab) ? (
          <CategorySettingsCard
            key={activeTab}
            category={categories.find(c => c._id === activeTab)}
            queryClient={queryClient}
            testMode={testMode}
          />
        ) : (
          <div className="text-text-muted mt-6">Nenhuma categoria selecionada ou carregando...</div>
        )}
      </div>
    </div>
  );
}

function CategorySettingsCard({ category, queryClient, testMode }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [modalOptional, setModalOptional] = useState(null); // null = fechado, {} = novo, {id...} = editando

  const pricing = category.pricing || {};
  const defaultOptionals = pricing.optionals || [];

  const { register, handleSubmit, watch, control, reset, formState: { isDirty } } = useForm({
    defaultValues: {
      pricing: {
        baseFare: pricing.baseFare ?? category.baseFare ?? 5.0,
        perKm: pricing.perKm ?? category.perKmRate ?? 2.0,
        perMinute: pricing.perMinute ?? category.perMinuteRate ?? 0.5,
        minimumFare: pricing.minimumFare ?? category.minFare ?? 7.0,
        platformCommission: pricing.platformCommission ?? 20,
        optionals: defaultOptionals
      }
    }
  });

  const { fields, append, update, remove } = useFieldArray({
    control,
    name: "pricing.optionals"
  });
  
  const liveValues = watch('pricing');

  const updateMutation = useMutation({
    mutationFn: async (data) => {
      // Endpoint /admin/vehicle-categories/:id/tariffs
      const res = await api.put(`/admin/vehicle-categories/${category._id}/tariffs`, data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicleCategories'] });
      toast.success(`Tarifas da categoria ${category.displayName} atualizadas!`);
    },
    onError: (err) => {
      toast.error(err.response?.data?.message || 'Erro ao salvar categoria');
    }
  });

  const handleSaveOptional = (data) => {
    if (modalOptional.index !== undefined) {
      update(modalOptional.index, data);
    } else {
      append(data);
    }
    setModalOptional(null);
  };

  const handleDeleteOptional = async (index, name) => {
    const ok = await confirm(`Você está prestes a excluir "${name}". Isso não afetará o histórico, mas o adicional desaparecerá de novas corridas.`, 'Excluir adicional?');
    if (ok) remove(index);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
      <div className="lg:col-span-1 xl:col-span-2 space-y-6">
        <form onSubmit={handleSubmit((data) => updateMutation.mutate(data))} className="bg-surface rounded-xl border border-border overflow-hidden">
          <div className="bg-background/50 border-b border-border p-4 flex justify-between items-center">
            <div>
              <h3 className="font-semibold text-lg">{category.displayName}</h3>
              <p className="text-sm text-text-muted mt-1">Configuração de tarifa base e comissão desta categoria.</p>
            </div>
            {!category.isActive && (
              <span className="bg-danger/20 text-danger text-xs px-2 py-1 rounded font-bold uppercase">Inativo</span>
            )}
          </div>
          
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="md:col-span-2">
              <h4 className="text-sm font-bold uppercase text-text-muted mb-4 border-b border-border pb-2">Tarifa Básica</h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-muted mb-1">Tarifa base (R$)</label>
                  <input type="number" step="0.01" min="0" {...register('pricing.baseFare', { valueAsNumber: true })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-muted mb-1">Por KM (R$)</label>
                  <input type="number" step="0.01" min="0" {...register('pricing.perKm', { valueAsNumber: true })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-muted mb-1">Por minuto (R$)</label>
                  <input type="number" step="0.01" min="0" {...register('pricing.perMinute', { valueAsNumber: true })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-muted mb-1">Tarifa mínima (R$)</label>
                  <input type="number" step="0.01" min="0" {...register('pricing.minimumFare', { valueAsNumber: true })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none" />
                </div>
              </div>
              <div className="mt-4 w-1/2 md:w-1/4">
                <label className="block text-sm font-medium text-text-muted mb-1">Comissão (%)</label>
                <input type="number" step="0.1" min="0" max="100" {...register('pricing.platformCommission', { valueAsNumber: true })} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none" />
              </div>
            </div>

            <div className="md:col-span-2 pt-6">
              <div className="flex items-center justify-between border-b border-border pb-2 mb-4">
                <h4 className="text-sm font-bold uppercase text-text-muted">Adicionais</h4>
                <button type="button" onClick={() => setModalOptional({})} className="flex items-center gap-1.5 text-sm font-medium bg-primary/10 text-primary hover:bg-primary/20 px-3 py-1.5 rounded-lg transition-colors">
                  <Plus className="w-4 h-4" /> Adicionar Adicional
                </button>
              </div>

              {fields.length === 0 ? (
                <div className="text-center py-6 text-text-muted bg-background/50 rounded-lg border border-border border-dashed">
                  Nenhum adicional cadastrado nesta categoria.
                </div>
              ) : (
                <div className="border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-background/80 text-text-muted uppercase text-xs">
                      <tr>
                        <th className="px-4 py-3 font-medium">Nome do Adicional</th>
                        <th className="px-4 py-3 font-medium">Valor</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {fields.map((opt, index) => (
                        <tr key={opt.id} className="bg-surface hover:bg-background/30 transition-colors">
                          <td className="px-4 py-3 font-medium text-text">{opt.name}</td>
                          <td className="px-4 py-3">R$ {parseFloat(opt.value).toFixed(2)}</td>
                          <td className="px-4 py-3">
                            {opt.isActive ? (
                              <span className="bg-success/10 text-success px-2 py-1 rounded text-xs font-semibold">ATIVO</span>
                            ) : (
                              <span className="bg-text-muted/10 text-text-muted px-2 py-1 rounded text-xs font-semibold">INATIVO</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button type="button" onClick={() => setModalOptional({ ...opt, index })} className="p-1.5 text-text-muted hover:text-primary transition-colors" title="Editar">
                                <Edit className="w-4 h-4" />
                              </button>
                              <button type="button" onClick={() => handleDeleteOptional(index, opt.name)} className="p-1.5 text-text-muted hover:text-danger transition-colors" title="Excluir">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
          
          <div className="bg-background/50 border-t border-border p-4 flex justify-end gap-3">
            <button type="submit" disabled={!isDirty || updateMutation.isPending} className="flex items-center gap-2 bg-primary hover:bg-primary-hover text-surface px-6 py-2.5 rounded-lg font-bold transition-colors disabled:opacity-50">
              <Save className="w-4 h-4" />
              {updateMutation.isPending ? 'Salvando...' : 'Salvar Alterações'}
            </button>
          </div>
        </form>
      </div>

      <div className="lg:col-span-1 xl:col-span-1">
        <TariffAdvancedSimulator values={liveValues} platformCommission={liveValues.platformCommission} />
      </div>

      {modalOptional && (
        <OptionalModal
          optional={modalOptional}
          onClose={() => setModalOptional(null)}
          onSave={handleSaveOptional}
        />
      )}
    </div>
  );
}

function OptionalModal({ optional, onClose, onSave }) {
  const { register, handleSubmit, formState: { errors } } = useForm({
    defaultValues: {
      id: optional.id || '', // será autogerado se vazio
      name: optional.name || '',
      value: optional.value || 0,
      isActive: optional.isActive ?? true
    }
  });

  const onSubmit = (data) => {
    if (!data.id) {
      data.id = data.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, '_');
    }
    onSave(data);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-surface rounded-xl shadow-xl w-full max-w-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex justify-between items-center">
          <h2 className="text-lg font-bold">{optional.name ? 'Editar Adicional' : 'Novo Adicional'}</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text"><X className="w-5 h-5"/></button>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-muted mb-1">Nome do Adicional</label>
            <input 
              type="text" 
              {...register('name', { required: 'Nome é obrigatório' })} 
              placeholder="Ex: Porta-malas" 
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text outline-none" 
            />
            {errors.name && <p className="text-danger text-xs mt-1">{errors.name.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-text-muted mb-1">Valor (R$)</label>
            <input 
              type="number" 
              step="0.01" 
              min="0" 
              {...register('value', { valueAsNumber: true, required: 'Valor é obrigatório' })} 
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text outline-none" 
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-muted mb-1">Status</label>
            <select {...register('isActive')} className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text outline-none">
              <option value="true">Ativo</option>
              <option value="false">Inativo</option>
            </select>
          </div>
          
          <div className="pt-4 flex justify-end gap-3 border-t border-border">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg font-medium border border-border text-text">Cancelar</button>
            <button type="submit" className="px-4 py-2 rounded-lg font-medium bg-primary text-surface">Salvar adicional</button>
          </div>
        </form>
      </div>
    </div>
  );
}
