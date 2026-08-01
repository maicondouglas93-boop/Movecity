import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import PageHeader from '@/shared/components/ui/PageHeader';
import DetailRow from '@/shared/components/ui/DetailRow';
import EmptyState from '@/shared/components/ui/EmptyState';
import Button from '@/shared/components/ui/Button';

const Favorites = () => {
    const navigate = useNavigate();
    const [favorites, setFavorites] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);

    useEffect(() => {
        const fetchFavorites = async () => {
            try {
                const response = await axios.get(`${import.meta.env.VITE_BASE_URL}/users/favorites`, {
                    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
                });
                setFavorites(response.data.favorites || []);
            } catch (error) {
                // A rota /users/favorites ainda não existe no backend.
                setLoadError(true);
            } finally {
                setLoading(false);
            }
        };
        fetchFavorites();
    }, []);

    return (
        <div className="h-screen bg-surface-alt flex flex-col font-sans">
            <PageHeader title="Favoritos e Locais" onBack={() => navigate('/account')} />

            <div className="flex-1 p-5 overflow-y-auto">
                <h3 className="font-semibold text-ink-600 mb-4">Locais Principais</h3>

                {/* Sem onClick de propósito: cadastrar "Casa"/"Trabalho" ainda não tem
                    fluxo real no backend — mostrar como clicável seria prometer uma ação
                    que não acontece (ver A7 na auditoria de integração). */}
                <div className="flex flex-col gap-3 mb-8">
                    <div className="bg-surface rounded-panel border border-line shadow-raised">
                        <DetailRow
                            icon="ri-home-4-fill"
                            iconColor="text-blue-600"
                            title="Casa"
                            subtitle="Adicionar endereço de casa"
                            className="px-4"
                        />
                    </div>
                    <div className="bg-surface rounded-panel border border-line shadow-raised">
                        <DetailRow
                            icon="ri-briefcase-4-fill"
                            iconColor="text-amber-600"
                            title="Trabalho"
                            subtitle="Adicionar endereço de trabalho"
                            className="px-4"
                        />
                    </div>
                </div>

                <h3 className="font-semibold text-ink-600 mb-4">Outros Endereços Favoritos</h3>

                {loading ? (
                    <div className="flex justify-center my-10">
                        <i className="ri-loader-4-line text-2xl animate-spin text-ink-400" aria-hidden="true"></i>
                    </div>
                ) : loadError ? (
                    <EmptyState
                        variant="error"
                        icon="ri-error-warning-line"
                        title="Não foi possível carregar seus locais salvos"
                    />
                ) : favorites.length > 0 ? (
                    <div className="flex flex-col gap-3">
                        {favorites.map((fav, idx) => (
                            <div key={idx} className="bg-surface p-4 rounded-panel border border-line shadow-raised flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <i className="ri-map-pin-2-fill text-ink-400 text-xl" aria-hidden="true"></i>
                                    <div>
                                        <h4 className="font-semibold text-ink-900">{fav.name}</h4>
                                        <p className="text-xs text-ink-400 mt-0.5">{fav.address}</p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <EmptyState
                        icon="ri-map-pin-add-line"
                        title="Nenhum outro endereço salvo"
                    />
                )}
            </div>

            <div className="p-5 bg-surface border-t border-line pb-10">
                <Button variant="secondary">
                    <i className="ri-add-line text-xl" aria-hidden="true"></i>
                    Adicionar Local
                </Button>
            </div>
        </div>
    );
};

export default Favorites;
