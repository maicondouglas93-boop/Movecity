const mongoose = require('mongoose')
const bcrypt = require('bcrypt')

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
    // Foto de perfil pública (cadastro / perfil) — distinta da selfie de documento.
    profilePicture: {
        type: String,
        default: '',
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
        // Simplificação do cadastro (2026-08-04): deixou de ser pedido no cadastro
        // inicial — não é usado em nenhum outro fluxo do app hoje (nenhuma tela liga
        // pro motorista). Continua opcional aqui em vez de removido, para não perder o
        // dado de quem já tinha informado antes desta mudança.
        type: String,
        match: [ /^\+\d{10,15}$/, 'Please enter a valid E.164 phone number (e.g. +5511999999999)' ]
    },

    isBlocked: {
        type: Boolean,
        default: false,
    },

    approvalStatus: {
        // 'expirado' adicionado na simplificação do cadastro (2026-08-04): motorista
        // que não enviou a documentação dentro do prazo de documentDeadline. Diferente
        // de 'reprovado' (documento avaliado e recusado) — aqui ninguém avaliou nada,
        // o prazo só terminou. Ver services/captainDeadline.service.js.
        type: String,
        enum: [ 'iniciado', 'documentos_enviados', 'em_analise', 'aprovado', 'reprovado', 'suspenso', 'bloqueado', 'expirado' ],
        default: 'iniciado',
    },

    // Simplificação do cadastro (2026-08-04): prazo para enviar a documentação
    // obrigatória, calculado no backend (createdAt + 5 dias) no momento da criação da
    // conta — nunca no frontend, que não é fonte confiável de tempo. Null nos
    // motoristas criados antes desta mudança (ver migração em scripts/).
    documentDeadline: {
        type: Date,
        default: null,
    },
    // Evita reenviar o lembrete de "prazo terminando" a cada tick do cron — ver
    // services/captainDeadline.service.js.
    documentDeadlineReminderSent: {
        type: Boolean,
        default: false,
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
        // `reason` adicionado na simplificação do cadastro (2026-08-04): antes, o motivo
        // de rejeição de um documento só existia no log de auditoria do admin — o
        // motorista via "não verificado" sem nenhuma pista de por quê. Setado pelo admin
        // em admin.service.js: updateCaptainDocument (limpo automaticamente ao aprovar).
        // `uploadedAt` adicionado pra suportar upload direto pelo admin (2026-08-10) —
        // até então só o próprio motorista enviava, e não havia data de envio registrada.
        cnhFront: { url: { type: String, default: '' }, verified: { type: Boolean, default: false }, reason: { type: String, default: '' }, uploadedAt: { type: Date, default: null } },
        cnhBack: { url: { type: String, default: '' }, verified: { type: Boolean, default: false }, reason: { type: String, default: '' }, uploadedAt: { type: Date, default: null } },
        crlv: { url: { type: String, default: '' }, verified: { type: Boolean, default: false }, reason: { type: String, default: '' }, uploadedAt: { type: Date, default: null } },
        vehicleFront: { url: { type: String, default: '' }, verified: { type: Boolean, default: false }, reason: { type: String, default: '' }, uploadedAt: { type: Date, default: null } },
        selfie: { url: { type: String, default: '' }, verified: { type: Boolean, default: false }, reason: { type: String, default: '' }, uploadedAt: { type: Date, default: null } }
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
    // Quais famílias de corrida o ADM autorizou. É independente do veículo cadastrado,
    // do status online e da disponibilidade operacional.
    vehicleAuthorization: {
        type: String,
        enum: [ 'car', 'motorcycle', 'car_motorcycle' ],
        default: undefined,
        index: true,
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
    },
    // Lock cruzado ride↔parcel no accept (auditoria P0/P1 Encomendas).
    // true = captain ocupado em um serviço ativo; liberado no finish/cancel.
    busyLock: {
        type: Boolean,
        default: false,
        index: true,
    },
}, { timestamps: true });

// Índices de Performance e Geolocalização
captainSchema.index({ status: 1 });
// Consulta do cron de expiração de documentação (captainDeadline.service.js): só
// varre quem ainda pode expirar, nunca a coleção inteira.
captainSchema.index({ documentDeadline: 1, approvalStatus: 1 });
captainSchema.index({ isOnline: 1 });
// Composto: toda consulta de disponibilidade filtra pelos dois juntos
// (captain.service.js: availabilityFilter).
captainSchema.index({ isOnline: 1, lastSeenAt: -1 });
captainSchema.index({ canReceiveRides: 1 });
captainSchema.index({ locationGeoJSON: '2dsphere' });



captainSchema.methods.generateAuthToken = function () {
    const { generateAccessToken } = require('../services/auth.service');
    return generateAccessToken(this._id, 'captain');
}


captainSchema.methods.comparePassword = async function (password) {
    return await bcrypt.compare(password, this.password);
}


captainSchema.statics.hashPassword = async function (password) {
    return await bcrypt.hash(password, 10);
}

const captainModel = mongoose.model('captain', captainSchema)


module.exports = captainModel;
