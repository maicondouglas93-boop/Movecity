import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import api from '../services/api';

const queryKey = ['driverCreditRule'];

export default function DriverCreditRule() {
  const { user } = useAuth();
  const toast = useToast();
  const client = useQueryClient();
  const [enabled, setEnabled] = useState(true);
  const canEdit = ['super_admin', 'OWNER'].includes(user?.role);
  const { data, isPending, isError, isFetching, refetch } = useQuery({
    queryKey,
    queryFn: async () => (await api.get('/admin/settings/driver-credit')).data,
  });
  useEffect(() => { if (data) setEnabled(data.blockDriverOnNegativeBalance); }, [data]);
  const save = useMutation({
    mutationFn: async () => (await api.put('/admin/settings/driver-credit', {
      blockDriverOnNegativeBalance: enabled, version: data.version,
    })).data,
    onSuccess: result => {
      client.setQueryData(queryKey, result);
      client.invalidateQueries({ queryKey: ['captains'] });
      toast.success('Regra de crédito salva.');
    },
    onError: error => toast.error(error.response?.data?.message || 'Não foi possível salvar a regra. Confira o valor atual antes de tentar novamente.'),
  });

  return (
    <section aria-label="Regra de crédito dos motoristas" className="bg-background border border-border rounded-xl p-4 space-y-3">
      <h2 className="font-semibold">Regra de crédito dos motoristas</h2>
      {isPending ? <p role="status" className="text-sm text-text-muted">Carregando regra de crédito...</p>
        : isError ? <div role="alert" className="text-sm text-danger space-y-2">
          <p>Não foi possível carregar a regra de crédito.</p>
          <button type="button" disabled={isFetching} onClick={() => refetch()} className="min-h-[44px] underline">Tentar carregar novamente</button>
        </div> : <>
          <p className="text-sm text-text-muted">Ativada: crédito abaixo de R$ 0,00 impede ficar online, aceitar corridas e encomendas ou criar e iniciar uma corrida presencial. Saldo zero é permitido.</p>
          <p className="text-sm text-text-muted">Desativada: saldo negativo não impede novos serviços. Aprovação, bloqueios administrativos e ocupação do motorista continuam valendo. Corridas em andamento podem ser finalizadas.</p>
          <form onSubmit={event => { event.preventDefault(); if (canEdit && !save.isPending) save.mutate(); }} className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-3 min-h-[44px] text-sm font-medium">
              <input type="checkbox" checked={enabled} disabled={!canEdit || save.isPending} onChange={event => setEnabled(event.target.checked)} className="h-5 w-5 accent-primary" />
              Bloquear motoristas com crédito negativo
            </label>
            {canEdit && <button type="submit" disabled={save.isPending || enabled === data.blockDriverOnNegativeBalance} className="min-h-[44px] px-4 py-2 rounded-lg bg-primary text-surface text-sm font-semibold disabled:opacity-50">
              {save.isPending ? 'Salvando regra...' : 'Salvar regra de crédito'}
            </button>}
          </form>
          <p role="status" className="text-sm text-text-muted">Regra salva: {data.blockDriverOnNegativeBalance ? 'ativada' : 'desativada'}.</p>
          {save.isError && <div role="alert" className="text-sm text-danger">
            <p>{save.error.response?.data?.message || 'Não foi possível confirmar o salvamento.'}</p>
            <button type="button" onClick={() => { save.reset(); refetch(); }} className="min-h-[44px] underline">Conferir regra atual</button>
          </div>}
          {!canEdit && <p className="text-xs text-text-muted">Somente o administrador principal pode alterar esta regra.</p>}
        </>}
    </section>
  );
}
