import React, { useContext, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { CaptainDataContext } from '@/contexts/CaptainContext'
import { SocketContext } from '@/contexts/SocketContext'
import { LocationContext } from '@/contexts/LocationContext'
import { useToast } from '@/contexts/ToastContext'
import axios from 'axios'
import Avatar from '@/shared/components/Avatar'

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
                        <h4 className='text-lg font-bold capitalize flex items-center gap-2 text-gray-800'>
                            {captain?.fullname?.firstname} {captain?.fullname?.lastname}
                            <span className="text-[11px] font-bold text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded-md flex items-center gap-1 shadow-sm border border-gray-200">
                                ⭐ {summary?.rating?.toFixed(1) || '5.0'}
                            </span>
                        </h4>
                        <p className='text-xs text-gray-500 font-medium capitalize'>{captain?.vehicle?.color} {captain?.vehicle?.vehicleType} • {captain?.vehicle?.plate}</p>
                    </div>
                </div>
            </div>

            {/* Auditoria de UX do motorista (2026-08-02, §2.5): sem isto, um motorista
                online sem GPS via "Procurando corridas..." pulsando em verde — uma
                afirmação falsa, já que sem localização ele nem aparece no despacho. */}
            {isOnline && locationError && (
                <div className='flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-xs font-semibold px-3 py-2 rounded-lg'>
                    <i className="ri-map-pin-off-line text-base"></i>
                    Sem sinal de GPS — você pode não estar recebendo corridas.
                </div>
            )}

            {/* Smart Card & Status Toggle */}
            <div className={`p-4 rounded-xl flex items-center justify-between ${isOnline ? 'bg-green-600 text-white shadow-green-200' : 'bg-gray-800 text-white shadow-gray-200'} shadow-lg transition-all duration-300`}>
                <div>
                    <h3 className="font-bold text-lg flex items-center gap-2">
                        {isOnline && locationError ? (
                            <><div className="w-2.5 h-2.5 bg-red-400 rounded-full"></div> Online, sem GPS</>
                        ) : isOnline ? (
                            <><div className="w-2.5 h-2.5 bg-green-300 rounded-full animate-pulse"></div> Procurando corridas...</>
                        ) : (
                            <><div className="w-2.5 h-2.5 bg-gray-400 rounded-full"></div> Offline</>
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
                    className={`px-5 py-3 rounded-full font-bold text-sm transition-all shadow-md active:scale-95 ${
                        isOnline
                        ? 'bg-white text-green-700 hover:bg-green-50'
                        : 'bg-green-500 text-white hover:bg-green-400'
                    } ${(loadingToggle || captain.approvalStatus !== 'aprovado') && 'opacity-70 cursor-not-allowed'}`}
                >
                    {isOnline ? 'Ficar Offline' : 'Ficar Online'}
                </button>
            </div>

            {/* Ganhos Hoje */}
            <div className='bg-white border border-gray-200 p-5 rounded-2xl shadow-sm'>
                <p className='text-xs text-gray-500 font-bold uppercase tracking-wider mb-1'>💰 Ganhos Hoje</p>
                <h2 className='text-4xl font-black text-gray-900 tracking-tight mt-1'>
                    {loadingSummary ? '...' : `R$ ${summary?.earnings?.toFixed(2) || '0.00'}`}
                </h2>

                <div className='flex items-center gap-4 mt-5 pt-4 border-t border-gray-100'>
                    <div className="flex-1">
                        <p className='text-[11px] text-gray-400 font-medium uppercase'>Tempo Online</p>
                        <p className='text-base font-bold text-gray-800'>{loadingSummary ? '...' : formatOnlineTime(summary?.onlineTimeSeconds)}</p>
                    </div>
                    <div className='w-px h-8 bg-gray-200'></div>
                    <div className="flex-1">
                        <p className='text-[11px] text-gray-400 font-medium uppercase'>Corridas Hoje</p>
                        <p className='text-base font-bold text-gray-800'>{loadingSummary ? '...' : `${summary?.ridesToday || 0}`}</p>
                    </div>
                    <div className='w-px h-8 bg-gray-200'></div>
                    <div className="flex-1">
                        <p className='text-[11px] text-gray-400 font-medium uppercase'>Carteira</p>
                        <p className='text-base font-bold text-blue-600'>{loadingSummary ? '...' : `R$ ${summary?.walletBalance?.toFixed(2) || '0.00'}`}</p>
                    </div>
                </div>
            </div>

            {/* Ações Rápidas (Atalhos) */}
            <h3 className='text-xs font-bold text-gray-800 mt-2 uppercase tracking-wider px-1'>Ações Rápidas</h3>
            <div className='grid grid-cols-3 gap-3'>
                <button
                    onClick={() => navigate('/captain-wallet')}
                    className='flex flex-col items-center gap-1.5 focus:outline-none hover:opacity-80 transition-opacity'
                >
                    <div className='w-14 h-14 bg-white border border-gray-200 rounded-2xl flex items-center justify-center shadow-sm text-green-600 text-[26px]'>
                        <i className="ri-wallet-3-fill"></i>
                    </div>
                    <span className='text-[10px] font-bold text-gray-700 text-center uppercase tracking-wide'>Carteira</span>
                </button>
                <button
                    onClick={() => navigate('/captain/rides')}
                    className='flex flex-col items-center gap-1.5 focus:outline-none hover:opacity-80 transition-opacity'
                >
                    <div className='w-14 h-14 bg-white border border-gray-200 rounded-2xl flex items-center justify-center shadow-sm text-gray-700 text-[26px]'>
                        <i className="ri-history-line"></i>
                    </div>
                    <span className='text-[10px] font-bold text-gray-700 text-center uppercase tracking-wide'>Histórico</span>
                </button>
                <button
                    onClick={() => navigate('/captain/earnings')}
                    className='flex flex-col items-center gap-1.5 focus:outline-none hover:opacity-80 transition-opacity'
                >
                    <div className='w-14 h-14 bg-white border border-gray-200 rounded-2xl flex items-center justify-center shadow-sm text-gray-700 text-[26px]'>
                        <i className="ri-bar-chart-fill"></i>
                    </div>
                    <span className='text-[10px] font-bold text-gray-700 text-center uppercase tracking-wide'>Ganhos</span>
                </button>
            </div>
        </div>
    )
}

export default CaptainDetails
