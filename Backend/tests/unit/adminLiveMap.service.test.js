const { formatLiveMapDriver } = require('../../services/admin.service');

describe('formatLiveMapDriver', () => {
    it('marca disponível quando pode receber corridas e não está busy', () => {
        const driver = formatLiveMapDriver({
            _id: { toString: () => 'cap1' },
            fullname: { firstname: 'Ana', lastname: 'Silva' },
            location: { ltd: -23.5, lng: -46.6 },
            canReceiveRides: true,
            busyLock: false,
            vehicle: { plate: 'ABC1D23', vehicleType: 'car', color: 'preto', modelo: 'Onix' },
            lastSeenAt: new Date('2026-08-05T12:00:00.000Z'),
        });

        expect(driver.captainId).toBe('cap1');
        expect(driver.name).toBe('Ana Silva');
        expect(driver.status).toBe('available');
        expect(driver.vehicle.plate).toBe('ABC1D23');
        expect(driver.ltd).toBe(-23.5);
        expect(driver.lng).toBe(-46.6);
    });

    it('marca in_ride quando canReceiveRides é false ou busyLock', () => {
        const byFlag = formatLiveMapDriver({
            _id: { toString: () => 'cap2' },
            fullname: { firstname: 'Bia' },
            location: { ltd: 1, lng: 2 },
            canReceiveRides: false,
            busyLock: false,
            vehicle: {},
        });
        expect(byFlag.status).toBe('in_ride');
        expect(byFlag.name).toBe('Bia');

        const byLock = formatLiveMapDriver({
            _id: { toString: () => 'cap3' },
            fullname: {},
            location: { ltd: 1, lng: 2 },
            canReceiveRides: true,
            busyLock: true,
            vehicle: {},
        });
        expect(byLock.status).toBe('in_ride');
        expect(byLock.name).toBe('Motorista');
    });
});
