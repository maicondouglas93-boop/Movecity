import React, { useState } from 'react';

const ScheduleRidePanel = ({ schedulePanelOpen, setSchedulePanelOpen }) => {
    const [selectedDate, setSelectedDate] = useState('');

    const handleConfirm = () => {
        if (!selectedDate) {
            alert('Por favor, escolha uma data e horário.');
            return;
        }
        // Em um app real, isso salvaria o agendamento na API
        alert(`Corrida agendada para: ${new Date(selectedDate).toLocaleString()}`);
        setSchedulePanelOpen(false);
    };

    return (
        <div className={`fixed w-full z-[70] bottom-0 bg-white px-5 py-6 pt-5 rounded-t-3xl shadow-[0_-10px_20px_rgba(0,0,0,0.15)] transition-transform duration-300 ${schedulePanelOpen ? 'translate-y-0' : 'translate-y-full'}`}>
            <div className="flex items-center gap-4 mb-6">
                <i 
                    onClick={() => setSchedulePanelOpen(false)} 
                    className="ri-arrow-left-line text-2xl cursor-pointer active:scale-95 transition-transform"
                ></i>
                <h2 className="text-xl font-semibold text-gray-800">Agendar viagem</h2>
            </div>

            <div className="text-center mb-8">
                <h3 className="text-lg font-medium text-gray-800 mb-2">Escolha o dia e horário</h3>
                {selectedDate && (
                    <p className="text-sm font-semibold text-gray-600 bg-gray-50 inline-block px-4 py-2 rounded-xl">
                        {new Date(selectedDate).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </p>
                )}
            </div>

            <div className="flex justify-center mb-8 relative">
                <input 
                    type="datetime-local" 
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="bg-gray-100 text-gray-800 font-semibold text-lg px-6 py-4 rounded-2xl outline-none focus:ring-2 focus:ring-black w-full max-w-sm text-center"
                />
                {/* Ícone sobreposto para indicar que é um input nativo */}
                <i className="ri-calendar-event-fill absolute right-8 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none text-2xl"></i>
            </div>

            <p className="text-center text-sm text-gray-500 mb-8 max-w-[280px] mx-auto leading-relaxed">
                O agendamento deve ser feito com no mínimo 5 minutos de antecedência
            </p>

            <button 
                onClick={handleConfirm}
                className="w-full bg-black text-white py-4 rounded-xl text-lg font-semibold active:scale-[0.98] transition-transform shadow-md"
            >
                Confirmar
            </button>
        </div>
    );
};

export default ScheduleRidePanel;
