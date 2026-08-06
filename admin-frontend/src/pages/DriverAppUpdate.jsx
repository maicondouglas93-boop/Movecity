import React, { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Save, Smartphone, Link2, ShieldAlert } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';

const fetchDriverAppVersion = async () => {
  const { data } = await api.get('/admin/driver-app-version');
  return data;
};

export default function DriverAppUpdate() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { register, handleSubmit, reset, watch } = useForm({
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
      toast.success('Configuração de atualização salva.');
      queryClient.invalidateQueries({ queryKey: ['driverAppVersion'] });
    },
    onError: (err) => {
      toast.error(err.response?.data?.message || 'Erro ao salvar configuração');
    },
  });

  const onSubmit = (form) => {
    saveMutation.mutate({
      version: form.version,
      versionCode: Number(form.versionCode),
      minimumVersion: form.minimumVersion,
      minimumVersionCode: Number(form.minimumVersionCode),
      apkUrl: form.apkUrl,
      sha256: form.sha256,
      fileSize: Number(form.fileSize) || 0,
      mandatory: Boolean(form.mandatory),
      isActive: Boolean(form.isActive),
      releaseNotes: form.releaseNotesText,
    });
  };

  if (isLoading) {
    return <div className="text-text-muted">Carregando configuração do APK...</div>;
  }

  const apkUrl = watch('apkUrl');

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
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="bg-surface border border-border rounded-xl p-6 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-sm font-medium text-text">Versão publicada (versionName)</span>
            <input
              {...register('version', { required: true })}
              className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 outline-none focus:border-primary"
              placeholder="1.5.0"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-text">versionCode</span>
            <input
              type="number"
              {...register('versionCode', { required: true, min: 1 })}
              className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 outline-none focus:border-primary"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-text">Versão mínima (semver)</span>
            <input
              {...register('minimumVersion', { required: true })}
              className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 outline-none focus:border-primary"
              placeholder="1.4.0"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-text">minimumVersionCode</span>
            <input
              type="number"
              {...register('minimumVersionCode', { required: true, min: 1 })}
              className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 outline-none focus:border-primary"
            />
          </label>
        </div>

        <label className="block">
          <span className="text-sm font-medium text-text flex items-center gap-2">
            <Link2 className="w-4 h-4" /> URL do APK (HTTPS / CDN)
          </span>
          <input
            {...register('apkUrl')}
            className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 outline-none focus:border-primary font-mono text-sm"
            placeholder="https://cdn.exemplo.com/movecity-driver-1.5.0.apk"
          />
          <p className="text-xs text-text-muted mt-1">
            Não hospede o APK no MongoDB. Apenas a URL. Em produção, use HTTPS.
          </p>
        </label>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-sm font-medium text-text">SHA-256 do APK (opcional, recomendado)</span>
            <input
              {...register('sha256')}
              className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 outline-none focus:border-primary font-mono text-xs"
              placeholder="64 caracteres hex"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-text">Tamanho do arquivo (bytes)</span>
            <input
              type="number"
              {...register('fileSize')}
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
            Preview URL: <a href={apkUrl} target="_blank" rel="noreferrer" className="text-primary underline">{apkUrl}</a>
          </div>
        )}

        <div className="pt-2">
          <button
            type="submit"
            disabled={saveMutation.isPending}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-white font-medium hover:opacity-90 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {saveMutation.isPending ? 'Salvando...' : 'Salvar'}
          </button>
        </div>
      </form>

      <div className="text-xs text-text-muted space-y-1 border border-border rounded-xl p-4 bg-surface">
        <p className="font-semibold text-text">Rollback</p>
        <p>
          Se uma versão apresentar problema, publique novamente a versão anterior (version, versionCode, apkUrl, minimumVersion).
          Não é necessário apagar o APK antigo do CDN.
        </p>
        <p className="font-semibold text-text pt-2">Assinatura</p>
        <p>
          Todas as versões devem usar a mesma chave de release (`br.com.movecity.driver`). Assinatura diferente impede atualização sobre a instalação existente.
        </p>
      </div>
    </div>
  );
}
