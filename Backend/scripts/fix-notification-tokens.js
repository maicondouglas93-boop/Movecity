const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

// Carrega as variáveis de ambiente corretas
dotenv.config({ path: path.join(__dirname, '../.env') });

const NotificationToken = require('../models/notificationToken.model');

// Corrige documentos de NotificationToken gravados antes de notification.controller.js
// parar de gravar `null` explícito no campo que não se aplica (userId para motorista,
// captainId para passageiro). Enquanto esse `null` existir, consultas de segmentação
// como `{campo: {$exists:true}}` (sendAdminNotification) casam com QUALQUER documento —
// null ainda "exists" — vazando notificação de motorista pra passageiro e vice-versa, e
// duplicando todo envio "all" (C4 da auditoria de push, 2026-08-02).
//
// Em lote (updateMany), não documento por documento: esta coleção tem potencialmente um
// documento por dispositivo — iterar um por um (como em fix-vehicle-categories.js, que só
// tinha 3 documentos) não escala.
//
// Idempotente: rodar de novo depois de já corrigido encontra 0 documentos e não altera
// nada. IMPORTANTE: rode este script novamente logo após o deploy do código que corrige
// notification.controller.js — tokens registrados na janela entre esta execução e o
// deploy (pelo controller antigo) voltam a gravar null e precisam de uma segunda passada.
async function migrate() {
    try {
        console.log("Conectando ao banco de dados...");
        const dbUri = process.env.DB_CONNECT;
        if (!dbUri) throw new Error("DB_CONNECT não encontrado no .env");

        await mongoose.connect(dbUri);
        console.log("Conectado! Verificando tokens de notificação...");

        // IMPORTANTE: `{campo: null}` no MongoDB casa tanto com valor null explícito
        // QUANTO com o campo simplesmente ausente — então usar isso como filtro faria
        // a "correção" achar sempre os mesmos documentos (e o Mongoose ainda bate
        // updatedAt em todo $unset, mesmo sem nada pra remover, inflando modifiedCount)
        // e o script pareceria nunca ficar idempotente. `$type: 10` (BSON Null) é o
        // único jeito de mirar só quem tem o campo REALMENTE gravado como null.
        const NULL_BSON_TYPE = 10;
        const userNullCount = await NotificationToken.countDocuments({ userId: { $type: NULL_BSON_TYPE } });
        const captainNullCount = await NotificationToken.countDocuments({ captainId: { $type: NULL_BSON_TYPE } });
        console.log(`Documentos com userId:null (deveriam ser só de motorista) -> ${userNullCount}`);
        console.log(`Documentos com captainId:null (deveriam ser só de passageiro) -> ${captainNullCount}`);

        const userResult = await NotificationToken.updateMany(
            { userId: { $type: NULL_BSON_TYPE } },
            { $unset: { userId: '' } }
        );
        const captainResult = await NotificationToken.updateMany(
            { captainId: { $type: NULL_BSON_TYPE } },
            { $unset: { captainId: '' } }
        );

        console.log(`userId:null corrigidos -> modifiedCount: ${userResult.modifiedCount}`);
        console.log(`captainId:null corrigidos -> modifiedCount: ${captainResult.modifiedCount}`);
        console.log("Migração concluída com sucesso!");

        if (userResult.modifiedCount === 0 && captainResult.modifiedCount === 0) {
            console.log("Nenhum documento precisou de correção — já estava tudo certo, ou esta é uma segunda execução (esperado e seguro).");
        }

        console.log("\nLEMBRETE: rode este script de novo logo após o deploy do código corrigido em notification.controller.js.");
    } catch (error) {
        console.error("Erro na migração:", error);
    } finally {
        await mongoose.disconnect();
        console.log("Desconectado.");
        process.exit(0);
    }
}

migrate();
