import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { 
  X, User, MapPin, Calendar, CreditCard, Clock, Map, 
  AlertTriangle, Shield, CheckCircle, Ticket, Plus, Tag
} from 'lucide-react';

export default function UserDrawer({ userId, isOpen, onClose }) {
  const [activeTab, setActiveTab] = useState('overview');
  const [newObs, setNewObs] = useState('');
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['userDetails', userId],
    queryFn: async () => {
      if (!userId) return null;
      const res = await api.get(`/admin/users/${userId}/details`);
      return res.data;
    },
    enabled: !!userId && isOpen
  });

  const addObsMutation = useMutation({
    mutationFn: async (text) => {
      const res = await api.post(`/admin/users/${userId}/observations`, { text });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['userDetails', userId]);
      setNewObs('');
    }
  });

  const tagsMutation = useMutation({
    mutationFn: async (tags) => {
      const res = await api.put(`/admin/users/${userId}/tags`, { tags });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['userDetails', userId]);
      queryClient.invalidateQueries(['users']);
    }
  });

  const handleToggleTag = (tag) => {
    if (!data?.user) return;
    const currentTags = data.user.tags || [];
    let newTags;
    if (currentTags.includes(tag)) {
      newTags = currentTags.filter(t => t !== tag);
    } else {
      newTags = [...currentTags, tag];
    }
    tagsMutation.mutate(newTags);
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/50 z-40 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />
      
      {/* Drawer */}
      <div className="fixed inset-y-0 right-0 w-full max-w-md bg-surface shadow-2xl z-50 flex flex-col transform transition-transform duration-300">
        {/* Header */}
        <div className="p-6 border-b border-border flex justify-between items-start bg-background/50">
          <div className="flex gap-4 items-center">
            <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center text-primary text-2xl font-bold overflow-hidden border-2 border-primary/30">
              {data?.user?.profilePicture ? (
                <img src={data.user.profilePicture} alt="Avatar" className="w-full h-full object-cover" />
              ) : (
                data?.user?.fullname?.firstname?.charAt(0).toUpperCase() || 'U'
              )}
            </div>
            <div>
              <h2 className="text-xl font-bold text-text">
                {isLoading ? 'Carregando...' : `${data?.user?.fullname?.firstname || ''} ${data?.user?.fullname?.lastname || ''}`}
              </h2>
              <p className="text-sm text-text-muted mt-1">{data?.user?.email}</p>
              <div className="flex gap-2 mt-2 flex-wrap">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${data?.user?.isBlocked ? 'bg-danger/20 text-danger' : 'bg-success/20 text-success'}`}>
                  {data?.user?.isBlocked ? 'Bloqueado' : 'Ativo'}
                </span>
                {data?.user?.tags?.map(tag => (
                  <span key={tag} className="text-xs px-2 py-0.5 rounded-full font-medium bg-warning/20 text-warning">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-background rounded-full transition-colors text-text-muted">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border bg-background/30 overflow-x-auto no-scrollbar">
          {['overview', 'rides', 'admin'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-3 text-sm font-medium transition-colors border-b-2 whitespace-nowrap px-4 ${
                activeTab === tab ? 'border-primary text-primary' : 'border-transparent text-text-muted hover:text-text'
              }`}
            >
              {tab === 'overview' && 'Visão Geral'}
              {tab === 'rides' && 'Corridas'}
              {tab === 'admin' && 'Administração'}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {isLoading ? (
            <div className="flex justify-center py-10"><span className="text-text-muted">Carregando dados do CRM...</span></div>
          ) : activeTab === 'overview' ? (
            <>
              {/* Contato */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-text uppercase tracking-wider">Contato e Local</h3>
                <div className="bg-background rounded-lg p-4 space-y-3 border border-border">
                  <div className="flex items-center gap-3 text-sm">
                    <User className="w-4 h-4 text-primary" />
                    <span className="text-text">{data?.user?.phone || 'Não informado'}</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <MapPin className="w-4 h-4 text-primary" />
                    <span className="text-text">{data?.user?.city || 'Cidade não registrada'}</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <Calendar className="w-4 h-4 text-primary" />
                    <span className="text-text">Membro desde {new Date(data?.user?.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>

              {/* Estatísticas Consolidadas */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-text uppercase tracking-wider">KPIs do Cliente</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-background rounded-lg p-4 border border-border">
                    <p className="text-xs text-text-muted mb-1">Total Gasto</p>
                    <p className="text-xl font-bold text-success">R$ {data?.stats?.spent?.toFixed(2)}</p>
                  </div>
                  <div className="bg-background rounded-lg p-4 border border-border">
                    <p className="text-xs text-text-muted mb-1">Ticket Médio</p>
                    <p className="text-xl font-bold text-primary">R$ {data?.stats?.averageTicket?.toFixed(2)}</p>
                  </div>
                  <div className="bg-background rounded-lg p-4 border border-border">
                    <p className="text-xs text-text-muted mb-1">Corridas Finalizadas</p>
                    <p className="text-xl font-bold text-text">{data?.stats?.rides}</p>
                  </div>
                  <div className="bg-background rounded-lg p-4 border border-border">
                    <p className="text-xs text-text-muted mb-1">Última Atividade</p>
                    <p className="text-sm font-bold text-text">
                      {data?.stats?.lastRideAt ? new Date(data.stats.lastRideAt).toLocaleDateString() : 'Nunca'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Avaliação & Qualidade */}
              <div className="bg-primary/10 rounded-lg p-4 border border-primary/20 flex items-center justify-between">
                <div>
                  <p className="text-xs text-primary font-medium uppercase mb-1">Nota do Passageiro</p>
                  <p className="text-2xl font-bold text-text">⭐ {data?.user?.rating?.toFixed(1) || '5.0'}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-text-muted mb-1">Distância Viajada</p>
                  <p className="text-sm font-semibold">{(data?.stats?.distance / 1000).toFixed(1)} km</p>
                </div>
              </div>
            </>
          ) : activeTab === 'rides' ? (
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-text uppercase tracking-wider">Últimas 5 Corridas</h3>
              {data?.recentRides?.length === 0 ? (
                <p className="text-sm text-text-muted bg-background p-4 rounded-lg border border-border">Nenhuma corrida encontrada.</p>
              ) : (
                <div className="space-y-3">
                  {data?.recentRides?.map(ride => (
                    <div key={ride._id} className="bg-background rounded-lg p-4 border border-border space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-text-muted">{new Date(ride.createdAt).toLocaleString()}</span>
                        <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full ${
                          ride.status === 'finished' ? 'bg-success/20 text-success' :
                          ride.status === 'cancelled' ? 'bg-danger/20 text-danger' : 'bg-warning/20 text-warning'
                        }`}>
                          {ride.status}
                        </span>
                      </div>
                      
                      <div className="space-y-2 relative before:absolute before:inset-y-3 before:left-[7px] before:w-0.5 before:bg-border">
                        <div className="flex items-center gap-3 relative">
                          <div className="w-4 h-4 rounded-full bg-primary/20 border-2 border-primary z-10"></div>
                          <p className="text-sm text-text truncate flex-1" title={ride.pickup}>{ride.pickup}</p>
                        </div>
                        <div className="flex items-center gap-3 relative">
                          <div className="w-4 h-4 rounded-full bg-surface border-2 border-primary z-10"></div>
                          <p className="text-sm text-text truncate flex-1" title={ride.destination}>{ride.destination}</p>
                        </div>
                      </div>
                      
                      <div className="pt-2 border-t border-border flex justify-between items-center">
                        <div className="flex items-center gap-2 text-xs text-text-muted">
                          <CreditCard className="w-3.5 h-3.5" />
                          <span className="uppercase">{ride.paymentMethod}</span>
                        </div>
                        <span className="font-bold text-sm text-success">R$ {ride.finalPrice?.toFixed(2) || ride.fare?.toFixed(2)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-6">
              {/* CRM Flags */}
              <div>
                <h3 className="text-sm font-semibold text-text uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Shield className="w-4 h-4" /> Bandeiras de Risco / Perfil
                </h3>
                <div className="flex flex-wrap gap-2">
                  {['VIP', 'Empresa', 'Fraude', 'Monitorar', 'Chargeback'].map(tag => {
                    const isActive = data?.user?.tags?.includes(tag);
                    return (
                      <button
                        key={tag}
                        onClick={() => handleToggleTag(tag)}
                        className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors border ${
                          isActive 
                            ? 'bg-primary/20 border-primary text-primary' 
                            : 'bg-background border-border text-text-muted hover:text-text'
                        }`}
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Observações Internas */}
              <div>
                <h3 className="text-sm font-semibold text-text uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Tag className="w-4 h-4" /> Notas Internas (Suporte)
                </h3>
                <div className="bg-background rounded-lg border border-border overflow-hidden mb-4">
                  <div className="p-2 border-b border-border flex gap-2">
                    <input 
                      type="text" 
                      value={newObs}
                      onChange={(e) => setNewObs(e.target.value)}
                      placeholder="Adicionar nota sobre o cliente..."
                      className="flex-1 bg-transparent text-sm text-text outline-none px-2"
                      onKeyDown={(e) => e.key === 'Enter' && newObs && addObsMutation.mutate(newObs)}
                    />
                    <button 
                      onClick={() => newObs && addObsMutation.mutate(newObs)}
                      disabled={!newObs || addObsMutation.isPending}
                      className="p-1.5 bg-primary/20 text-primary rounded-md hover:bg-primary/30 transition-colors disabled:opacity-50"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="max-h-40 overflow-y-auto p-3 space-y-3">
                    {data?.user?.observations?.length === 0 ? (
                      <p className="text-xs text-text-muted text-center py-2">Nenhuma observação interna.</p>
                    ) : (
                      data?.user?.observations?.slice().reverse().map((obs, i) => (
                        <div key={i} className="text-xs space-y-1">
                          <div className="flex justify-between text-text-muted">
                            <span className="font-medium text-text">{obs.adminName}</span>
                            <span>{new Date(obs.createdAt).toLocaleDateString()}</span>
                          </div>
                          <p className="text-text/90 leading-relaxed bg-surface p-2 rounded border border-border/50">{obs.text}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* Logs Administrativos */}
              <div>
                <h3 className="text-sm font-semibold text-text uppercase tracking-wider mb-3 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" /> Histórico de Bloqueios
                </h3>
                {data?.adminLogs?.length === 0 ? (
                  <p className="text-sm text-text-muted">Nenhuma ação administrativa registrada.</p>
                ) : (
                  <div className="space-y-3">
                    {data?.adminLogs?.filter(log => log.action.includes('block')).map(log => (
                      <div key={log._id} className="bg-background border border-border p-3 rounded-lg text-xs space-y-2">
                        <div className="flex justify-between items-center font-medium">
                          <span className={log.action === 'block_user' ? 'text-danger' : 'text-success'}>
                            {log.action === 'block_user' ? 'Bloqueado' : 'Desbloqueado'}
                          </span>
                          <span className="text-text-muted">{new Date(log.createdAt).toLocaleDateString()}</span>
                        </div>
                        <p className="text-text-muted"><span className="text-text">Motivo:</span> {log.reason}</p>
                        <p className="text-text-muted text-[10px]">Por: {log.adminName}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
