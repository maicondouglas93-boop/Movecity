import React, { useState, useEffect, useContext } from 'react'
import { Link } from 'react-router-dom'
import axios from 'axios'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CaptainDataContext } from '@/contexts/CaptainContext'
import { SocketContext } from '@/contexts/SocketContext'
import CaptainHeader from '@/modules/driver/components/CaptainHeader'
import { useToast } from '@/contexts/ToastContext'

const CaptainWallet = () => {
    const { captain } = useContext(CaptainDataContext)
    const { socket } = useContext(SocketContext)
    const { addToast } = useToast()

    const queryClient = useQueryClient();

    const [showRechargeModal, setShowRechargeModal] = useState(false);
    const [showQRCode, setShowQRCode] = useState(false);
    const [rechargeAmount, setRechargeAmount] = useState('');
    const [recharging, setRecharging] = useState(false);

    // Queries
    const { data: walletData, isLoading: walletLoading } = useQuery({
        queryKey: ['captainWallet'],
        queryFn: async () => {
            const token = localStorage.getItem('captain-token')
            const res = await axios.get(`${import.meta.env.VITE_BASE_URL}/captains/wallet`, { headers: { Authorization: `Bearer ${token}` } })
            return res.data.wallet
        }
    })

    const { data: transactionsData, isLoading: transLoading } = useQuery({
        queryKey: ['captainTransactions'],
        queryFn: async () => {
            const token = localStorage.getItem('captain-token')
            const res = await axios.get(`${import.meta.env.VITE_BASE_URL}/captains/transactions`, { headers: { Authorization: `Bearer ${token}` } })
            return res.data.transactions
        }
    })

    const loading = walletLoading || transLoading;
    const wallet = walletData;
    const transactions = transactionsData || [];

    // Socket invalidation
    useEffect(() => {
        const handleWalletUpdated = () => {
            queryClient.invalidateQueries({ queryKey: ['captainWallet'] })
            queryClient.invalidateQueries({ queryKey: ['captainTransactions'] })
        }

        if (socket) {
            socket.on('wallet-updated', handleWalletUpdated)
        }

        return () => {
            if (socket) socket.off('wallet-updated', handleWalletUpdated)
        }
    }, [socket, queryClient])

    // Mutations
    const rechargeMutation = useMutation({
        mutationFn: async (amount) => {
            const token = localStorage.getItem('captain-token')
            await axios.post(`${import.meta.env.VITE_BASE_URL}/captains/recharge`, { amount }, { headers: { Authorization: `Bearer ${token}` } })
        },
        onSuccess: () => {
            addToast('Recarga efetuada com sucesso!', 'success')
            setShowRechargeModal(false)
            setShowQRCode(false)
            setRechargeAmount('')
            queryClient.invalidateQueries({ queryKey: ['captainWallet'] })
            queryClient.invalidateQueries({ queryKey: ['captainTransactions'] })
        },
        onError: (err) => {
            console.error(err)
            addToast('Erro ao realizar recarga.', 'error')
        }
    })

    const handleRechargeSimulate = async () => {
        if (!rechargeAmount || isNaN(rechargeAmount) || parseFloat(rechargeAmount) <= 0) {
            addToast('Insira um valor válido para recarga.', 'error')
            return
        }
        rechargeMutation.mutate(parseFloat(rechargeAmount))
    }

    // Novos saldos
    const creditBalance = wallet?.creditBalance || 0;
    const pendingBalance = wallet?.pendingBalance || 0;
    const isBlocked = captain?.canReceiveRides === false || creditBalance <= -20; // threshold provisório no front para UI rápida
    const status = isBlocked ? 'BLOQUEADO' : 'ATIVO';

    return (
        <div className='h-screen bg-gray-50 flex flex-col pt-24'>
            {/* Header */}
            <div className='bg-black text-white p-6 pt-8 flex items-center justify-between'>
                <h1 className='text-xl font-bold'>Minha Carteira</h1>
                <Link to='/captain-home' className='h-10 w-10 bg-gray-800 flex items-center justify-center rounded-full text-white'>
                    <i className="text-lg ri-home-5-line"></i>
                </Link>
            </div>

            {/* Content */}
            <div className='flex-1 overflow-y-auto p-4 pb-6'>
                
                {/* Notice Blocked */}
                {isBlocked && (
                    <div className='bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl mb-4 text-sm flex items-start gap-3 shadow-sm'>
                        <i className="ri-error-warning-fill text-xl"></i>
                        <div>
                            <p className='font-bold mb-1'>Conta Suspensa para Corridas</p>
                            <p>Seu saldo de créditos está negativo além do limite permitido. Faça uma recarga via Pix para voltar a receber corridas instantaneamente.</p>
                        </div>
                    </div>
                )}

                {/* Balance Cards */}
                <div className='grid grid-cols-1 gap-4 mb-6'>
                    
                    {/* Credit Balance Card */}
                    <div className={`rounded-2xl shadow-sm border p-5 relative overflow-hidden ${creditBalance < 0 ? 'bg-red-50 border-red-100' : 'bg-white border-gray-100'}`}>
                        <div className='absolute top-0 right-0 p-3'>
                            <span className={`text-[10px] px-2 py-1 rounded-full font-bold uppercase tracking-wider ${status === 'ATIVO' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                {status}
                            </span>
                        </div>
                        
                        <p className='text-sm text-gray-500 mb-1 flex items-center gap-1'>
                            <i className="ri-coins-fill text-yellow-500"></i> Meus Créditos
                        </p>
                        <h2 className={`text-4xl font-bold mb-2 ${creditBalance < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                            R$ {creditBalance.toFixed(2)}
                        </h2>
                        <p className='text-xs text-gray-500 mb-4'>Usado para pagar as comissões da plataforma (Corridas em Dinheiro/Pix).</p>

                        <button 
                            onClick={() => setShowRechargeModal(true)}
                            className='w-full bg-black text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 hover:bg-gray-800 transition'
                        >
                            <i className="ri-add-circle-fill text-green-400"></i> Adicionar Crédito (PIX)
                        </button>
                    </div>

                    {/* Pending Balance Card */}
                    <div className='bg-blue-50 rounded-2xl shadow-sm border border-blue-100 p-5'>
                        <p className='text-sm text-blue-600 mb-1 flex items-center gap-1 font-semibold'>
                            <i className="ri-bank-card-fill"></i> Repasses Pendentes
                        </p>
                        <h2 className='text-3xl font-bold text-blue-900 mb-1'>R$ {pendingBalance.toFixed(2)}</h2>
                        <p className='text-xs text-blue-600 opacity-80'>Valor retido de corridas no cartão aguardando transferência bancária para você.</p>
                    </div>

                </div>

                {/* Transactions List */}
                <h3 className='text-lg font-bold text-gray-800 mb-4'>Extrato (Ledger)</h3>
                
                {loading ? (
                    <div className='flex justify-center p-8'>
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-black"></div>
                    </div>
                ) : transactions.length === 0 ? (
                    <div className='text-center text-gray-500 p-8'>Nenhuma transação encontrada.</div>
                ) : (
                    <div className='space-y-3'>
                        {transactions.map((tx) => {
                            // Identify UI colors and icons based on strict ledger types
                            const isCredit = ['recharge', 'bonus', 'ride_payment', 'adjustment'].includes(tx.type) && tx.balanceAfter >= tx.balanceBefore;
                            const isDebit = !isCredit;

                            let icon = 'ri-exchange-dollar-line';
                            let title = 'Transação';
                            let bgColor = 'bg-gray-100';
                            let iconColor = 'text-gray-600';

                            if (tx.type === 'commission') { icon = 'ri-arrow-down-line'; title = 'Comissão Plataforma'; bgColor = 'bg-red-100'; iconColor = 'text-red-600'; }
                            if (tx.type === 'recharge') { icon = 'ri-add-line'; title = 'Recarga Pix'; bgColor = 'bg-green-100'; iconColor = 'text-green-600'; }
                            if (tx.type === 'ride_payment') { icon = 'ri-car-line'; title = 'Ganho de Corrida'; bgColor = 'bg-blue-100'; iconColor = 'text-blue-600'; }
                            if (tx.type === 'payout') { icon = 'ri-bank-line'; title = 'Repasse Bancário'; bgColor = 'bg-purple-100'; iconColor = 'text-purple-600'; }
                            if (tx.type === 'adjustment') { icon = 'ri-tools-line'; title = 'Ajuste Admin'; bgColor = 'bg-orange-100'; iconColor = 'text-orange-600'; }

                            return (
                                <div key={tx._id} className='bg-white p-4 rounded-xl border border-gray-100 shadow-sm'>
                                    <div className='flex justify-between items-start mb-2'>
                                        <div className='flex items-center gap-3'>
                                            <div className={`h-10 w-10 rounded-full flex items-center justify-center ${bgColor} ${iconColor}`}>
                                                <i className={icon}></i>
                                            </div>
                                            <div>
                                                <h4 className='font-semibold text-gray-800 text-sm'>
                                                    {title}
                                                </h4>
                                                <p className='text-[10px] text-gray-500 leading-tight w-40 truncate'>{tx.description}</p>
                                                <p className='text-[9px] text-gray-400 mt-0.5'>{new Date(tx.createdAt).toLocaleString('pt-BR')}</p>
                                            </div>
                                        </div>
                                        <div className='text-right'>
                                            <h4 className={`font-bold ${isDebit ? 'text-red-500' : 'text-green-500'}`}>
                                                {isDebit ? '-' : '+'}R$ {Math.abs(tx.amount).toFixed(2)}
                                            </h4>
                                            {tx.paymentMethod === 'card' && <span className='text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded'>Cartão</span>}
                                        </div>
                                    </div>
                                    <div className='flex justify-between items-center text-[10px] text-gray-400 border-t border-gray-50 pt-2 mt-1'>
                                        <p>Saldo Ant: R$ {tx.balanceBefore.toFixed(2)}</p>
                                        <p>Saldo Atual: <span className='font-semibold text-gray-600'>R$ {tx.balanceAfter.toFixed(2)}</span></p>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>

            <CaptainHeader />

            {/* Recharge Modal */}
            {showRechargeModal && (
                <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4'>
                    <div className='bg-white w-full max-w-sm rounded-2xl p-6 relative shadow-2xl'>
                        <button 
                            onClick={() => { setShowRechargeModal(false); setShowQRCode(false); }}
                            className='absolute top-4 right-4 text-gray-400 hover:text-black bg-gray-100 rounded-full h-8 w-8 flex items-center justify-center'
                        >
                            <i className="ri-close-line text-xl"></i>
                        </button>
                        
                        <h2 className='text-xl font-bold mb-1'>Adicionar Créditos</h2>
                        <p className='text-xs text-gray-500 mb-5'>O valor ficará disponível instantaneamente para pagamento das comissões (R$ 20 mínimo).</p>
                        
                        {!showQRCode ? (
                            <>
                                <div className='relative mb-6'>
                                    <span className='absolute left-4 top-1/2 -translate-y-1/2 font-medium text-gray-500 text-lg'>R$</span>
                                    <input 
                                        type="number" 
                                        value={rechargeAmount}
                                        onChange={(e) => setRechargeAmount(e.target.value)}
                                        className='w-full bg-gray-50 border border-gray-200 rounded-xl py-4 pl-12 pr-4 outline-none font-bold text-2xl text-gray-800 focus:border-green-500 focus:ring-2 focus:ring-green-200 transition-all'
                                        placeholder="0.00"
                                    />
                                </div>
                                <div className='grid grid-cols-3 gap-2 mb-6'>
                                    {[20, 50, 100].map(val => (
                                        <button key={val} onClick={() => setRechargeAmount(val)} className='bg-gray-100 hover:bg-gray-200 text-gray-700 py-2 rounded-lg font-semibold text-sm transition-colors border border-gray-200'>
                                            +R$ {val}
                                        </button>
                                    ))}
                                </div>
                                <button 
                                    onClick={() => {
                                        if (rechargeAmount >= 20) setShowQRCode(true)
                                        else addToast('O valor mínimo de recarga é R$ 20.', 'error')
                                    }}
                                    className='w-full bg-[#22c55e] hover:bg-[#16a34a] text-white font-bold py-4 rounded-xl shadow-lg shadow-green-500/30 transition-all transform hover:-translate-y-0.5'
                                >
                                    Gerar PIX Copia e Cola
                                </button>
                            </>
                        ) : (
                            <div className='flex flex-col items-center mt-2'>
                                <div className='bg-gray-50 p-6 rounded-2xl mb-4 border border-gray-200 w-full flex flex-col items-center justify-center relative overflow-hidden'>
                                    <div className='absolute top-0 right-0 w-24 h-24 bg-green-500 rounded-full blur-3xl opacity-20 -mr-10 -mt-10'></div>
                                    <i className="ri-qr-code-line text-7xl text-gray-800 mb-2 relative z-10"></i>
                                    <p className='text-xs font-semibold text-gray-500 relative z-10'>Chave PIX Gerada</p>
                                </div>
                                <p className='text-[13px] text-center text-gray-600 mb-6 px-2'>
                                    Ambiente Asaas Sandbox. Escaneie o QR Code ou clique abaixo para simular o pagamento de <b className='text-gray-900'>R$ {parseFloat(rechargeAmount).toFixed(2)}</b>. O crédito cai na hora!
                                </p>
                                <button 
                                    onClick={handleRechargeSimulate}
                                    disabled={recharging}
                                    className='w-full bg-black text-white font-bold py-4 rounded-xl flex justify-center items-center gap-2 shadow-lg hover:bg-gray-800 transition-all'
                                >
                                    {rechargeMutation.isPending ? <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full"></div> : 'Simular Pagamento Pago'}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}

export default CaptainWallet
