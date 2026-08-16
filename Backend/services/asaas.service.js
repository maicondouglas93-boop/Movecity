const axios = require('axios');

const ASAAS_API_URL = process.env.ASAAS_API_URL || 'https://sandbox.asaas.com/api/v3';
const ASAAS_API_KEY = process.env.ASAAS_API_KEY;

const asaasApi = axios.create({
    baseURL: ASAAS_API_URL,
    headers: {
        'access_token': ASAAS_API_KEY
    }
});

module.exports.createCustomer = async (customerData) => {
    try {
        const response = await asaasApi.post('/customers', customerData);
        return response.data;
    } catch (error) {
        console.error('Asaas Create Customer Error:', error.response?.data || error.message);
        throw error;
    }
};

module.exports.createPixCharge = async (chargeData) => {
    try {
        const response = await asaasApi.post('/payments', {
            customer: chargeData.customer,
            billingType: 'PIX',
            value: chargeData.value,
            dueDate: chargeData.dueDate || new Date(new Date().setDate(new Date().getDate() + 1)).toISOString().split('T')[0],
            description: chargeData.description
        });
        return response.data;
    } catch (error) {
        console.error('Asaas Create PIX Charge Error:', error.response?.data || error.message);
        throw error;
    }
};

module.exports.getPixQrCode = async (paymentId) => {
    try {
        const response = await asaasApi.get(`/payments/${paymentId}/pixQrCode`);
        return response.data;
    } catch (error) {
        console.error('Asaas Get PIX QRCode Error:', error.response?.data || error.message);
        throw error;
    }
};

module.exports.createCreditCardCharge = async (chargeData) => {
    try {
        const response = await asaasApi.post('/payments', {
            customer: chargeData.customer,
            billingType: 'CREDIT_CARD',
            value: chargeData.value,
            dueDate: new Date().toISOString().split('T')[0],
            creditCard: chargeData.creditCard, // Should be tokenized in frontend and passed here if possible, or raw if PCI compliant
            creditCardHolderInfo: chargeData.creditCardHolderInfo,
            remoteIp: chargeData.remoteIp
        });
        return response.data;
    } catch (error) {
        console.error('Asaas Credit Card Charge Error:', error.response?.data || error.message);
        throw error;
    }
};

module.exports.getPayment = async (paymentId) => {
    try {
        const response = await asaasApi.get(`/payments/${paymentId}`);
        return response.data;
    } catch (error) {
        console.error('Asaas Get Payment Error:', error.response?.data || error.message);
        throw error;
    }
};

module.exports.refundPayment = async (paymentId, { value, description } = {}) => {
    try {
        const body = {};
        if (Number(value) > 0) body.value = Number(value);
        if (description) body.description = description;
        const response = await asaasApi.post(`/payments/${paymentId}/refund`, body);
        return response.data;
    } catch (error) {
        console.error('Asaas Refund Payment Error:', error.response?.data || error.message);
        throw error;
    }
};

module.exports.deletePayment = async (paymentId) => {
    try {
        const response = await asaasApi.delete(`/payments/${paymentId}`);
        return response.data;
    } catch (error) {
        console.error('Asaas Delete Payment Error:', error.response?.data || error.message);
        throw error;
    }
};
