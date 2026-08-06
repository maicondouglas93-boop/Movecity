const state = { doc: null };

vi.mock('../../models/driverAppVersion.model', () => {
  class FakeDoc {
    constructor(data) {
      Object.assign(this, data);
    }
    async save() {
      state.doc = this;
      return this;
    }
  }
  return {
    findOne: vi.fn(() => ({
      sort: vi.fn(async () => state.doc),
    })),
    create: vi.fn(async (data) => {
      state.doc = new FakeDoc({ ...data, updatedAt: new Date() });
      return state.doc;
    }),
  };
});

const service = require('../../services/driverAppVersion.service');

describe('driverAppVersion.service', () => {
  beforeEach(() => {
    state.doc = null;
    vi.clearAllMocks();
  });

  it('cria defaults na primeira leitura', async () => {
    const data = await service.getPublic();
    expect(data.version).toBe('1.1.0');
    expect(data.versionCode).toBe(2);
    expect(data.apkUrl).toBe('');
  });

  it('atualiza metadados sem armazenar APK', async () => {
    const data = await service.update({
      version: '1.5.0',
      versionCode: 15,
      minimumVersion: '1.4.0',
      minimumVersionCode: 14,
      apkUrl: 'https://cdn.example.com/driver.apk',
      sha256: 'a'.repeat(64),
      mandatory: true,
      releaseNotes: 'GPS\nNotificações',
    });
    expect(data.version).toBe('1.5.0');
    expect(data.versionCode).toBe(15);
    expect(data.apkUrl).toContain('https://');
    expect(data.releaseNotes).toEqual(['GPS', 'Notificações']);
    expect(data.mandatory).toBe(true);
  });

  it('rejeita sha256 inválido', async () => {
    await expect(service.update({ sha256: 'abc' })).rejects.toThrow(/sha256/i);
  });
});
