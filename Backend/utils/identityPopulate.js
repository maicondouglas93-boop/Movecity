/**
 * Campos operacionais para serviços de Ride/Parcel após vínculo. Incluem socketId e
 * localização apenas para roteamento interno; nunca devem ser serializados diretamente.
 * Toda resposta pública passa pelos DTOs allowlist de actorDtos.js.
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
        fullname: {
            firstname: raw.fullname?.firstname || 'Passageiro',
        },
    };
};
