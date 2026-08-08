// Cria usuários/motoristas claramente marcados como SIMULATOR/TEST — nome, email e
// cpf deixam isso óbvio em qualquer log ou dump do banco. O banco em si já é um
// MongoMemoryReplSet efêmero (nunca o banco real de produção), então este marcador é
// defesa em profundidade + legibilidade do relatório, não a garantia de isolamento.
const { createUser } = require('../../factories/user.factory');
const { createCaptain } = require('../../factories/captain.factory');

let counter = 0;
const nextTag = () => `${Date.now()}${(counter++).toString().padStart(3, '0')}`;

// Telefone precisa bater com /^\+\d{10,15}$/ (E.164 puro) — não dá pra colocar "TEST"
// dentro do número. O marcador de identidade fica em fullname/email/cpf.
const simPhone = (tag) => `+5511${tag}`.slice(0, 15);

async function createSimUser(overrides = {}) {
    const tag = nextTag();
    return createUser({
        fullname: { firstname: 'SIMULATOR', lastname: 'MoveCity-E2E' },
        email: `sim.user.${tag}@movecity.test`,
        phone: simPhone(tag),
        cpf: tag.slice(-11).padStart(11, '0'),
        ...overrides,
    });
}

async function createSimCaptain(overrides = {}) {
    const tag = nextTag();
    return createCaptain({
        fullname: { firstname: 'SIMULATOR', lastname: 'MoveCity-E2E' },
        email: `sim.captain.${tag}@movecity.test`,
        phone: simPhone(tag),
        cpf: tag.slice(-11).padStart(11, '0'),
        ...overrides,
    });
}

module.exports = { createSimUser, createSimCaptain };
