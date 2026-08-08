const parcelModel = require('../../models/parcel.model');
const { createUser } = require('./user.factory');
const { createCaptain } = require('./captain.factory');

module.exports.createParcel = async (overrides = {}) => {
    let { user, captain } = overrides;

    if (!user) user = (await createUser())._id;
    if (captain === undefined) captain = (await createCaptain())._id;

    const defaultData = {
        user,
        captain,
        vehicleType: 'car',
        pickup: 'Avenida Paulista, São Paulo',
        destination: 'Avenida Faria Lima, São Paulo',
        sender: { name: 'Remetente Teste', phone: '+5511900000001' },
        recipient: { name: 'Destinatário Teste', phone: '+5511900000002' },
        itemName: 'Pacote de teste',
        category: 'outros',
        weightKg: 2,
        size: 'small',
        fare: 25.00,
        deliveryPin: '4321',
        status: 'awaiting_provider',
        paymentMethod: 'cash',
    };

    return await parcelModel.create({ ...defaultData, ...overrides });
};
