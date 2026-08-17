/**
 * Como apresentar uma transação da carteira do motorista no admin.
 *
 * O backend grava `amount` positivo na maioria dos tipos — inclusive comissão,
 * que na verdade debita `creditBalance`. Corrida cash/Pix não mexe em crédito
 * nem em pendente: o passageiro já pagou o motorista. Esta função só traduz
 * isso para a UI; não altera regra financeira.
 *
 * Espelha Backend/services/wallet.service.js (resolveLedgerField / buildIncFields).
 */

const TONE_CLASS = {
  credit: 'text-primary',
  debit: 'text-danger',
  info: 'text-text',
};

export function ledgerToneClass(tone) {
  return TONE_CLASS[tone] || TONE_CLASS.info;
}

export function describeCaptainLedgerTx(tx = {}) {
  const type = tx.type;
  const amount = Number(tx.amount) || 0;
  const method = tx.paymentMethod;

  if (type === 'commission') {
    return {
      label: 'Comissão',
      signedAmount: -Math.abs(amount),
      tone: 'debit',
      balanceCaption: 'Créditos após',
      amountHint: 'Saiu dos créditos',
    };
  }

  if (type === 'recharge') {
    return {
      label: 'Recarga Pix',
      signedAmount: Math.abs(amount),
      tone: 'credit',
      balanceCaption: 'Créditos após',
      amountHint: 'Entrou nos créditos',
    };
  }

  if (type === 'bonus') {
    return {
      label: 'Bônus',
      signedAmount: Math.abs(amount),
      tone: 'credit',
      balanceCaption: 'Créditos após',
      amountHint: 'Entrou nos créditos',
    };
  }

  if (type === 'adjustment') {
    const signed = amount;
    return {
      label: 'Ajuste manual',
      signedAmount: signed,
      tone: signed < 0 ? 'debit' : 'credit',
      balanceCaption: 'Créditos após',
      amountHint: signed < 0 ? 'Saiu dos créditos' : 'Entrou nos créditos',
    };
  }

  if (type === 'ride_payment' || type === 'parcel_payment') {
    const isParcel = type === 'parcel_payment';
    if (method === 'card' || method === 'wallet') {
      return {
        label: isParcel ? 'Encomenda (a receber)' : 'Corrida (a receber)',
        signedAmount: Math.abs(amount),
        tone: 'credit',
        balanceCaption: 'A receber após',
        amountHint: 'Fica pendente para saque',
      };
    }
    return {
      label: isParcel ? 'Encomenda (pago ao motorista)' : 'Corrida (pago ao motorista)',
      signedAmount: Math.abs(amount),
      tone: 'info',
      balanceCaption: 'Créditos sem alteração',
      amountHint: 'Não entra na carteira — passageiro pagou direto',
    };
  }

  if (type === 'payout' || type === 'withdraw') {
    return {
      label: type === 'payout' ? 'Repasse' : 'Saque',
      signedAmount: -Math.abs(amount),
      tone: 'debit',
      balanceCaption: 'A receber após',
      amountHint: 'Saiu do valor a receber',
    };
  }

  if (type === 'wallet_contribution') {
    return {
      label: 'Carteira do passageiro',
      signedAmount: Math.abs(amount),
      tone: 'credit',
      balanceCaption: 'A receber após',
      amountHint: 'Fica pendente para saque',
    };
  }

  return {
    label: type || 'Transação',
    signedAmount: amount,
    tone: amount < 0 ? 'debit' : amount > 0 ? 'credit' : 'info',
    balanceCaption: 'Saldo após',
    amountHint: '',
  };
}
