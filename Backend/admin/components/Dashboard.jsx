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
        <div style={{ padding: '30px', fontFamily: 'Inter, system-ui, sans-serif', backgroundColor: '#09090b', minHeight: '100vh', color: '#fafafa' }}>
            {/* Header Banner */}
            <div style={{
                background: 'linear-gradient(135deg, #18181b 0%, #09090b 100%)',
                borderRadius: '20px',
                padding: '32px 40px',
                border: '1px solid #27272a',
                color: '#fafafa',
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 10px 10px -5px rgba(0, 0, 0, 0.2)',
                marginBottom: '32px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                position: 'relative',
                overflow: 'hidden'
            }}>
                {/* Glow effect */}
                <div style={{ position: 'absolute', top: '-50px', right: '-50px', width: '200px', height: '200px', background: 'radial-gradient(circle, rgba(34,197,94,0.15) 0%, rgba(0,0,0,0) 70%)', borderRadius: '50%' }}></div>
                
                <div style={{ position: 'relative', zIndex: 1 }}>
                    <h1 style={{ margin: 0, fontSize: '32px', fontWeight: '800', color: '#fafafa', letterSpacing: '-0.02em' }}>
                        Centro de Operações <span style={{ color: '#22c55e' }}>Ao Vivo</span>
                    </h1>
                    <p style={{ margin: '8px 0 0 0', color: '#a1a1aa', fontSize: '15px' }}>
                        Monitoramento inteligente e em tempo real da frota MoveCity Premium.
                    </p>
                </div>
                <div style={{
                    backgroundColor: 'rgba(34, 197, 94, 0.1)',
                    border: '1px solid rgba(34, 197, 94, 0.2)',
                    padding: '12px 24px',
                    borderRadius: '30px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    backdropFilter: 'blur(10px)',
                    zIndex: 1
                }}>
                    <span style={{ height: '10px', width: '10px', backgroundColor: '#22c55e', borderRadius: '50%', display: 'inline-block', boxShadow: '0 0 10px #22c55e' }}></span>
                    <span style={{ fontSize: '14px', fontWeight: '600', color: '#4ade80', textTransform: 'uppercase', letterSpacing: '0.05em' }}>GPS Ativo</span>
                </div>
            </div>

            {/* KPI Cards Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px', marginBottom: '32px' }}>
                
                {/* Corridas Hoje */}
                <div style={cardStyle('#3b82f6')}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <span style={cardTitleStyle}>Corridas (Hoje)</span>
                        <span style={iconBadgeStyle('rgba(59, 130, 246, 0.1)', '#60a5fa')}>🚗</span>
                    </div>
                    <div style={cardValueStyle}>{ridesToday}</div>
                    <div style={cardFooterStyle}>Semana: {ridesWeek} | Mês: {ridesMonth}</div>
                </div>

                {/* Corridas em Andamento */}
                <div style={cardStyle('#8b5cf6')}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <span style={cardTitleStyle}>Em Andamento</span>
                        <span style={iconBadgeStyle('rgba(139, 92, 246, 0.1)', '#a78bfa')}>⚡</span>
                    </div>
                    <div style={cardValueStyle}>{ongoingRides}</div>
                    <div style={cardFooterStyle}>Corridas ativas agora</div>
                </div>

                {/* Motoristas Online */}
                <div style={cardStyle('#22c55e')}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <span style={cardTitleStyle}>Motoristas Online</span>
                        <span style={iconBadgeStyle('rgba(34, 197, 94, 0.1)', '#4ade80')}>👨‍✈️</span>
                    </div>
                    <div style={cardValueStyle}>{onlineCaptains}</div>
                    <div style={cardFooterStyle}>Captains com GPS ativo</div>
                </div>

                {/* Passageiros Registrados */}
                <div style={cardStyle('#f59e0b')}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <span style={cardTitleStyle}>Passageiros</span>
                        <span style={iconBadgeStyle('rgba(245, 158, 11, 0.1)', '#fbbf24')}>👥</span>
                    </div>
                    <div style={cardValueStyle}>{totalUsers}</div>
                    <div style={cardFooterStyle}>Total de usuários registrados</div>
                </div>
            </div>

            {/* REAL-TIME MAP SECTION */}
            <div style={{ ...panelStyle, marginBottom: '32px', padding: '0', overflow: 'hidden', border: '1px solid #27272a' }}>
                <div style={{ padding: '24px 28px', borderBottom: '1px solid #27272a', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#18181b' }}>
                    <div>
                        <h3 style={panelTitleStyle}>🗺️ Mapa de Frotas e Zonas de Demanda</h3>
                        <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#a1a1aa' }}>
                            Localização ao vivo dos motoristas, corridas ativas e manchas de calor de solicitações.
                        </p>
                    </div>
                    <div style={{ display: 'flex', gap: '12px' }}>
                        <span style={{ fontSize: '12px', padding: '6px 14px', borderRadius: '20px', backgroundColor: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.2)', color: '#4ade80', fontWeight: '600' }}>
                            🟢 Motorista Online
                        </span>
                        <span style={{ fontSize: '12px', padding: '6px 14px', borderRadius: '20px', backgroundColor: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', color: '#f87171', fontWeight: '600' }}>
                            🔥 Zona de Alta Demanda
                        </span>
                    </div>
                </div>

                {/* Leaflet Map Container */}
                <div id="admin-live-map" style={{ width: '100%', height: '500px', backgroundColor: '#09090b', filter: 'invert(100%) hue-rotate(180deg) brightness(95%) contrast(90%)' }}></div>
            </div>

            {/* Active Rides & Drivers Details List */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '24px', marginBottom: '32px' }}>
                
                {/* Active Drivers List */}
                <div style={panelStyle}>
                    <h3 style={panelTitleStyle}>👨‍✈️ Motoristas Conectados ({activeCaptainsList.length})</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '20px' }}>
                        {activeCaptainsList.length === 0 ? (
                            <p style={{ color: '#71717a', fontSize: '14px' }}>Nenhum motorista online no momento.</p>
                        ) : (
                            activeCaptainsList.map(c => (
                                <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', backgroundColor: '#09090b', borderRadius: '12px', border: '1px solid #27272a', transition: 'all 0.2s', cursor: 'default' }}>
                                    <div>
                                        <div style={{ fontWeight: '700', fontSize: '14px', color: '#fafafa' }}>{c.name}</div>
                                        <div style={{ fontSize: '12px', color: '#a1a1aa', marginTop: '4px' }}>{c.phone} &bull; Placa: <span style={{ color: '#d4d4d8' }}>{c.plate}</span></div>
                                    </div>
                                    <span style={{ fontSize: '11px', fontWeight: '800', padding: '6px 12px', borderRadius: '8px', backgroundColor: 'rgba(34, 197, 94, 0.1)', color: '#4ade80', letterSpacing: '0.05em' }}>
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
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '20px' }}>
                        {activeRidesList.length === 0 ? (
                            <p style={{ color: '#71717a', fontSize: '14px' }}>Nenhuma corrida em andamento no momento.</p>
                        ) : (
                            activeRidesList.map(r => (
                                <div key={r.id} style={{ padding: '16px', backgroundColor: 'rgba(139, 92, 246, 0.05)', borderRadius: '12px', border: '1px solid rgba(139, 92, 246, 0.2)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', alignItems: 'center' }}>
                                        <span style={{ fontWeight: '700', fontSize: '14px', color: '#e9d5ff' }}>{r.user} <span style={{ color: '#a78bfa', margin: '0 6px' }}>➔</span> {r.captain}</span>
                                        <span style={{ fontWeight: '800', fontSize: '16px', color: '#c4b5fd' }}>{formatCurrency(r.fare)}</span>
                                    </div>
                                    <div style={{ fontSize: '13px', color: '#a78bfa', lineHeight: '1.6' }}>
                                        <div style={{ display: 'flex', gap: '8px' }}><span>📍</span> <span style={{ color: '#e9d5ff' }}>{r.pickup}</span></div>
                                        <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}><span>🏁</span> <span style={{ color: '#e9d5ff' }}>{r.destination}</span></div>
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
                        
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px', backgroundColor: '#09090b', borderRadius: '16px', border: '1px solid #27272a' }}>
                            <div>
                                <span style={{ fontSize: '11px', color: '#a1a1aa', fontWeight: '700', letterSpacing: '0.05em' }}>RECEITA BRUTA (100%)</span>
                                <div style={{ fontSize: '26px', fontWeight: '800', color: '#fafafa', marginTop: '4px' }}>
                                    {formatCurrency(totalRevenue)}
                                </div>
                            </div>
                            <span style={{ fontSize: '32px', filter: 'drop-shadow(0 0 10px rgba(255,255,255,0.1))' }}>💵</span>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px', backgroundColor: 'rgba(34, 197, 94, 0.05)', borderRadius: '16px', border: '1px solid rgba(34, 197, 94, 0.2)' }}>
                            <div>
                                <span style={{ fontSize: '11px', color: '#4ade80', fontWeight: '700', letterSpacing: '0.05em' }}>COMISSÃO PLATAFORMA (20%)</span>
                                <div style={{ fontSize: '26px', fontWeight: '800', color: '#22c55e', marginTop: '4px' }}>
                                    {formatCurrency(platformCommission)}
                                </div>
                            </div>
                            <span style={{ fontSize: '32px', filter: 'drop-shadow(0 0 10px rgba(34,197,94,0.3))' }}>🏦</span>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px', backgroundColor: 'rgba(59, 130, 246, 0.05)', borderRadius: '16px', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
                            <div>
                                <span style={{ fontSize: '11px', color: '#60a5fa', fontWeight: '700', letterSpacing: '0.05em' }}>REPASSE MOTORISTAS (80%)</span>
                                <div style={{ fontSize: '26px', fontWeight: '800', color: '#3b82f6', marginTop: '4px' }}>
                                    {formatCurrency(driverPayouts)}
                                </div>
                            </div>
                            <span style={{ fontSize: '32px', filter: 'drop-shadow(0 0 10px rgba(59,130,246,0.3))' }}>💳</span>
                        </div>

                    </div>
                </div>

                {/* Payment Statuses Audit */}
                <div style={panelStyle}>
                    <h3 style={panelTitleStyle}>💳 Status dos Pagamentos</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '20px' }}>
                        
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px', backgroundColor: 'rgba(34, 197, 94, 0.05)', borderRadius: '16px', border: '1px solid rgba(34, 197, 94, 0.1)' }}>
                            <span style={{ fontWeight: '600', color: '#4ade80' }}>✅ Concluídos (`completed`)</span>
                            <span style={{ fontSize: '22px', fontWeight: '800', color: '#22c55e' }}>{paymentsSummary.completed}</span>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px', backgroundColor: 'rgba(245, 158, 11, 0.05)', borderRadius: '16px', border: '1px solid rgba(245, 158, 11, 0.1)' }}>
                            <span style={{ fontWeight: '600', color: '#fbbf24' }}>⏳ Pendentes (`pending`)</span>
                            <span style={{ fontSize: '22px', fontWeight: '800', color: '#f59e0b' }}>{paymentsSummary.pending}</span>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px', backgroundColor: 'rgba(239, 68, 68, 0.05)', borderRadius: '16px', border: '1px solid rgba(239, 68, 68, 0.1)' }}>
                            <span style={{ fontWeight: '600', color: '#f87171' }}>🔄 Estornos (`refunded`)</span>
                            <span style={{ fontSize: '22px', fontWeight: '800', color: '#ef4444' }}>{paymentsSummary.refunded}</span>
                        </div>

                    </div>
                </div>

            </div>
        </div>
    );
};

const cardStyle = (accentColor) => ({
    backgroundColor: '#18181b',
    borderRadius: '16px',
    padding: '24px',
    border: '1px solid #27272a',
    borderTop: `4px solid ${accentColor}`,
    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)',
});

const cardTitleStyle = {
    fontSize: '12px',
    fontWeight: '700',
    color: '#a1a1aa',
    textTransform: 'uppercase',
    letterSpacing: '0.05em'
};

const iconBadgeStyle = (bg, color) => ({
    width: '42px',
    height: '42px',
    borderRadius: '12px',
    backgroundColor: bg,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '20px',
    color: color
});

const cardValueStyle = {
    fontSize: '36px',
    fontWeight: '800',
    color: '#fafafa',
    marginTop: '16px',
    marginBottom: '8px',
    lineHeight: '1'
};

const cardFooterStyle = {
    fontSize: '13px',
    color: '#71717a',
    fontWeight: '500'
};

const panelStyle = {
    backgroundColor: '#18181b',
    borderRadius: '20px',
    padding: '32px',
    border: '1px solid #27272a',
    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)'
};

const panelTitleStyle = {
    margin: 0,
    fontSize: '20px',
    fontWeight: '800',
    color: '#fafafa',
    letterSpacing: '-0.01em'
};

export default Dashboard;
