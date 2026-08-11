/**
 * Campos públicos de identidade para populate em Ride/Parcel após vínculo.
 * Sem senha, tokens, documentos ou dados administrativos.
 */
module.exports.CAPTAIN_IDENTITY_FIELDS =
    'fullname profilePicture rating vehicle vehicleAuthorization phone socketId location';

module.exports.USER_IDENTITY_FIELDS =
    'fullname profilePicture rating phone socketId';

/** Oferta pré-aceite: só primeiro nome — sem foto nem telefone. */
module.exports.toOfferPassengerPreview = (user) => {
    if (!user) return undefined;
    const raw = typeof user.toObject === 'function' ? user.toObject() : user;
    return {
        _id: raw._id,
        fullname: {
            firstname: raw.fullname?.firstname || 'Passageiro',
        },
    };
};
