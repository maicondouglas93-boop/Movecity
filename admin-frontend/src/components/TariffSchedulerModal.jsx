import React from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { Calendar, X } from 'lucide-react';
import { useToast } from '../contexts/ToastContext';

export default function TariffSchedulerModal({ isOpen, onClose, categoryId, categoryName, pendingChanges }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { register, handleSubmit } = useForm();

  const scheduleMutation = useMutation({
    mutationFn: async (data) => {
      const payload = {
        categoryId,
        scheduledFor: data.scheduledFor,
        changes: pendingChanges
      };
      const res = await api.post('/admin/tariffs/schedule', payload);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['tariffHistory']);
      toast.success('Tarifas agendadas com sucesso!');
      onClose();
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Erro ao agendar tarifas')
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-surface rounded-xl border border-border w-full max-w-md shadow-2xl">
        <div className="flex justify-between items-center p-5 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="bg-primary/20 p-2 rounded-lg">
              <Calendar className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="font-semibold text-lg">Agendar Tarifas</h2>
              <p className="text-xs text-text-muted">{categoryName || 'Tarifas Globais'}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-background rounded-full transition-colors">
            <X className="w-5 h-5 text-text-muted hover:text-text" />
          </button>
        </div>
        
        <form onSubmit={handleSubmit((data) => scheduleMutation.mutate(data))} className="p-5">
          <p className="text-sm text-text-muted mb-4">
            Em vez de salvar as alterações imediatamente, você pode agendar para que entrem em vigor em uma data e hora específicas.
          </p>
          
          <div className="mb-6">
            <label className="block text-sm font-medium text-text-muted mb-1">Entrar em vigor em:</label>
            <input 
              type="datetime-local" 
              required
              {...register('scheduledFor')} 
              className="w-full bg-background border border-border rounded-lg px-3 py-2 text-text focus:border-primary outline-none" 
            />
          </div>
          
          <div className="flex justify-end gap-3">
            <button 
              type="button" 
              onClick={onClose} 
              className="px-4 py-2 text-text-muted hover:text-text font-medium transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={scheduleMutation.isPending}
              className="bg-primary hover:bg-primary-hover text-surface px-6 py-2 rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              {scheduleMutation.isPending ? 'Agendando...' : 'Confirmar Agendamento'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
