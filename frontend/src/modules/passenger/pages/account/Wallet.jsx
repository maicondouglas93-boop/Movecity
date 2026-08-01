import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

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
                    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
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
        <div className="h-screen bg-gray-50 flex flex-col font-sans">
            <div className="flex items-center gap-4 p-5 bg-white border-b border-gray-100 sticky top-0 z-10">
                <i onClick={() => navigate('/account')} className="ri-arrow-left-line text-2xl cursor-pointer active:scale-95 transition-transform"></i>
                <h2 className="text-xl font-semibold">Carteira</h2>
            </div>

            <div className="p-5 bg-black text-white m-4 rounded-2xl shadow-lg relative overflow-hidden">
                <div className="absolute -right-4 -top-4 w-24 h-24 bg-white opacity-5 rounded-full blur-2xl"></div>
                <p className="text-gray-300 text-sm mb-1">Saldo disponível</p>
                <h1 className="text-4xl font-bold mb-6">R$ {balance.toFixed(2).replace('.', ',')}</h1>
                
                <div className="flex gap-4">
                    <button className="flex-1 bg-white text-black py-2.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2">
                        <i className="ri-add-circle-fill"></i> Adicionar
                    </button>
                    <button className="flex-1 bg-white/20 text-white py-2.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2">
                        <i className="ri-bank-card-line"></i> Cartões
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-3 gap-3 px-4 mb-4">
                <div className="bg-white p-3 rounded-xl flex flex-col items-center justify-center gap-2 border border-gray-100 shadow-sm cursor-pointer active:bg-gray-50">
                    <i className="ri-instance-line text-2xl text-teal-500"></i>
                    <span className="text-xs font-medium">Pix</span>
                </div>
                <div className="bg-white p-3 rounded-xl flex flex-col items-center justify-center gap-2 border border-gray-100 shadow-sm cursor-pointer active:bg-gray-50">
                    <i className="ri-arrow-left-right-line text-2xl text-blue-500"></i>
                    <span className="text-xs font-medium">Transferir</span>
                </div>
                <div className="bg-white p-3 rounded-xl flex flex-col items-center justify-center gap-2 border border-gray-100 shadow-sm cursor-pointer active:bg-gray-50">
                    <i className="ri-file-list-3-line text-2xl text-purple-500"></i>
                    <span className="text-xs font-medium">Comprovantes</span>
                </div>
            </div>

            <div className="flex-1 bg-white rounded-t-3xl p-5 shadow-[0_-4px_10px_rgba(0,0,0,0.02)] border-t border-gray-100">
                <h3 className="text-lg font-semibold mb-4">Extrato de transações</h3>
                
                {loading ? (
                    <div className="flex justify-center my-8">
                        <i className="ri-loader-4-line text-2xl animate-spin text-gray-400"></i>
                    </div>
                ) : loadError ? (
                    <div className="text-center py-10 flex flex-col items-center">
                        <i className="ri-error-warning-line text-5xl text-red-300 mb-3"></i>
                        <h4 className="text-gray-600 font-medium">Não foi possível carregar sua carteira</h4>
                        <p className="text-sm text-gray-400 mt-1">Tente novamente mais tarde.</p>
                    </div>
                ) : transactions.length > 0 ? (
                    <ul className="flex flex-col gap-4">
                        {transactions.map((t, idx) => (
                            <li key={idx} className="flex justify-between items-center pb-3 border-b border-gray-50 last:border-0">
                                <div>
                                    <p className="font-medium text-gray-800">{t.description}</p>
                                    <p className="text-xs text-gray-500">{t.date}</p>
                                </div>
                                <span className={`font-semibold ${t.type === 'in' ? 'text-green-600' : 'text-black'}`}>
                                    {t.type === 'in' ? '+' : '-'} R$ {t.amount.toFixed(2)}
                                </span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <div className="text-center py-10 flex flex-col items-center">
                        <i className="ri-file-paper-2-line text-5xl text-gray-200 mb-3"></i>
                        <h4 className="text-gray-600 font-medium">Nenhuma transação recente</h4>
                        <p className="text-sm text-gray-400 mt-1">Seu histórico aparecerá aqui.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Wallet;
