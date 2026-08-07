import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Save, Smartphone, Link2, ShieldAlert } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';

const fetchDriverAppVersion = async () => {
  const { data } = await api.get('/admin/driver-app-version');
  return data;
};

function sanitizeSha256(value) {
  return String(value || '').replace(/[^a-fA-F0-9]/g, '').toLowerCase();
}

export default function DriverAppUpdate() {
  const toast = useToast();
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
    },
    onError: (err) => {
      const msg = err.response?.data?.message || err.message || 'Erro ao salvar configuração';
      setFormError(msg);
      toast.error(msg);
    },
  });

  const onSubmit = (form) => {
    setFormError('');
    const sha256 = sanitizeSha256(form.sha256);
    const apkUrl = String(form.apkUrl || '').trim();

    if (apkUrl && sha256.length !== 64) {
      const msg = 'Com URL do APK preenchida, o SHA-256 precisa ter exatamente 64 caracteres hex.';
      setFormError(msg);
      toast.error(msg);
      return;
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

      <div className="text-xs text-text-muted space-y-1 border border-border rounded-xl p-4 bg-surface">
        <p className="font-semibold text-text">Valores v1.1.7 (copiar)</p>
        <p>version: 1.1.7 · versionCode: 9 · minimumVersion: 1.1.5 · minimumVersionCode: 7</p>
        <p className="break-all">
          apkUrl: https://github.com/maicondouglas93-boop/Movecity/releases/download/v1.1.7/movecity-driver-1.1.7.apk
        </p>
        <p className="break-all">sha256: 96305d09fd2f75be67947a24ef0a81d5c6ab017d2f30b89aa4b4c605ee1f539c</p>
        <p>fileSize: 6911676 · mandatory: desmarcado</p>
        <p className="font-semibold text-text pt-2">Rollback</p>
        <p>
          Se uma versão apresentar problema, publique novamente a versão anterior (version, versionCode, apkUrl, minimumVersion).
        </p>
      </div>
    </div>
  );
}
