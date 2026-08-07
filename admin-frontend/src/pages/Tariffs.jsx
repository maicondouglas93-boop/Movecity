import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { Save, Beaker, Plus, X, Edit, Trash2, Copy, Power, Settings2 } from 'lucide-react';
import { useForm, useFieldArray } from 'react-hook-form';

import TariffAdvancedSimulator from '../components/TariffAdvancedSimulator';
import SimulatorErrorBoundary from '../components/SimulatorErrorBoundary';
import GlobalTariffsSection from '../components/GlobalTariffsSection';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';

const fetchVehicleCategories = async () => {
  const { data } = await api.get('/admin/vehicle-categories');
  return data;
};

export default function Tariffs() {
  const [activeTab, setActiveTab] = useState(null);
  const [testMode, setTestMode] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [editCategory, setEditCategory] = useState(null);
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();

  const { data: categories, isLoading } = useQuery({
    queryKey: ['vehicleCategories'],
    queryFn: fetchVehicleCategories,
  });

  React.useEffect(() => {
    if (!activeTab && categories && categories.length > 0) {
      setActiveTab(categories[0]._id);
    }
  }, [categories, activeTab]);

  const createMutation = useMutation({
    mutationFn: async (payload) => {
      const { data } = await api.post('/admin/vehicle-categories', payload);
      return data;
    },
    onSuccess: (cat) => {
      queryClient.invalidateQueries({ queryKey: ['vehicleCategories'] });
      toast.success('Categoria criada');
      setEditCategory(null);
      setManageOpen(false);
      setActiveTab(cat._id);
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Erro ao criar categoria'),
  });

  const updateMetaMutation = useMutation({
    mutationFn: async ({ id, payload }) => {
      const { data } = await api.put(`/admin/vehicle-categories/${id}/tariffs`, payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicleCategories'] });
      toast.success('Categoria atualizada');
      setEditCategory(null);
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Erro ao atualizar categoria'),
  });

  const duplicateMutation = useMutation({
    mutationFn: async (id) => {
      const { data } = await api.post(`/admin/vehicle-categories/${id}/duplicate`);
      return data;
    },
    onSuccess: (cat) => {
      queryClient.invalidateQueries({ queryKey: ['vehicleCategories'] });
      toast.success('Categoria duplicada (inativa)');
      setActiveTab(cat._id);
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Erro ao duplicar'),
  });

  const toggleActive = async (cat) => {
    const next = !cat.isActive;
    if (next) {
      const ok = await confirm(
        'A categoria só pode ser ativada se a tarifa for válida (valores ≥ 0 e não todos zero).',
        'Ativar categoria?'
      );
      if (!ok) return;
    }
    updateMetaMutation.mutate({
      id: cat._id,
      payload: { isActive: next, __v: cat.__v, pricing: cat.pricing },
    });
  };

  if (isLoading) return <div className="text-text-muted">Carregando tarifas por categoria...</div>;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:justify-between md:items-end gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tarifas</h1>
          <p className="text-text-muted mt-1">
            Globais (todas as categorias) e tarifas por veículo. Encomendas usam a base da categoria + acréscimo opcional.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => { setManageOpen(true); setEditCategory(null); }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-surface text-sm font-medium hover:border-primary"
          >
            <Settings2 className="w-4 h-4" /> Gerenciar categorias
          </button>
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
      </div>

      <GlobalTariffsSection />

      <div>
        <h2 className="text-lg font-semibold tracking-tight">Tarifas por categoria</h2>
        <p className="text-sm text-text-muted mt-1">Base, km, minuto, comissão, encomendas e adicionais de cada veículo.</p>
      </div>

      <div className="block md:hidden">
        <select
          value={activeTab || ''}
          onChange={(e) => setActiveTab(e.target.value)}
          className="w-full bg-surface border border-border rounded-lg px-4 py-3 text-text font-medium outline-none"
        >
          {categories?.map((cat) => (
            <option key={cat._id} value={cat._id}>{cat.displayName}</option>
          ))}
        </select>
      </div>

      <div className="hidden md:flex border-b border-border overflow-x-auto no-scrollbar">
        {categories?.map((cat) => (
          <button
            key={cat._id}
            onClick={() => setActiveTab(cat._id)}
            className={`px-6 py-3 font-medium text-sm whitespace-nowrap transition-colors border-b-2 flex items-center gap-2 ${activeTab === cat._id ? 'border-primary text-primary' : 'border-transparent text-text-muted hover:text-text'}`}
          >
            {cat.displayName}
            {!cat.isActive && <span className="w-2 h-2 rounded-full bg-danger" />}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {categories && activeTab && categories.find((c) => c._id === activeTab) ? (
          <CategorySettingsCard
            key={activeTab}
            category={categories.find((c) => c._id === activeTab)}
            queryClient={queryClient}
            testMode={testMode}
          />
        ) : (
          <div className="text-text-muted mt-6">Nenhuma categoria selecionada.</div>
        )}
      </div>

      {manageOpen && (
        <ManageCategoriesModal
          categories={categories || []}
          onClose={() => { setManageOpen(false); setEditCategory(null); }}
          onCreate={() => setEditCategory({})}
          onEdit={(cat) => setEditCategory(cat)}
          onDuplicate={(id) => duplicateMutation.mutate(id)}
          onToggle={toggleActive}
        />
      )}

      {editCategory && (
        <CategoryMetaModal
          category={editCategory}
          onClose={() => setEditCategory(null)}
          onSave={(payload) => {
            if (editCategory._id) {
              updateMetaMutation.mutate({
                id: editCategory._id,
                payload: { ...payload, __v: editCategory.__v, pricing: editCategory.pricing },
              });
            } else {
              createMutation.mutate(payload);
            }
          }}
          saving={createMutation.isPending || updateMetaMutation.isPending}
        />
      )}
    </div>
  );
}

function ManageCategoriesModal({ categories, onClose, onCreate, onEdit, onDuplicate, onToggle }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-surface rounded-xl shadow-xl w-full max-w-2xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-border flex justify-between items-center">
          <h2 className="text-lg font-bold">Gerenciar categorias</h2>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 overflow-y-auto flex-1 space-y-2">
          <p className="text-sm text-text-muted mb-3">
            Categorias com histórico de corridas não devem ser excluídas — desative-as. Duplique para criar uma variação.
          </p>
          {categories.map((cat) => (
            <div key={cat._id} className="flex items-center justify-between gap-3 border border-border rounded-lg px-4 py-3">
              <div>
                <div className="font-medium">{cat.displayName}</div>
                <div className="text-xs text-text-muted">{cat.name} · {cat.isActive ? 'Ativa' : 'Inativa'}</div>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" title="Editar" onClick={() => onEdit(cat)} className="p-2 text-text-muted hover:text-primary"><Edit className="w-4 h-4" /></button>
                <button type="button" title="Duplicar" onClick={() => onDuplicate(cat._id)} className="p-2 text-text-muted hover:text-primary"><Copy className="w-4 h-4" /></button>
                <button type="button" title={cat.isActive ? 'Desativar' : 'Ativar'} onClick={() => onToggle(cat)} className="p-2 text-text-muted hover:text-warning"><Power className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
        </div>
        <div className="px-6 py-4 border-t border-border flex justify-between">
          <button type="button" onClick={onCreate} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-surface font-medium">
            <Plus className="w-4 h-4" /> Nova categoria
          </button>
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-border">Fechar</button>
        </div>
      </div>
    </div>
  );
}

function CategoryMetaModal({ category, onClose, onSave, saving }) {
  const isNew = !category._id;
  const { register, handleSubmit, formState: { errors } } = useForm({
    defaultValues: {
      name: category.name || '',
      displayName: category.displayName || '',
      description: category.description || '',
      capacity: category.capacity ?? 4,
      luggageCapacity: category.luggageCapacity || '',
      iconKey: category.iconKey || 'car',
      sortOrder: category.sortOrder ?? 0,
      isActive: category.isActive ?? false,
      baseFare: category.pricing?.baseFare ?? category.baseFare ?? 5,
      perKmRate: category.pricing?.perKm ?? category.perKmRate ?? 1.5,
      perMinuteRate: category.pricing?.perMinute ?? category.perMinuteRate ?? 0.3,
      minFare: category.pricing?.minimumFare ?? category.minFare ?? 8,
    },
  });

  const submit = (data) => {
    if (isNew) {
      onSave({
        name: data.name.trim(),
        displayName: data.displayName.trim(),
        description: data.description,
        capacity: Number(data.capacity),
        luggageCapacity: data.luggageCapacity,
        iconKey: data.iconKey,
        sortOrder: Number(data.sortOrder),
        isActive: data.isActive === true || data.isActive === 'true',
        pricing: {
          baseFare: Number(data.baseFare),
          perKm: Number(data.perKmRate),
          perMinute: Number(data.perMinuteRate),
          minimumFare: Number(data.minFare),
          platformCommission: 20,
          parcelAdjustment: { isActive: false, type: 'percentage', value: 0 },
          optionals: [],
        },
      });
    } else {
      onSave({
        displayName: data.displayName.trim(),
        description: data.description,
        capacity: Number(data.capacity),
        luggageCapacity: data.luggageCapacity,
        iconKey: data.iconKey,
        sortOrder: Number(data.sortOrder),
      });
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div className="bg-surface rounded-xl shadow-xl w-full max-w-md overflow-hidden max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-border flex justify-between items-center">
          <h2 className="text-lg font-bold">{isNew ? 'Nova categoria' : 'Editar categoria'}</h2>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit(submit)} className="p-6 space-y-4">
          {isNew && (
            <div>
              <label className="block text-sm font-medium text-text-muted mb-1">Nome interno</label>
              <input {...register('name', { required: true })} placeholder="ex: car, moto, suv" className="w-full bg-background border border-border rounded-lg px-3 py-2 outline-none" />
              {errors.name && <p className="text-danger text-xs mt-1">Obrigatório</p>}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-text-muted mb-1">Nome de exibição</label>
            <input {...register('displayName', { required: true })} className="w-full bg-background border border-border rounded-lg px-3 py-2 outline-none" />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-muted mb-1">Descrição</label>
            <input {...register('description')} className="w-full bg-background border border-border rounded-lg px-3 py-2 outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-text-muted mb-1">Lotação</label>
              <input type="number" min="1" {...register('capacity', { valueAsNumber: true })} className="w-full bg-background border border-border rounded-lg px-3 py-2 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-muted mb-1">Bagagem</label>
              <input {...register('luggageCapacity')} placeholder="ex: 2 malas" className="w-full bg-background border border-border rounded-lg px-3 py-2 outline-none" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-text-muted mb-1">Ícone</label>
              <select {...register('iconKey')} className="w-full bg-background border border-border rounded-lg px-3 py-2 outline-none">
                <option value="car">Carro</option>
                <option value="moto">Moto</option>
                <option value="auto">Auto</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-muted mb-1">Ordem</label>
              <input type="number" {...register('sortOrder', { valueAsNumber: true })} className="w-full bg-background border border-border rounded-lg px-3 py-2 outline-none" />
            </div>
          </div>
          {isNew && (
            <>
              <p className="text-xs text-text-muted">Tarifa inicial (pode ajustar depois na aba da categoria):</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-text-muted mb-1">Base</label>
                  <input type="number" step="0.01" {...register('baseFare', { valueAsNumber: true })} className="w-full bg-background border border-border rounded-lg px-3 py-2 outline-none" />
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1">Por km</label>
                  <input type="number" step="0.01" {...register('perKmRate', { valueAsNumber: true })} className="w-full bg-background border border-border rounded-lg px-3 py-2 outline-none" />
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1">Por minuto</label>
                  <input type="number" step="0.01" {...register('perMinuteRate', { valueAsNumber: true })} className="w-full bg-background border border-border rounded-lg px-3 py-2 outline-none" />
                </div>
                <div>
                  <label className="block text-xs text-text-muted mb-1">Mínimo</label>
                  <input type="number" step="0.01" {...register('minFare', { valueAsNumber: true })} className="w-full bg-background border border-border rounded-lg px-3 py-2 outline-none" />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" {...register('isActive')} />
                Ativar imediatamente
              </label>
            </>
          )}
          <div className="pt-2 flex justify-end gap-3 border-t border-border">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-border">Cancelar</button>
            <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-primary text-surface font-medium disabled:opacity-50">
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CategorySettingsCard({ category, queryClient, testMode }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [modalOptional, setModalOptional] = useState(null);

  const pricing = category.pricing || {};
  const defaultOptionals = pricing.optionals || [];
  const defaultParcelAdj = pricing.parcelAdjustment || { isActive: false, type: 'percentage', value: 0 };

  const { register, handleSubmit, watch, control, formState: { isDirty } } = useForm({
    defaultValues: {
      pricing: {
        baseFare: pricing.baseFare ?? category.baseFare ?? 5.0,
        perKm: pricing.perKm ?? category.perKmRate ?? 2.0,
        perMinute: pricing.perMinute ?? category.perMinuteRate ?? 0.5,
        minimumFare: pricing.minimumFare ?? category.minFare ?? 7.0,
        platformCommission: pricing.platformCommission ?? 20,
        parcelAdjustment: {
          isActive: Boolean(defaultParcelAdj.isActive),
          type: defaultParcelAdj.type === 'fixed' ? 'fixed' : 'percentage',
          value: Number(defaultParcelAdj.value) || 0,
        },
        surcharges: pricing.surcharges || {},
        optionals: defaultOptionals,
      },
    },
  });

  const { fields, append, update, remove } = useFieldArray({
    control,
    name: 'pricing.optionals',
  });

  const liveValues = watch('pricing');
  const parcelOn = watch('pricing.parcelAdjustment.isActive');
  const parcelType = watch('pricing.parcelAdjustment.type');
  const parcelValue = watch('pricing.parcelAdjustment.value');

  const previewBase = (Number(liveValues.baseFare) || 0)
    + (10 * (Number(liveValues.perKm) || 0))
    + (20 * (Number(liveValues.perMinute) || 0));
  const previewAdj = parcelOn
    ? (parcelType === 'fixed'
      ? Number(parcelValue) || 0
      : previewBase * ((Number(parcelValue) || 0) / 100))
    : 0;

  const updateMutation = useMutation({
    mutationFn: async (data) => {
      const payload = {
        ...data,
        __v: category.__v,
        isActive: category.isActive,
      };
      const res = await api.put(`/admin/vehicle-categories/${category._id}/tariffs`, payload);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicleCategories'] });
      toast.success(`Tarifas de ${category.displayName} atualizadas`);
    },
    onError: (err) => {
      toast.error(err.response?.data?.message || 'Erro ao salvar categoria');
    },
  });

  const handleSaveOptional = (data) => {
    const normalized = {
      ...data,
      isActive: data.isActive === true || data.isActive === 'true',
      value: Number(data.value) || 0,
    };
    if (modalOptional.index !== undefined) {
      update(modalOptional.index, normalized);
    } else {
      append(normalized);
    }
    setModalOptional(null);
  };

  const handleDeleteOptional = async (index, name) => {
    const ok = await confirm(
      `Excluir "${name}"? Corridas antigas mantêm o valor congelado; novas não verão este adicional.`,
      'Excluir adicional?'
    );
    if (ok) remove(index);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
      <div className="lg:col-span-1 xl:col-span-2 space-y-6">
        <form onSubmit={handleSubmit((data) => updateMutation.mutate(data))} className="bg-surface rounded-xl border border-border overflow-hidden">
          <div className="bg-background/50 border-b border-border p-4 flex justify-between items-center">
            <div>
              <h3 className="font-semibold text-lg">{category.displayName}</h3>
              <p className="text-sm text-text-muted mt-1">Tarifa básica, encomendas e adicionais desta categoria.</p>
            </div>
            {!category.isActive && (
              <span className="bg-danger/20 text-danger text-xs px-2 py-1 rounded font-bold uppercase">Inativo</span>
            )}
          </div>

          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="md:col-span-2">
              <h4 className="text-sm font-bold uppercase text-text-muted mb-4 border-b border-border pb-2">Tarifa básica</h4>
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

            <div className="md:col-span-2 pt-2">
              <h4 className="text-sm font-bold uppercase text-text-muted mb-4 border-b border-border pb-2">Encomendas</h4>
              <p className="text-sm text-text-muted mb-3">
                Usa a mesma tarifa básica. Opcionalmente aplica um acréscimo só em entregas (serviceKind = encomenda).
              </p>
              <label className="flex items-center gap-2 text-sm font-medium mb-3">
                <input type="checkbox" {...register('pricing.parcelAdjustment.isActive')} />
                Ativar acréscimo de encomenda
              </label>
              <div className={`grid grid-cols-2 sm:grid-cols-3 gap-4 ${parcelOn ? '' : 'opacity-50 pointer-events-none'}`}>
                <div>
                  <label className="block text-sm font-medium text-text-muted mb-1">Tipo</label>
                  <select {...register('pricing.parcelAdjustment.type')} className="w-full bg-background border border-border rounded-lg px-3 py-2 outline-none">
                    <option value="percentage">Percentual (%)</option>
                    <option value="fixed">Valor fixo (R$)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-muted mb-1">Valor</label>
                  <input type="number" step="0.01" min="0" {...register('pricing.parcelAdjustment.value', { valueAsNumber: true })} className="w-full bg-background border border-border rounded-lg px-3 py-2 outline-none" />
                </div>
                <div className="flex flex-col justify-end">
                  <span className="text-xs text-text-muted mb-1">Preview (10 km / 20 min)</span>
                  <span className="text-sm font-semibold">+ R$ {previewAdj.toFixed(2)}</span>
                </div>
              </div>
            </div>

            <div className="md:col-span-2 pt-6">
              <div className="flex items-center justify-between border-b border-border pb-2 mb-4">
                <h4 className="text-sm font-bold uppercase text-text-muted">Adicionais</h4>
                <button type="button" onClick={() => setModalOptional({})} className="flex items-center gap-1.5 text-sm font-medium bg-primary/10 text-primary hover:bg-primary/20 px-3 py-1.5 rounded-lg transition-colors">
                  <Plus className="w-4 h-4" /> Adicionar
                </button>
              </div>

              {fields.length === 0 ? (
                <div className="text-center py-6 text-text-muted bg-background/50 rounded-lg border border-border border-dashed">
                  Nenhum adicional nesta categoria.
                </div>
              ) : (
                <div className="border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-background/80 text-text-muted uppercase text-xs">
                      <tr>
                        <th className="px-4 py-3 font-medium">Nome</th>
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
                              <button type="button" onClick={() => setModalOptional({ ...opt, index })} className="p-1.5 text-text-muted hover:text-primary" title="Editar">
                                <Edit className="w-4 h-4" />
                              </button>
                              <button type="button" onClick={() => handleDeleteOptional(index, opt.name)} className="p-1.5 text-text-muted hover:text-danger" title="Excluir">
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
              {updateMutation.isPending ? 'Salvando...' : 'Salvar alterações'}
            </button>
          </div>
        </form>
      </div>

      <div className={`lg:col-span-1 xl:col-span-1 ${testMode ? 'ring-2 ring-warning/40 rounded-xl' : ''}`}>
        <SimulatorErrorBoundary>
          <TariffAdvancedSimulator
            values={liveValues}
            vehicleType={category.name}
            platformCommission={liveValues.platformCommission}
          />
        </SimulatorErrorBoundary>
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
      id: optional.id || '',
      name: optional.name || '',
      value: optional.value || 0,
      isActive: optional.isActive ?? true,
    },
  });

  const onSubmit = (data) => {
    if (!data.id) {
      data.id = data.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '_');
    }
    onSave(data);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-surface rounded-xl shadow-xl w-full max-w-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex justify-between items-center">
          <h2 className="text-lg font-bold">{optional.name ? 'Editar adicional' : 'Novo adicional'}</h2>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text"><X className="w-5 h-5" /></button>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-muted mb-1">Nome</label>
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
            <button type="submit" className="px-4 py-2 rounded-lg font-medium bg-primary text-surface">Salvar</button>
          </div>
        </form>
      </div>
    </div>
  );
}
