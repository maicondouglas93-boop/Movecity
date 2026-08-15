module.exports = {
    initializeApp: jest.fn(),
    credential: { cert: jest.fn() },
    cert: jest.fn()
};

module.exports.auth = () => {
    return {
        verifyIdToken: jest.fn().mockResolvedValue({
            uid: 'mock_uid',
            email: 'mock@test.com',
            email_verified: true,
            firebase: { sign_in_provider: 'google.com' }
        })
    };
};

module.exports.getAuth = jest.fn(() => ({
    verifyIdToken: jest.fn().mockResolvedValue({
        uid: 'mock_uid',
        email: 'mock@test.com',
        email_verified: true,
        firebase: { sign_in_provider: 'google.com' }
    })
}));
