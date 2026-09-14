// Saldo zero é permitido. O ADM controla apenas se o bloqueio está ativo.
// maximumNegativeBalance é legado e não define um limite diferente por caminho.
function isDriverCreditBlocked(creditBalance, settings) {
    return settings?.blockDriverOnNegativeBalance !== false && Number(creditBalance) < 0;
}

module.exports = { isDriverCreditBlocked };
