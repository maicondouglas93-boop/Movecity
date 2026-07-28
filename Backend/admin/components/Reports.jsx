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
        <Box p="xl" variant="grey">
            <H2 mb="xl">📊 Relatórios e Inteligência de Negócio</H2>
            
            <Box flex flexDirection="row" flexWrap="wrap" style={{ gap: '24px' }}>
                
                {/* Horários de Pico */}
                <Box bg="white" p="lg" flexGrow={1} style={{ minWidth: '400px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                    <H4 mb="lg">🕒 Horários de Pico (Volume por Hora)</H4>
                    {data.peakHours && data.peakHours.length > 0 ? (
                        <Box>
                            {data.peakHours.map(ph => {
                                const maxCount = Math.max(...data.peakHours.map(p => p.count));
                                const percent = (ph.count / maxCount) * 100;
                                return (
                                    <Box key={ph._id} mb="default" flex alignItems="center">
                                        <Text width="50px">{String(ph._id).padStart(2, '0')}:00</Text>
                                        <Box flexGrow={1} bg="grey20" height="20px" ml="default" mr="default" style={{ borderRadius: '10px', overflow: 'hidden' }}>
                                            <Box bg="primary100" height="100%" width={`${percent}%`} />
                                        </Box>
                                        <Text width="30px" textAlign="right">{ph.count}</Text>
                                    </Box>
                                );
                            })}
                        </Box>
                    ) : <Text>Sem dados de horários.</Text>}
                </Box>

                {/* Receita por Período */}
                <Box bg="white" p="lg" flexGrow={1} style={{ minWidth: '400px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                    <H4 mb="lg">💰 Receita por Período</H4>
                    <Table>
                        <TableHead>
                            <TableRow>
                                <TableCell>Período (Data)</TableCell>
                                <TableCell>Faturamento Bruto</TableCell>
                                <TableCell>Comissão Plataforma (20%)</TableCell>
                                <TableCell>Corridas</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {data.revenueByPeriod && data.revenueByPeriod.map((rev, idx) => (
                                <TableRow key={idx}>
                                    <TableCell>{rev._id}</TableCell>
                                    <TableCell>R$ {rev.totalFare.toFixed(2)}</TableCell>
                                    <TableCell>R$ {(rev.totalFare * 0.2).toFixed(2)}</TableCell>
                                    <TableCell>{rev.count}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </Box>

                {/* Motoristas Mais Ativos */}
                <Box bg="white" p="lg" flexGrow={1} style={{ minWidth: '350px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                    <H4 mb="lg">🚗 Top 5 Motoristas</H4>
                    <Table>
                        <TableHead>
                            <TableRow>
                                <TableCell>Nome</TableCell>
                                <TableCell>Corridas</TableCell>
                                <TableCell>Faturamento Bruto</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {data.topCaptains && data.topCaptains.map((cap, idx) => (
                                <TableRow key={idx}>
                                    <TableCell>{cap.captainData?.fullname?.firstname} {cap.captainData?.fullname?.lastname}</TableCell>
                                    <TableCell>{cap.count}</TableCell>
                                    <TableCell>R$ {cap.totalGenerated.toFixed(2)}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </Box>

                {/* Passageiros Mais Ativos */}
                <Box bg="white" p="lg" flexGrow={1} style={{ minWidth: '350px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                    <H4 mb="lg">👤 Top 5 Passageiros</H4>
                    <Table>
                        <TableHead>
                            <TableRow>
                                <TableCell>Nome</TableCell>
                                <TableCell>Corridas Solicitadas</TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {data.topUsers && data.topUsers.map((user, idx) => (
                                <TableRow key={idx}>
                                    <TableCell>{user.userData?.fullname?.firstname} {user.userData?.fullname?.lastname}</TableCell>
                                    <TableCell>{user.count}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </Box>

                {/* Corridas por Bairro/Cidade */}
                <Box bg="white" p="lg" flexGrow={1} width="100%" style={{ borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                    <H4 mb="lg">🗺️ Locais de Partida Mais Frequentes (Heatmap Base)</H4>
                    <Box flex flexDirection="row" flexWrap="wrap" style={{ gap: '16px' }}>
                        {data.ridesByLocation && data.ridesByLocation.map((loc, idx) => (
                            <Box key={idx} p="default" bg="grey20" style={{ borderRadius: '4px', minWidth: '150px' }}>
                                <Text color="grey80" variant="sm">Origem</Text>
                                <Text fontWeight="bold" mb="sm" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '250px' }}>{loc._id}</Text>
                                <Text color="primary100" fontWeight="bold">{loc.count} corridas</Text>
                            </Box>
                        ))}
                    </Box>
                </Box>

            </Box>
        </Box>
    );
};

export default Reports;
