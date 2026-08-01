// Mensagem de erro diferenciada por tipo de falha (item 17 da auditoria de UX — hoje
// timeout, erro de rede e erro 5xx caem todos na mesma mensagem genérica ou na mensagem
// crua do backend, que nem sempre existe pra essas falhas de infraestrutura).
export function getFriendlyErrorMessage(error, fallback = 'Algo deu errado. Tente novamente.') {
    if (!error?.response) {
        if (error?.code === 'ECONNABORTED') {
            return 'A conexão demorou demais para responder. Verifique sua internet e tente de novo.';
        }
        return 'Não foi possível conectar ao servidor. Verifique sua internet e tente de novo.';
    }

    if (error.response.status >= 500) {
        return 'Nosso servidor teve um problema momentâneo. Tente novamente em instantes.';
    }

    return error.response.data?.message || fallback;
}
