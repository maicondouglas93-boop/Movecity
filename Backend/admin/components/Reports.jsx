import React, { useEffect, useState } from 'react';
import { Box, H2, H4, Text, Table, TableRow, TableCell, TableHead, TableBody, Loader } from '@adminjs/design-system';

const Reports = () => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch('/admin/api/reports')
            .then(res => res.json())
            .then(resData => {
                setData(resData);
                setLoading(false);
            })
            .catch(err => {
                console.error("Error fetching reports", err);
                setLoading(false);
            });
    }, []);

    if (loading) return <Box p="xl" flex alignItems="center" justifyContent="center"><Loader /></Box>;
    if (!data) return <Box p="xl"><Text>Erro ao carregar relatórios.</Text></Box>;

    return (
        <Box p="xl" style={{ backgroundColor: '#09090b', minHeight: '100vh', color: '#fafafa' }}>
            <H2 mb="xl" style={{ color: '#fafafa', fontWeight: '800', letterSpacing: '-0.02em' }}>📊 Inteligência de Negócio</H2>
            
            <Box flex flexDirection="row" flexWrap="wrap" style={{ gap: '24px' }}>
                
                {/* Horários de Pico */}
                <Box p="lg" flexGrow={1} style={{ backgroundColor: '#18181b', minWidth: '400px', borderRadius: '16px', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.5)', border: '1px solid #27272a' }}>
                    <H4 mb="lg" style={{ color: '#fafafa' }}>🕒 Volume por Hora</H4>
                    {data.peakHours && data.peakHours.length > 0 ? (
                        <Box>
                            {data.peakHours.map(ph => {
                                const maxCount = Math.max(...data.peakHours.map(p => p.count));
                                const percent = (ph.count / maxCount) * 100;
                                return (
                                    <Box key={ph._id} mb="default" flex alignItems="center">
                                        <Text width="50px" style={{ color: '#a1a1aa' }}>{String(ph._id).padStart(2, '0')}:00</Text>
                                        <Box flexGrow={1} style={{ backgroundColor: '#27272a', height: '12px', marginLeft: '12px', marginRight: '12px', borderRadius: '6px', overflow: 'hidden' }}>
                                            <Box style={{ backgroundColor: '#22c55e', height: '100%', width: `${percent}%`, borderRadius: '6px', boxShadow: '0 0 10px rgba(34,197,94,0.5)' }} />
                                        </Box>
                                        <Text width="30px" textAlign="right" style={{ color: '#fafafa', fontWeight: 'bold' }}>{ph.count}</Text>
                                    </Box>
                                );
                            })}
                        </Box>
                    ) : <Text style={{ color: '#71717a' }}>Sem dados de horários.</Text>}
                </Box>

                {/* Receita por Período */}
                <Box p="lg" flexGrow={1} style={{ backgroundColor: '#18181b', minWidth: '400px', borderRadius: '16px', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.5)', border: '1px solid #27272a' }}>
                    <H4 mb="lg" style={{ color: '#fafafa' }}>💰 Receita por Período</H4>
                    <Table>
                        <TableHead>
                            <TableRow>
                                <TableCell style={{ color: '#a1a1aa', borderBottom: '1px solid #27272a' }}>Período (Data)</TableCell>
                                <TableCell style={{ color: '#a1a1aa', borderBottom: '1px solid #27272a' }}>Faturamento Bruto</TableCell>
                                <TableCell style={{ color: '#a1a1aa', borderBottom: '1px solid #27272a' }}>Comissão Plataforma</TableCell>
                                <TableCell style={{ color: '#a1a1aa', borderBottom: '1px solid #27272a' }}>Corridas</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {data.revenueByPeriod && data.revenueByPeriod.map((rev, idx) => (
                                <TableRow key={idx}>
                                    <TableCell style={{ color: '#fafafa', borderBottom: '1px solid #27272a' }}>{rev._id}</TableCell>
                                    <TableCell style={{ color: '#4ade80', fontWeight: 'bold', borderBottom: '1px solid #27272a' }}>R$ {rev.totalFare.toFixed(2)}</TableCell>
                                    <TableCell style={{ color: '#22c55e', borderBottom: '1px solid #27272a' }}>R$ {(rev.totalFare * 0.2).toFixed(2)}</TableCell>
                                    <TableCell style={{ color: '#fafafa', borderBottom: '1px solid #27272a' }}>{rev.count}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </Box>

                {/* Motoristas Mais Ativos */}
                <Box p="lg" flexGrow={1} style={{ backgroundColor: '#18181b', minWidth: '350px', borderRadius: '16px', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.5)', border: '1px solid #27272a' }}>
                    <H4 mb="lg" style={{ color: '#fafafa' }}>🚗 Top 5 Motoristas</H4>
                    <Table>
                        <TableHead>
                            <TableRow>
                                <TableCell style={{ color: '#a1a1aa', borderBottom: '1px solid #27272a' }}>Nome</TableCell>
                                <TableCell style={{ color: '#a1a1aa', borderBottom: '1px solid #27272a' }}>Corridas</TableCell>
                                <TableCell style={{ color: '#a1a1aa', borderBottom: '1px solid #27272a' }}>Faturamento</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {data.topCaptains && data.topCaptains.map((cap, idx) => (
                                <TableRow key={idx}>
                                    <TableCell style={{ color: '#fafafa', borderBottom: '1px solid #27272a' }}>{cap.captainData?.fullname?.firstname} {cap.captainData?.fullname?.lastname}</TableCell>
                                    <TableCell style={{ color: '#fafafa', borderBottom: '1px solid #27272a' }}>{cap.count}</TableCell>
                                    <TableCell style={{ color: '#4ade80', fontWeight: 'bold', borderBottom: '1px solid #27272a' }}>R$ {cap.totalGenerated.toFixed(2)}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </Box>

                {/* Passageiros Mais Ativos */}
                <Box p="lg" flexGrow={1} style={{ backgroundColor: '#18181b', minWidth: '350px', borderRadius: '16px', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.5)', border: '1px solid #27272a' }}>
                    <H4 mb="lg" style={{ color: '#fafafa' }}>👤 Top 5 Passageiros</H4>
                    <Table>
                        <TableHead>
                            <TableRow>
                                <TableCell style={{ color: '#a1a1aa', borderBottom: '1px solid #27272a' }}>Nome</TableCell>
                                <TableCell style={{ color: '#a1a1aa', borderBottom: '1px solid #27272a' }}>Solicitações</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {data.topUsers && data.topUsers.map((user, idx) => (
                                <TableRow key={idx}>
                                    <TableCell style={{ color: '#fafafa', borderBottom: '1px solid #27272a' }}>{user.userData?.fullname?.firstname} {user.userData?.fullname?.lastname}</TableCell>
                                    <TableCell style={{ color: '#fafafa', borderBottom: '1px solid #27272a' }}>{user.count}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </Box>

                {/* Corridas por Bairro/Cidade */}
                <Box p="lg" flexGrow={1} width="100%" style={{ backgroundColor: '#18181b', borderRadius: '16px', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.5)', border: '1px solid #27272a' }}>
                    <H4 mb="lg" style={{ color: '#fafafa' }}>🗺️ Locais de Partida Mais Frequentes</H4>
                    <Box flex flexDirection="row" flexWrap="wrap" style={{ gap: '16px' }}>
                        {data.ridesByLocation && data.ridesByLocation.map((loc, idx) => (
                            <Box key={idx} p="default" style={{ backgroundColor: '#27272a', borderRadius: '12px', minWidth: '150px', border: '1px solid #3f3f46' }}>
                                <Text style={{ color: '#a1a1aa', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Origem</Text>
                                <Text mb="sm" style={{ color: '#fafafa', fontWeight: 'bold', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '250px' }}>{loc._id}</Text>
                                <Text style={{ color: '#22c55e', fontWeight: 'bold' }}>{loc.count} corridas</Text>
                            </Box>
                        ))}
                    </Box>
                </Box>

            </Box>
        </Box>
    );
};

export default Reports;
