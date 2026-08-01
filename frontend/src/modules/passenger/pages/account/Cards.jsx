import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

const Cards = () => {
    const navigate = useNavigate();
    const [cards, setCards] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);

    useEffect(() => {
        const fetchCards = async () => {
            try {
                const response = await axios.get(`${import.meta.env.VITE_BASE_URL}/users/cards`, {
                    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
                });
                setCards(response.data.cards || []);
            } catch (error) {
                // A rota /users/cards ainda não existe no backend.
                setLoadError(true);
            } finally {
                setLoading(false);
            }
        };
        fetchCards();
    }, []);

    return (
        <div className="h-screen bg-gray-50 flex flex-col font-sans">
            <div className="flex items-center gap-4 p-5 bg-white border-b border-gray-100 sticky top-0 z-10">
                <i onClick={() => navigate('/account')} className="ri-arrow-left-line text-2xl cursor-pointer active:scale-95 transition-transform"></i>
                <h2 className="text-xl font-semibold">Meus Cartões</h2>
            </div>

            <div className="flex-1 p-5 overflow-y-auto">
                {loading ? (
                    <div className="flex justify-center my-10">
                        <i className="ri-loader-4-line text-2xl animate-spin text-gray-400"></i>
                    </div>
                ) : loadError ? (
                    <div className="text-center py-16 flex flex-col items-center">
                        <i className="ri-error-warning-line text-5xl text-red-300 mb-4"></i>
                        <h4 className="text-gray-800 font-semibold text-lg mb-1">Não foi possível carregar seus cartões</h4>
                        <p className="text-sm text-gray-500 max-w-[250px]">Tente novamente mais tarde.</p>
                    </div>
                ) : cards.length > 0 ? (
                    <div className="flex flex-col gap-4">
                        {cards.map((card, idx) => (
                            <div key={idx} className="bg-gray-800 text-white rounded-2xl p-5 shadow-lg relative overflow-hidden">
                                <div className="absolute -right-10 -top-10 w-32 h-32 bg-white opacity-10 rounded-full blur-2xl"></div>
                                <div className="flex justify-between items-center mb-6">
                                    <i className="ri-mastercard-fill text-3xl"></i>
                                    <span className="text-xs tracking-widest opacity-80">CRÉDITO</span>
                                </div>
                                <h3 className="text-xl font-mono tracking-[0.2em] mb-2">**** **** **** {card.last4}</h3>
                                <div className="flex justify-between items-end mt-4 opacity-80 text-sm">
                                    <span>Vencimento: {card.expiry}</span>
                                    <i className="ri-delete-bin-line text-lg cursor-pointer hover:text-red-400"></i>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-16 flex flex-col items-center">
                        <div className="h-24 w-24 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                            <i className="ri-bank-card-line text-5xl text-gray-300"></i>
                        </div>
                        <h4 className="text-gray-800 font-semibold text-lg mb-1">Nenhum cartão salvo</h4>
                        <p className="text-sm text-gray-500 max-w-[250px] mb-8">Adicione um cartão de crédito ou débito para facilitar seus pagamentos nas viagens.</p>
                        
                    </div>
                )}
            </div>

            <div className="p-5 bg-white border-t border-gray-100 pb-10">
                <button className="w-full bg-black text-white py-4 rounded-xl font-semibold text-lg flex justify-center items-center gap-2 shadow-md active:bg-gray-800 transition-colors">
                    <i className="ri-add-line text-xl"></i>
                    Adicionar Novo Cartão
                </button>
            </div>
        </div>
    );
};

export default Cards;
