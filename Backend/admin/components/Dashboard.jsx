import React, { useEffect } from 'react';

const Dashboard = (props) => {
    const data = props.data || {};
    const {
        ridesToday = 0,
        ridesWeek = 0,
        ridesMonth = 0,
        ongoingRides = 0,
        onlineCaptains = 0,
        totalUsers = 0,
        totalRevenue = 0,
        platformCommission = 0,
        driverPayouts = 0,
        activeCaptainsList = [],
        activeRidesList = [],
        paymentsSummary = { completed: 0, pending: 0, refunded: 0 },
        paymentMethods = { card: 0, cash: 0, upi: 0 },
        vehicleBreakdown = { car: 0, moto: 0, auto: 0 }
    } = data;

    useEffect(() => {
        // Carrega as dependências do Leaflet dinamicamente se necessário
        if (!window.L) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
            document.head.appendChild(link);

            const script = document.createElement('script');
            script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
            script.onload = () => initMap();
            document.head.appendChild(script);
        } else {
            initMap();
        }
    }, [activeCaptainsList, activeRidesList]);

    const initMap = () => {
        if (!window.L || !document.getElementById('admin-live-map')) return;

        // Evita re-inicialização duplicada do Leaflet
        if (window.adminMapInstance) {
            window.adminMapInstance.remove();
        }

        const map = window.L.map('admin-live-map').setView([-23.55052, -46.633308], 13);
        window.adminMapInstance = map;

        window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(map);

        // Marcadores de Motoristas Online (Active Captains)
        activeCaptainsList.forEach(captain => {
            const lat = captain.ltd || -23.55052;
            const lng = captain.lng || -46.633308;
            
            const driverIcon = window.L.divIcon({
                className: 'custom-driver-pin',
                html: `<div style="background-color: #22c55e; color: white; padding: 6px 10px; border-radius: 20px; font-weight: bold; font-size: 12px; box-shadow: 0 4px 10px rgba(0,0,0,0.3); display: flex; align-items: center; gap: 4px;">🚗 ${captain.name} (${captain.vehicleType})</div>`,
                iconSize: [120, 30],
                iconAnchor: [60, 15]
            });

            window.L.marker([lat, lng], { icon: driverIcon })
                .addTo(map)
                .bindPopup(`<b>Motorista:</b> ${captain.name}<br/><b>Placa:</b> ${captain.plate}<br/><b>Status:</b> Online`);
        });

        // Áreas com Maior Demanda (Demand Hotspots)
        const hotspots = [
            { lat: -23.5615, lng: -46.6559, name: 'Av. Paulista & Jardins', intensity: 'Alta' },
            { lat: -23.5902, lng: -46.6894, name: 'Faria Lima & Vila Olímpia', intensity: 'Muito Alta' },
            { lat: -23.5489, lng: -46.6388, name: 'Centro Histórico & República', intensity: 'Média' }
        ];

        hotspots.forEach(spot => {
            window.L.circle([spot.lat, spot.lng], {
                color: '#ef4444',
                fillColor: '#f87171',
                fillOpacity: 0.3,
                radius: 800
            }).addTo(map).bindPopup(`<b>🔥 Zona de Alta Demanda:</b> ${spot.name}<br/><b>Intensidade:</b> ${spot.intensity}`);
        });
    };

    const formatCurrency = (val) => {
        return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);
    };

    return (
        <div style={{ padding: '30px', fontFamily: 'Inter, system-ui, sans-serif', backgroundColor: '#f8fafc', minHeight: '100vh' }}>
            {/* Header Banner */}
            <div style={{
                background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
                borderRadius: '16px',
                padding: '28px 36px',
                color: '#ffffff',
                boxShadow: '0 10px 25px -5px rgba(15, 23, 42, 0.15)',
                marginBottom: '32px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
            }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: '28px', fontWeight: '800', color: '#ffffff' }}>
                        🗺️ Centro de Operações & Rastreamento em Tempo Real
                    </h1>
                    <p style={{ margin: '8px 0 0 0', color: '#94a3b8', fontSize: '15px' }}>
                        Monitoramento geográfico da frota online, corridas ativas e zonas de maior demanda.
                    </p>
                </div>
                <div style={{
                    backgroundColor: 'rgba(34, 197, 94, 0.15)',
                    border: '1px solid rgba(34, 197, 94, 0.3)',
                    padding: '10px 18px',
                    borderRadius: '30px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px'
                }}>
                    <span style={{ height: '10px', width: '10px', backgroundColor: '#22c55e', borderRadius: '50%', display: 'inline-block' }}></span>
                    <span style={{ fontSize: '14px', fontWeight: '600', color: '#4ade80' }}>GPS Live Tracking Ativo</span>
                </div>
            </div>

            {/* KPI Cards Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', marginBottom: '32px' }}>
                
                {/* Corridas Hoje */}
                <div style={cardStyle('#3b82f6')}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <span style={cardTitleStyle}>Corridas (Hoje)</span>
                        <span style={iconBadgeStyle('#eff6ff', '#3b82f6')}>🚗</span>
                    </div>
                    <div style={cardValueStyle}>{ridesToday}</div>
                    <div style={cardFooterStyle}>Semana: {ridesWeek} | Mês: {ridesMonth}</div>
                </div>

                {/* Corridas em Andamento */}
                <div style={cardStyle('#8b5cf6')}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <span style={cardTitleStyle}>Em Andamento</span>
                        <span style={iconBadgeStyle('#f5f3ff', '#8b5cf6')}>⚡</span>
                    </div>
                    <div style={cardValueStyle}>{ongoingRides}</div>
                    <div style={cardFooterStyle}>Corridas ativas agora</div>
                </div>

                {/* Motoristas Online */}
                <div style={cardStyle('#10b981')}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <span style={cardTitleStyle}>Motoristas Online</span>
                        <span style={iconBadgeStyle('#ecfdf5', '#10b981')}>👨‍✈️</span>
                    </div>
                    <div style={cardValueStyle}>{onlineCaptains}</div>
                    <div style={cardFooterStyle}>Captains com GPS ativo</div>
                </div>

                {/* Passageiros Registrados */}
                <div style={cardStyle('#f59e0b')}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <span style={cardTitleStyle}>Passageiros</span>
                        <span style={iconBadgeStyle('#fffbeb', '#f59e0b')}>👥</span>
                    </div>
                    <div style={cardValueStyle}>{totalUsers}</div>
                    <div style={cardFooterStyle}>Total de usuários registrados</div>
                </div>
            </div>

            {/* REAL-TIME MAP SECTION */}
            <div style={{ ...panelStyle, marginBottom: '32px', padding: '0', overflow: 'hidden' }}>
                <div style={{ padding: '24px 28px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h3 style={panelTitleStyle}>🗺️ Mapa de Frotas e Zonas de Demanda</h3>
                        <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#64748b' }}>
                            Localização ao vivo dos motoristas, corridas ativas e manchas de calor de solicitações.
                        </p>
                    </div>
                    <div style={{ display: 'flex', gap: '12px' }}>
                        <span style={{ fontSize: '12px', padding: '6px 12px', borderRadius: '20px', backgroundColor: '#f0fdf4', color: '#166534', fontWeight: '600' }}>
                            🟢 Motorista Online
                        </span>
                        <span style={{ fontSize: '12px', padding: '6px 12px', borderRadius: '20px', backgroundColor: '#fef2f2', color: '#991b1b', fontWeight: '600' }}>
                            🔥 Zona de Alta Demanda
                        </span>
                    </div>
                </div>

                {/* Leaflet Map Container */}
                <div id="admin-live-map" style={{ width: '100%', height: '450px', backgroundColor: '#e2e8f0' }}></div>
            </div>

            {/* Active Rides & Drivers Details List */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '24px', marginBottom: '32px' }}>
                
                {/* Active Drivers List */}
                <div style={panelStyle}>
                    <h3 style={panelTitleStyle}>👨‍✈️ Motoristas Conectados ({activeCaptainsList.length})</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '16px' }}>
                        {activeCaptainsList.length === 0 ? (
                            <p style={{ color: '#94a3b8', fontSize: '14px' }}>Nenhum motorista online no momento.</p>
                        ) : (
                            activeCaptainsList.map(c => (
                                <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', backgroundColor: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                                    <div>
                                        <div style={{ fontWeight: '700', fontSize: '14px', color: '#0f172a' }}>{c.name}</div>
                                        <div style={{ fontSize: '12px', color: '#64748b' }}>{c.phone} | Placa: {c.plate}</div>
                                    </div>
                                    <span style={{ fontSize: '12px', fontWeight: '700', padding: '4px 10px', borderRadius: '12px', backgroundColor: '#dcfce7', color: '#15803d' }}>
                                        {c.vehicleType.toUpperCase()}
                                    </span>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Ongoing Rides List */}
                <div style={panelStyle}>
                    <h3 style={panelTitleStyle}>⚡ Corridas em Andamento ({activeRidesList.length})</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '16px' }}>
                        {activeRidesList.length === 0 ? (
                            <p style={{ color: '#94a3b8', fontSize: '14px' }}>Nenhuma corrida em andamento no momento.</p>
                        ) : (
                            activeRidesList.map(r => (
                                <div key={r.id} style={{ padding: '12px 16px', backgroundColor: '#f5f3ff', borderRadius: '10px', border: '1px solid #ddd6fe' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                                        <span style={{ fontWeight: '700', fontSize: '13px', color: '#5b21b6' }}>{r.user} ➔ {r.captain}</span>
                                        <span style={{ fontWeight: '800', fontSize: '14px', color: '#7c3aed' }}>{formatCurrency(r.fare)}</span>
                                    </div>
                                    <div style={{ fontSize: '12px', color: '#4c1d95' }}>
                                        📍 <b>De:</b> {r.pickup} <br/>
                                        🏁 <b>Para:</b> {r.destination}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

            </div>

            {/* Financial Deep-Dive Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '24px' }}>
                
                {/* Revenue & Driver Payouts */}
                <div style={panelStyle}>
                    <h3 style={panelTitleStyle}>💰 Demonstrativo Financeiro (DRE)</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '20px' }}>
                        
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', backgroundColor: '#f8fafc', borderRadius: '12px' }}>
                            <div>
                                <span style={{ fontSize: '12px', color: '#64748b', fontWeight: '700' }}>RECEITA BRUTA (100%)</span>
                                <div style={{ fontSize: '22px', fontWeight: '800', color: '#0f172a', marginTop: '2px' }}>
                                    {formatCurrency(totalRevenue)}
                                </div>
                            </div>
                            <span style={{ fontSize: '28px' }}>💵</span>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', backgroundColor: '#f0fdf4', borderRadius: '12px', border: '1px solid #bbf7d0' }}>
                            <div>
                                <span style={{ fontSize: '12px', color: '#166534', fontWeight: '700' }}>COMISSÃO PLATAFORMA (20%)</span>
                                <div style={{ fontSize: '22px', fontWeight: '800', color: '#15803d', marginTop: '2px' }}>
                                    {formatCurrency(platformCommission)}
                                </div>
                            </div>
                            <span style={{ fontSize: '28px' }}>🏦</span>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', backgroundColor: '#eff6ff', borderRadius: '12px', border: '1px solid #bfdbfe' }}>
                            <div>
                                <span style={{ fontSize: '12px', color: '#1e40af', fontWeight: '700' }}>REPASSE MOTORISTAS (80%)</span>
                                <div style={{ fontSize: '22px', fontWeight: '800', color: '#1d4ed8', marginTop: '2px' }}>
                                    {formatCurrency(driverPayouts)}
                                </div>
                            </div>
                            <span style={{ fontSize: '28px' }}>💳</span>
                        </div>

                    </div>
                </div>

                {/* Payment Statuses Audit */}
                <div style={panelStyle}>
                    <h3 style={panelTitleStyle}>💳 Status dos Pagamentos</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '20px' }}>
                        
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', backgroundColor: '#f0fdf4', borderRadius: '12px' }}>
                            <span style={{ fontWeight: '600', color: '#166534' }}>✅ Concluídos (`completed`)</span>
                            <span style={{ fontSize: '18px', fontWeight: '800', color: '#15803d' }}>{paymentsSummary.completed}</span>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', backgroundColor: '#fffbeb', borderRadius: '12px' }}>
                            <span style={{ fontWeight: '600', color: '#92400e' }}>⏳ Pendentes (`pending`)</span>
                            <span style={{ fontSize: '18px', fontWeight: '800', color: '#b45309' }}>{paymentsSummary.pending}</span>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', backgroundColor: '#fef2f2', borderRadius: '12px' }}>
                            <span style={{ fontWeight: '600', color: '#991b1b' }}>🔄 Estornos (`refunded`)</span>
                            <span style={{ fontSize: '18px', fontWeight: '800', color: '#dc2626' }}>{paymentsSummary.refunded}</span>
                        </div>

                    </div>
                </div>

            </div>
        </div>
    );
};

const cardStyle = (accentColor) => ({
    backgroundColor: '#ffffff',
    borderRadius: '14px',
    padding: '24px',
    borderLeft: `5px solid ${accentColor}`,
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.03)',
    borderTop: '1px solid #e2e8f0',
    borderRight: '1px solid #e2e8f0',
    borderBottom: '1px solid #e2e8f0',
});

const cardTitleStyle = {
    fontSize: '13px',
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.05em'
};

const iconBadgeStyle = (bg, color) => ({
    width: '38px',
    height: '38px',
    borderRadius: '10px',
    backgroundColor: bg,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '18px'
});

const cardValueStyle = {
    fontSize: '32px',
    fontWeight: '800',
    color: '#0f172a',
    marginTop: '12px',
    marginBottom: '8px'
};

const cardFooterStyle = {
    fontSize: '12px',
    color: '#94a3b8',
    fontWeight: '500'
};

const panelStyle = {
    backgroundColor: '#ffffff',
    borderRadius: '16px',
    padding: '28px',
    border: '1px solid #e2e8f0',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.03)'
};

const panelTitleStyle = {
    margin: 0,
    fontSize: '18px',
    fontWeight: '700',
    color: '#0f172a'
};

export default Dashboard;
