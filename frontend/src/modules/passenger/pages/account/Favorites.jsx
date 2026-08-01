import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

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
        <div className="h-screen bg-gray-50 flex flex-col font-sans">
            <div className="flex items-center gap-4 p-5 bg-white border-b border-gray-100 sticky top-0 z-10">
                <i onClick={() => navigate('/account')} className="ri-arrow-left-line text-2xl cursor-pointer active:scale-95 transition-transform"></i>
                <h2 className="text-xl font-semibold">Favoritos e Locais</h2>
            </div>

            <div className="flex-1 p-5 overflow-y-auto">
                <h3 className="font-semibold text-gray-700 mb-4">Locais Principais</h3>
                
                <div className="flex flex-col gap-3 mb-8">
                    <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm flex items-center justify-between cursor-pointer active:bg-gray-50">
                        <div className="flex items-center gap-4">
                            <div className="h-10 w-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-600">
                                <i className="ri-home-4-fill text-xl"></i>
                            </div>
                            <div>
                                <h4 className="font-semibold text-gray-800">Casa</h4>
                                <p className="text-xs text-gray-500 mt-0.5">Adicionar endereço de casa</p>
                            </div>
                        </div>
                        <i className="ri-arrow-right-s-line text-xl text-gray-400"></i>
                    </div>

                    <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm flex items-center justify-between cursor-pointer active:bg-gray-50">
                        <div className="flex items-center gap-4">
                            <div className="h-10 w-10 bg-orange-100 rounded-full flex items-center justify-center text-orange-600">
                                <i className="ri-briefcase-4-fill text-xl"></i>
                            </div>
                            <div>
                                <h4 className="font-semibold text-gray-800">Trabalho</h4>
                                <p className="text-xs text-gray-500 mt-0.5">Adicionar endereço de trabalho</p>
                            </div>
                        </div>
                        <i className="ri-arrow-right-s-line text-xl text-gray-400"></i>
                    </div>
                </div>

                <h3 className="font-semibold text-gray-700 mb-4">Outros Endereços Favoritos</h3>

                {loading ? (
                    <div className="flex justify-center my-10">
                        <i className="ri-loader-4-line text-2xl animate-spin text-gray-400"></i>
                    </div>
                ) : loadError ? (
                    <div className="text-center py-6 flex flex-col items-center border-2 border-dashed border-red-200 rounded-xl">
                        <i className="ri-error-warning-line text-3xl text-red-300 mb-2"></i>
                        <p className="text-sm text-gray-500">Não foi possível carregar seus locais salvos.</p>
                    </div>
                ) : favorites.length > 0 ? (
                    <div className="flex flex-col gap-3">
                        {favorites.map((fav, idx) => (
                            <div key={idx} className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <i className="ri-map-pin-2-fill text-gray-400 text-xl"></i>
                                    <div>
                                        <h4 className="font-semibold text-gray-800">{fav.name}</h4>
                                        <p className="text-xs text-gray-500 mt-0.5">{fav.address}</p>
                                    </div>
                                </div>
                                <i className="ri-delete-bin-line text-red-400 cursor-pointer p-2"></i>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-6 flex flex-col items-center border-2 border-dashed border-gray-200 rounded-xl">
                        <i className="ri-map-pin-add-line text-3xl text-gray-300 mb-2"></i>
                        <p className="text-sm text-gray-500">Nenhum outro endereço salvo.</p>
                    </div>
                )}
            </div>

            <div className="p-5 bg-white border-t border-gray-100 pb-10">
                <button className="w-full bg-black text-white py-4 rounded-xl font-semibold text-lg flex justify-center items-center gap-2 shadow-md active:bg-gray-800 transition-colors">
                    <i className="ri-add-line text-xl"></i>
                    Adicionar Local
                </button>
            </div>
        </div>
    );
};

export default Favorites;
