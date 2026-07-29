module.exports = {
    createCustomer: jest.fn().mockResolvedValue({ id: 'cus_mock123' }),
    createPixCharge: jest.fn().mockResolvedValue({ 
        id: 'pay_mockpix',
        invoiceUrl: 'http://mock.pix', 
        payload: 'mock_payload' 
    }),
    createCreditCardCharge: jest.fn().mockResolvedValue({ 
        id: 'pay_mockcard',
        status: 'CONFIRMED' 
    }),
    createTransfer: jest.fn().mockResolvedValue({ 
        id: 'trans_mock',
        status: 'PENDING' 
    }),
    checkPaymentStatus: jest.fn().mockResolvedValue({ 
        id: 'pay_mockpix',
        status: 'RECEIVED' 
    })
};
