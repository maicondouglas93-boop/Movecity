import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { 
  Users as UsersIcon, Ban, UserCheck, TrendingUp, Search, 
  Filter, MoreVertical, ShieldAlert, Download, CheckSquare, Square
} from 'lucide-react';
import UserDrawer from '../components/UserDrawer';
import { useToast } from '../contexts/ToastContext';

export default function Users() {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filters, setFilters] = useState({ status: '', hasRides: '', dateRange: '', sortBy: 'createdAt', sortOrder: 'desc' });
  const [selectedUsers, setSelectedUsers] = useState([]);
  const [drawerUserId, setDrawerUserId] = useState(null);
  const [blockModal, setBlockModal] = useState({ isOpen: false, type: '', userId: null, reason: '', isBulk: false });
  
  const queryClient = useQueryClient();
  const toast = useToast();

  // Debounce search
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 500);
    return () => clearTimeout(handler);
  }, [search]);

  const { data, isLoading } = useQuery({
    queryKey: ['users', page, limit, debouncedSearch, filters],
    queryFn: async () => {
      const params = new URLSearchParams({
        page, limit, search: debouncedSearch, ...filters
      });
      const res = await api.get(`/admin/users?${params.toString()}`);
      return res.data;
    }
  });

  const blockMutation = useMutation({
    mutationFn: async ({ userId, isBlocked, reason }) => {
      await api.put(`/admin/users/${userId}/block`, { isBlocked, reason });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['users']);
      setBlockModal({ isOpen: false, type: '', userId: null, reason: '', isBulk: false });
      toast.success('Passageiro atualizado com sucesso!');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Erro ao atualizar passageiro')
  });

  const bulkBlockMutation = useMutation({
    mutationFn: async ({ userIds, actionType, reason }) => {
      await api.post(`/admin/users/bulk-action`, { userIds, actionType, reason });
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['users']);
      setSelectedUsers([]);
      setBlockModal({ isOpen: false, type: '', userId: null, reason: '', isBulk: false });
      toast.success('Passageiros atualizados com sucesso!');
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Erro ao atualizar passageiros em lote')
  });

  const handleSelectAll = (e) => {
    if (e.target.checked && data?.users) {
      setSelectedUsers(data.users.map(u => u._id));
    } else {
      setSelectedUsers([]);
    }
  };

  const handleSelectUser = (id) => {
    setSelectedUsers(prev => 
      prev.includes(id) ? prev.filter(uid => uid !== id) : [...prev, id]
    );
  };

  const handleSort = (field) => {
    setFilters(prev => ({
      ...prev,
      sortBy: field,
      sortOrder: prev.sortBy === field && prev.sortOrder === 'desc' ? 'asc' : 'desc'
    }));
  };

  const handleExport = () => {
    toast.error('Exportação de CSV ainda não implementada nesta lista.');
    // Real implementation would trigger download from backend or generate CSV blob
  };

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">CRM de Passageiros</h1>
        <p className="text-text-muted mt-1">Gerencie, analise e monitore a base de clientes (Riders).</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-surface p-4 rounded-xl border border-border shadow-sm flex items-center gap-4">
          <div className="p-3 bg-primary/20 text-primary rounded-lg"><UsersIcon className="w-5 h-5" /></div>
          <div><p className="text-sm text-text-muted">Totais</p><p className="text-xl font-bold">{data?.summary?.total || 0}</p></div>
        </div>
        <div className="bg-surface p-4 rounded-xl border border-border shadow-sm flex items-center gap-4">
          <div className="p-3 bg-success/20 text-success rounded-lg"><UserCheck className="w-5 h-5" /></div>
          <div><p className="text-sm text-text-muted">Ativos</p><p className="text-xl font-bold">{data?.summary?.active || 0}</p></div>
        </div>
        <div className="bg-surface p-4 rounded-xl border border-border shadow-sm flex items-center gap-4">
          <div className="p-3 bg-danger/20 text-danger rounded-lg"><Ban className="w-5 h-5" /></div>
          <div><p className="text-sm text-text-muted">Bloqueados</p><p className="text-xl font-bold">{data?.summary?.blocked || 0}</p></div>
        </div>
        <div className="bg-surface p-4 rounded-xl border border-border shadow-sm flex items-center gap-4">
          <div className="p-3 bg-info/20 text-info rounded-lg"><TrendingUp className="w-5 h-5" /></div>
          <div><p className="text-sm text-text-muted">Novos Hoje</p><p className="text-xl font-bold">{data?.summary?.newToday || 0}</p></div>
        </div>
        <div className="bg-surface p-4 rounded-xl border border-border shadow-sm flex items-center gap-4">
          <div className="p-3 bg-warning/20 text-warning rounded-lg"><UsersIcon className="w-5 h-5" /></div>
          <div><p className="text-sm text-text-muted">Novos na Semana</p><p className="text-xl font-bold">{data?.summary?.newWeek || 0}</p></div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="bg-surface p-4 rounded-xl border border-border flex flex-col md:flex-row gap-4 justify-between items-center">
        <div className="flex w-full md:w-auto gap-4 flex-1">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-text-muted" />
            <input 
              type="text" 
              placeholder="Buscar por nome, email, telefone ou CPF..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-background border border-border rounded-lg pl-9 pr-4 py-2 text-sm text-text focus:border-primary outline-none"
            />
          </div>
          <div className="flex gap-2">
            <select className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-text outline-none"
              value={filters.status} onChange={(e) => setFilters({...filters, status: e.target.value})}
            >
              <option value="">Todos Status</option>
              <option value="active">🟢 Ativos</option>
              <option value="blocked">🔴 Bloqueados</option>
            </select>
            <select className="bg-background border border-border rounded-lg px-3 py-2 text-sm text-text outline-none"
              value={filters.hasRides} onChange={(e) => setFilters({...filters, hasRides: e.target.value})}
            >
              <option value="">Corridas (Todos)</option>
              <option value="yes">Com Corridas</option>
              <option value="no">Sem Corridas</option>
            </select>
          </div>
        </div>
        
        <div className="flex gap-3 w-full md:w-auto">
          {selectedUsers.length > 0 ? (
            <div className="flex gap-2 items-center bg-primary/10 px-3 py-1.5 rounded-lg border border-primary/20">
              <span className="text-xs font-medium text-primary mr-2">{selectedUsers.length} selecionados</span>
              <button 
                onClick={() => setBlockModal({ isOpen: true, type: 'block', isBulk: true, reason: '' })}
                className="text-xs bg-danger hover:bg-danger/90 text-white px-3 py-1.5 rounded transition-colors font-medium"
              >
                Bloquear
              </button>
              <button 
                onClick={() => setBlockModal({ isOpen: true, type: 'unblock', isBulk: true, reason: '' })}
                className="text-xs bg-success hover:bg-success/90 text-white px-3 py-1.5 rounded transition-colors font-medium"
              >
                Desbloquear
              </button>
            </div>
          ) : (
            <button onClick={handleExport} className="flex items-center gap-2 bg-background border border-border hover:bg-surface text-text px-4 py-2 rounded-lg text-sm font-medium transition-colors">
              <Download className="w-4 h-4" /> Exportar CSV
            </button>
          )}
        </div>
      </div>

      {/* Main Table */}
      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-background/50 border-b border-border text-text-muted">
              <tr>
                <th className="p-4 w-12">
                  <input 
                    type="checkbox" 
                    onChange={handleSelectAll}
                    checked={data?.users?.length > 0 && selectedUsers.length === data.users.length}
                    className="rounded border-border text-primary focus:ring-primary bg-background"
                  />
                </th>
                <th className="p-4 font-medium cursor-pointer hover:text-text" onClick={() => handleSort('name')}>
                  Passageiro {filters.sortBy === 'name' && (filters.sortOrder === 'asc' ? '↑' : '↓')}
                </th>
                <th className="p-4 font-medium cursor-pointer hover:text-text" onClick={() => handleSort('createdAt')}>
                  Cadastro {filters.sortBy === 'createdAt' && (filters.sortOrder === 'asc' ? '↑' : '↓')}
                </th>
                <th className="p-4 font-medium cursor-pointer hover:text-text" onClick={() => handleSort('totalRides')}>
                  Corridas {filters.sortBy === 'totalRides' && (filters.sortOrder === 'asc' ? '↑' : '↓')}
                </th>
                <th className="p-4 font-medium cursor-pointer hover:text-text" onClick={() => handleSort('totalSpent')}>
                  Gasto Total {filters.sortBy === 'totalSpent' && (filters.sortOrder === 'asc' ? '↑' : '↓')}
                </th>
                <th className="p-4 font-medium">Status</th>
                <th className="p-4 font-medium w-16">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="p-4"><div className="w-4 h-4 bg-background rounded"></div></td>
                    <td className="p-4 flex items-center gap-3"><div className="w-10 h-10 bg-background rounded-full"></div><div className="w-32 h-4 bg-background rounded"></div></td>
                    <td className="p-4"><div className="w-24 h-4 bg-background rounded"></div></td>
                    <td className="p-4"><div className="w-16 h-4 bg-background rounded"></div></td>
                    <td className="p-4"><div className="w-20 h-4 bg-background rounded"></div></td>
                    <td className="p-4"><div className="w-16 h-6 bg-background rounded-full"></div></td>
                    <td className="p-4"><div className="w-8 h-8 bg-background rounded"></div></td>
                  </tr>
                ))
              ) : data?.users?.length === 0 ? (
                <tr><td colSpan="7" className="p-8 text-center text-text-muted">Nenhum passageiro encontrado.</td></tr>
              ) : (
                data?.users?.map(user => (
                  <tr key={user._id} className={`hover:bg-background/30 transition-colors ${selectedUsers.includes(user._id) ? 'bg-primary/5' : ''}`}>
                    <td className="p-4">
                      <input 
                        type="checkbox" 
                        checked={selectedUsers.includes(user._id)}
                        onChange={() => handleSelectUser(user._id)}
                        className="rounded border-border text-primary focus:ring-primary bg-background"
                      />
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold overflow-hidden">
                          {user.profilePicture ? <img src={user.profilePicture} alt="Avatar" className="w-full h-full object-cover" /> : user.fullname?.firstname?.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-text">{user.fullname?.firstname} {user.fullname?.lastname || ''}</p>
                          <p className="text-xs text-text-muted flex items-center gap-2">
                            {user.email} 
                            {user.tags?.length > 0 && <span className="text-[10px] bg-warning/20 text-warning px-1.5 py-0.5 rounded uppercase font-bold">{user.tags[0]}</span>}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="p-4 text-text-muted">
                      <p>{new Date(user.createdAt).toLocaleDateString()}</p>
                      <p className="text-xs">{user.city || 'Não informada'}</p>
                    </td>
                    <td className="p-4">
                      <p className="font-medium text-text">{user.totalRides || 0}</p>
                      {user.lastRideAt && <p className="text-xs text-text-muted">Últ: {new Date(user.lastRideAt).toLocaleDateString()}</p>}
                    </td>
                    <td className="p-4 font-medium text-success">R$ {(user.totalSpent || 0).toFixed(2)}</td>
                    <td className="p-4">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium border flex items-center w-max gap-1.5 ${
                        user.isBlocked ? 'bg-danger/10 border-danger/20 text-danger' : 'bg-success/10 border-success/20 text-success'
                      }`}>
                        <div className={`w-1.5 h-1.5 rounded-full ${user.isBlocked ? 'bg-danger' : 'bg-success'}`}></div>
                        {user.isBlocked ? 'Bloqueado' : 'Ativo'}
                      </span>
                    </td>
                    <td className="p-4 relative group">
                      <button className="p-1.5 text-text-muted hover:text-text hover:bg-background rounded-md transition-colors">
                        <MoreVertical className="w-5 h-5" />
                      </button>
                      <div className="absolute right-8 top-4 w-48 bg-surface border border-border rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 flex flex-col overflow-hidden">
                        <button onClick={() => setDrawerUserId(user._id)} className="px-4 py-2.5 text-left text-sm hover:bg-background transition-colors">Abrir Perfil (CRM)</button>
                        <button onClick={() => setDrawerUserId(user._id)} className="px-4 py-2.5 text-left text-sm hover:bg-background transition-colors">Histórico Financeiro</button>
                        {user.isBlocked ? (
                          <button onClick={() => setBlockModal({ isOpen: true, type: 'unblock', userId: user._id, reason: '' })} className="px-4 py-2.5 text-left text-sm text-success hover:bg-success/10 transition-colors">Desbloquear Passageiro</button>
                        ) : (
                          <button onClick={() => setBlockModal({ isOpen: true, type: 'block', userId: user._id, reason: '' })} className="px-4 py-2.5 text-left text-sm text-danger hover:bg-danger/10 transition-colors">Bloquear Passageiro</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        
        {/* Pagination */}
        <div className="bg-background/50 border-t border-border p-4 flex justify-between items-center text-sm">
          <div className="flex items-center gap-3 text-text-muted">
            <span>Itens por página:</span>
            <select value={limit} onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }} className="bg-background border border-border rounded p-1 outline-none">
              <option value="10">10</option>
              <option value="25">25</option>
              <option value="50">50</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button 
              disabled={page === 1} 
              onClick={() => setPage(p => p - 1)}
              className="px-3 py-1.5 border border-border rounded hover:bg-surface disabled:opacity-50 transition-colors"
            >
              Anterior
            </button>
            <span className="text-text-muted font-medium px-2">Página {page} de {data?.pages || 1}</span>
            <button 
              disabled={page === (data?.pages || 1) || !data?.pages} 
              onClick={() => setPage(p => p + 1)}
              className="px-3 py-1.5 border border-border rounded hover:bg-surface disabled:opacity-50 transition-colors"
            >
              Próxima
            </button>
          </div>
        </div>
      </div>

      {/* Drawer */}
      <UserDrawer 
        userId={drawerUserId} 
        isOpen={!!drawerUserId} 
        onClose={() => setDrawerUserId(null)} 
      />

      {/* Block / Unblock Modal */}
      {blockModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-surface rounded-xl border border-border w-full max-w-md shadow-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <ShieldAlert className={`w-6 h-6 ${blockModal.type === 'block' ? 'text-danger' : 'text-success'}`} />
              <h2 className="text-xl font-bold">
                {blockModal.type === 'block' ? 'Bloquear Passageiro' : 'Desbloquear Passageiro'}
                {blockModal.isBulk && ' (Em Lote)'}
              </h2>
            </div>
            
            <p className="text-sm text-text-muted mb-4">
              Por motivos de auditoria, é obrigatório informar o motivo para {blockModal.type === 'block' ? 'bloquear' : 'desbloquear'} {blockModal.isBulk ? 'estes usuários' : 'este usuário'}.
            </p>
            
            <textarea
              value={blockModal.reason}
              onChange={(e) => setBlockModal({...blockModal, reason: e.target.value})}
              placeholder="Ex: Fraude de cartão, chargeback, solicitação de suporte..."
              className="w-full bg-background border border-border rounded-lg p-3 text-sm text-text focus:border-primary outline-none mb-5 h-24 resize-none"
              required
            />
            
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setBlockModal({ isOpen: false, type: '', userId: null, reason: '', isBulk: false })}
                className="px-4 py-2 text-text-muted hover:text-text font-medium transition-colors"
              >
                Cancelar
              </button>
              <button 
                onClick={() => {
                  if (!blockModal.reason.trim()) return toast.error('O motivo é obrigatório');
                  if (blockModal.isBulk) {
                    bulkBlockMutation.mutate({ userIds: selectedUsers, actionType: blockModal.type, reason: blockModal.reason });
                  } else {
                    blockMutation.mutate({ userId: blockModal.userId, isBlocked: blockModal.type === 'block', reason: blockModal.reason });
                  }
                }}
                disabled={blockMutation.isPending || bulkBlockMutation.isPending || !blockModal.reason.trim()}
                className={`px-6 py-2 rounded-lg font-medium text-white transition-colors disabled:opacity-50 ${blockModal.type === 'block' ? 'bg-danger hover:bg-danger/90' : 'bg-success hover:bg-success/90'}`}
              >
                {blockMutation.isPending || bulkBlockMutation.isPending ? 'Processando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
