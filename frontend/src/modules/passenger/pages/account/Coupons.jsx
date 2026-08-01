import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

const Coupons = () => {
    const navigate = useNavigate();
    const [coupons, setCoupons] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(false);
    const [couponCode, setCouponCode] = useState('');

    useEffect(() => {
        const fetchCoupons = async () => {
            try {
                const response = await axios.get(`${import.meta.env.VITE_BASE_URL}/users/coupons`, {
                    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
                });
                setCoupons(response.data.coupons || []);
            } catch (error) {
                // A rota /users/coupons ainda não existe no backend — distinguir "sem
                // cupons" de "não deu pra carregar" em vez de esconder o erro.
                setLoadError(true);
            } finally {
                setLoading(false);
            }
        };
        fetchCoupons();
    }, []);

    const handleAddCoupon = (e) => {
        e.preventDefault();
        if (couponCode.trim() !== '') {
            setCouponCode('');
            alert('Aplicação de cupons ainda não está disponível.');
        }
    };

    return (
        <div className="h-screen bg-gray-50 flex flex-col font-sans">
            <div className="flex items-center gap-4 p-5 bg-white border-b border-gray-100 sticky top-0 z-10">
                <i onClick={() => navigate('/account')} className="ri-arrow-left-line text-2xl cursor-pointer active:scale-95 transition-transform"></i>
                <h2 className="text-xl font-semibold">Meus Cupons</h2>
            </div>

            <div className="p-5 bg-white shadow-sm mb-2">
                <form onSubmit={handleAddCoupon} className="flex gap-2">
                    <div className="relative flex-1">
                        <i className="ri-ticket-2-line absolute left-3 top-3 text-gray-400"></i>
                        <input 
                            type="text" 
                            placeholder="Digite o código do cupom"
                            value={couponCode}
                            onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                            className="w-full bg-gray-100 pl-10 pr-4 py-3 rounded-xl outline-none font-medium placeholder-gray-400 focus:ring-2 focus:ring-black uppercase"
                        />
                    </div>
                    <button type="submit" className="bg-black text-white px-5 rounded-xl font-semibold active:bg-gray-800 transition-colors">
                        Aplicar
                    </button>
                </form>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
                <h3 className="font-semibold text-gray-700 mb-4">Cupons ativos</h3>
                
                {loading ? (
                    <div className="flex justify-center my-8">
                        <i className="ri-loader-4-line text-2xl animate-spin text-gray-400"></i>
                    </div>
                ) : loadError ? (
                    <div className="text-center py-16 flex flex-col items-center">
                        <i className="ri-error-warning-line text-4xl text-red-300 mb-3"></i>
                        <h4 className="text-gray-800 font-semibold text-lg mb-1">Não foi possível carregar seus cupons</h4>
                        <p className="text-sm text-gray-500 max-w-[250px]">Tente novamente mais tarde.</p>
                    </div>
                ) : coupons.length > 0 ? (
                    <div className="flex flex-col gap-3">
                        {coupons.map((coupon, idx) => (
                            <div key={idx} className="bg-white border border-gray-200 rounded-xl p-4 flex gap-4 items-center shadow-sm relative overflow-hidden">
                                <div className="absolute left-0 top-0 bottom-0 w-2 bg-green-500"></div>
                                <div className="h-12 w-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center flex-shrink-0">
                                    <i className="ri-percent-line text-xl font-bold"></i>
                                </div>
                                <div className="flex-1">
                                    <h4 className="font-bold text-gray-800">{coupon.title}</h4>
                                    <p className="text-xs text-gray-500 mt-1">{coupon.description}</p>
                                    <p className="text-[10px] text-gray-400 mt-2 font-medium">Válido até {coupon.expiresAt}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-16 flex flex-col items-center">
                        <div className="h-20 w-20 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                            <i className="ri-coupon-3-line text-4xl text-gray-300"></i>
                        </div>
                        <h4 className="text-gray-800 font-semibold text-lg mb-1">Nenhum cupom disponível</h4>
                        <p className="text-sm text-gray-500 max-w-[250px]">Você não tem nenhum cupom de desconto ativo no momento.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Coupons;
