import React, { useContext, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { CaptainDataContext } from '@/contexts/CaptainContext'
import { SocketContext } from '@/contexts/SocketContext'
import { LocationContext } from '@/contexts/LocationContext'
import { useToast } from '@/contexts/ToastContext'
import axios from 'axios'
import Avatar from '@/shared/components/Avatar'
import Card from '@/shared/components/ui/Card'

const CaptainDetails = () => {

    const { captain } = useContext(CaptainDataContext)
    const { socket } = useContext(SocketContext)
    const { locationError } = useContext(LocationContext)
    const { addToast } = useToast()
    const navigate = useNavigate()
    const [summary, setSummary] = useState(null)
    const [loadingSummary, setLoadingSummary] = useState(true)

    // Auditoria de UX do motorista (2026-08-02, §2.1): estes dois useState viviam DEPOIS
    // do "if (!captain) return null" abaixo — violação das Regras dos Hooks. Quando
    // `captain` passa de null para preenchido (exatamente o que acontece assim que o
    // perfil termina de carregar), o React tenta renderizar mais hooks do que na render
    // anterior e derruba a árvore com "Rendered more hooks than during the previous
    // render". Hooks sempre antes de qualquer return condicional.
    const [isOnline, setIsOnline] = useState(captain?.isOnline || false);
    const [loadingToggle, setLoadingToggle] = useState(false);

    const fetchSummary = async () => {
        try {
            const token = localStorage.getItem('captain-token');
            const response = await axios.get(`${import.meta.env.VITE_BASE_URL}/captains/summary`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setSummary(response.data);
        } catch (err) {
            console.error('Error fetching captain summary:', err);
        } finally {
            setLoadingSummary(false);
        }
    };

    useEffect(() => {
        fetchSummary();

        // Listen for real-time updates
        const handleSummaryUpdated = () => {
            fetchSummary();
        };

        if (socket) {
            socket.on('summary-updated', handleSummaryUpdated);
        }

        return () => {
            if (socket) {
                socket.off('summary-updated', handleSummaryUpdated);
            }
        };
    }, [socket]);

    if (!captain) return null;

    const toggleOnline = async () => {
        if (captain.approvalStatus !== 'aprovado') {
            addToast('Você não pode ficar online até que seu cadastro seja aprovado.', 'error');
            return;
        }

        setLoadingToggle(true);
        try {
            const response = await axios.post(`${import.meta.env.VITE_BASE_URL}/captains/toggle-online`, {
                isOnline: !isOnline
            }, {
                headers: {
                    Authorization: `Bearer ${localStorage.getItem('captain-token')}`
                }
            });
            setIsOnline(response.data.captain.isOnline);
            // Optionally update context here if needed
        } catch (error) {
            console.error('Error toggling online status:', error);
            addToast(error.response?.data?.message || 'Erro ao alterar status online', 'error');
        } finally {
            setLoadingToggle(false);
        }
    }

    const formatOnlineTime = (totalSeconds) => {
        if (!totalSeconds) return '0m';
        const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        if (h > 0) return `${h}h${m}m`;
        return `${m}m`;
    };

    return (
        <div className="flex flex-col gap-4">
            {/* Cabecalho e Perfil */}
            <div className='flex items-center justify-between'>
                <div className='flex items-center gap-3'>
                    <Avatar firstname={captain?.fullname?.firstname} lastname={captain?.fullname?.lastname} className='border-2 border-yellow-400' />
                    <div>
                        <h4 className='text-lg font-bold capitalize flex items-center gap-2 text-ink-900'>
                            {captain?.fullname?.firstname} {captain?.fullname?.lastname}
                            <span className="text-[11px] font-bold text-ink-600 bg-surface-alt px-1.5 py-0.5 rounded-md flex items-center gap-1 shadow-raised border border-line">
                                ⭐ {summary?.rating?.toFixed(1) || '5.0'}
                            </span>
                        </h4>
                        <p className='text-xs text-ink-600 font-medium capitalize'>{captain?.vehicle?.color} {captain?.vehicle?.vehicleType} • {captain?.vehicle?.plate}</p>
                    </div>
                </div>
            </div>

            {/* Auditoria de UX do motorista (2026-08-02, §2.5): sem isto, um motorista
                online sem GPS via "Procurando corridas..." pulsando em verde — uma
                afirmação falsa, já que sem localização ele nem aparece no despacho. */}
            {isOnline && locationError && (
                <div className='flex items-center gap-2 bg-danger-50 border border-danger-500/20 text-danger-600 text-xs font-semibold px-3 py-2 rounded-panel'>
                    <i className="ri-map-pin-off-line text-base"></i>
                    Sem sinal de GPS — você pode não estar recebendo corridas.
                </div>
            )}

            {/* Smart Card & Status Toggle — cor dinâmica de propósito (não é um cartão
                neutro do sistema): comunica o estado online/offline/sem-GPS do motorista. */}
            <div className={`p-4 rounded-panel flex items-center justify-between ${isOnline && locationError ? 'bg-danger-600 text-white' : isOnline ? 'bg-brand-600 text-white' : 'bg-ink-900 text-white'} shadow-floating transition-all duration-300`}>
                <div>
                    <h3 className="font-bold text-lg flex items-center gap-2">
                        {isOnline && locationError ? (
                            <><div className="w-2.5 h-2.5 bg-white/70 rounded-full"></div> Online, sem GPS</>
                        ) : isOnline ? (
                            <><div className="w-2.5 h-2.5 bg-white/70 rounded-full animate-pulse"></div> Procurando corridas...</>
                        ) : (
                            <><div className="w-2.5 h-2.5 bg-white/40 rounded-full"></div> Offline</>
                        )}
                    </h3>
                    <p className="text-[13px] opacity-90 mt-1 font-medium">
                        {isOnline && locationError
                            ? 'Ative a localização para voltar a receber corridas'
                            : isOnline ? 'Você está visível para passageiros próximos' : 'Fique online para receber corridas'}
                    </p>
                </div>
                <button
                    onClick={toggleOnline}
                    disabled={loadingToggle || captain.approvalStatus !== 'aprovado'}
                    className={`px-5 py-3 rounded-full font-bold text-sm transition-all shadow-raised active:scale-95 ${
                        isOnline
                        ? 'bg-white text-brand-700 hover:bg-brand-50'
                        : 'bg-brand-500 text-white hover:bg-brand-400'
                    } ${(loadingToggle || captain.approvalStatus !== 'aprovado') && 'opacity-70 cursor-not-allowed'}`}
                >
                    {isOnline ? 'Ficar Offline' : 'Ficar Online'}
                </button>
            </div>

            {/* Ganhos Hoje */}
            <Card shadow="raised" padding="p-5">
                <p className='text-xs text-ink-600 font-bold uppercase tracking-wider mb-1'>💰 Ganhos Hoje</p>
                <h2 className='text-4xl font-black text-ink-900 tracking-tight mt-1'>
                    {loadingSummary ? '...' : `R$ ${summary?.earnings?.toFixed(2) || '0.00'}`}
                </h2>

                <div className='flex items-center gap-4 mt-5 pt-4 border-t border-line'>
                    <div className="flex-1">
                        <p className='text-[11px] text-ink-400 font-medium uppercase'>Tempo Online</p>
                        <p className='text-base font-bold text-ink-900'>{loadingSummary ? '...' : formatOnlineTime(summary?.onlineTimeSeconds)}</p>
                    </div>
                    <div className='w-px h-8 bg-line'></div>
                    <div className="flex-1">
                        <p className='text-[11px] text-ink-400 font-medium uppercase'>Corridas Hoje</p>
                        <p className='text-base font-bold text-ink-900'>{loadingSummary ? '...' : `${summary?.ridesToday || 0}`}</p>
                    </div>
                    <div className='w-px h-8 bg-line'></div>
                    <div className="flex-1">
                        <p className='text-[11px] text-ink-400 font-medium uppercase'>Carteira</p>
                        <p className='text-base font-bold text-blue-600'>{loadingSummary ? '...' : `R$ ${summary?.walletBalance?.toFixed(2) || '0.00'}`}</p>
                    </div>
                </div>
            </Card>

            {/* Ações Rápidas (Atalhos) */}
            <h3 className='text-xs font-bold text-ink-900 mt-2 uppercase tracking-wider px-1'>Ações Rápidas</h3>
            <div className='grid grid-cols-3 gap-3'>
                <button
                    onClick={() => navigate('/captain-wallet')}
                    className='flex flex-col items-center gap-1.5 focus:outline-none hover:opacity-80 transition-opacity'
                >
                    <div className='w-14 h-14 bg-surface border border-line rounded-panel flex items-center justify-center shadow-raised text-brand-600 text-[26px]'>
                        <i className="ri-wallet-3-fill"></i>
                    </div>
                    <span className='text-[10px] font-bold text-ink-600 text-center uppercase tracking-wide'>Carteira</span>
                </button>
                <button
                    onClick={() => navigate('/captain/rides')}
                    className='flex flex-col items-center gap-1.5 focus:outline-none hover:opacity-80 transition-opacity'
                >
                    <div className='w-14 h-14 bg-surface border border-line rounded-panel flex items-center justify-center shadow-raised text-ink-600 text-[26px]'>
                        <i className="ri-history-line"></i>
                    </div>
                    <span className='text-[10px] font-bold text-ink-600 text-center uppercase tracking-wide'>Histórico</span>
                </button>
                <button
                    onClick={() => navigate('/captain/earnings')}
                    className='flex flex-col items-center gap-1.5 focus:outline-none hover:opacity-80 transition-opacity'
                >
                    <div className='w-14 h-14 bg-surface border border-line rounded-panel flex items-center justify-center shadow-raised text-ink-600 text-[26px]'>
                        <i className="ri-bar-chart-fill"></i>
                    </div>
                    <span className='text-[10px] font-bold text-ink-600 text-center uppercase tracking-wide'>Ganhos</span>
                </button>
            </div>
        </div>
    )
}

export default CaptainDetails
