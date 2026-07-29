import React, { useContext, useState, useEffect } from 'react'
import { CaptainDataContext } from '../context/CapatainContext'
import { SocketContext } from '../context/SocketContext'
import axios from 'axios'

const CaptainDetails = () => {

    const { captain } = useContext(CaptainDataContext)
    const { socket } = useContext(SocketContext)
    const [onlineTime, setOnlineTime] = useState(0) // minutes online this session
    const [summary, setSummary] = useState(null)
    const [loadingSummary, setLoadingSummary] = useState(true)

    const fetchSummary = async () => {
        try {
            const token = localStorage.getItem('captain-token');
            const response = await axios.get(`${import.meta.env.VITE_BASE_URL}/captains/summary`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setSummary(response.data);
            
            // Extract the simple "05:32" string into actual minutes if needed, or just display
            if (response.data.onlineTime) {
                // simple mock parsing
                setOnlineTime(response.data.onlineTime); 
            }
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

    return (
        <div>
            <div className='flex items-center justify-between'>
                <div className='flex items-center justify-start gap-3'>
                    <img className='h-12 w-12 rounded-full object-cover border-2 border-yellow-400' src="https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcRdlMd7stpWUCmjpfRjUsQ72xSWikidbgaI1w&s" alt="" />
                    <div>
                        <h4 className='text-lg font-semibold capitalize'>{captain?.fullname?.firstname} {captain?.fullname?.lastname}</h4>
                        <p className='text-xs text-gray-500 capitalize'>{captain?.vehicle?.color} {captain?.vehicle?.vehicleType} · {captain?.vehicle?.plate}</p>
                    </div>
                </div>
                <div className='text-right'>
                    <button 
                        onClick={toggleOnline}
                        disabled={loadingToggle || captain.approvalStatus !== 'aprovado'}
                        title={captain.approvalStatus !== 'aprovado' ? 'Aprovação pendente' : ''}
                        className={`flex items-center gap-2 px-4 py-2 rounded-full font-medium transition-colors ${
                            captain.approvalStatus !== 'aprovado'
                            ? 'bg-gray-100 text-gray-500 cursor-not-allowed opacity-60'
                            : isOnline 
                            ? 'bg-green-100 text-green-700 hover:bg-green-200' 
                            : 'bg-red-100 text-red-700 hover:bg-red-200'
                        }`}
                    >
                        <div className={`h-2 w-2 rounded-full ${captain.approvalStatus !== 'aprovado' ? 'bg-gray-400' : isOnline ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></div>
                        <span className='text-sm'>{captain.approvalStatus !== 'aprovado' ? 'Pendente' : isOnline ? 'Online' : 'Offline'}</span>
                    </button>
                </div>
            </div>
            {/* Quick Metrics */}
            <div className='flex p-4 mt-6 bg-gray-100 rounded-xl justify-center gap-4 items-start shadow-sm'>
                <div className='text-center w-1/3'>
                    <i className="text-3xl mb-1 ri-timer-2-line text-blue-500"></i>
                    <h5 className='text-lg font-semibold'>{loadingSummary ? '...' : (summary?.onlineTime || '00:00')}</h5>
                    <p className='text-[11px] text-gray-500 font-medium uppercase'>Online Hoje</p>
                </div>
                <div className='text-center w-1/3 border-l border-r border-gray-300'>
                    <i className="text-3xl mb-1 ri-wallet-3-line text-orange-500"></i>
                    <h5 className='text-lg font-semibold'>{loadingSummary ? '...' : `R$ ${summary?.earnings?.toFixed(2) || '0.00'}`}</h5>
                    <p className='text-[11px] text-gray-500 font-medium uppercase'>Ganhos</p>
                </div>
                <div className='text-center w-1/3'>
                    <i className="text-3xl mb-1 ri-route-line text-green-500"></i>
                    <h5 className='text-lg font-semibold'>{loadingSummary ? '...' : (summary?.ridesToday || 0)}</h5>
                    <p className='text-[11px] text-gray-500 font-medium uppercase'>Corridas</p>
                </div>
            </div>

            {/* Detailed Dashboard Metrics */}
            <div className='mt-6 bg-white border border-gray-200 rounded-xl p-4 shadow-sm'>
                <h3 className='text-sm font-semibold text-gray-800 mb-3 uppercase tracking-wider'>Resumo do Dia</h3>
                <div className='grid grid-cols-2 gap-4'>
                    <div className='bg-gray-50 p-3 rounded-lg'>
                        <p className='text-xs text-gray-500 mb-1'>Saldo de Créditos</p>
                        <h4 className='text-lg font-bold text-gray-800'>{loadingSummary ? '...' : `R$ ${summary?.walletBalance?.toFixed(2) || '0.00'}`}</h4>
                    </div>
                    <div className='bg-gray-50 p-3 rounded-lg'>
                        <p className='text-xs text-gray-500 mb-1'>Comissões Pagas</p>
                        <h4 className='text-lg font-bold text-red-500'>{loadingSummary ? '...' : `R$ ${summary?.commissions?.toFixed(2) || '0.00'}`}</h4>
                    </div>
                    <div className='bg-gray-50 p-3 rounded-lg flex items-center justify-between'>
                        <div>
                            <p className='text-xs text-gray-500 mb-1'>Avaliação</p>
                            <h4 className='text-lg font-bold text-gray-800 flex items-center gap-1'>
                                {loadingSummary ? '...' : (summary?.rating || '5.0')} <i className="ri-star-fill text-yellow-500 text-sm"></i>
                            </h4>
                        </div>
                    </div>
                    <div className='bg-gray-50 p-3 rounded-lg'>
                        <p className='text-xs text-gray-500 mb-1'>Cancelamentos</p>
                        <h4 className='text-lg font-bold text-gray-800'>{loadingSummary ? '...' : (summary?.cancelledRides || 0)}</h4>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default CaptainDetails