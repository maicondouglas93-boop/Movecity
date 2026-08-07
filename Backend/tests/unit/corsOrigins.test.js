const { isOriginAllowed, allowedOrigins, corsOriginCallback } = require('../../config/corsOrigins');

describe('corsOrigins — lista compartilhada REST + Socket.IO', () => {
    it('aceita as duas origens possíveis do WebView Capacitor', () => {
        // androidScheme https (atual) e http (APKs antigos ainda instalados).
        expect(isOriginAllowed('https://localhost')).toBe(true);
        expect(isOriginAllowed('http://localhost')).toBe(true);
        expect(isOriginAllowed('capacitor://localhost')).toBe(true);
        expect(isOriginAllowed('ionic://localhost')).toBe(true);
    });

    it('aceita os dev servers do frontend e do admin', () => {
        expect(isOriginAllowed('http://localhost:5173')).toBe(true);
        expect(isOriginAllowed('http://localhost:5174')).toBe(true);
    });

    it('aceita o domínio de produção moovecity.com.br (www e apex)', () => {
        expect(isOriginAllowed('https://www.moovecity.com.br')).toBe(true);
        expect(isOriginAllowed('https://moovecity.com.br')).toBe(true);
        expect(isOriginAllowed('https://www.moovecity.com.br/')).toBe(true);
    });

    it('aceita requisição sem Origin (cliente não-browser / health check)', () => {
        expect(isOriginAllowed(undefined)).toBe(true);
        expect(isOriginAllowed('')).toBe(true);
    });

    it('ignora barra final ao comparar', () => {
        expect(isOriginAllowed('https://localhost/')).toBe(true);
    });

    it('recusa origem desconhecida', () => {
        expect(isOriginAllowed('https://evil.example.com')).toBe(false);
    });

    it('callback do cors resolve permitido e rejeita desconhecido', () => {
        const okCb = vi.fn();
        corsOriginCallback('https://localhost', okCb);
        expect(okCb).toHaveBeenCalledWith(null, true);

        const denyCb = vi.fn();
        corsOriginCallback('https://evil.example.com', denyCb);
        expect(denyCb).toHaveBeenCalledTimes(1);
        expect(denyCb.mock.calls[0][0]).toBeInstanceOf(Error);
    });

    it('não expõe entradas vazias quando as envs não estão definidas', () => {
        expect(allowedOrigins.every((o) => typeof o === 'string' && o.length > 0)).toBe(true);
    });
});
