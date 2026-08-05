import React, { useState, useEffect, useContext } from 'react'
import { Link } from 'react-router-dom'
import axios from 'axios'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { CaptainDataContext } from '@/driver/contexts/CaptainContext'
import { SocketContext } from '@/shared/contexts/SocketContext'
import CaptainHeader from '@/driver/components/CaptainHeader'
import StatusBadge from '@/shared/components/ui/StatusBadge'
import EmptyState from '@/shared/components/ui/EmptyState'
import Skeleton from '@/shared/components/ui/Skeleton'
import { getAccessToken } from '@/shared/services/session'

const CaptainWallet = () => {
    const { captain } = useContext(CaptainDataContext)
    const { socket } = useContext(SocketContext)

    const queryClient = useQueryClient();

    const [showRechargeModal, setShowRechargeModal] = useState(false);
    const [payoutFeedback, setPayoutFeedback] = useState(null); // { type: 'success' | 'error', message }

    // Queries
    const { data: walletData, isLoading: walletLoading } = useQuery({
        queryKey: ['captainWallet'],
        queryFn: async () => {
            const token = getAccessToken('captain')
            const res = await axios.get(`${import.meta.env.VITE_BASE_URL}/captains/wallet`, { headers: { Authorization: `Bearer ${token}` } })
            return res.data.wallet
        }
    })

    const { data: transactionsData, isLoading: transLoading } = useQuery({
        queryKey: ['captainTransactions'],
        queryFn: async () => {
            const token = getAccessToken('captain')
            const res = await axios.get(`${import.meta.env.VITE_BASE_URL}/captains/transactions`, { headers: { Authorization: `Bearer ${token}` } })
            return res.data.transactions
        }
    })

    const loading = walletLoading || transLoading;
    const wallet = walletData;
    const transactions = transactionsData || [];

    // Auditoria do painel administrativo (2026-08-02, Bloco C): antes não existia
    // nenhum jeito do motorista solicitar o saque do saldo pendente — o Centro
    // Financeiro do admin administrava uma lista de repasses que nada nunca criava.
    const requestPayoutMutation = useMutation({
        mutationFn: async () => {
            const token = getAccessToken('captain')
            const res = await axios.post(`${import.meta.env.VITE_BASE_URL}/captains/payouts`, {}, { headers: { Authorization: `Bearer ${token}` } })
            return res.data
        },
        onSuccess: () => {
            setPayoutFeedback({ type: 'success', message: 'Saque solicitado! Acompanhe o status no seu extrato — a MoveCity vai transferir via Pix após aprovação.' })
            queryClient.invalidateQueries({ queryKey: ['captainWallet'] })
            queryClient.invalidateQueries({ queryKey: ['captainTransactions'] })
        },
        onError: (err) => {
            setPayoutFeedback({ type: 'error', message: err.response?.data?.message || 'Não foi possível solicitar o saque.' })
        }
    })

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

    // Novos saldos
    const creditBalance = wallet?.creditBalance || 0;
    const pendingBalance = wallet?.pendingBalance || 0;
    const isBlocked = captain?.canReceiveRides === false || creditBalance <= -20; // threshold provisório no front para UI rápida
    const status = isBlocked ? 'BLOQUEADO' : 'ATIVO';

    return (
        <div className='h-screen bg-surface-alt flex flex-col pt-24'>
            {/* Header */}
            <div className='bg-black text-white p-6 pt-8 flex items-center justify-between'>
                <h1 className='text-xl font-bold'>Minha Carteira</h1>
                <Link to='/captain-home' aria-label="Voltar para a Home" className='h-11 w-11 bg-gray-800 flex items-center justify-center rounded-full text-white'>
                    <i className="text-lg ri-home-5-line"></i>
                </Link>
            </div>

            {/* Content */}
            <div className='flex-1 overflow-y-auto p-4 pb-6'>
                
                {/* Notice Blocked */}
                {isBlocked && (
                    <div className='bg-danger-50 border border-danger-500/30 text-danger-600 p-4 rounded-panel mb-4 text-sm flex items-start gap-3 shadow-raised'>
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
                    <div className={`rounded-panel shadow-raised border p-5 relative overflow-hidden ${creditBalance < 0 ? 'bg-danger-50 border-danger-500/20' : 'bg-surface border-line'}`}>
                        <div className='absolute top-0 right-0 p-3'>
                            <StatusBadge tone={status === 'ATIVO' ? 'success' : 'danger'}>{status}</StatusBadge>
                        </div>

                        <p className='text-sm text-ink-600 mb-1 flex items-center gap-1'>
                            <i className="ri-coins-fill text-yellow-500"></i> Meus Créditos
                        </p>
                        <h2 className={`text-4xl font-bold mb-2 ${creditBalance < 0 ? 'text-danger-600' : 'text-ink-900'}`}>
                            R$ {creditBalance.toFixed(2)}
                        </h2>
                        <p className='text-xs text-ink-600 mb-4'>Usado para pagar as comissões da plataforma (Corridas em Dinheiro/Pix).</p>

                        <button
                            type="button"
                            onClick={() => setShowRechargeModal(true)}
                            className='w-full bg-black text-white font-semibold py-3 rounded-panel flex items-center justify-center gap-2 hover:bg-gray-800 transition'
                        >
                            <i className="ri-add-circle-fill text-green-400"></i> Adicionar Crédito (PIX)
                        </button>
                    </div>

                    {/* Pending Balance Card */}
                    <div className='bg-blue-50 rounded-panel shadow-raised border border-blue-100 p-5'>
                        <p className='text-sm text-blue-600 mb-1 flex items-center gap-1 font-semibold'>
                            <i className="ri-bank-card-fill"></i> Repasses Pendentes
                        </p>
                        <h2 className='text-3xl font-bold text-blue-900 mb-1'>R$ {pendingBalance.toFixed(2)}</h2>
                        <p className='text-xs text-blue-600 opacity-80 mb-4'>Valor retido de corridas no cartão aguardando transferência bancária para você.</p>

                        <button
                            type="button"
                            onClick={() => { setPayoutFeedback(null); requestPayoutMutation.mutate(); }}
                            disabled={pendingBalance <= 0 || requestPayoutMutation.isPending}
                            className='w-full bg-blue-600 text-white font-semibold py-3 rounded-panel flex items-center justify-center gap-2 hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed'
                        >
                            <i className="ri-send-plane-fill"></i> {requestPayoutMutation.isPending ? 'Solicitando...' : 'Solicitar Saque'}
                        </button>
                    </div>

                    {payoutFeedback && (
                        <div className={`p-4 rounded-panel text-sm flex items-start gap-3 shadow-raised border ${
                            payoutFeedback.type === 'success'
                                ? 'bg-brand-50 border-brand-500/30 text-brand-600'
                                : 'bg-danger-50 border-danger-500/30 text-danger-600'
                        }`}>
                            <i className={`text-xl ${payoutFeedback.type === 'success' ? 'ri-checkbox-circle-fill' : 'ri-error-warning-fill'}`}></i>
                            <p className='flex-1'>{payoutFeedback.message}</p>
                            <button type="button" onClick={() => setPayoutFeedback(null)} aria-label="Fechar" className='text-current opacity-60 hover:opacity-100'>
                                <i className="ri-close-line"></i>
                            </button>
                        </div>
                    )}

                </div>

                {/* Transactions List */}
                <h3 className='text-lg font-bold text-ink-900 mb-4'>Extrato (Ledger)</h3>
                
                {loading ? (
                    <div className='space-y-3'>
                        <Skeleton className="h-20 w-full" />
                        <Skeleton className="h-20 w-full" />
                        <Skeleton className="h-20 w-full" />
                    </div>
                ) : transactions.length === 0 ? (
                    <EmptyState
                        icon="ri-exchange-dollar-line"
                        title="Nenhuma transação ainda"
                        description="Seu extrato aparece aqui assim que você tiver a primeira corrida ou recarga."
                    />
                ) : (
                    <div className='space-y-3'>
                        {transactions.map((tx) => {
                            // Identify UI colors and icons based on strict ledger types
                            const isCredit = ['recharge', 'bonus', 'ride_payment', 'adjustment'].includes(tx.type) && tx.balanceAfter >= tx.balanceBefore;
                            const isDebit = !isCredit;

                            let icon = 'ri-exchange-dollar-line';
                            let title = 'Transação';
                            let bgColor = 'bg-surface-alt';
                            let iconColor = 'text-ink-600';

                            if (tx.type === 'recharge') { icon = 'ri-add-line'; title = 'Recarga Pix'; bgColor = 'bg-brand-50'; iconColor = 'text-brand-600'; }
                            if (tx.type === 'ride_payment' || tx.type === 'parcel_payment') { icon = 'ri-car-line'; title = 'Ganho de serviço'; bgColor = 'bg-blue-100'; iconColor = 'text-blue-600'; }
                            if (tx.type === 'payout') { icon = 'ri-bank-line'; title = 'Repasse Bancário'; bgColor = 'bg-purple-100'; iconColor = 'text-purple-600'; }
                            if (tx.type === 'adjustment') { icon = 'ri-tools-line'; title = 'Ajuste Admin'; bgColor = 'bg-orange-100'; iconColor = 'text-orange-600'; }

                            return (
                                <div key={tx._id} className='bg-surface p-4 rounded-panel border border-line shadow-raised'>
                                    <div className='flex justify-between items-start mb-2'>
                                        <div className='flex items-center gap-3'>
                                            <div className={`h-10 w-10 rounded-full flex items-center justify-center ${bgColor} ${iconColor}`}>
                                                <i className={icon}></i>
                                            </div>
                                            <div>
                                                <h4 className='font-semibold text-ink-900 text-sm'>
                                                    {title}
                                                </h4>
                                                <p className='text-xs text-ink-600 leading-tight w-40 truncate'>{tx.description}</p>
                                                <p className='text-xs text-ink-600 mt-0.5'>{new Date(tx.createdAt).toLocaleString('pt-BR')}</p>
                                            </div>
                                        </div>
                                        <div className='text-right'>
                                            <h4 className={`font-bold ${isDebit ? 'text-danger-500' : 'text-brand-600'}`}>
                                                {isDebit ? '-' : '+'}R$ {Math.abs(tx.amount).toFixed(2)}
                                            </h4>
                                            {tx.paymentMethod === 'card' && <span className='text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded'>Cartão</span>}
                                        </div>
                                    </div>
                                    <div className='flex justify-between items-center text-xs text-ink-600 border-t border-line pt-2 mt-1'>
                                        <p>Saldo Ant: R$ {tx.balanceBefore.toFixed(2)}</p>
                                        <p>Saldo Atual: <span className='font-semibold text-ink-600'>R$ {tx.balanceAfter.toFixed(2)}</span></p>
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
                <div className='fixed inset-0 z-modal flex items-center justify-center bg-black/60 px-4'>
                    <div className='bg-surface w-full max-w-sm rounded-panel p-6 relative shadow-floating'>
                        <button
                            type="button"
                            onClick={() => setShowRechargeModal(false)}
                            aria-label="Fechar"
                            className='absolute top-4 right-4 text-ink-400 hover:text-ink-900 bg-surface-alt rounded-full h-11 w-11 flex items-center justify-center'
                        >
                            <i className="ri-close-line text-xl"></i>
                        </button>

                        <div className='flex flex-col items-center text-center pt-4'>
                            <div className='h-14 w-14 bg-yellow-50 text-yellow-600 rounded-full flex items-center justify-center mb-4'>
                                <i className="ri-tools-fill text-2xl"></i>
                            </div>
                            <h2 className='text-xl font-bold mb-2'>Recarga temporariamente indisponível</h2>
                            <p className='text-sm text-ink-600 mb-6'>
                                Ainda não temos um meio de pagamento automático conectado para recarga de créditos. Fale com o suporte da MoveCity para adicionar saldo à sua conta.
                            </p>
                            <button
                                type="button"
                                onClick={() => setShowRechargeModal(false)}
                                className='w-full bg-black text-white font-semibold py-3 rounded-panel hover:bg-gray-800 transition-colors'
                            >
                                Entendi
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

export default CaptainWallet
