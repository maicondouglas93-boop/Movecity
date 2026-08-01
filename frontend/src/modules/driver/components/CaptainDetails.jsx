import React, { useContext, useState, useEffect } from 'react'
import { CaptainDataContext } from '@/contexts/CaptainContext'
import { SocketContext } from '@/contexts/SocketContext'
import axios from 'axios'
import Avatar from '@/shared/components/Avatar'

const CaptainDetails = () => {

    const { captain } = useContext(CaptainDataContext)
    const { socket } = useContext(SocketContext)
    const [summary, setSummary] = useState(null)
    const [loadingSummary, setLoadingSummary] = useState(true)

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

    const [isOnline, setIsOnline] = useState(captain.isOnline || false);
    const [loadingToggle, setLoadingToggle] = useState(false);

    const toggleOnline = async () => {
        if (captain.approvalStatus !== 'aprovado') {
            alert('Você não pode ficar online até que seu cadastro seja aprovado.');
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
            alert(error.response?.data?.message || 'Erro ao alterar status online');
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
                            <span className="text-[11px] font-bold text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded-md flex items-center gap-1 shadow-sm border border-gray-200">⭐ {summary?.rating || '5.0'}</span>
                        </h4>
                        <p className='text-xs text-gray-500 font-medium capitalize'>{captain?.vehicle?.color} {captain?.vehicle?.vehicleType} • {captain?.vehicle?.plate}</p>
                    </div>
                </div>
            </div>

            {/* Smart Card & Status Toggle */}
            <div className={`p-4 rounded-xl flex items-center justify-between ${isOnline ? 'bg-green-600 text-white shadow-green-200' : 'bg-gray-800 text-white shadow-gray-200'} shadow-lg transition-all duration-300`}>
                <div>
                    <h3 className="font-bold text-lg flex items-center gap-2">
                        {isOnline ? (
                            <><div className="w-2.5 h-2.5 bg-green-300 rounded-full animate-pulse"></div> Procurando corridas...</>
                        ) : (
                            <><div className="w-2.5 h-2.5 bg-gray-400 rounded-full"></div> Offline</>
                        )}
                    </h3>
                    <p className="text-[13px] opacity-90 mt-1 font-medium">
                        {isOnline ? 'Tempo médio de espera: 3 min' : 'Fique online para receber corridas'}
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

            {/* Ganhos Hoje Massivo */}
            <div className='bg-white border border-gray-200 p-5 rounded-2xl shadow-sm'>
                <p className='text-xs text-gray-500 font-bold uppercase tracking-wider mb-1 flex justify-between items-center'>
                    <span>💰 Ganhos Hoje</span>
                    <span className="text-green-600 bg-green-50 px-2 py-0.5 rounded text-[10px]">+12% vs Ontem</span>
                </p>
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

            {/* Metas */}
            <div className='bg-blue-50 border border-blue-100 p-4 rounded-xl shadow-sm'>
                <div className='flex justify-between items-end mb-2'>
                    <div>
                        <p className='text-xs text-blue-600 font-black uppercase tracking-wider mb-1'>🎯 Meta do dia</p>
                        <p className='text-sm font-semibold text-gray-800'>Ganhe bônus de R$ 30,00</p>
                    </div>
                    <p className='text-sm font-bold text-blue-700 bg-blue-100 px-2 py-1 rounded'>{summary?.ridesToday || 0}/10 corridas</p>
                </div>
                <div className='w-full bg-blue-200/60 rounded-full h-3 mt-3 overflow-hidden shadow-inner'>
                    <div className='bg-blue-600 h-3 rounded-full transition-all duration-1000 ease-out relative' style={{ width: `${Math.min(((summary?.ridesToday || 0) / 10) * 100, 100)}%` }}>
                        <div className="absolute inset-0 bg-white/20"></div>
                    </div>
                </div>
            </div>

            {/* Ações Rápidas (Atalhos) */}
            <h3 className='text-xs font-bold text-gray-800 mt-2 uppercase tracking-wider px-1'>Ações Rápidas</h3>
            <div className='grid grid-cols-4 gap-3'>
                <button className='flex flex-col items-center gap-1.5 focus:outline-none hover:opacity-80 transition-opacity'>
                    <div className='w-14 h-14 bg-white border border-gray-200 rounded-2xl flex items-center justify-center shadow-sm text-green-600 text-[26px]'>
                        <i className="ri-wallet-3-fill"></i>
                    </div>
                    <span className='text-[10px] font-bold text-gray-700 text-center uppercase tracking-wide'>Carteira</span>
                </button>
                <button className='flex flex-col items-center gap-1.5 focus:outline-none hover:opacity-80 transition-opacity'>
                    <div className='w-14 h-14 bg-white border border-gray-200 rounded-2xl flex items-center justify-center shadow-sm text-gray-700 text-[26px]'>
                        <i className="ri-history-line"></i>
                    </div>
                    <span className='text-[10px] font-bold text-gray-700 text-center uppercase tracking-wide'>Histórico</span>
                </button>
                <button className='flex flex-col items-center gap-1.5 focus:outline-none hover:opacity-80 transition-opacity'>
                    <div className='w-14 h-14 bg-white border border-gray-200 rounded-2xl flex items-center justify-center shadow-sm text-gray-700 text-[26px]'>
                        <i className="ri-road-map-fill"></i>
                    </div>
                    <span className='text-[10px] font-bold text-gray-700 text-center uppercase tracking-wide'>Corridas</span>
                </button>
                <button className='flex flex-col items-center gap-1.5 focus:outline-none hover:opacity-80 transition-opacity'>
                    <div className='w-14 h-14 bg-white border border-gray-200 rounded-2xl flex items-center justify-center shadow-sm text-gray-700 text-[26px]'>
                        <i className="ri-customer-service-2-fill"></i>
                    </div>
                    <span className='text-[10px] font-bold text-gray-700 text-center uppercase tracking-wide'>Suporte</span>
                </button>
            </div>
            
            {/* Espaço reservado para futuras funcionalidades */}
            <div className="mt-6 opacity-60 mb-6">
                 <h3 className='text-[10px] font-bold text-gray-500 mb-3 uppercase tracking-wider px-1'>Em Breve</h3>
                 <div className="flex gap-3 overflow-x-auto pb-2 hide-scrollbar">
                     <div className="min-w-[120px] h-20 bg-gray-100 border border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center text-gray-500 gap-1">
                         <i className="ri-box-3-line text-lg"></i>
                         <span className="text-[10px] font-bold uppercase tracking-wide">Encomendas</span>
                     </div>
                     <div className="min-w-[120px] h-20 bg-gray-100 border border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center text-gray-500 gap-1">
                         <i className="ri-vip-diamond-line text-lg"></i>
                         <span className="text-[10px] font-bold uppercase tracking-wide">Missões</span>
                     </div>
                     <div className="min-w-[120px] h-20 bg-gray-100 border border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center text-gray-500 gap-1">
                         <i className="ri-calendar-event-line text-lg"></i>
                         <span className="text-[10px] font-bold uppercase tracking-wide">Agendamentos</span>
                     </div>
                 </div>
            </div>
        </div>
    )
}

export default CaptainDetails