import React, { useState } from 'react';
import { Box, Button, Input, Label, FormGroup, NoticeBox } from '@adminjs/design-system';
import { useNotice, ApiClient } from 'adminjs';
import { useNavigate } from 'react-router-dom'; // AdminJS uses react-router under the hood usually, but we can also use window.location

const api = new ApiClient();

const ManualAdjustment = (props) => {
    const { record, resource, action } = props;
    const [amount, setAmount] = useState('');
    const [reason, setReason] = useState('');
    const [loading, setLoading] = useState(false);
    
    // addNotice is provided by useNotice
    const addNotice = useNotice();

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!amount || isNaN(amount) || amount == 0) {
            addNotice({ message: 'Informe um valor válido (diferente de zero).', type: 'error' });
            return;
        }
        if (!reason || reason.trim().length < 3) {
            addNotice({ message: 'Informe um motivo claro para a auditoria.', type: 'error' });
            return;
        }

        setLoading(true);
        try {
            // Chama a própria action enviando os dados via POST
            const response = await api.recordAction({
                resourceId: resource.id,
                recordId: record.id,
                actionName: action.name,
                method: 'post',
                data: {
                    amount: amount,
                    reason: reason
                }
            });

            if (response.data.notice) {
                addNotice(response.data.notice);
            }
            
            // Redirect to list or show page
            window.location.href = `/admin/resources/${resource.id}/records/${record.id}/show`;
        } catch (error) {
            addNotice({ message: 'Erro ao processar ajuste.', type: 'error' });
        } finally {
            setLoading(false);
        }
    };

    return (
        <Box variant="white" padding="xl" width="100%" style={{ maxWidth: '600px', margin: '0 auto' }}>
            <Box marginBottom="lg">
                <h1 style={{ marginBottom: '8px' }}>Ajuste Manual de Saldo</h1>
                <p style={{ color: '#71717a' }}>Motorista: {record.params['fullname.firstname']} {record.params['fullname.lastname']}</p>
                <p style={{ color: '#71717a' }}>Saldo Atual: R$ {record.params.earnings}</p>
            </Box>

            <NoticeBox mb="lg">
                Valores positivos adicionam saldo (ex: bônus). Valores negativos deduzem saldo (ex: taxa). Todas as ações ficam registradas no extrato.
            </NoticeBox>

            <form onSubmit={handleSubmit}>
                <FormGroup>
                    <Label required>Valor (R$)</Label>
                    <Input 
                        type="number" 
                        step="0.01" 
                        value={amount} 
                        onChange={(e) => setAmount(e.target.value)} 
                        placeholder="Ex: 50.00 ou -20.00" 
                        width="100%"
                    />
                </FormGroup>

                <FormGroup>
                    <Label required>Motivo (Auditoria)</Label>
                    <Input 
                        type="text" 
                        value={reason} 
                        onChange={(e) => setReason(e.target.value)} 
                        placeholder="Ex: Bônus de indicação, Estorno de viagem..." 
                        width="100%"
                    />
                </FormGroup>

                <Box marginTop="xl" display="flex" style={{ gap: '16px' }}>
                    <Button variant="primary" type="submit" disabled={loading}>
                        {loading ? 'Processando...' : 'Confirmar Ajuste'}
                    </Button>
                    <Button type="button" variant="text" onClick={() => window.history.back()}>
                        Cancelar
                    </Button>
                </Box>
            </form>
        </Box>
    );
};

export default ManualAdjustment;
