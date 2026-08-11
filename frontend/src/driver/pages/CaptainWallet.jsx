import { useState, useEffect, useContext } from 'react'
import { Link } from 'react-router-dom'
import api from '@/shared/services/axios'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CaptainDataContext } from '@/driver/contexts/CaptainContext'
import { SocketContext } from '@/shared/contexts/SocketContext'
import CaptainHeader from '@/driver/components/CaptainHeader'
import StatusBadge from '@/shared/components/ui/StatusBadge'
import EmptyState from '@/shared/components/ui/EmptyState'
import Skeleton from '@/shared/components/ui/Skeleton'
import { getAccessToken } from '@/shared/services/session'
import { formatBRL } from '@/shared/utils/currency'
import { openWhatsApp } from '@/shared/utils/whatsapp'
import { useToast } from '@/shared/contexts/ToastContext'

const CaptainWallet = () => {
    const { captain } = useContext(CaptainDataContext)
    const { socket } = useContext(SocketContext)
    const { addToast } = useToast()

    const queryClient = useQueryClient();

    const [showRechargeModal, setShowRechargeModal] = useState(false);

    // Queries
    const {
        data: walletData,
        isLoading: walletLoading,
        isError: walletIsError,
        refetch: refetchWallet,
        isRefetching: walletRefetching,
    } = useQuery({
        queryKey: ['captainWallet'],
        queryFn: async () => {
            const token = getAccessToken('captain')
            const res = await api.get(`${import.meta.env.VITE_BASE_URL}/captains/wallet`, { headers: { Authorization: `Bearer ${token}` } })
            return res.data.wallet
        }
    })

    const {
        data: transactionsData,
        isLoading: transLoading,
        isError: transIsError,
        refetch: refetchTransactions,
        isRefetching: transRefetching,
    } = useQuery({
        queryKey: ['captainTransactions'],
        queryFn: async () => {
            const token = getAccessToken('captain')
            const res = await api.get(`${import.meta.env.VITE_BASE_URL}/captains/transactions`, { headers: { Authorization: `Bearer ${token}` } })
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

    // Novos saldos
    const creditBalance = wallet?.creditBalance || 0;
    // Auditoria do app do motorista (2026-08-11, P1): o limite de saldo negativo é
    // configurável pelo admin (GlobalSetting.maximumNegativeBalance, default 0) e já
    // decide canReceiveRides no backend de forma atômica a cada transação
    // (Backend/services/wallet.service.js) — o "-20" fixo aqui era um palpite do
    // frontend que podia divergir do limite real.
    const isBlocked = captain?.canReceiveRides === false;
    const status = isBlocked ? 'BLOQUEADO' : 'ATIVO';
    const supportPhone = import.meta.env.VITE_SUPPORT_WHATSAPP

    const contactSupport = () => {
        const firstName = captain?.fullname?.firstname || 'motorista'
        const opened = openWhatsApp(
            supportPhone,
            `Olá! Sou ${firstName}, motorista MoveCity, e quero fazer uma recarga de créditos.`,
        )
        if (!opened) {
            addToast('WhatsApp do suporte indisponível. Peça o contato à equipe MoveCity.', 'info')
        }
    }

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
                
                {/* Auditoria do app do motorista (2026-08-11, P1): antes, uma falha de rede
                    aqui deixava wallet undefined e creditBalance/pendingBalance caíam
                    silenciosamente pro fallback `|| 0` — o motorista via "R$ 0,00" como se
                    fosse o saldo real, sem nenhum aviso de que a chamada tinha falhado
                    (podia até mascarar um bloqueio por saldo negativo real). */}
                {walletIsError ? (
                    <EmptyState
                        variant="error"
                        icon="ri-wifi-off-line"
                        title="Não foi possível carregar sua carteira"
                        description="Verifique sua conexão e tente novamente."
                        actionLabel={walletRefetching ? 'Tentando...' : 'Tentar de novo'}
                        onAction={refetchWallet}
                    />
                ) : (
                <>
                {/* Notice Blocked */}
                {isBlocked && (
                    <div className='bg-danger-50 border border-danger-500/30 text-danger-600 p-4 rounded-panel mb-4 text-sm flex items-start gap-3 shadow-raised'>
                        <i className="ri-error-warning-fill text-xl"></i>
                        <div>
                            <p className='font-bold mb-1'>Conta Suspensa para Corridas</p>
                            <p>Seus créditos chegaram ao limite. Fale com o suporte para recarregar e voltar a receber corridas após a confirmação.</p>
                        </div>
                    </div>
                )}

                {/* Explicação do modelo financeiro atual: o passageiro paga o motorista
                    diretamente e a carteira guarda somente créditos de comissão. */}
                <section className='bg-brand-50 border border-brand-200 rounded-panel p-4 mb-4'>
                    <div className='flex items-start gap-3'>
                        <div className='h-10 w-10 rounded-full bg-brand-600 text-white flex items-center justify-center flex-shrink-0'>
                            <i className='ri-hand-coin-fill text-xl' aria-hidden='true'></i>
                        </div>
                        <div>
                            <h2 className='font-bold text-ink-900'>Como funciona seu pagamento</h2>
                            <p className='text-sm text-ink-700 mt-1'>O valor da corrida vai direto para você. A MoveCity usa esta carteira apenas para descontar a comissão.</p>
                        </div>
                    </div>
                    <ol className='grid grid-cols-3 gap-2 mt-4' aria-label='Etapas do pagamento'>
                        {[
                            ['1', 'Receba', 'Dinheiro ou Pix'],
                            ['2', 'Confirme', 'No fim da corrida'],
                            ['3', 'Comissão', 'Sai dos créditos'],
                        ].map(([number, title, description]) => (
                            <li key={number} className='bg-surface rounded-panel p-2.5 text-center border border-brand-100'>
                                <span className='inline-flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-white text-xs font-bold'>{number}</span>
                                <p className='text-xs font-bold text-ink-900 mt-1.5'>{title}</p>
                                <p className='text-[11px] leading-tight text-ink-600 mt-0.5'>{description}</p>
                            </li>
                        ))}
                    </ol>
                </section>

                {/* Balance Cards */}
                <div className='grid grid-cols-1 gap-4 mb-6'>

                    {/* Credit Balance Card */}
                    <div className={`rounded-panel shadow-raised border p-5 relative overflow-hidden ${creditBalance < 0 ? 'bg-danger-50 border-danger-500/20' : 'bg-surface border-line'}`}>
                        <div className='absolute top-0 right-0 p-3'>
                            <StatusBadge tone={status === 'ATIVO' ? 'success' : 'danger'}>{status}</StatusBadge>
                        </div>

                        <p className='text-sm text-ink-600 mb-1 flex items-center gap-1'>
                            <i className="ri-coins-fill text-yellow-500"></i> Créditos para comissões
                        </p>
                        <h2 className={`text-4xl font-bold mb-2 ${creditBalance < 0 ? 'text-danger-600' : 'text-ink-900'}`}>
                            {formatBRL(creditBalance)}
                        </h2>
                        <p className='text-sm text-ink-600 mb-4'>Este saldo não é o seu ganho. Ele serve somente para pagar a comissão da MoveCity após você receber do passageiro.</p>

                        <button
                            type="button"
                            onClick={() => setShowRechargeModal(true)}
                            className='w-full bg-black text-white font-semibold py-3 rounded-panel flex items-center justify-center gap-2 hover:bg-gray-800 transition'
                        >
                            <i className="ri-whatsapp-fill text-green-400"></i> Recarregar com o suporte
                        </button>
                    </div>
                </div>
                </>
                )}

                {/* Transactions List */}
                <div className='mb-4'>
                    <h3 className='text-lg font-bold text-ink-900'>Movimentações dos créditos</h3>
                    <p className='text-xs text-ink-600 mt-1'>Aqui aparecem recargas, comissões e ajustes. Seus ganhos ficam na tela Ganhos.</p>
                </div>

                {loading ? (
                    <div className='space-y-3'>
                        <Skeleton className="h-20 w-full" />
                        <Skeleton className="h-20 w-full" />
                        <Skeleton className="h-20 w-full" />
                    </div>
                ) : transIsError ? (
                    <EmptyState
                        variant="error"
                        icon="ri-wifi-off-line"
                        title="Não foi possível carregar o extrato"
                        description="Verifique sua conexão e tente novamente."
                        actionLabel={transRefetching ? 'Tentando...' : 'Tentar de novo'}
                        onAction={refetchTransactions}
                    />
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
                            const isCredit = ['recharge', 'bonus', 'ride_payment', 'parcel_payment', 'adjustment'].includes(tx.type) && tx.balanceAfter >= tx.balanceBefore;
                            const isDebit = !isCredit;

                            let icon = 'ri-exchange-dollar-line';
                            let title = 'Transação';
                            let bgColor = 'bg-surface-alt';
                            let iconColor = 'text-ink-600';

                            if (tx.type === 'recharge') { icon = 'ri-add-line'; title = 'Recarga Pix'; bgColor = 'bg-brand-50'; iconColor = 'text-brand-600'; }
                            if (tx.type === 'commission') { icon = 'ri-percent-line'; title = 'Comissão MoveCity'; bgColor = 'bg-danger-50'; iconColor = 'text-danger-600'; }
                            if (tx.type === 'ride_payment' || tx.type === 'parcel_payment') { icon = 'ri-car-line'; title = 'Movimentação de serviço'; bgColor = 'bg-blue-100'; iconColor = 'text-blue-600'; }
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
                                                {isDebit ? '-' : '+'}{formatBRL(Math.abs(tx.amount))}
                                            </h4>
                                            {tx.paymentMethod === 'card' && <span className='text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded'>Cartão</span>}
                                        </div>
                                    </div>
                                    <div className='flex justify-between items-center text-xs text-ink-600 border-t border-line pt-2 mt-1'>
                                        <p>Antes: {formatBRL(tx.balanceBefore)}</p>
                                        <p>Depois: <span className='font-semibold text-ink-600'>{formatBRL(tx.balanceAfter)}</span></p>
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
                            <h2 className='text-xl font-bold mb-2'>Recarregar créditos</h2>
                            <p className='text-sm text-ink-600'>Nesta fase inicial, nossa equipe faz a recarga para você pelo suporte.</p>
                            <div className='w-full bg-surface-alt border border-line rounded-panel p-4 my-5 text-left'>
                                <p className='text-sm font-semibold text-ink-900 mb-3'>É simples:</p>
                                <ol className='space-y-2 text-sm text-ink-600'>
                                    <li className='flex gap-2'><span className='font-bold text-brand-600'>1.</span> Fale com o suporte.</li>
                                    <li className='flex gap-2'><span className='font-bold text-brand-600'>2.</span> Receba a chave Pix e envie o valor.</li>
                                    <li className='flex gap-2'><span className='font-bold text-brand-600'>3.</span> Envie o comprovante e aguarde o crédito aparecer aqui.</li>
                                </ol>
                            </div>
                            <button
                                type="button"
                                onClick={contactSupport}
                                className='w-full bg-green-600 text-white font-semibold py-3 rounded-panel hover:bg-green-700 transition-colors flex items-center justify-center gap-2'
                            >
                                <i className='ri-whatsapp-fill text-xl' aria-hidden='true'></i>
                                Falar com o suporte
                            </button>
                            <p className='text-xs text-ink-500 mt-3'>O crédito é usado apenas para comissões. O pagamento das corridas continua indo direto para você.</p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

export default CaptainWallet
