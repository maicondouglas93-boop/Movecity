const mongoose = require('mongoose')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')

const captainSchema = new mongoose.Schema({
    fullname: {
        firstname: {
            type: String,
            required: true,
            minlength: [ 1, 'Firstname must be at least 1 character long' ],
        },
        lastname: {
            type: String,
            minlength: [ 1, 'Lastname must be at least 1 character long' ],
        }
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        match: [ /^\S+@\S+\.\S+$/, 'Please enter a valid email' ]
    },
    password: {
        type: String,
        required: true,
        select: false,
    },
    cpf: {
        type: String,
        unique: true,
        sparse: true,
        match: [ /^\d{11}$/, 'Please enter a valid 11-digit CPF' ]
    },
    birthDate: {
        type: Date
    },
    socketId: {
        type: String,
    },

    phone: {
        type: String,
        required: true,
        match: [ /^\+\d{10,15}$/, 'Please enter a valid E.164 phone number (e.g. +5511999999999)' ]
    },

    isBlocked: {
        type: Boolean,
        default: false,
    },

    approvalStatus: {
        type: String,
        enum: [ 'iniciado', 'documentos_enviados', 'em_analise', 'aprovado', 'reprovado', 'suspenso', 'bloqueado' ],
        default: 'iniciado',
    },

    rating: {
        type: Number,
        default: 5.0,
    },

    earnings: {
        type: Number,
        default: 0,
    },

    documents: {
        cnhFront: { url: { type: String, default: '' }, verified: { type: Boolean, default: false } },
        cnhBack: { url: { type: String, default: '' }, verified: { type: Boolean, default: false } },
        crlv: { url: { type: String, default: '' }, verified: { type: Boolean, default: false } },
        vehicleFront: { url: { type: String, default: '' }, verified: { type: Boolean, default: false } },
        selfie: { url: { type: String, default: '' }, verified: { type: Boolean, default: false } }
    },
    cnh: {
        number: { type: String },
        category: { type: String },
        expiration: { type: Date },
        uf: { type: String },
        ear: { type: Boolean, default: false }
    },
    pix: {
        keyType: { type: String, enum: ['cpf', 'celular', 'email', 'aleatoria'] },
        key: { type: String }
    },
    bankDetails: {
        bankName: { type: String },
        bankAgency: { type: String },
        bankAccount: { type: String },
        accountType: { type: String, enum: ['corrente', 'poupanca'] }
    },
    canReceiveRides: {
        type: Boolean,
        default: true
    },
    status: {
        type: String,
        enum: [ 'active', 'inactive' ],
        default: 'inactive',
    },

    isOnline: {
        // Separação disponibilidade x conexão (2026-08-03): este campo representa
        // apenas a INTENÇÃO do motorista ("quero receber corridas"), definida pelo
        // botão "Ficar Online". Antes ele também era zerado pelo `disconnect` do
        // socket, o que fazia fechar o app remover o motorista do despacho — e por
        // isso a push de corrida nova com o app fechado nunca era alcançável.
        // Conectividade agora é `socketId` + `lastSeenAt`, campos separados.
        type: Boolean,
        default: false,
    },

    lastSeenAt: {
        type: Date,
        default: null,
        description: "Último contato real com o motorista (join de socket, atualização de localização ou toggle-online). Usado com isOnline para decidir se ele ainda está disponível — ver captain.service.js: availabilityFilter."
    },

    totalRides: {
        type: Number,
        default: 0,
    },
    onlineTimeSeconds: {
        type: Number,
        default: 0,
        description: "Acumulado vitalício (todas as sessões online já finalizadas)"
    },
    onlineSince: {
        type: Date,
        default: null,
        description: "Início da sessão online atual (null se offline). Usado para calcular tempo online real."
    },
    todayOnlineSeconds: {
        type: Number,
        default: 0,
        description: "Acumulado de hoje (sessões já finalizadas). Zera ao virar o dia — ver captain.service.js"
    },
    todayOnlineDate: {
        type: Date,
        default: null,
        description: "Início (00:00) do dia a que todayOnlineSeconds se refere"
    },
    acceptanceRate: {
        type: Number,
        default: 100, // percentage 0-100
    },
    cancellationRate: {
        type: Number,
        default: 0, // percentage 0-100
    },

    vehicle: {
        marca: {
            type: String
        },
        modelo: {
            type: String
        },
        ano: {
            type: Number
        },
        color: {
            type: String,
            required: true,
            minlength: [ 3, 'Color must be at least 3 characters long' ],
        },
        plate: {
            type: String,
            required: true,
            minlength: [ 3, 'Plate must be at least 3 characters long' ],
        },
        capacity: {
            type: Number,
            required: true,
            min: [ 1, 'Capacity must be at least 1' ],
        },
        vehicleType: {
            // Corresponde a vehicleCategory.name. Não é mais um enum fixo: a validade é
            // checada em runtime no cadastro (categoria precisa existir e estar ativa).
            type: String,
            required: true
        }
    },

    location: {
        ltd: {
            type: Number,
        },
        lng: {
            type: Number,
        }
    },
    locationGeoJSON: {
        type: {
            type: String,
            enum: ['Point'],
            default: 'Point'
        },
        coordinates: {
            type: [Number], // [longitude, latitude]
            default: [0, 0] // Default for the ocean off Africa, updated on real location
        }
    },
    cancelledRides: {
        type: Number,
        default: 0,
    }
}, { timestamps: true });

// Índices de Performance e Geolocalização
captainSchema.index({ status: 1 });
captainSchema.index({ isOnline: 1 });
// Composto: toda consulta de disponibilidade filtra pelos dois juntos
// (captain.service.js: availabilityFilter).
captainSchema.index({ isOnline: 1, lastSeenAt: -1 });
captainSchema.index({ canReceiveRides: 1 });
captainSchema.index({ locationGeoJSON: '2dsphere' });



captainSchema.methods.generateAuthToken = function () {
    const token = jwt.sign({ _id: this._id }, process.env.JWT_SECRET, { expiresIn: '24h' });
    return token;
}


captainSchema.methods.comparePassword = async function (password) {
    return await bcrypt.compare(password, this.password);
}


captainSchema.statics.hashPassword = async function (password) {
    return await bcrypt.hash(password, 10);
}

const captainModel = mongoose.model('captain', captainSchema)


module.exports = captainModel;