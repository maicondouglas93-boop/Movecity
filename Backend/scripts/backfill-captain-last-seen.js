const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const captainModel = require('../models/captain.model');

// Separação disponibilidade x conexão (2026-08-03) — ver
// docs/plans/2026-08-03-disponibilidade-vs-conexao-motorista.md.
//
// O despacho passou a exigir `lastSeenAt` recente no lugar de socket vivo. Motoristas
// já cadastrados não têm esse campo (null), e `{ $gte: <data> }` NÃO casa com null —
// então, sem este backfill, todo motorista atualmente online sairia do despacho no
// momento do deploy e deixaria de receber corridas até reabrir o app ou tocar em
// "Ficar Online" de novo.
//
// Só toca em quem está `isOnline: true` (quem está offline não deve ser despachado de
// qualquer forma, e ficar online já grava lastSeenAt). Marcar com "agora" dá a esses
// motoristas a janela normal do TTL: quem realmente estiver lá renova o lastSeenAt em
// segundos (o join do socket e a atualização de localização fazem isso); quem sumiu sai
// do despacho sozinho quando o TTL vencer.
//
// Idempotente: só considera documentos em que lastSeenAt ainda não existe.
async function backfill() {
    try {
        console.log("Conectando ao banco de dados...");
        const dbUri = process.env.DB_CONNECT;
        if (!dbUri) throw new Error("DB_CONNECT não encontrado no .env");

        await mongoose.connect(dbUri);
        console.log("Conectado! Verificando motoristas online sem lastSeenAt...");

        const filter = { isOnline: true, $or: [{ lastSeenAt: null }, { lastSeenAt: { $exists: false } }] };

        const affected = await captainModel.countDocuments(filter);
        console.log(`Motoristas online sem lastSeenAt -> ${affected}`);

        const result = await captainModel.updateMany(filter, { $set: { lastSeenAt: new Date() } });
        console.log(`Backfill aplicado -> modifiedCount: ${result.modifiedCount}`);

        if (result.modifiedCount === 0) {
            console.log("Nenhum documento precisou de correção — já estava tudo certo, ou esta é uma segunda execução (esperado e seguro).");
        }

        console.log("\nRode este script UMA VEZ, junto com o deploy do código que introduz o lastSeenAt.");
    } catch (error) {
        console.error("Erro no backfill:", error);
    } finally {
        await mongoose.disconnect();
        console.log("Desconectado.");
        process.exit(0);
    }
}

backfill();
