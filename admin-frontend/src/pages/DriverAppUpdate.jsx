import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Save, Smartphone, Link2, ShieldAlert, History } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { formatDateTime } from '../utils/format';

const fetchDriverAppVersion = async () => {
  const { data } = await api.get('/admin/driver-app-version');
  return data;
};

const fetchDriverAppVersionHistory = async () => {
  const { data } = await api.get('/admin/driver-app-version/history');
  return data.history || [];
};

function sanitizeSha256(value) {
  return String(value || '').replace(/[^a-fA-F0-9]/g, '').toLowerCase();
}

export default function DriverAppUpdate() {
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState('');
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm({
    defaultValues: {
      version: '1.1.0',
      versionCode: 2,
      minimumVersion: '1.0.0',
      minimumVersionCode: 1,
      apkUrl: '',
      sha256: '',
      fileSize: 0,
      mandatory: false,
      isActive: true,
      releaseNotesText: '',
    },
  });

  const { data, isLoading } = useQuery({
    queryKey: ['driverAppVersion'],
    queryFn: fetchDriverAppVersion,
  });

  const { data: history } = useQuery({
    queryKey: ['driverAppVersionHistory'],
    queryFn: fetchDriverAppVersionHistory,
  });

  useEffect(() => {
    if (!data) return;
    reset({
      version: data.version || '',
      versionCode: data.versionCode || 1,
      minimumVersion: data.minimumVersion || '',
      minimumVersionCode: data.minimumVersionCode || 1,
      apkUrl: data.apkUrl || '',
      sha256: data.sha256 || '',
      fileSize: data.fileSize || 0,
      mandatory: Boolean(data.mandatory),
      isActive: data.isActive !== false,
      releaseNotesText: Array.isArray(data.releaseNotes) ? data.releaseNotes.join('\n') : '',
    });
  }, [data, reset]);

  const saveMutation = useMutation({
    mutationFn: async (payload) => {
      const { data: res } = await api.put('/admin/driver-app-version', payload);
      return res;
    },
    onSuccess: () => {
      setFormError('');
      toast.success('Configuração de atualização salva.');
      queryClient.invalidateQueries({ queryKey: ['driverAppVersion'] });
      queryClient.invalidateQueries({ queryKey: ['driverAppVersionHistory'] });
    },
    onError: (err) => {
      const msg = err.response?.data?.message || err.message || 'Erro ao salvar configuração';
      setFormError(msg);
      toast.error(msg);
    },
  });

  const onSubmit = async (form) => {
    setFormError('');
    const sha256 = sanitizeSha256(form.sha256);
    const apkUrl = String(form.apkUrl || '').trim();

    if (apkUrl && sha256.length !== 64) {
      const msg = 'Com URL do APK preenchida, o SHA-256 precisa ter exatamente 64 caracteres hex.';
      setFormError(msg);
      toast.error(msg);
      return;
    }

    // Auditoria de UX/produção (2026-08-10): nenhuma confirmação existia antes de
    // publicar — "obrigatória" força TODOS os motoristas com o app instalado a
    // atualizar antes de continuar trabalhando; um clique errado tem esse impacto
    // imediato em produção.
    if (form.mandatory) {
      const ok = await confirm({
        title: 'Publicar atualização obrigatória',
        message: `Isso força todo motorista com o app instalado numa versão anterior a atualizar para ${form.version} antes de continuar usando o aplicativo. Confirma?`,
        tone: 'danger',
        confirmLabel: 'Publicar como obrigatória',
      });
      if (!ok) return;
    }

    saveMutation.mutate({
      version: String(form.version || '').trim(),
      versionCode: Number(form.versionCode),
      minimumVersion: String(form.minimumVersion || '').trim(),
      minimumVersionCode: Number(form.minimumVersionCode),
      apkUrl,
      sha256,
      fileSize: Number(form.fileSize) || 0,
      mandatory: Boolean(form.mandatory),
      isActive: Boolean(form.isActive),
      releaseNotes: form.releaseNotesText,
    });
  };

  const onInvalid = () => {
    const msg = 'Preencha versão, versionCode, versão mínima e minimumVersionCode.';
    setFormError(msg);
    toast.error(msg);
  };

  if (isLoading) {
    return <div className="text-text-muted">Carregando configuração do APK...</div>;
  }

  const apkUrl = watch('apkUrl');
  const saving = saveMutation.isPending || isSubmitting;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Smartphone className="w-7 h-7 text-primary" />
          Atualização do MoveCity Motorista
        </h1>
        <p className="text-text-muted mt-1">
          Publique a versão do APK distribuído fora da Play Store. O aplicativo consulta estes dados ao abrir.
        </p>
        {data?.updatedAt && (
          <p className="text-xs text-text-muted mt-2">
            Versão atualmente publicada: <strong className="text-text">{data.version}</strong> (versionCode {data.versionCode}) · última publicação em {formatDateTime(data.updatedAt)}
          </p>
        )}
      </div>

      <form
        noValidate
        onSubmit={handleSubmit(onSubmit, onInvalid)}
        className="bg-surface border border-border rounded-xl p-6 space-y-5"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-sm font-medium text-text">Versão publicada (versionName)</span>
            <input
              {...register('version', { required: 'Obrigatório' })}
              className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 outline-none focus:border-primary"
              placeholder="1.5.0"
            />
            {errors.version && <p className="text-xs text-danger mt-1">{errors.version.message}</p>}
          </label>
          <label className="block">
            <span className="text-sm font-medium text-text">versionCode</span>
            <input
              type="number"
              {...register('versionCode', {
                required: 'Obrigatório',
                valueAsNumber: true,
                min: { value: 1, message: 'Mínimo 1' },
              })}
              className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 outline-none focus:border-primary"
            />
            {errors.versionCode && <p className="text-xs text-danger mt-1">{errors.versionCode.message}</p>}
          </label>
          <label className="block">
            <span className="text-sm font-medium text-text">Versão mínima (semver)</span>
            <input
              {...register('minimumVersion', { required: 'Obrigatório' })}
              className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 outline-none focus:border-primary"
              placeholder="1.4.0"
            />
            {errors.minimumVersion && <p className="text-xs text-danger mt-1">{errors.minimumVersion.message}</p>}
          </label>
          <label className="block">
            <span className="text-sm font-medium text-text">minimumVersionCode</span>
            <input
              type="number"
              {...register('minimumVersionCode', {
                required: 'Obrigatório',
                valueAsNumber: true,
                min: { value: 1, message: 'Mínimo 1' },
              })}
              className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 outline-none focus:border-primary"
            />
            {errors.minimumVersionCode && (
              <p className="text-xs text-danger mt-1">{errors.minimumVersionCode.message}</p>
            )}
          </label>
        </div>

        <label className="block">
          <span className="text-sm font-medium text-text flex items-center gap-2">
            <Link2 className="w-4 h-4" /> URL do APK (HTTPS / GitHub Release)
          </span>
          <input
            {...register('apkUrl')}
            className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 outline-none focus:border-primary font-mono text-sm"
            placeholder="https://github.com/.../releases/download/v1.1.7/movecity-driver-1.1.7.apk"
          />
          <p className="text-xs text-text-muted mt-1">
            Use a URL da Release no GitHub. Em produção precisa ser HTTPS.
          </p>
        </label>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-sm font-medium text-text">SHA-256 do APK (64 hex)</span>
            <input
              {...register('sha256')}
              className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 outline-none focus:border-primary font-mono text-xs"
              placeholder="96305d09fd2f75be67947a24ef0a81d5c6ab017d2f30b89aa4b4c605ee1f539c"
            />
            <p className="text-xs text-text-muted mt-1">Obrigatório se houver URL. Espaços são ignorados.</p>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-text">Tamanho do arquivo (bytes)</span>
            <input
              type="number"
              {...register('fileSize', { valueAsNumber: true })}
              className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 outline-none focus:border-primary"
            />
          </label>
        </div>

        <label className="block">
          <span className="text-sm font-medium text-text">Notas da versão (uma por linha)</span>
          <textarea
            {...register('releaseNotesText')}
            rows={5}
            className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 outline-none focus:border-primary"
            placeholder={'Correções de estabilidade\nMelhorias nas notificações\nMelhorias no GPS'}
          />
        </label>

        <div className="flex flex-col sm:flex-row gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" {...register('mandatory')} className="rounded border-border" />
            <span className="text-sm font-medium flex items-center gap-1">
              <ShieldAlert className="w-4 h-4 text-warning" />
              Atualização obrigatória
            </span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" {...register('isActive')} className="rounded border-border" />
            <span className="text-sm font-medium">Configuração ativa</span>
          </label>
        </div>

        {apkUrl && (
          <div className="rounded-lg bg-background border border-border p-3 text-sm text-text-muted break-all">
            Preview URL:{' '}
            <a href={apkUrl} target="_blank" rel="noreferrer" className="text-primary underline">
              {apkUrl}
            </a>
          </div>
        )}

        {formError && (
          <div className="rounded-lg border border-danger/40 bg-danger/10 text-danger text-sm px-3 py-2">
            {formError}
          </div>
        )}

        <div className="pt-2">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-white font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-wait"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Salvando...' : 'Salvar'}
          </button>
          <p className="text-xs text-text-muted mt-2">
            Conta precisa ser <strong>super_admin</strong>. Se o botão não salvar, a mensagem de erro aparece acima.
          </p>
        </div>
      </form>

      {/* Auditoria de UX/produção (2026-08-10): antes havia um bloco de texto FIXO no
          código com valores de exemplo de uma versão antiga (v1.1.7) "pra copiar" —
          ficava desatualizado a cada release (produção já estava na 1.1.16 quando
          isso foi corrigido) e podia levar o admin a publicar dados de uma versão
          errada por engano. Histórico real, alimentado a cada publicação. */}
      <div className="border border-border rounded-xl bg-surface overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-2">
          <History className="w-4 h-4 text-text-muted" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-text">Histórico de publicações</h2>
        </div>
        {!history || history.length === 0 ? (
          <p className="text-xs text-text-muted p-4">Nenhuma publicação registrada ainda por este painel.</p>
        ) : (
          <div className="divide-y divide-border">
            {history.map((h) => (
              <div key={h._id} className="p-4 text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-text">
                    {h.version} <span className="text-text-muted font-normal">(versionCode {h.versionCode})</span>
                    {h.mandatory && <span className="ml-2 text-warning">· obrigatória</span>}
                  </span>
                  <span className="text-text-muted">{formatDateTime(h.createdAt)}</span>
                </div>
                <p className="text-text-muted">
                  Publicado por {h.adminName || 'admin desconhecido'} · versão mínima {h.minimumVersion || '—'} (code {h.minimumVersionCode ?? '—'})
                </p>
                {h.apkUrl && <p className="text-text-muted break-all">{h.apkUrl}</p>}
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-text-muted p-4 border-t border-border">
          Pra reverter uma versão com problema: escolha uma entrada anterior neste histórico e publique os mesmos dados
          novamente, com um <strong>versionCode maior</strong> que o atual (não é possível publicar um versionCode menor).
        </p>
      </div>
    </div>
  );
}
