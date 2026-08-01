import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import PageHeader from '@/shared/components/ui/PageHeader';
import EmptyState from '@/shared/components/ui/EmptyState';
import Button from '@/shared/components/ui/Button';

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
        <div className="h-screen bg-surface-alt flex flex-col font-sans">
            <PageHeader title="Meus Cupons" onBack={() => navigate('/account')} />

            <div className="p-5 bg-surface shadow-raised mb-2">
                <form onSubmit={handleAddCoupon} className="flex gap-2">
                    <div className="relative flex-1">
                        <i className="ri-ticket-2-line absolute left-3 top-3 text-ink-400" aria-hidden="true"></i>
                        <input
                            type="text"
                            placeholder="Digite o código do cupom"
                            value={couponCode}
                            onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                            className="w-full bg-surface-alt pl-10 pr-4 py-3 rounded-panel outline-none font-medium placeholder-ink-400 focus:ring-2 focus:ring-brand-500 uppercase text-ink-900"
                        />
                    </div>
                    <Button type="submit" fullWidth={false} className="px-5">
                        Aplicar
                    </Button>
                </form>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
                <h3 className="font-semibold text-ink-600 mb-4">Cupons ativos</h3>

                {loading ? (
                    <div className="flex justify-center my-8">
                        <i className="ri-loader-4-line text-2xl animate-spin text-ink-400" aria-hidden="true"></i>
                    </div>
                ) : loadError ? (
                    <EmptyState
                        variant="error"
                        icon="ri-error-warning-line"
                        title="Não foi possível carregar seus cupons"
                        description="Tente novamente mais tarde."
                    />
                ) : coupons.length > 0 ? (
                    <div className="flex flex-col gap-3">
                        {coupons.map((coupon, idx) => (
                            <div key={idx} className="bg-surface border border-line rounded-panel p-4 flex gap-4 items-center shadow-raised relative overflow-hidden">
                                <div className="absolute left-0 top-0 bottom-0 w-2 bg-brand-500"></div>
                                <div className="h-12 w-12 bg-brand-50 text-brand-600 rounded-full flex items-center justify-center flex-shrink-0">
                                    <i className="ri-percent-line text-xl font-bold" aria-hidden="true"></i>
                                </div>
                                <div className="flex-1">
                                    <h4 className="font-bold text-ink-900">{coupon.title}</h4>
                                    <p className="text-xs text-ink-400 mt-1">{coupon.description}</p>
                                    <p className="text-[10px] text-ink-400 mt-2 font-medium">Válido até {coupon.expiresAt}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <EmptyState
                        icon="ri-coupon-3-line"
                        title="Nenhum cupom disponível"
                        description="Você não tem nenhum cupom de desconto ativo no momento."
                    />
                )}
            </div>
        </div>
    );
};

export default Coupons;
