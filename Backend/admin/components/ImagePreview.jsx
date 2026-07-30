import React from 'react';
import { Box, Label } from '@adminjs/design-system';

const ImagePreview = (props) => {
    const { property, record } = props;
    
    // O valor armazenado no banco para o campo de imagem. 
    // Em nosso schema, "documents.cnhFront.url" mapeia diretamente para o path no banco.
    // O AdminJS passa property.name como path.
    const url = record.params[property.name];

    return (
        <Box marginBottom="xxl">
            <Label>{property.label}</Label>
            {url ? (
                <img 
                    src={url} 
                    alt={property.label} 
                    style={{ maxHeight: '300px', maxWidth: '100%', borderRadius: '8px', border: '1px solid #27272a' }} 
                />
            ) : (
                <div style={{ color: '#71717a' }}>Sem imagem enviada</div>
            )}
        </Box>
    );
};

export default ImagePreview;
