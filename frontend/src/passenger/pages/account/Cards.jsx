import React, { useState, useEffect } from 'react';
import { getAccessToken } from '@/shared/services/session';
import { useNavigate } from 'react-router-dom';
import api from '@/shared/services/axios';
import PageHeader from '@/shared/components/ui/PageHeader';
import EmptyState from '@/shared/components/ui/EmptyState';
import Button from '@/shared/components/ui/Button';

const Cards = () => {
    const navigate = useNavigate();
    const [cards, setCards] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);

    useEffect(() => {
        const fetchCards = async () => {
            try {
                const response = await api.get(`${import.meta.env.VITE_BASE_URL}/users/cards`, {
                    headers: { Authorization: `Bearer ${getAccessToken('user')}` }
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
        <div className="h-screen bg-surface-alt flex flex-col font-sans">
            <PageHeader title="Meus Cartões" onBack={() => navigate('/account')} />

            <div className="flex-1 p-5 overflow-y-auto">
                {loading ? (
                    <div className="flex justify-center my-10">
                        <i className="ri-loader-4-line text-2xl animate-spin text-ink-400" aria-hidden="true"></i>
                    </div>
                ) : loadError ? (
                    <EmptyState
                        variant="error"
                        icon="ri-error-warning-line"
                        title="Não foi possível carregar seus cartões"
                        description="Tente novamente mais tarde."
                    />
                ) : cards.length > 0 ? (
                    <div className="flex flex-col gap-4">
                        {cards.map((card, idx) => (
                            <div key={idx} className="bg-ink-900 text-white rounded-panel p-5 shadow-raised relative overflow-hidden">
                                <div className="absolute -right-10 -top-10 w-32 h-32 bg-white opacity-10 rounded-full blur-2xl"></div>
                                <div className="flex justify-between items-center mb-6">
                                    <i className="ri-mastercard-fill text-3xl" aria-hidden="true"></i>
                                    <span className="text-xs tracking-widest opacity-80">CRÉDITO</span>
                                </div>
                                <h3 className="text-xl font-mono tracking-[0.2em] mb-2">**** **** **** {card.last4}</h3>
                                <div className="flex justify-between items-end mt-4 opacity-80 text-sm">
                                    <span>Vencimento: {card.expiry}</span>
                                    <i className="ri-delete-bin-line text-lg cursor-pointer hover:text-danger-400" aria-hidden="true"></i>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <EmptyState
                        icon="ri-bank-card-line"
                        title="Nenhum cartão salvo"
                        description="Adicione um cartão de crédito ou débito para facilitar seus pagamentos nas viagens."
                    />
                )}
            </div>

            <div className="p-5 bg-surface border-t border-line pb-10">
                <Button variant="secondary">
                    <i className="ri-add-line text-xl" aria-hidden="true"></i>
                    Adicionar Novo Cartão
                </Button>
            </div>
        </div>
    );
};

export default Cards;
