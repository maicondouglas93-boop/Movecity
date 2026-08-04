import React, { useState, useEffect } from 'react';
import { getAccessToken } from '@/shared/services/session';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import PageHeader from '@/shared/components/ui/PageHeader';
import EmptyState from '@/shared/components/ui/EmptyState';

const Wallet = () => {
    const navigate = useNavigate();
    const [balance, setBalance] = useState(0);
    const [transactions, setTransactions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);

    useEffect(() => {
        const fetchWallet = async () => {
            try {
                const response = await axios.get(`${import.meta.env.VITE_BASE_URL}/users/wallet`, {
                    headers: { Authorization: `Bearer ${getAccessToken('user')}` }
                });
                setBalance(response.data.balance || 0);
                setTransactions(response.data.transactions || []);
            } catch (error) {
                // A rota /users/wallet ainda não existe (o saldo real do passageiro já
                // existe em user.walletBalance e é usado no fluxo de corrida, mas esta
                // tela nunca foi ligada a ele).
                setLoadError(true);
            } finally {
                setLoading(false);
            }
        };
        fetchWallet();
    }, []);

    return (
        <div className="h-screen bg-surface-alt flex flex-col font-sans">
            <PageHeader title="Carteira" onBack={() => navigate('/account')} />

            <div className="p-5 bg-ink-900 text-white m-4 rounded-panel shadow-floating relative overflow-hidden">
                <div className="absolute -right-4 -top-4 w-24 h-24 bg-white opacity-5 rounded-full blur-2xl"></div>
                <p className="text-white/70 text-sm mb-1">Saldo disponível</p>
                <h1 className="text-4xl font-bold mb-6">R$ {balance.toFixed(2).replace('.', ',')}</h1>

                <div className="flex gap-4">
                    <button type="button" className="flex-1 bg-white text-ink-900 py-2.5 rounded-panel font-semibold text-sm flex items-center justify-center gap-2">
                        <i className="ri-add-circle-fill" aria-hidden="true"></i> Adicionar
                    </button>
                    <button type="button" className="flex-1 bg-white/20 text-white py-2.5 rounded-panel font-semibold text-sm flex items-center justify-center gap-2">
                        <i className="ri-bank-card-line" aria-hidden="true"></i> Cartões
                    </button>
                </div>
            </div>

            {/* Sem onClick de propósito: nenhuma dessas ações tem fluxo real ainda. */}
            <div className="grid grid-cols-3 gap-3 px-4 mb-4">
                <div className="bg-surface p-3 rounded-panel flex flex-col items-center justify-center gap-2 border border-line shadow-raised">
                    <i className="ri-instance-line text-2xl text-teal-500" aria-hidden="true"></i>
                    <span className="text-xs font-medium text-ink-900">Pix</span>
                </div>
                <div className="bg-surface p-3 rounded-panel flex flex-col items-center justify-center gap-2 border border-line shadow-raised">
                    <i className="ri-arrow-left-right-line text-2xl text-blue-500" aria-hidden="true"></i>
                    <span className="text-xs font-medium text-ink-900">Transferir</span>
                </div>
                <div className="bg-surface p-3 rounded-panel flex flex-col items-center justify-center gap-2 border border-line shadow-raised">
                    <i className="ri-file-list-3-line text-2xl text-purple-500" aria-hidden="true"></i>
                    <span className="text-xs font-medium text-ink-900">Comprovantes</span>
                </div>
            </div>

            <div className="flex-1 bg-surface rounded-t-3xl p-5 shadow-floating border-t border-line">
                <h3 className="text-lg font-semibold mb-4 text-ink-900">Extrato de transações</h3>

                {loading ? (
                    <div className="flex justify-center my-8">
                        <i className="ri-loader-4-line text-2xl animate-spin text-ink-400" aria-hidden="true"></i>
                    </div>
                ) : loadError ? (
                    <EmptyState
                        variant="error"
                        icon="ri-error-warning-line"
                        title="Não foi possível carregar sua carteira"
                        description="Tente novamente mais tarde."
                    />
                ) : transactions.length > 0 ? (
                    <ul className="flex flex-col gap-4">
                        {transactions.map((t, idx) => (
                            <li key={idx} className="flex justify-between items-center pb-3 border-b border-line last:border-0">
                                <div>
                                    <p className="font-medium text-ink-900">{t.description}</p>
                                    <p className="text-xs text-ink-400">{t.date}</p>
                                </div>
                                <span className={`font-semibold ${t.type === 'in' ? 'text-brand-700' : 'text-ink-900'}`}>
                                    {t.type === 'in' ? '+' : '-'} R$ {t.amount.toFixed(2)}
                                </span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <EmptyState
                        icon="ri-file-paper-2-line"
                        title="Nenhuma transação recente"
                        description="Seu histórico aparecerá aqui."
                    />
                )}
            </div>
        </div>
    );
};

export default Wallet;
