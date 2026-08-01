import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

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
        <div className="h-screen bg-gray-50 flex flex-col font-sans">
            <div className="flex items-center gap-4 p-5 bg-white border-b border-gray-100 sticky top-0 z-10">
                <i onClick={() => navigate('/account')} className="ri-arrow-left-line text-2xl cursor-pointer active:scale-95 transition-transform"></i>
                <h2 className="text-xl font-semibold">Corridas Agendadas</h2>
            </div>

            <div className="flex-1 p-5 overflow-y-auto">
                {loading ? (
                    <div className="flex justify-center my-10">
                        <i className="ri-loader-4-line text-2xl animate-spin text-gray-400"></i>
                    </div>
                ) : loadError ? (
                    <div className="text-center py-16 flex flex-col items-center">
                        <i className="ri-error-warning-line text-5xl text-red-300 mb-4"></i>
                        <h4 className="text-gray-800 font-semibold text-lg mb-1">Não foi possível carregar suas corridas agendadas</h4>
                        <p className="text-sm text-gray-500 max-w-[250px]">Tente novamente mais tarde.</p>
                    </div>
                ) : scheduledRides.length > 0 ? (
                    <div className="flex flex-col gap-4">
                        {scheduledRides.map((ride, idx) => (
                            <div key={idx} className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 flex items-center justify-between">
                                <div>
                                    <h4 className="font-semibold text-gray-800">{ride.destination}</h4>
                                    <p className="text-sm text-gray-500 mt-1"><i className="ri-time-line"></i> {ride.time}</p>
                                </div>
                                <button className="text-red-500 bg-red-50 px-3 py-1.5 rounded-lg text-sm font-medium">Cancelar</button>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-16 flex flex-col items-center">
                        <div className="h-24 w-24 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                            <i className="ri-calendar-todo-line text-5xl text-gray-300"></i>
                        </div>
                        <h4 className="text-gray-800 font-semibold text-lg mb-1">Nenhuma corrida agendada</h4>
                        <p className="text-sm text-gray-500 max-w-[250px]">Você ainda não agendou nenhuma viagem para o futuro.</p>
                    </div>
                )}
            </div>

            <div className="p-5 bg-white border-t border-gray-100 pb-10">
                <button 
                    onClick={() => navigate('/home')}
                    className="w-full bg-black text-white py-4 rounded-xl font-semibold text-lg flex justify-center items-center gap-2 shadow-md active:bg-gray-800 transition-colors"
                >
                    <i className="ri-calendar-check-line text-xl"></i>
                    Agendar nova corrida
                </button>
            </div>
        </div>
    );
};

export default Scheduled;
