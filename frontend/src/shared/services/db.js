import Dexie from 'dexie';

export const db = new Dexie('MoveCityDB');

db.version(1).stores({
    offlineActions: '++id, type, rideId, timestamp', // queue for actions like ACCEPT_RIDE, START_RIDE
    driverLocations: '++id, lat, lng, timestamp' // queue for GPS points
});

// v2 (P1.2 da auditoria de concorrência, 2026-08-02): offlineActions passou a guardar
// method/url/body reais (pra reexecutar via HTTP, não mais via socket.emit — ver
// services/offlineQueue.js) e um contador de tentativas. failedActions é o destino final
// de uma ação que esgotou as tentativas — fica registrada em vez de simplesmente
// desaparecer, pra o motorista (e o suporte) conseguirem ver o que não sincronizou.
db.version(2).stores({
    offlineActions: '++id, type, rideId, timestamp, attempts',
    driverLocations: '++id, lat, lng, timestamp',
    failedActions: '++id, type, rideId, timestamp, failedAt'
});
