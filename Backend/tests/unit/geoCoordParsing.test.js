const { extractEmbeddedCoords } = require('../../services/maps/geo.util');

/**
 * Relato de campo (2026-08-18): corrida presencial dentro de Lajinha estimou 10.554 km,
 * 21.109 min e R$ 36.946,87.
 *
 * O fluxo presencial é o ÚNICO que manda a origem como par cru ("lat,lng") — o do
 * passageiro manda "Endereço (lat, lng)". A regex antiga exigia decimal nos dois lados
 * (`\d+\.\d+`), então um par que não casasse não era rejeitado: caía na geocodificação
 * como se fosse um endereço de texto, e o provider respondia com um lugar qualquer do
 * mundo. Daí a rota absurda.
 *
 * Coordenada redonda é o caso mais fácil de cair nisso: o JavaScript escreve -20.0
 * como "-20", sem casa decimal.
 */
describe('extração de coordenadas em texto de endereço', () => {
    describe('formatos que já funcionavam', () => {
        it('lê o par embutido no fim de um endereço', () => {
            expect(extractEmbeddedCoords(
                'Av. Antônio Florêncio Alvim - Lajinha, MG, 36980-000, Brazil (-20.1548255, -41.6291745)'
            )).toEqual({ ltd: -20.1548255, lng: -41.6291745 });
        });

        it('lê par cru com decimais', () => {
            expect(extractEmbeddedCoords('-20.1548255,-41.6291745'))
                .toEqual({ ltd: -20.1548255, lng: -41.6291745 });
        });

        it('aceita espaço depois da vírgula', () => {
            expect(extractEmbeddedCoords('-20.15, -41.62')).toEqual({ ltd: -20.15, lng: -41.62 });
        });
    });

    // O bug: estes caíam na geocodificação por texto em vez de serem lidos.
    describe('coordenadas sem casa decimal', () => {
        it('lê par de inteiros', () => {
            expect(extractEmbeddedCoords('-20,-41')).toEqual({ ltd: -20, lng: -41 });
        });

        it('lê par misto (um lado inteiro)', () => {
            expect(extractEmbeddedCoords('-20.15,-41')).toEqual({ ltd: -20.15, lng: -41 });
        });

        it('lê par embutido com inteiros', () => {
            expect(extractEmbeddedCoords('Rua X (-20, -41)')).toEqual({ ltd: -20, lng: -41 });
        });

        it('aceita coordenada positiva', () => {
            expect(extractEmbeddedCoords('20,41')).toEqual({ ltd: 20, lng: 41 });
        });
    });

    describe('endereço de verdade segue para a geocodificação', () => {
        it('devolve null para texto puro', () => {
            expect(extractEmbeddedCoords('Praça Central, Lajinha MG')).toBeNull();
        });

        it('devolve null para endereço com número de porta', () => {
            expect(extractEmbeddedCoords('Rua Américo Misael, 550, Lajinha')).toBeNull();
        });
    });

    // O ponto central da correção: falhar alto. Silenciar aqui é o que transformava um
    // dado ruim em preço cobrado do passageiro.
    describe('texto com cara de coordenada mas ilegível', () => {
        it('recusa em vez de geocodificar como endereço', () => {
            expect(() => extractEmbeddedCoords('-20.,-41')).toThrow(/ileg/i);
            expect(() => extractEmbeddedCoords('..,..')).toThrow(/ileg/i);
        });

        it('recusa coordenada fora da faixa válida', () => {
            expect(() => extractEmbeddedCoords('-200,-41')).toThrow(/faixa/i);
            expect(() => extractEmbeddedCoords('-20,-500')).toThrow(/faixa/i);
        });
    });

    it('não quebra com entrada vazia ou nula', () => {
        expect(extractEmbeddedCoords('')).toBeNull();
        expect(extractEmbeddedCoords(null)).toBeNull();
        expect(extractEmbeddedCoords(undefined)).toBeNull();
    });
});
