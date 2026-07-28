import React, { useState, useEffect, useContext } from 'react'
import { Link } from 'react-router-dom'
import axios from 'axios'
import { CaptainDataContext } from '../context/CapatainContext'
import { SocketContext } from '../context/SocketContext'
import CaptainHeader from '../components/CaptainHeader'
import { useToast } from '../context/ToastContext'

const CaptainWallet = () => {
    const { captain } = useContext(CaptainDataContext)
    const { socket } = useContext(SocketContext)
    const { addToast } = useToast()

    const [wallet, setWallet] = useState(null)
    const [transactions, setTransactions] = useState([])
    const [loading, setLoading] = useState(true)

    // Recharge modal states
    const [showRechargeModal, setShowRechargeModal] = useState(false)
    const [rechargeAmount, setRechargeAmount] = useState('')
    const [showQRCode, setShowQRCode] = useState(false)
    const [recharging, setRecharging] = useState(false)

    const fetchData = async () => {
        try {
            const token = localStorage.getItem('captain-token')
            const [walletRes, transRes] = await Promise.all([
                axios.get(`${import.meta.env.VITE_BASE_URL}/captains/wallet`, { headers: { Authorization: `Bearer ${token}` } }),
                axios.get(`${import.meta.env.VITE_BASE_URL}/captains/transactions`, { headers: { Authorization: `Bearer ${token}` } })
            ])
            setWallet(walletRes.data.wallet)
            setTransactions(transRes.data.transactions)
        } catch (err) {
            console.error('Error fetching wallet data:', err)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchData()

        const handleWalletUpdated = (data) => {
            if (data.wallet) setWallet(data.wallet)
            if (data.transaction) {
                setTransactions(prev => [data.transaction, ...prev])
            } else {
                fetchData() // fallback
            }
        }

        if (socket) {
            socket.on('wallet-updated', handleWalletUpdated)
        }

        return () => {
            if (socket) socket.off('wallet-updated', handleWalletUpdated)
        }
    }, [socket])

    const handleRechargeSimulate = async () => {
        if (!rechargeAmount || isNaN(rechargeAmount) || parseFloat(rechargeAmount) <= 0) {
            addToast('Insira um valor válido para recarga.', 'error')
            return
        }

        setRecharging(true)
        try {
            const token = localStorage.getItem('captain-token')
            await axios.post(`${import.meta.env.VITE_BASE_URL}/captains/recharge`, {
                amount: parseFloat(rechargeAmount)
            }, {
                headers: { Authorization: `Bearer ${token}` }
            })
            addToast('Recarga efetuada com sucesso!', 'success')
            setShowRechargeModal(false)
            setShowQRCode(false)
            setRechargeAmount('')
        } catch (err) {
            console.error(err)
            addToast('Erro ao realizar recarga.', 'error')
        } finally {
            setRecharging(false)
        }
    }

    // Calculando saldos e dívidas
    const balance = wallet?.balance || 0
    const available = balance > 0 ? balance : 0
    const debt = balance < 0 ? Math.abs(balance) : 0
    const blocked = wallet?.blockedBalance || 0
    const status = balance < 0 ? 'BLOQUEADO' : 'ATIVO'

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
                {/* Balance Card */}
                <div className='bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-6 relative overflow-hidden'>
                    <div className='absolute top-0 right-0 p-3'>
                        <span className={`text-[10px] px-2 py-1 rounded-full font-bold uppercase tracking-wider ${status === 'ATIVO' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {status}
                        </span>
                    </div>

                    <p className='text-sm text-gray-500 mb-1'>Saldo Disponível</p>
                    <h2 className='text-4xl font-bold text-gray-900 mb-4'>R$ {available.toFixed(2)}</h2>

                    <div className='grid grid-cols-2 gap-4 border-t border-gray-100 pt-4'>
                        <div>
                            <p className='text-xs text-gray-500'>Saldo Bloqueado</p>
                            <p className='text-sm font-semibold text-gray-700'>R$ {blocked.toFixed(2)}</p>
                        </div>
                        <div>
                            <p className='text-xs text-gray-500'>Dívida (Comissões)</p>
                            <p className='text-sm font-semibold text-red-600'>R$ {debt.toFixed(2)}</p>
                        </div>
                    </div>

                    <button 
                        onClick={() => setShowRechargeModal(true)}
                        className='w-full mt-5 bg-black text-white font-semibold py-3 rounded-xl flex items-center justify-center gap-2 hover:bg-gray-800 transition'
                    >
                        <i className="ri-add-circle-fill"></i> Recarregar via PIX
                    </button>
                </div>

                {/* Transactions List */}
                <h3 className='text-lg font-bold text-gray-800 mb-4'>Histórico de Transações</h3>
                
                {loading ? (
                    <div className='flex justify-center p-8'>
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-black"></div>
                    </div>
                ) : transactions.length === 0 ? (
                    <div className='text-center text-gray-500 p-8'>Nenhuma transação encontrada.</div>
                ) : (
                    <div className='space-y-3'>
                        {transactions.map((tx) => (
                            <div key={tx._id} className='bg-white p-4 rounded-xl border border-gray-100 shadow-sm'>
                                <div className='flex justify-between items-start mb-2'>
                                    <div className='flex items-center gap-3'>
                                        <div className={`h-10 w-10 rounded-full flex items-center justify-center ${tx.type === 'commission' ? 'bg-red-100 text-red-600' : tx.type === 'recharge' ? 'bg-green-100 text-green-600' : 'bg-blue-100 text-blue-600'}`}>
                                            <i className={tx.type === 'commission' ? 'ri-arrow-down-line' : tx.type === 'recharge' ? 'ri-add-line' : 'ri-exchange-dollar-line'}></i>
                                        </div>
                                        <div>
                                            <h4 className='font-semibold text-gray-800 text-sm'>
                                                {tx.type === 'commission' ? `Comissão` : tx.type === 'recharge' ? 'Recarga PIX' : 'Bônus'}
                                            </h4>
                                            <p className='text-[11px] text-gray-500'>{new Date(tx.createdAt).toLocaleString('pt-BR')}</p>
                                        </div>
                                    </div>
                                    <h4 className={`font-bold ${tx.balanceAfter < tx.balanceBefore ? 'text-red-500' : 'text-green-500'}`}>
                                        {tx.balanceAfter < tx.balanceBefore ? '-' : '+'}R$ {Math.abs(tx.amount).toFixed(2)}
                                    </h4>
                                </div>
                                <div className='flex justify-between items-center text-[11px] text-gray-500 border-t border-gray-50 pt-2'>
                                    <p>Saldo Ant: R$ {tx.balanceBefore.toFixed(2)}</p>
                                    <p>Saldo Atual: <span className='font-semibold'>R$ {tx.balanceAfter.toFixed(2)}</span></p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <CaptainHeader />

            {/* Recharge Modal */}
            {showRechargeModal && (
                <div className='fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4'>
                    <div className='bg-white w-full max-w-sm rounded-2xl p-6 relative'>
                        <button 
                            onClick={() => { setShowRechargeModal(false); setShowQRCode(false); }}
                            className='absolute top-4 right-4 text-gray-400 hover:text-black'
                        >
                            <i className="ri-close-line text-2xl"></i>
                        </button>
                        
                        <h2 className='text-xl font-bold mb-4'>Adicionar Créditos</h2>
                        
                        {!showQRCode ? (
                            <>
                                <p className='text-sm text-gray-600 mb-4'>Digite o valor que deseja recarregar via PIX para abater comissões.</p>
                                <div className='relative mb-6'>
                                    <span className='absolute left-4 top-1/2 -translate-y-1/2 font-medium text-gray-500'>R$</span>
                                    <input 
                                        type="number" 
                                        value={rechargeAmount}
                                        onChange={(e) => setRechargeAmount(e.target.value)}
                                        className='w-full bg-gray-100 rounded-xl py-3 pl-10 pr-4 outline-none font-semibold text-lg'
                                        placeholder="0.00"
                                    />
                                </div>
                                <button 
                                    onClick={() => {
                                        if (rechargeAmount > 0) setShowQRCode(true)
                                    }}
                                    className='w-full bg-green-600 text-white font-bold py-3 rounded-xl'
                                >
                                    Gerar PIX
                                </button>
                            </>
                        ) : (
                            <div className='flex flex-col items-center'>
                                <div className='bg-gray-100 p-4 rounded-xl mb-4 border-2 border-dashed border-gray-300'>
                                    <i className="ri-qr-code-line text-6xl text-gray-700"></i>
                                </div>
                                <p className='text-sm text-center text-gray-600 mb-6'>
                                    (Ambiente de Testes) Escaneie o QR Code ou copie o código Copia e Cola para pagar <b>R$ {parseFloat(rechargeAmount).toFixed(2)}</b>.
                                </p>
                                <button 
                                    onClick={handleRechargeSimulate}
                                    disabled={recharging}
                                    className='w-full bg-black text-white font-bold py-3 rounded-xl flex justify-center items-center gap-2'
                                >
                                    {recharging ? <div className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full"></div> : 'Simular Pagamento Confirmado'}
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
