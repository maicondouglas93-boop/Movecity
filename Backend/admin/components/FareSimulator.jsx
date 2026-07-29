import React, { useState } from 'react';

const formatCurrency = (val) => {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);
};

const FareSimulator = () => {
    const [distance, setDistance] = useState(10000); // meters
    const [time, setTime] = useState(1200); // seconds
    const [vehicleType, setVehicleType] = useState('car');
    const [paymentMethod, setPaymentMethod] = useState('cash');
    const [couponCode, setCouponCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');

    const handleSimulate = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');
        setResult(null);

        try {
            const res = await fetch('/admin/api/simulate-fare', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ distance, time, vehicleType, paymentMethod, couponCode })
            });
            const data = await res.json();
            
            if (!res.ok) {
                setError(data.error || 'Erro na simulação');
            } else {
                setResult(data);
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ padding: '40px', fontFamily: 'Inter, system-ui, sans-serif', backgroundColor: '#09090b', minHeight: '100vh', color: '#fafafa' }}>
            <h1 style={{ margin: 0, fontSize: '32px', fontWeight: '800', color: '#fafafa' }}>
                Simulador de <span style={{ color: '#3b82f6' }}>Corridas</span>
            </h1>
            <p style={{ margin: '8px 0 32px 0', color: '#a1a1aa' }}>
                Valide o comportamento do Motor de Tarifas simulando corridas reais com as regras atuais.
            </p>

            <div style={{ display: 'flex', gap: '32px', alignItems: 'flex-start' }}>
                {/* FORM PANEL */}
                <div style={{ flex: '1', backgroundColor: '#18181b', padding: '32px', borderRadius: '16px', border: '1px solid #27272a' }}>
                    <form onSubmit={handleSimulate}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
                            <div>
                                <label style={labelStyle}>Distância (metros)</label>
                                <input type="number" value={distance} onChange={e => setDistance(e.target.value)} style={inputStyle} required />
                                <small style={{ color: '#71717a' }}>Ex: 10000 = 10km</small>
                            </div>
                            <div>
                                <label style={labelStyle}>Tempo (segundos)</label>
                                <input type="number" value={time} onChange={e => setTime(e.target.value)} style={inputStyle} required />
                                <small style={{ color: '#71717a' }}>Ex: 1200 = 20 min</small>
                            </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
                            <div>
                                <label style={labelStyle}>Categoria de Veículo</label>
                                <select value={vehicleType} onChange={e => setVehicleType(e.target.value)} style={inputStyle}>
                                    <option value="car">Carro Econômico (car)</option>
                                    <option value="moto">Moto (moto)</option>
                                    <option value="auto">Auto (auto)</option>
                                    <option value="suv">SUV (suv)</option>
                                </select>
                            </div>
                            <div>
                                <label style={labelStyle}>Método de Pagamento</label>
                                <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} style={inputStyle}>
                                    <option value="cash">Dinheiro</option>
                                    <option value="pix">Pix</option>
                                    <option value="card">Cartão de Crédito</option>
                                </select>
                            </div>
                        </div>

                        <div style={{ marginBottom: '32px' }}>
                            <label style={labelStyle}>Cupom de Desconto (Opcional)</label>
                            <input type="text" value={couponCode} onChange={e => setCouponCode(e.target.value)} style={inputStyle} placeholder="Ex: TOMA10" />
                        </div>

                        <button type="submit" disabled={loading} style={{
                            width: '100%',
                            padding: '16px',
                            backgroundColor: loading ? '#3f3f46' : '#3b82f6',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '8px',
                            fontWeight: 'bold',
                            fontSize: '16px',
                            cursor: loading ? 'not-allowed' : 'pointer'
                        }}>
                            {loading ? 'Simulando...' : 'Simular Cálculo'}
                        </button>
                    </form>

                    {error && (
                        <div style={{ marginTop: '20px', padding: '16px', backgroundColor: '#450a0a', color: '#ef4444', borderRadius: '8px', border: '1px solid #991b1b' }}>
                            <b>Erro:</b> {error}
                        </div>
                    )}
                </div>

                {/* RESULT PANEL (DRE) */}
                <div style={{ flex: '1' }}>
                    {result ? (
                        <div style={{ backgroundColor: '#18181b', padding: '32px', borderRadius: '16px', border: '1px solid #27272a', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }}>
                            
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', borderBottom: '1px solid #27272a', paddingBottom: '16px' }}>
                                <h3 style={{ margin: 0, color: '#fafafa' }}>🧾 Recibo Detalhado (DRE)</h3>
                                <span style={{ backgroundColor: '#1e3a8a', color: '#60a5fa', padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 'bold' }}>
                                    {vehicleType.toUpperCase()}
                                </span>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '15px' }}>
                                <Row label="Tarifa Base" value={formatCurrency(result.fareBreakdown.baseFare)} />
                                <Row label={`Distância (${(distance/1000).toFixed(1)} km)`} value={formatCurrency(result.fareBreakdown.distanceFare)} />
                                <Row label={`Tempo (${(time/60).toFixed(1)} min)`} value={formatCurrency(result.fareBreakdown.timeFare)} />
                                
                                {result.fareBreakdown.appliedRules && result.fareBreakdown.appliedRules.map((rule, idx) => (
                                    <Row key={idx} label={`Taxa: ${rule.name}`} value={formatCurrency(rule.amount)} color="#f59e0b" />
                                ))}

                                {result.fareBreakdown.dynamicMultiplier !== 1.0 && (
                                    <Row label="Tarifa Dinâmica" value={`${result.fareBreakdown.dynamicMultiplier}x`} color="#ef4444" />
                                )}

                                {result.fareBreakdown.cardFee > 0 && (
                                    <Row label="Taxa do Cartão" value={formatCurrency(result.fareBreakdown.cardFee)} color="#a855f7" />
                                )}

                                {result.fareBreakdown.couponDiscount > 0 && (
                                    <Row label="Cupom de Desconto" value={`- ${formatCurrency(result.fareBreakdown.couponDiscount)}`} color="#22c55e" />
                                )}
                            </div>

                            <div style={{ margin: '24px 0', height: '1px', backgroundColor: '#3f3f46', borderStyle: 'dashed' }}></div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                <span style={{ fontSize: '18px', fontWeight: 'bold', color: '#fafafa' }}>Valor Final Passageiro</span>
                                <span style={{ fontSize: '24px', fontWeight: '900', color: '#3b82f6' }}>{formatCurrency(result.finalFare)}</span>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#ef4444' }}>
                                    <span>Comissão Plataforma (-)</span>
                                    <b>{formatCurrency(result.commissionAmount)}</b>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#22c55e', fontSize: '18px', fontWeight: 'bold', marginTop: '8px', padding: '16px', backgroundColor: 'rgba(34,197,94,0.1)', borderRadius: '8px' }}>
                                    <span>Motorista Recebe Líquido</span>
                                    <span>{formatCurrency(result.fareBreakdown.driverNetEarnings)}</span>
                                </div>
                            </div>

                        </div>
                    ) : (
                        <div style={{ backgroundColor: '#18181b', border: '1px dashed #3f3f46', borderRadius: '16px', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#71717a' }}>
                            Preencha os dados e simule para ver o DRE.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const Row = ({ label, value, color = '#a1a1aa' }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: color }}>{label}</span>
        <span style={{ fontWeight: '600', color: '#fafafa' }}>{value}</span>
    </div>
);

const labelStyle = {
    display: 'block',
    marginBottom: '8px',
    color: '#d4d4d8',
    fontWeight: '500'
};

const inputStyle = {
    width: '100%',
    padding: '12px',
    backgroundColor: '#09090b',
    border: '1px solid #3f3f46',
    borderRadius: '8px',
    color: '#fafafa',
    fontSize: '15px'
};

export default FareSimulator;
