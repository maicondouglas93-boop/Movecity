const GlobalTariff = require('../../models/globalTariff.model');
const service = require('../../services/globalTariff.service');

describe('globalTariff.service', () => {
    beforeEach(async () => {
        await GlobalTariff.deleteMany({});
    });

    it('cria tarifa global', async () => {
        const item = await service.create({ name: 'Taxa de embarque', value: 2, active: true });
        expect(item.name).toBe('Taxa de embarque');
        expect(item.value).toBe(2);
        expect(item.active).toBe(true);
        expect(item._id).toBeTruthy();
    });

    it('rejeita nome vazio e valor negativo', async () => {
        await expect(service.create({ name: '  ', value: 1 })).rejects.toThrow(/obrigatório/i);
        await expect(service.create({ name: 'X', value: -1 })).rejects.toThrow(/negativo/i);
        await expect(service.create({ name: 'X', value: 'abc' })).rejects.toThrow(/numérico/i);
    });

    it('edita sem criar outro registro', async () => {
        const created = await service.create({ name: 'A', value: 1 });
        const updated = await service.update(created._id, { name: 'B', value: 3 });
        expect(String(updated._id)).toBe(String(created._id));
        expect(updated.name).toBe('B');
        expect(updated.value).toBe(3);
        expect(await GlobalTariff.countDocuments()).toBe(1);
    });

    it('ativa e desativa', async () => {
        const created = await service.create({ name: 'A', value: 1, active: true });
        const off = await service.setActive(created._id, false);
        expect(off.active).toBe(false);
        const on = await service.setActive(created._id, true);
        expect(on.active).toBe(true);
    });

    it('exclui definitivamente', async () => {
        const created = await service.create({ name: 'A', value: 1 });
        await service.remove(created._id);
        expect(await GlobalTariff.countDocuments()).toBe(0);
    });

    it('listActiveForPricing só retorna ativas', async () => {
        await service.create({ name: 'Ativa', value: 2, active: true });
        await service.create({ name: 'Inativa', value: 9, active: false });
        const active = await service.listActiveForPricing();
        expect(active).toHaveLength(1);
        expect(active[0].name).toBe('Ativa');
        expect(active[0].value).toBe(2);
    });
});
