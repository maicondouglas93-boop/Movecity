import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import api from '../services/api';
import {
  Bell, Send, Users, Car, Globe, Info, Clock, CheckCircle2,
  XCircle, Copy, Calendar, MessageSquare, AlertCircle, Trash2, Tag, Play, CheckSquare, Plus, Smartphone, X, Image as ImageIcon
} from 'lucide-react';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';

const schema = z.object({
  title: z.string().min(3, 'O título deve ter no mínimo 3 caracteres').max(50, 'Máximo 50 caracteres'),
  message: z.string().min(5, 'A mensagem deve ter no mínimo 5 caracteres').max(150, 'Máximo 150 caracteres'),
  imageUrl: z.string().url('URL inválida').optional().or(z.literal('')),
  deepLink: z.enum(['home', 'wallet', 'promotions', 'rides', 'profile']).default('home'),
  type: z.enum(['marketing', 'system', 'promotion', 'emergency', 'financial', 'update']).default('marketing'),
  targetRules: z.object({
    audienceType: z.enum(['all', 'passengers', 'drivers']),
    isVIP: z.boolean().optional(),
    isBlocked: z.boolean().optional(),
    noRidesDays: z.number().optional(),
    isOnline: z.boolean().optional(),
    city: z.string().optional()
  }),
  isScheduled: z.boolean().default(false),
  scheduledAt: z.string().optional()
});

const TEMPLATES = [
  { id: 1, name: '🎉 Promoção FDS', title: 'Fim de semana chegou! 🎉', message: 'Ganhe 20% OFF na sua corrida usando o cupom FIMDESEMANA20. Aproveite!', type: 'promotion', deepLink: 'promotions' },
  { id: 2, name: '🚨 Manutenção', title: 'Aviso de Sistema', message: 'Faremos uma manutenção hoje à noite. O app pode ficar instável por 15 minutos.', type: 'system', deepLink: 'home' },
  { id: 3, name: '💰 Cashback', title: 'Seu Cashback Expirando!', message: 'Você tem R$ 10,00 na sua carteira que vão expirar amanhã. Use agora!', type: 'marketing', deepLink: 'wallet' },
];


function InboxQuickSend({ onSent }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState({
    target: 'passengers',
    title: '',
    message: '',
    category: 'admin',
    priority: 'normal',
    action: '/home',
    userIds: '',
    captainIds: '',
  });
  const [sending, setSending] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    // Bug de produção (2026-08-10): este envio disparava imediatamente ao clicar,
    // sem nenhuma confirmação — diferente da aba "Nova Campanha", que já tem modal
    // de confirmação antes de qualquer disparo. É irreversível (não dá pra "desenviar"
    // um push já entregue) e pode alcançar toda a base se target='all'.
    const targetLabel = form.target === 'all' ? 'TODOS os passageiros e motoristas'
      : form.target === 'passengers' ? 'todos os passageiros'
      : form.target === 'drivers' ? 'todos os motoristas'
      : 'os IDs específicos informados';
    const ok = await confirm({
      title: 'Enviar notificação agora',
      message: `Isso envia "${form.title}" pra ${targetLabel} imediatamente, sem confirmação posterior — não é possível cancelar depois de enviado. Continuar?`,
      tone: form.target === 'all' ? 'danger' : 'default',
      confirmLabel: 'Enviar agora',
    });
    if (!ok) return;
    setSending(true);
    try {
      const payload = {
        target: form.target,
        title: form.title,
        message: form.message,
        category: form.category,
        priority: form.priority,
        action: form.action,
      };
      if (form.target === 'specific') {
        payload.userIds = form.userIds.split(',').map((s) => s.trim()).filter(Boolean);
        payload.captainIds = form.captainIds.split(',').map((s) => s.trim()).filter(Boolean);
      }
      await api.post('/admin/notifications/inbox', payload);
      toast.success('Notificação enviada para a central dos usuários');
      onSent?.();
      setForm((f) => ({ ...f, title: '', message: '' }));
    } catch (err) {
      toast.error(err.response?.data?.message || 'Falha ao enviar');
    } finally {
      setSending(false);
    }
  };

  return (
    <form onSubmit={submit} className="bg-surface border border-border rounded-xl p-6 space-y-4 max-w-2xl">
      <h2 className="text-sm font-bold uppercase tracking-wider flex items-center gap-2"><Bell className="w-4 h-4" /> Envio para Central In-App</h2>
      <p className="text-sm text-text-muted">Cria o card na central do app (sino) e dispara push FCM quando houver token.</p>
      <div className="grid grid-cols-2 gap-3">
        {['all', 'passengers', 'drivers', 'specific'].map((t) => (
          <button type="button" key={t} onClick={() => setForm((f) => ({ ...f, target: t }))}
            className={`p-3 rounded-lg border text-sm font-medium ${form.target === t ? 'border-primary bg-primary/10 text-primary' : 'border-border'}`}>
            {t === 'all' ? 'Todos' : t === 'passengers' ? 'Passageiros' : t === 'drivers' ? 'Motoristas' : 'IDs específicos'}
          </button>
        ))}
      </div>
      {form.target === 'specific' && (
        <div className="space-y-2">
          <input className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background" placeholder="userIds separados por vírgula" value={form.userIds} onChange={(e) => setForm((f) => ({ ...f, userIds: e.target.value }))} />
          <input className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background" placeholder="captainIds separados por vírgula" value={form.captainIds} onChange={(e) => setForm((f) => ({ ...f, captainIds: e.target.value }))} />
        </div>
      )}
      <input required maxLength={120} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background" placeholder="Título" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
      <textarea required maxLength={500} rows={3} className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background" placeholder="Descrição" value={form.message} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <select className="border border-border rounded-lg px-3 py-2 text-sm bg-background" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
          {['admin','promotion','coupon','system','alert','payment','ride','parcel','schedule'].map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="border border-border rounded-lg px-3 py-2 text-sm bg-background" value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}>
          {['low','normal','high','urgent'].map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <input className="border border-border rounded-lg px-3 py-2 text-sm bg-background" placeholder="Ação (ex: /coupons)" value={form.action} onChange={(e) => setForm((f) => ({ ...f, action: e.target.value }))} />
      </div>
      <button disabled={sending} type="submit" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-white text-sm font-semibold disabled:opacity-50">
        <Send className="w-4 h-4" /> {sending ? 'Enviando…' : 'Enviar agora'}
      </button>
    </form>
  );
}


export default function Notifications() {
  const [activeTab, setActiveTab] = useState('new');
  const [previewTab, setPreviewTab] = useState('ios');
  const [estimatedCount, setEstimatedCount] = useState(null);
  const [confirmModal, setConfirmModal] = useState({ isOpen: false, data: null });
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();

  const { register, handleSubmit, watch, control, setValue, reset, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      title: '', message: '', imageUrl: '', deepLink: 'home', type: 'marketing',
      targetRules: { audienceType: 'all', isVIP: false, isBlocked: false, isOnline: false, city: '' },
      isScheduled: false, scheduledAt: ''
    }
  });

  const formValues = watch();

  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ['campaigns'],
    queryFn: async () => {
      const res = await api.get('/admin/campaigns');
      return res.data;
    },
    enabled: activeTab === 'history'
  });

  const { data: inboxStatsData } = useQuery({
    queryKey: ['inbox-stats'],
    queryFn: async () => {
      const res = await api.get('/admin/notifications/inbox-stats');
      return res.data;
    },
    enabled: activeTab === 'history'
  });

  const estimateMutation = useMutation({
    mutationFn: async (rules) => {
      const res = await api.post('/admin/campaigns/estimate', { targetRules: rules });
      return res.data.count;
    },
    onSuccess: (count) => setEstimatedCount(count)
  });

  // Debounced estimation
  useEffect(() => {
    const handler = setTimeout(() => {
      if (formValues.targetRules.audienceType) {
        estimateMutation.mutate(formValues.targetRules);
      }
    }, 800);
    return () => clearTimeout(handler);
  }, [JSON.stringify(formValues.targetRules)]);

  const createMutation = useMutation({
    mutationFn: async (data) => {
      return await api.post('/admin/campaigns', data);
    },
    onSuccess: () => {
      toast.success('Campanha criada com sucesso!');
      setConfirmModal({ isOpen: false, data: null });
      reset();
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      setActiveTab('history');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Erro ao criar campanha')
  });

  const cancelMutation = useMutation({
    mutationFn: async (id) => await api.post(`/admin/campaigns/${id}/cancel`),
    onSuccess: () => {
      toast.success('Campanha agendada foi cancelada.');
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Erro ao cancelar campanha')
  });

  const onSubmit = (data) => {
    if (data.isScheduled && !data.scheduledAt) {
      return toast.error('Preencha a data de agendamento');
    }
    setConfirmModal({ isOpen: true, data });
  };

  const applyTemplate = (tpl) => {
    setValue('title', tpl.title);
    setValue('message', tpl.message);
    setValue('type', tpl.type);
    setValue('deepLink', tpl.deepLink);
  };

  const handleDuplicate = (camp) => {
    setValue('title', camp.title + ' (Cópia)');
    setValue('message', camp.message);
    setValue('imageUrl', camp.imageUrl || '');
    setValue('type', camp.type);
    setValue('deepLink', camp.deepLink);
    setValue('targetRules', camp.targetRules);
    setValue('isScheduled', false);
    setActiveTab('new');
    toast.success('Campanha duplicada para o formulário. Ajuste e envie.');
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 relative pb-20">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Central de Comunicação</h1>
        <p className="text-text-muted mt-1">Crie, segmente e gerencie campanhas de Push Notification.</p>
      </div>

      <div className="flex border-b border-border">
        <button onClick={() => setActiveTab('new')} className={`px-6 py-3 font-medium text-sm transition-colors border-b-2 ${activeTab === 'new' ? 'border-primary text-primary' : 'border-transparent text-text-muted hover:text-text'}`}>Nova Campanha</button>
        <button onClick={() => setActiveTab('inbox')} className={`px-6 py-3 font-medium text-sm transition-colors border-b-2 ${activeTab === 'inbox' ? 'border-primary text-primary' : 'border-transparent text-text-muted hover:text-text'}`}>Envio Inbox</button>
        <button onClick={() => setActiveTab('history')} className={`px-6 py-3 font-medium text-sm transition-colors border-b-2 ${activeTab === 'history' ? 'border-primary text-primary' : 'border-transparent text-text-muted hover:text-text'}`}>Histórico & Métricas</button>
      </div>

      {activeTab === 'new' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            
            {/* Templates */}
            <div className="bg-surface border border-border p-4 rounded-xl flex gap-3 overflow-x-auto no-scrollbar items-center">
              <span className="text-sm font-semibold text-text-muted flex items-center gap-2 mr-2 shrink-0"><Copy className="w-4 h-4" /> Templates Rápidos:</span>
              {TEMPLATES.map(tpl => (
                <button key={tpl.id} type="button" onClick={() => applyTemplate(tpl)} className="shrink-0 px-4 py-2 rounded-lg bg-background border border-border text-xs font-medium hover:border-primary hover:text-primary transition-colors">
                  {tpl.name}
                </button>
              ))}
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              
              {/* Audience */}
              <div className="bg-surface border border-border p-6 rounded-xl space-y-5">
                <h2 className="text-sm font-bold uppercase tracking-wider text-text flex items-center gap-2"><Users className="w-4 h-4" /> 1. Público Alvo</h2>
                
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {['all', 'passengers', 'drivers'].map(aud => (
                    <button type="button" key={aud} onClick={() => setValue('targetRules.audienceType', aud)} className={`p-4 rounded-xl border flex flex-col items-center justify-center transition-all ${formValues.targetRules.audienceType === aud ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-background text-text-muted hover:border-text-muted'}`}>
                      {aud === 'all' && <Globe className="w-6 h-6 mb-2" />}
                      {aud === 'passengers' && <Users className="w-6 h-6 mb-2" />}
                      {aud === 'drivers' && <Car className="w-6 h-6 mb-2" />}
                      <span className="text-sm font-medium">{aud === 'all' ? 'Todos' : aud === 'passengers' ? 'Passageiros' : 'Motoristas'}</span>
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-border">
                  {/* Bug de produção (2026-08-10): este checkbox também aparecia com
                      público "Todos", mas o backend só respeitava isVIP dentro do
                      filtro de passageiros — marcar "Apenas VIP" com "Todos" selecionado
                      não tinha efeito nenhum, o push saía pra base inteira mesmo assim.
                      Restrito a "Passageiros" (o único caso sem ambiguidade: motorista
                      não tem esse conceito, e "Todos + só VIP" é uma combinação que não
                      faz sentido de produto — se você quer só VIP, o público É os VIPs). */}
                  {formValues.targetRules.audienceType === 'passengers' && (
                    <label className="flex items-center gap-3 p-3 border border-border rounded-lg bg-background cursor-pointer hover:border-primary/50 transition-colors">
                      <input type="checkbox" {...register('targetRules.isVIP')} className="w-4 h-4 text-primary bg-surface border-border rounded focus:ring-primary" />
                      <span className="text-sm font-medium">Apenas Passageiros VIP</span>
                    </label>
                  )}
                  {formValues.targetRules.audienceType === 'drivers' && (
                    <label className="flex items-center gap-3 p-3 border border-border rounded-lg bg-background cursor-pointer hover:border-primary/50 transition-colors">
                      <input type="checkbox" {...register('targetRules.isOnline')} className="w-4 h-4 text-primary bg-surface border-border rounded focus:ring-primary" />
                      <span className="text-sm font-medium">Apenas Motoristas Online</span>
                    </label>
                  )}
                  <label className="flex items-center gap-3 p-3 border border-border rounded-lg bg-background cursor-pointer hover:border-primary/50 transition-colors">
                    <input type="checkbox" {...register('targetRules.isBlocked')} className="w-4 h-4 text-primary bg-surface border-border rounded focus:ring-primary" />
                    <span className="text-sm font-medium">Apenas Usuários Bloqueados</span>
                  </label>
                  <div className="sm:col-span-2">
                    <input type="text" {...register('targetRules.city')} placeholder="Filtrar por Cidade (Ex: Lajinha)" className="w-full p-3 bg-background border border-border rounded-lg text-sm text-text focus:border-primary outline-none" />
                  </div>
                </div>
              </div>

              {/* Content */}
              <div className="bg-surface border border-border p-6 rounded-xl space-y-5">
                <h2 className="text-sm font-bold uppercase tracking-wider text-text flex items-center gap-2"><MessageSquare className="w-4 h-4" /> 2. Conteúdo</h2>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-text-muted mb-1">Tipo de Notificação</label>
                    <select {...register('type')} className="w-full bg-background border border-border rounded-lg p-3 text-sm focus:border-primary outline-none">
                      <option value="marketing">Marketing (Promoções)</option>
                      <option value="system">Sistema / Alertas</option>
                      <option value="financial">Financeiro / Recargas</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-muted mb-1">Ação ao Clicar (Deep Link)</label>
                    <select {...register('deepLink')} className="w-full bg-background border border-border rounded-lg p-3 text-sm focus:border-primary outline-none">
                      <option value="home">Página Inicial (Home)</option>
                      <option value="wallet">Carteira / Pagamentos</option>
                      <option value="promotions">Central de Promoções</option>
                      <option value="profile">Perfil do Usuário</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">Título</label>
                  <input type="text" {...register('title')} placeholder="Olá, {{nome}}! Seu desconto chegou." className={`w-full bg-background border rounded-lg p-3 text-sm focus:border-primary outline-none ${errors.title ? 'border-danger' : 'border-border'}`} />
                  {errors.title && <p className="text-danger text-xs mt-1">{errors.title.message}</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">Mensagem</label>
                  <textarea {...register('message')} placeholder="Escreva a mensagem aqui..." className={`w-full h-24 resize-none bg-background border rounded-lg p-3 text-sm focus:border-primary outline-none ${errors.message ? 'border-danger' : 'border-border'}`} />
                  <p className="text-xs text-text-muted text-right mt-1">{formValues.message.length}/150</p>
                  {errors.message && <p className="text-danger text-xs">{errors.message.message}</p>}
                </div>
                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">Imagem URL (Opcional - Firebase Push)</label>
                  <input type="text" {...register('imageUrl')} placeholder="https://..." className={`w-full bg-background border rounded-lg p-3 text-sm focus:border-primary outline-none ${errors.imageUrl ? 'border-danger' : 'border-border'}`} />
                  {errors.imageUrl && <p className="text-danger text-xs mt-1">{errors.imageUrl.message}</p>}
                </div>
              </div>

              {/* Scheduling & Submit */}
              <div className="bg-surface border border-border p-6 rounded-xl space-y-5">
                <h2 className="text-sm font-bold uppercase tracking-wider text-text flex items-center gap-2"><Clock className="w-4 h-4" /> 3. Agendamento e Disparo</h2>
                
                <div className="flex gap-4 p-1 bg-background rounded-lg border border-border w-max">
                  <button type="button" onClick={() => setValue('isScheduled', false)} className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${!formValues.isScheduled ? 'bg-primary text-white shadow' : 'text-text-muted hover:text-text'}`}>Enviar Agora</button>
                  <button type="button" onClick={() => setValue('isScheduled', true)} className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${formValues.isScheduled ? 'bg-primary text-white shadow' : 'text-text-muted hover:text-text'}`}>Agendar Data</button>
                </div>

                {formValues.isScheduled && (
                  <div>
                    <label className="block text-xs font-medium text-text-muted mb-1">Selecione Data e Hora</label>
                    <input type="datetime-local" {...register('scheduledAt')} className="w-full md:w-1/2 bg-background border border-border rounded-lg p-3 text-sm focus:border-primary outline-none" />
                  </div>
                )}

                <div className="pt-4 flex items-center justify-between">
                  <div className="text-sm font-medium text-text flex items-center gap-2">
                    <Users className="w-5 h-5 text-primary" />
                    {estimatedCount === null ? <span>Calculando público...</span> : (
                      <span className="bg-primary/10 text-primary px-3 py-1 rounded-full">{estimatedCount.toLocaleString()} destinatários estimados</span>
                    )}
                  </div>
                  <button type="submit" disabled={estimateMutation.isPending || estimatedCount === 0} className="bg-primary hover:bg-primary/90 text-white font-medium py-3 px-8 rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50">
                    {formValues.isScheduled ? <Clock className="w-5 h-5" /> : <Send className="w-5 h-5" />}
                    {formValues.isScheduled ? 'Agendar Campanha' : 'Disparar Push'}
                  </button>
                </div>
              </div>
            </form>
          </div>

          {/* Previews Sidebar */}
          <div className="lg:col-span-1 space-y-6">
            <div className="sticky top-6">
              <div className="bg-surface border border-border rounded-xl shadow-sm overflow-hidden">
                <div className="flex border-b border-border">
                  <button onClick={() => setPreviewTab('ios')} className={`flex-1 py-3 text-xs font-bold transition-colors ${previewTab === 'ios' ? 'bg-primary/10 text-primary border-b-2 border-primary' : 'bg-background text-text-muted hover:text-text hover:bg-surface'}`}>iOS (iPhone)</button>
                  <button onClick={() => setPreviewTab('android')} className={`flex-1 py-3 text-xs font-bold transition-colors ${previewTab === 'android' ? 'bg-primary/10 text-primary border-b-2 border-primary' : 'bg-background text-text-muted hover:text-text hover:bg-surface'}`}>Android</button>
                </div>
                
                <div className="p-6 bg-background/50 flex justify-center items-center min-h-[400px]">
                  {/* Phone Mockup */}
                  <div className={`relative w-[280px] h-[550px] bg-black rounded-[40px] shadow-2xl border-[8px] ${previewTab === 'ios' ? 'border-[#2d2d2d]' : 'border-gray-800'} overflow-hidden flex flex-col`}>
                    {/* Top Bar Phone */}
                    <div className="h-6 w-full flex justify-center relative mt-2 z-20">
                      {previewTab === 'ios' && <div className="w-32 h-6 bg-black rounded-full absolute top-0"></div>}
                    </div>
                    {/* Wallpaper mock */}
                    <div className="absolute inset-0 bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 opacity-30 z-0"></div>
                    
                    {/* Notification UI */}
                    <div className="mt-8 px-3 z-10 w-full animate-slide-up">
                      {previewTab === 'ios' ? (
                        <div className="bg-white/90 backdrop-blur-md rounded-2xl p-3 shadow-lg">
                          <div className="flex gap-3">
                            <div className="w-10 h-10 bg-black rounded-lg flex items-center justify-center shrink-0">
                              <span className="text-white font-bold text-lg">M</span>
                            </div>
                            <div className="flex-1 min-w-0 pt-0.5">
                              <div className="flex justify-between items-center mb-1">
                                <p className="text-black text-[13px] font-semibold">MoveCity</p>
                                <p className="text-gray-500 text-[11px]">agora</p>
                              </div>
                              <p className="text-black font-bold text-[14px] leading-snug">{formValues.title || 'Título da Notificação'}</p>
                              <p className="text-black/80 text-[13px] leading-snug mt-1">{formValues.message || 'Mensagem aparecerá aqui.'}</p>
                              {formValues.imageUrl && (
                                <div className="mt-2 w-full h-32 rounded-lg overflow-hidden bg-gray-200">
                                  <img src={formValues.imageUrl} alt="preview" className="w-full h-full object-cover" onError={(e) => {e.target.src='https://via.placeholder.com/300x150?text=Imagem+Inv%C3%A1lida'}} />
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="bg-[#1f1f1f] rounded-2xl p-3 shadow-lg border border-white/10">
                          <div className="flex justify-between items-center mb-2">
                            <div className="flex items-center gap-2">
                              <div className="w-5 h-5 bg-primary rounded-full flex items-center justify-center"><Bell className="w-3 h-3 text-white" /></div>
                              <p className="text-white/60 text-xs font-medium">MoveCity • agora</p>
                            </div>
                            <div className="flex items-center gap-1">
                              <div className="w-1.5 h-1.5 bg-white/40 rounded-full"></div>
                            </div>
                          </div>
                          {formValues.imageUrl && (
                             <div className="mb-2 w-full h-32 rounded-lg overflow-hidden bg-black/50">
                               <img src={formValues.imageUrl} alt="preview" className="w-full h-full object-cover" onError={(e) => {e.target.src='https://via.placeholder.com/300x150?text=Imagem+Inv%C3%A1lida'}} />
                             </div>
                          )}
                          <p className="text-white font-medium text-[14px]">{formValues.title || 'Título da Notificação'}</p>
                          <p className="text-white/70 text-[13px] mt-1 leading-snug line-clamp-3">{formValues.message || 'Mensagem aparecerá aqui.'}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'inbox' && (
        <InboxQuickSend onSent={() => { queryClient.invalidateQueries({ queryKey: ['inbox-stats'] }); setActiveTab('history'); }} />
      )}

      {activeTab === 'history' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-surface p-4 rounded-xl border border-border flex items-center gap-4">
              <div className="p-3 bg-primary/20 text-primary rounded-lg"><Send className="w-5 h-5" /></div>
              <div><p className="text-xs text-text-muted">Total Campanhas</p><p className="text-lg font-bold">{historyData?.total || 0}</p></div>
            </div>
            <div className="bg-surface p-4 rounded-xl border border-border flex items-center gap-4">
              <div className="p-3 bg-success/20 text-success rounded-lg"><CheckCircle2 className="w-5 h-5" /></div>
              <div><p className="text-xs text-text-muted">Entregues (Est)</p><p className="text-lg font-bold">{historyData?.campaigns?.reduce((acc, c) => acc + (c.metrics?.delivered || 0), 0) || 0}</p></div>
            </div>
            <div className="bg-surface p-4 rounded-xl border border-border flex items-center gap-4">
              <div className="p-3 bg-danger/20 text-danger rounded-lg"><XCircle className="w-5 h-5" /></div>
              <div><p className="text-xs text-text-muted">Falhas</p><p className="text-lg font-bold">{historyData?.campaigns?.reduce((acc, c) => acc + (c.metrics?.failed || 0), 0) || 0}</p></div>
            </div>
            <div className="bg-surface p-4 rounded-xl border border-border flex items-center gap-4">
              <div className="p-3 bg-warning/20 text-warning rounded-lg"><Clock className="w-5 h-5" /></div>
              <div><p className="text-xs text-text-muted">Agendadas</p><p className="text-lg font-bold">{historyData?.campaigns?.filter(c => c.status === 'scheduled').length || 0}</p></div>
            </div>
          </div>

          {(inboxStatsData?.items?.length > 0) && (
            <div className="bg-surface border border-border rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-border font-semibold text-sm">Inbox in-app — entregues / lidas</div>
              <div className="overflow-x-auto">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-background/50 border-b border-border text-text-muted">
                  <tr>
                    <th className="p-4 font-medium">Título</th>
                    <th className="p-4 font-medium">Categoria</th>
                    <th className="p-4 font-medium">Entregues</th>
                    <th className="p-4 font-medium">Lidas</th>
                    <th className="p-4 font-medium">Data</th>
                  </tr>
                </thead>
                <tbody>
                  {inboxStatsData.items.map((row, idx) => (
                    <tr key={idx} className="border-b border-border/60">
                      <td className="p-4">
                        <div className="font-medium">{row.title}</div>
                        <div className="text-xs text-text-muted truncate max-w-xs">{row.message}</div>
                      </td>
                      <td className="p-4">{row.category}</td>
                      <td className="p-4">{row.delivered}</td>
                      <td className="p-4">{row.read}</td>
                      <td className="p-4">{row.day}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          )}

          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-background/50 border-b border-border text-text-muted">
                <tr>
                  <th className="p-4 font-medium">Campanha</th>
                  <th className="p-4 font-medium">Status / Data</th>
                  <th className="p-4 font-medium">Audiência</th>
                  <th className="p-4 font-medium">Métricas (Delivery)</th>
                  <th className="p-4 font-medium w-16">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {historyLoading ? (
                  <tr><td colSpan="5" className="p-8 text-center text-text-muted">Carregando histórico...</td></tr>
                ) : historyData?.campaigns?.length === 0 ? (
                  <tr><td colSpan="5" className="p-8 text-center text-text-muted">Nenhuma campanha registrada.</td></tr>
                ) : (
                  historyData?.campaigns?.map(camp => {
                    const totalProcessed = (camp.metrics?.delivered || 0) + (camp.metrics?.failed || 0);
                    const isProcessing = camp.status === 'processing';
                    return (
                      <tr key={camp._id} className="hover:bg-background/30 transition-colors">
                        <td className="p-4">
                          <p className="font-bold text-text mb-1 truncate max-w-[200px]" title={camp.title}>{camp.title}</p>
                          <div className="flex gap-2">
                            <span className="text-[10px] uppercase font-bold bg-primary/10 text-primary px-1.5 py-0.5 rounded">{camp.type}</span>
                            {camp.deepLink !== 'home' && <span className="text-[10px] uppercase font-bold bg-info/10 text-info px-1.5 py-0.5 rounded">↗ {camp.deepLink}</span>}
                          </div>
                        </td>
                        <td className="p-4">
                          <div className={`px-2 py-1 rounded-md text-xs font-medium w-max mb-1 border ${
                            camp.status === 'completed' ? 'bg-success/10 text-success border-success/20' :
                            camp.status === 'scheduled' ? 'bg-warning/10 text-warning border-warning/20' :
                            camp.status === 'processing' ? 'bg-info/10 text-info border-info/20 animate-pulse' :
                            'bg-danger/10 text-danger border-danger/20'
                          }`}>
                            {camp.status.toUpperCase()}
                          </div>
                          <p className="text-xs text-text-muted">
                            {camp.status === 'scheduled' && camp.scheduledAt ? new Date(camp.scheduledAt).toLocaleString() : new Date(camp.createdAt).toLocaleString()}
                          </p>
                        </td>
                        <td className="p-4">
                          <p className="text-sm font-medium">{camp.targetRules?.audienceType === 'all' ? 'Todos' : camp.targetRules?.audienceType === 'passengers' ? 'Passageiros' : 'Motoristas'}</p>
                          <p className="text-xs text-text-muted max-w-[150px] truncate" title={JSON.stringify(camp.targetRules)}>
                            {Object.keys(camp.targetRules).filter(k => k !== 'audienceType' && camp.targetRules[k]).length > 0 ? '+ Filtros Aplicados' : 'Base Completa'}
                          </p>
                        </td>
                        <td className="p-4">
                          {['draft', 'scheduled', 'cancelled'].includes(camp.status) ? (
                            <span className="text-xs text-text-muted italic">Aguardando Envio</span>
                          ) : (
                            <div className="w-full max-w-[200px]">
                              <div className="flex justify-between text-xs mb-1">
                                <span className="text-success font-medium">{camp.metrics?.delivered || 0} OK</span>
                                {camp.metrics?.failed > 0 && <span className="text-danger font-medium">{camp.metrics?.failed} Err</span>}
                              </div>
                              <div className="w-full bg-background rounded-full h-1.5 overflow-hidden flex">
                                <div className="bg-success h-full" style={{ width: `${totalProcessed > 0 ? ((camp.metrics?.delivered / totalProcessed) * 100) : 0}%` }}></div>
                                <div className="bg-danger h-full" style={{ width: `${totalProcessed > 0 ? ((camp.metrics?.failed / totalProcessed) * 100) : 0}%` }}></div>
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="p-4 relative group">
                          <button onClick={() => handleDuplicate(camp)} className="p-2 text-text-muted hover:text-primary transition-colors" title="Duplicar">
                            <Copy className="w-4 h-4" />
                          </button>
                          {camp.status === 'scheduled' && (
                            <button onClick={async () => { if (await confirm('Cancelar agendamento?')) cancelMutation.mutate(camp._id) }} className="p-2 text-text-muted hover:text-danger transition-colors" title="Cancelar Agendamento">
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      {confirmModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-surface rounded-xl border border-border w-full max-w-md shadow-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-primary">
                <Send className="w-5 h-5" />
              </div>
              <h2 className="text-xl font-bold">Confirmação de Disparo</h2>
            </div>
            
            <div className="bg-background border border-border rounded-lg p-4 space-y-3 mb-6">
              <div className="flex justify-between text-sm">
                <span className="text-text-muted">Ação:</span>
                <span className="font-bold text-primary">{confirmModal.data.isScheduled ? 'Agendar' : 'Enviar Agora'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-text-muted">Destinatários Estimados:</span>
                <span className="font-bold">{estimatedCount?.toLocaleString() || 0}</span>
              </div>
              {confirmModal.data.isScheduled && (
                <div className="flex justify-between text-sm">
                  <span className="text-text-muted">Data/Hora:</span>
                  <span className="font-bold">{new Date(confirmModal.data.scheduledAt).toLocaleString()}</span>
                </div>
              )}
            </div>
            
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setConfirmModal({ isOpen: false, data: null })}
                className="px-4 py-2 text-text-muted hover:text-text font-medium transition-colors"
                disabled={createMutation.isPending}
              >
                Cancelar
              </button>
              <button 
                onClick={() => createMutation.mutate(confirmModal.data)}
                disabled={createMutation.isPending}
                className="px-6 py-2 rounded-lg font-medium text-white bg-primary hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {createMutation.isPending ? 'Processando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
