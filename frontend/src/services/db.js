import Dexie from 'dexie';

export const db = new Dexie('MoveCityDB');

db.version(1).stores({
    offlineActions: '++id, type, rideId, timestamp', // queue for actions like ACCEPT_RIDE, START_RIDE
    driverLocations: '++id, lat, lng, timestamp' // queue for GPS points
});
