import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Plus, X, Edit, Trash2, Power, Globe } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';

const fetchGlobalTariffs = async () => {
  const { data } = await api.get('/admin/global-tariffs');
  return data;
};

export default function GlobalTariffsSection() {
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [modal, setModal] = useState(null); // null | {} | tariff

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['globalTariffs'],
    queryFn: fetchGlobalTariffs,
  });

  const createMutation = useMutation({
    mutationFn: async (payload) => {
      const { data } = await api.post('/admin/global-tariffs', payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['globalTariffs'] });
      toast.success('Tarifa global criada');
      setModal(null);
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Erro ao criar'),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }) => {
      const { data } = await api.put(`/admin/global-tariffs/${id}`, payload);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['globalTariffs'] });
      toast.success('Tarifa global atualizada');
      setModal(null);
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Erro ao atualizar'),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, active }) => {
      const { data } = await api.patch(`/admin/global-tariffs/${id}/active`, { active });
      return data;
    },
    onSuccess: (item) => {
      queryClient.invalidateQueries({ queryKey: ['globalTariffs'] });
      toast.success(item.active ? 'Tarifa ativada' : 'Tarifa desativada');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Erro ao alterar status'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      await api.delete(`/admin/global-tariffs/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['globalTariffs'] });
      toast.success('Tarifa global excluída');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Erro ao excluir'),
  });

  const onSave = (form) => {
    const payload = {
      name: form.name.trim(),
      value: Number(form.value),
      active: form.active === true || form.active === 'true',
    };
    if (modal?._id) {
      updateMutation.mutate({ id: modal._id, payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const onToggle = async (item) => {
    toggleMutation.mutate({ id: item._id, active: !item.active });
  };

  const onDelete = async (item) => {
    const ok = await confirm(
      `Excluir "${item.name}"? Ela deixará de entrar no cálculo imediatamente.`,
      'Excluir tarifa global?'
    );
    if (ok) deleteMutation.mutate(item._id);
  };

  return (
    <section className="bg-surface rounded-xl border border-border overflow-hidden">
      <div className="bg-background/50 border-b border-border p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="font-semibold text-lg flex items-center gap-2">
            <Globe className="w-5 h-5 text-primary" />
            Tarifas Globais
          </h2>
          <p className="text-sm text-text-muted mt-1">
            Aplicadas a todas as categorias (moto, carro, etc.) quando ativas — sem duplicar por veículo.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setModal({})}
          className="inline-flex items-center gap-1.5 text-sm font-medium bg-primary text-surface px-3 py-2 rounded-lg hover:opacity-90"
        >
          <Plus className="w-4 h-4" /> Nova tarifa global
        </button>
      </div>

      <div className="p-4">
        {isLoading ? (
          <p className="text-sm text-text-muted">Carregando…</p>
        ) : items.length === 0 ? (
          <div className="text-center py-8 text-text-muted border border-dashed border-border rounded-lg">
            Nenhuma tarifa global cadastrada.
          </div>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm text-left">
              <thead className="bg-background/80 text-text-muted uppercase text-xs">
                <tr>
                  <th className="px-4 py-3 font-medium">Nome</th>
                  <th className="px-4 py-3 font-medium">Valor</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Criada em</th>
                  <th className="px-4 py-3 font-medium text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((item) => (
                  <tr key={item._id} className="bg-surface hover:bg-background/30">
                    <td className="px-4 py-3 font-medium text-text">{item.name}</td>
                    <td className="px-4 py-3">
                      R$ {Number(item.value).toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      {item.active ? (
                        <span className="bg-success/10 text-success px-2 py-1 rounded text-xs font-semibold">ATIVA</span>
                      ) : (
                        <span className="bg-text-muted/10 text-text-muted px-2 py-1 rounded text-xs font-semibold">INATIVA</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-text-muted">
                      {item.createdAt
                        ? new Date(item.createdAt).toLocaleDateString('pt-BR')
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          title="Editar"
                          onClick={() => setModal(item)}
                          className="p-1.5 text-text-muted hover:text-primary"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          title={item.active ? 'Desativar' : 'Ativar'}
                          onClick={() => onToggle(item)}
                          className="p-1.5 text-text-muted hover:text-warning"
                        >
                          <Power className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          title="Excluir"
                          onClick={() => onDelete(item)}
                          className="p-1.5 text-text-muted hover:text-danger"
                        >
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

      {modal && (
        <GlobalTariffModal
          tariff={modal}
          saving={createMutation.isPending || updateMutation.isPending}
          onClose={() => setModal(null)}
          onSave={onSave}
        />
      )}
    </section>
  );
}

function GlobalTariffModal({ tariff, onClose, onSave, saving }) {
  const isEdit = Boolean(tariff._id);
  const { register, handleSubmit, formState: { errors } } = useForm({
    defaultValues: {
      name: tariff.name || '',
      value: tariff.value ?? 0,
      active: tariff.active ?? true,
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-surface rounded-xl shadow-xl w-full max-w-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex justify-between items-center">
          <h3 className="text-lg font-bold">{isEdit ? 'Editar tarifa global' : 'Nova tarifa global'}</h3>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit(onSave)} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-muted mb-1">Nome</label>
            <input
              {...register('name', { required: 'Nome é obrigatório' })}
              placeholder="Ex: Taxa de embarque"
              className="w-full bg-background border border-border rounded-lg px-3 py-2 outline-none"
            />
            {errors.name && <p className="text-danger text-xs mt-1">{errors.name.message}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-text-muted mb-1">Valor (R$)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              {...register('value', {
                valueAsNumber: true,
                required: 'Valor é obrigatório',
                min: { value: 0, message: 'Não pode ser negativo' },
              })}
              className="w-full bg-background border border-border rounded-lg px-3 py-2 outline-none"
            />
            {errors.value && <p className="text-danger text-xs mt-1">{errors.value.message}</p>}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...register('active')} />
            Ativa (entra no cálculo)
          </label>
          <div className="pt-2 flex justify-end gap-3 border-t border-border">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-border">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-primary text-surface font-medium disabled:opacity-50"
            >
              {saving ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
