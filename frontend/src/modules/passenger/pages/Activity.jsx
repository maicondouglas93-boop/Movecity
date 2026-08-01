import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import Header from '@/modules/passenger/components/Header';
import { vehicleImages, vehicleLabels } from '@/assets/vehicleAssets';

const Activity = () => {
    const [rides, setRides] = useState([]);
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [statusFilter, setStatusFilter] = useState('all'); // all, completed, cancelled, ongoing
    const [search, setSearch] = useState('');
    const [selectedRide, setSelectedRide] = useState(null);
    const navigate = useNavigate();

    const fetchHistory = async (pageNum, status, searchQuery, append = false) => {
        if (loading) return;
        setLoading(true);
        try {
            const response = await axios.get(`${import.meta.env.VITE_BASE_URL}/rides/history`, {
                params: {
                    page: pageNum,
                    limit: 10,
                    status: status,
                    search: searchQuery
                },
                headers: {
                    Authorization: `Bearer ${localStorage.getItem('token')}`
                }
            });

            if (append) {
                setRides(prev => [...prev, ...response.data.rides]);
            } else {
                setRides(response.data.rides);
            }
            setHasMore(response.data.hasNext);
        } catch (error) {
            console.error("Error fetching history", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        setPage(1);
        fetchHistory(1, statusFilter, search, false);
    }, [statusFilter]);

    // Handle search debounce
    useEffect(() => {
        const timeoutId = setTimeout(() => {
            setPage(1);
            fetchHistory(1, statusFilter, search, false);
        }, 500);
        return () => clearTimeout(timeoutId);
    }, [search]);

    const loadMore = () => {
        if (hasMore && !loading) {
            const nextPage = page + 1;
            setPage(nextPage);
            fetchHistory(nextPage, statusFilter, search, true);
        }
    };

    const handleRepeatRide = (ride) => {
        navigate('/home', { state: { pickup: ride.pickup, destination: ride.destination } });
    };

    const formatDate = (dateString) => {
        const date = new Date(dateString);
        return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    };

    // Valores reais de ride.status (Backend/models/ride.model.js) — 'completed'/'ongoing'/
    // 'pending' nunca existiram no enum, por isso corridas finalizadas sempre caíam no
    // default e mostravam a string crua "finished" em vez de um rótulo amigável.
    const getStatusText = (status) => {
        switch (status) {
            case 'finished': return { text: 'Finalizada', color: 'text-green-600', bg: 'bg-green-100' };
            case 'cancelled': return { text: 'Cancelada', color: 'text-red-600', bg: 'bg-red-100' };
            case 'requested': return { text: 'Buscando motorista', color: 'text-yellow-600', bg: 'bg-yellow-100' };
            case 'accepted':
            case 'going_to_pickup': return { text: 'Motorista a caminho', color: 'text-blue-600', bg: 'bg-blue-100' };
            case 'arrived':
            case 'waiting_passenger': return { text: 'Motorista chegou', color: 'text-blue-600', bg: 'bg-blue-100' };
            case 'started': return { text: 'Em andamento', color: 'text-blue-600', bg: 'bg-blue-100' };
            default: return { text: status, color: 'text-gray-600', bg: 'bg-gray-100' };
        }
    };

    return (
        <div className="h-screen bg-gray-50 flex flex-col pt-24 pb-6 font-sans">
            <div className="p-5 bg-white border-b border-gray-200">
                <h2 className="text-2xl font-semibold mb-4 text-gray-800">Suas Viagens</h2>
                
                <div className="relative mb-4">
                    <i className="ri-search-line absolute left-3 top-3 text-gray-400 text-lg"></i>
                    <input 
                        type="text" 
                        placeholder="Pesquisar endereço..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full bg-gray-50 text-gray-800 pl-10 pr-4 py-3 rounded-xl outline-none focus:ring-2 focus:ring-green-500 transition-all border border-gray-200 placeholder:text-gray-400"
                    />
                </div>

                <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                    {['all', 'completed', 'ongoing', 'cancelled'].map(filter => {
                        const labels = { all: 'Todas', completed: 'Finalizadas', ongoing: 'Em andamento', cancelled: 'Canceladas' };
                        return (
                            <button 
                                key={filter}
                                onClick={() => setStatusFilter(filter)}
                                className={`whitespace-nowrap px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${statusFilter === filter ? 'bg-green-500 text-white' : 'bg-gray-100 text-gray-600 border border-gray-200'}`}
                            >
                                {labels[filter]}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
                {rides.length === 0 && !loading && (
                    <div className="text-center text-gray-500 mt-10">
                        <i className="ri-car-line text-4xl mb-2 block"></i>
                        <p>Nenhuma viagem encontrada.</p>
                    </div>
                )}
                
                <div className="flex flex-col gap-3">
                    {rides.map(ride => {
                        const statusInfo = getStatusText(ride.status);
                        return (
                            <div 
                                key={ride._id} 
                                onClick={() => setSelectedRide(ride)}
                                className="bg-white p-4 rounded-2xl shadow-sm border border-gray-200 flex items-center justify-between cursor-pointer active:scale-[0.98] transition-transform"
                            >
                                <div className="flex items-center gap-4 flex-1 overflow-hidden">
                                    <div className="bg-gray-50 h-12 w-12 rounded-xl flex items-center justify-center flex-shrink-0 border border-gray-100">
                                        <img src={vehicleImages[ride.vehicleType || 'car']} className="h-8 object-contain" alt="" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h4 className="font-semibold text-base truncate text-gray-800">{ride.destination?.split(',')[0]}</h4>
                                        <p className="text-xs text-gray-500">{formatDate(ride.createdAt)}</p>
                                    </div>
                                </div>
                                <div className="text-right ml-4">
                                    <h4 className="font-semibold text-green-600">R$ {ride.fare}</h4>
                                    <p className={`text-[10px] font-medium px-2 py-0.5 rounded-md inline-block mt-1 ${statusInfo.bg} ${statusInfo.color}`}>
                                        {statusInfo.text}
                                    </p>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {loading && (
                    <div className="text-center my-4">
                        <i className="ri-loader-4-line text-2xl animate-spin inline-block text-gray-400"></i>
                    </div>
                )}

                {hasMore && !loading && rides.length > 0 && (
                    <button onClick={loadMore} className="w-full py-3 mt-4 text-black font-semibold bg-gray-200 rounded-xl">
                        Carregar mais
                    </button>
                )}
            </div>

            {/* Modal Detalhes */}
            {selectedRide && (
                <div className="fixed inset-0 bg-black/50 z-[70] flex justify-center items-end animate-fade-in">
                    <div className="bg-white w-full h-[85vh] rounded-t-3xl flex flex-col shadow-2xl translate-y-0 animate-slide-up">
                        <div className="p-5 border-b border-gray-100 flex justify-between items-center relative">
                            <h2 className="text-xl font-semibold">Detalhes da Viagem</h2>
                            <button onClick={() => setSelectedRide(null)} className="h-8 w-8 bg-gray-100 rounded-full flex items-center justify-center">
                                <i className="ri-close-line text-xl"></i>
                            </button>
                        </div>
                        
                        <div className='flex-1 overflow-y-auto p-4 pb-6'>
                            <div className="flex items-center justify-between mb-6">
                                <div>
                                    <h1 className="text-4xl font-bold">R$ {selectedRide.fare}</h1>
                                    <p className="text-gray-500 text-sm mt-1">{formatDate(selectedRide.createdAt)}</p>
                                </div>
                                <img src={vehicleImages[selectedRide.vehicleType || 'car']} className="h-16 object-contain" alt="" />
                            </div>

                            <div className="bg-gray-50 rounded-2xl p-4 mb-6">
                                <div className='flex items-start gap-4 mb-4'>
                                    <i className="ri-map-pin-user-fill text-green-600 text-xl mt-1"></i>
                                    <div>
                                        <h3 className='text-base font-semibold'>{selectedRide.pickup?.split(',')[0]}</h3>
                                        <p className='text-sm text-gray-600'>{selectedRide.pickup}</p>
                                    </div>
                                </div>
                                <div className='flex items-start gap-4'>
                                    <i className="text-xl ri-map-pin-2-fill text-red-500 mt-1"></i>
                                    <div>
                                        <h3 className='text-base font-semibold'>{selectedRide.destination?.split(',')[0]}</h3>
                                        <p className='text-sm text-gray-600'>{selectedRide.destination}</p>
                                    </div>
                                </div>
                            </div>

                            {selectedRide.captain && (
                                <div className="border border-gray-100 rounded-2xl p-4 mb-6 flex items-center justify-between shadow-sm">
                                    <div className="flex items-center gap-3">
                                        <div className="h-12 w-12 bg-gray-200 rounded-full overflow-hidden flex items-center justify-center">
                                            <i className="ri-user-fill text-2xl text-gray-400"></i>
                                        </div>
                                        <div>
                                            <h4 className="font-semibold capitalize">{selectedRide.captain.fullname.firstname} {selectedRide.captain.fullname.lastname}</h4>
                                            <p className="text-sm text-gray-500"><i className="ri-star-fill text-yellow-500"></i> 4.9</p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <h4 className="font-bold text-lg">{selectedRide.captain.vehicle?.plate}</h4>
                                        <p className="text-xs text-gray-500 capitalize">{selectedRide.captain.vehicle?.color} {selectedRide.captain.vehicle?.vehicleType}</p>
                                    </div>
                                </div>
                            )}

                            <div className="flex flex-col gap-3">
                                <div className="flex justify-between items-center py-2 border-b border-gray-50">
                                    <span className="text-gray-500">Forma de Pagamento</span>
                                    <span className="font-medium flex items-center gap-2"><i className="ri-money-dollar-circle-line text-green-600"></i> Dinheiro</span>
                                </div>
                                <div className="flex justify-between items-center py-2 border-b border-gray-50">
                                    <span className="text-gray-500">Status</span>
                                    <span className="font-medium capitalize">{getStatusText(selectedRide.status).text}</span>
                                </div>
                            </div>
                        </div>

                        <div className="p-5 border-t border-gray-100 bg-white absolute bottom-0 w-full rounded-b-3xl">
                            <button 
                                onClick={() => handleRepeatRide(selectedRide)}
                                className="w-full bg-green-500 hover:bg-green-600 text-white font-bold py-4 rounded-xl text-lg flex items-center justify-center gap-2 transition-colors shadow-lg shadow-green-500/20"
                            >
                                <i className="ri-refresh-line"></i>
                                Repetir Corrida
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <Header />
        </div>
    );
}

export default Activity;
