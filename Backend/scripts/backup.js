const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const DB_URI = process.env.DB_CONNECT || 'mongodb://localhost:27017/uberdemo';
const BACKUP_DIR = path.join(__dirname, '../backups');

if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

const date = new Date();
const timestamp = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}_${date.getHours()}-${date.getMinutes()}`;
const backupPath = path.join(BACKUP_DIR, `backup-${timestamp}.gz`);

// Usando mongodump para exportar em formato compactado gzip
const cmd = `mongodump --uri="${DB_URI}" --archive="${backupPath}" --gzip`;

console.log(`Iniciando backup em: ${backupPath}`);

exec(cmd, (error, stdout, stderr) => {
    if (error) {
        console.error(`Erro ao executar backup: ${error.message}`);
        return;
    }
    if (stderr) {
        console.log(`Backup finalizado: ${stderr}`);
    }
    console.log("Backup realizado com sucesso!");
});
