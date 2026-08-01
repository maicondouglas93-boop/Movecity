import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import Header from '@/modules/passenger/components/Header';
import { vehicleImages, vehicleLabels } from '@/assets/vehicleAssets';
import { RideCardSkeleton } from '@/shared/components/ui/Skeleton';
import EmptyState from '@/shared/components/ui/EmptyState';
import StatusBadge from '@/shared/components/ui/StatusBadge';
import Button from '@/shared/components/ui/Button';

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
    const getStatusInfo = (status) => {
        switch (status) {
            case 'finished': return { text: 'Finalizada', tone: 'success' };
            case 'cancelled': return { text: 'Cancelada', tone: 'danger' };
            case 'requested': return { text: 'Buscando motorista', tone: 'warning' };
            case 'accepted':
            case 'going_to_pickup': return { text: 'Motorista a caminho', tone: 'info' };
            case 'arrived':
            case 'waiting_passenger': return { text: 'Motorista chegou', tone: 'info' };
            case 'started': return { text: 'Em andamento', tone: 'info' };
            default: return { text: status, tone: 'neutral' };
        }
    };

    const isInitialLoading = loading && rides.length === 0;

    return (
        <div className="h-screen bg-surface-alt flex flex-col pt-24 pb-6 font-sans">
            <div className="p-5 bg-surface border-b border-line">
                <h2 className="text-2xl font-semibold mb-4 text-ink-900">Suas Viagens</h2>

                <div className="relative mb-4">
                    <i className="ri-search-line absolute left-3 top-3 text-ink-400 text-lg" aria-hidden="true"></i>
                    <input
                        type="text"
                        placeholder="Pesquisar endereço..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full bg-surface-alt text-ink-900 pl-10 pr-4 py-3 rounded-panel outline-none focus:ring-2 focus:ring-brand-500 transition-all border border-line placeholder:text-ink-400"
                    />
                </div>

                <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                    {['all', 'completed', 'ongoing', 'cancelled'].map(filter => {
                        const labels = { all: 'Todas', completed: 'Finalizadas', ongoing: 'Em andamento', cancelled: 'Canceladas' };
                        const isActive = statusFilter === filter
                        return (
                            <button
                                key={filter}
                                type="button"
                                onClick={() => setStatusFilter(filter)}
                                aria-pressed={isActive}
                                className={`whitespace-nowrap px-4 py-1.5 rounded-full text-sm font-semibold transition-colors ${isActive ? 'bg-brand-500 text-white' : 'bg-surface-alt text-ink-600 border border-line'}`}
                            >
                                {labels[filter]}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
                {isInitialLoading && (
                    <div className="flex flex-col gap-3">
                        <RideCardSkeleton />
                        <RideCardSkeleton />
                        <RideCardSkeleton />
                    </div>
                )}

                {rides.length === 0 && !loading && (
                    <EmptyState
                        icon="ri-car-line"
                        title="Nenhuma viagem encontrada"
                        description="Suas próximas corridas vão aparecer aqui."
                    />
                )}

                {!isInitialLoading && (
                    <div className="flex flex-col gap-3">
                        {rides.map(ride => {
                            const statusInfo = getStatusInfo(ride.status);
                            return (
                                <button
                                    key={ride._id}
                                    type="button"
                                    onClick={() => setSelectedRide(ride)}
                                    className="w-full text-left bg-surface p-4 rounded-panel shadow-raised border border-line flex items-center justify-between active:scale-[0.98] transition-transform"
                                >
                                    <div className="flex items-center gap-4 flex-1 overflow-hidden">
                                        <div className="bg-surface-alt h-12 w-12 rounded-panel flex items-center justify-center flex-shrink-0 border border-line">
                                            <img src={vehicleImages[ride.vehicleType || 'car']} className="h-8 object-contain" alt="" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <h4 className="font-semibold text-base truncate text-ink-900">{ride.destination?.split(',')[0]}</h4>
                                            <p className="text-xs text-ink-400">{formatDate(ride.createdAt)}</p>
                                        </div>
                                    </div>
                                    <div className="text-right ml-4 flex flex-col items-end gap-1">
                                        <h4 className="font-semibold text-ink-900">R$ {ride.fare}</h4>
                                        <StatusBadge tone={statusInfo.tone}>{statusInfo.text}</StatusBadge>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}

                {loading && rides.length > 0 && (
                    <div className="text-center my-4">
                        <i className="ri-loader-4-line text-2xl animate-spin inline-block text-ink-400" aria-hidden="true"></i>
                    </div>
                )}

                {hasMore && !loading && rides.length > 0 && (
                    <Button variant="secondary" onClick={loadMore} className="mt-4">
                        Carregar mais
                    </Button>
                )}
            </div>

            {/* Modal Detalhes */}
            {selectedRide && (
                <div className="fixed inset-0 bg-black/50 z-modal flex justify-center items-end animate-fade-in">
                    <div className="bg-surface w-full h-[85vh] rounded-t-3xl flex flex-col shadow-2xl translate-y-0 animate-slide-up">
                        <div className="p-5 border-b border-line flex justify-between items-center relative">
                            <h2 className="text-xl font-semibold text-ink-900">Detalhes da Viagem</h2>
                            <button
                                type="button"
                                onClick={() => setSelectedRide(null)}
                                aria-label="Fechar"
                                className="h-8 w-8 bg-surface-alt rounded-full flex items-center justify-center text-ink-900"
                            >
                                <i className="ri-close-line text-xl" aria-hidden="true"></i>
                            </button>
                        </div>

                        <div className='flex-1 overflow-y-auto p-4 pb-6'>
                            <div className="flex items-center justify-between mb-6">
                                <div>
                                    <h1 className="text-4xl font-bold text-ink-900">R$ {selectedRide.fare}</h1>
                                    <p className="text-ink-400 text-sm mt-1">{formatDate(selectedRide.createdAt)}</p>
                                </div>
                                <img src={vehicleImages[selectedRide.vehicleType || 'car']} className="h-16 object-contain" alt="" />
                            </div>

                            <div className="bg-surface-alt rounded-panel p-4 mb-6">
                                <div className='flex items-start gap-4 mb-4'>
                                    <i className="ri-map-pin-user-fill text-brand-500 text-xl mt-1" aria-hidden="true"></i>
                                    <div>
                                        <h3 className='text-base font-semibold text-ink-900'>{selectedRide.pickup?.split(',')[0]}</h3>
                                        <p className='text-sm text-ink-400'>{selectedRide.pickup}</p>
                                    </div>
                                </div>
                                <div className='flex items-start gap-4'>
                                    <i className="text-xl ri-map-pin-2-fill text-danger-500 mt-1" aria-hidden="true"></i>
                                    <div>
                                        <h3 className='text-base font-semibold text-ink-900'>{selectedRide.destination?.split(',')[0]}</h3>
                                        <p className='text-sm text-ink-400'>{selectedRide.destination}</p>
                                    </div>
                                </div>
                            </div>

                            {selectedRide.captain && (
                                <div className="border border-line rounded-panel p-4 mb-6 flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="h-12 w-12 bg-surface-alt rounded-full overflow-hidden flex items-center justify-center">
                                            <i className="ri-user-fill text-2xl text-ink-400" aria-hidden="true"></i>
                                        </div>
                                        <div>
                                            <h4 className="font-semibold capitalize text-ink-900">{selectedRide.captain.fullname.firstname} {selectedRide.captain.fullname.lastname}</h4>
                                            <p className="text-sm text-ink-400"><i className="ri-star-fill text-amber-400" aria-hidden="true"></i> 4.9</p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <h4 className="font-bold text-lg text-ink-900">{selectedRide.captain.vehicle?.plate}</h4>
                                        <p className="text-xs text-ink-400 capitalize">{selectedRide.captain.vehicle?.color} {selectedRide.captain.vehicle?.vehicleType}</p>
                                    </div>
                                </div>
                            )}

                            <div className="flex flex-col gap-3">
                                <div className="flex justify-between items-center py-2 border-b border-line">
                                    <span className="text-ink-400">Forma de Pagamento</span>
                                    <span className="font-medium text-ink-900 flex items-center gap-2"><i className="ri-money-dollar-circle-line text-brand-500" aria-hidden="true"></i> Dinheiro</span>
                                </div>
                                <div className="flex justify-between items-center py-2 border-b border-line">
                                    <span className="text-ink-400">Status</span>
                                    <span className="font-medium capitalize text-ink-900">{getStatusInfo(selectedRide.status).text}</span>
                                </div>
                            </div>
                        </div>

                        <div className="p-5 border-t border-line bg-surface absolute bottom-0 w-full rounded-b-3xl">
                            <Button onClick={() => handleRepeatRide(selectedRide)}>
                                <i className="ri-refresh-line" aria-hidden="true"></i>
                                Repetir Corrida
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            <Header />
        </div>
    );
}

export default Activity;
