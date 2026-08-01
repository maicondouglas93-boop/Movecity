import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import PageHeader from '@/shared/components/ui/PageHeader';
import EmptyState from '@/shared/components/ui/EmptyState';
import Button from '@/shared/components/ui/Button';

const Scheduled = () => {
    const navigate = useNavigate();
    const [scheduledRides, setScheduledRides] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);

    useEffect(() => {
        const fetchScheduled = async () => {
            try {
                const response = await axios.get(`${import.meta.env.VITE_BASE_URL}/users/scheduled`, {
                    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
                });
                setScheduledRides(response.data.scheduled || []);
            } catch (error) {
                // A rota /users/scheduled ainda não existe no backend.
                setLoadError(true);
            } finally {
                setLoading(false);
            }
        };
        fetchScheduled();
    }, []);

    return (
        <div className="h-screen bg-surface-alt flex flex-col font-sans">
            <PageHeader title="Corridas Agendadas" onBack={() => navigate('/account')} />

            <div className="flex-1 p-5 overflow-y-auto">
                {loading ? (
                    <div className="flex justify-center my-10">
                        <i className="ri-loader-4-line text-2xl animate-spin text-ink-400" aria-hidden="true"></i>
                    </div>
                ) : loadError ? (
                    <EmptyState
                        variant="error"
                        icon="ri-error-warning-line"
                        title="Não foi possível carregar suas corridas agendadas"
                        description="Tente novamente mais tarde."
                    />
                ) : scheduledRides.length > 0 ? (
                    <div className="flex flex-col gap-4">
                        {scheduledRides.map((ride, idx) => (
                            <div key={idx} className="bg-surface rounded-panel p-4 shadow-raised border border-line flex items-center justify-between">
                                <div>
                                    <h4 className="font-semibold text-ink-900">{ride.destination}</h4>
                                    <p className="text-sm text-ink-400 mt-1"><i className="ri-time-line" aria-hidden="true"></i> {ride.time}</p>
                                </div>
                                <button type="button" className="text-danger-500 bg-danger-50 px-3 py-1.5 rounded-lg text-sm font-medium">Cancelar</button>
                            </div>
                        ))}
                    </div>
                ) : (
                    <EmptyState
                        icon="ri-calendar-todo-line"
                        title="Nenhuma corrida agendada"
                        description="Você ainda não agendou nenhuma viagem para o futuro."
                    />
                )}
            </div>

            <div className="p-5 bg-surface border-t border-line pb-10">
                <Button onClick={() => navigate('/home')}>
                    <i className="ri-calendar-check-line text-xl" aria-hidden="true"></i>
                    Agendar nova corrida
                </Button>
            </div>
        </div>
    );
};

export default Scheduled;
