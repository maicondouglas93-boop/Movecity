/**
 * Teto de tempo do lado do JS para uma promise de rede.
 *
 * O app roteia todo HTTP pela camada nativa (CapacitorHttp ligado em
 * capacitor.config.json) e o `timeout` configurado no axios não é aplicado lá. Sem
 * conectividade real a requisição fica pendurada sem nunca rejeitar — e todo o
 * tratamento offline do app mora em `onError`, que só roda quando a promise falha.
 * O sintoma é o botão girando pra sempre e a ação nunca entrando na fila offline:
 * se o motorista fecha o app nesse estado, o trabalho já executado se perde.
 *
 * Este teto não depende do transporte usado embaixo, então vale igual no navegador
 * e no APK. O erro sai marcado com `isConnectivityIssue` para que quem trata saiba
 * que é falta de rede (guardar pra sincronizar depois), não erro de regra do
 * servidor (mostrar mensagem e desistir).
 */
export const CONNECTIVITY_TIMEOUT_MS = 12000

export function withHardTimeout(promise, ms = CONNECTIVITY_TIMEOUT_MS) {
    let timer
    const ceiling = new Promise((_, reject) => {
        timer = setTimeout(() => {
            const err = new Error('CONNECTIVITY_TIMEOUT')
            err.isConnectivityIssue = true
            reject(err)
        }, ms)
    })

    return Promise.race([promise, ceiling]).finally(() => clearTimeout(timer))
}
