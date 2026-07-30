import React, { useEffect } from 'react';
import { Box, NoticeBox } from '@adminjs/design-system';

const ExportCSVBulk = (props) => {
    const { records, resource } = props;

    useEffect(() => {
        if (records && records.length > 0) {
            const ids = records.map(r => r.params._id).join(',');
            // Força o download chamando a nossa rota customizada
            window.open(`/admin/api/payouts/export?ids=${ids}`, '_blank');
        }
        
        // Retorna para a página anterior após 1 segundo
        setTimeout(() => {
            window.history.back();
        }, 1000);
    }, [records]);

    return (
        <Box variant="white" padding="xl" style={{ textAlign: 'center' }}>
            <NoticeBox>
                Gerando arquivo CSV para download... Aguarde.
            </NoticeBox>
        </Box>
    );
};

export default ExportCSVBulk;
