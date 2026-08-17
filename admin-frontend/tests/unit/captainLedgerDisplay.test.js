import { describe, expect, it } from 'vitest';
import { describeCaptainLedgerTx, ledgerToneClass } from '../../src/utils/captainLedgerDisplay';

describe('describeCaptainLedgerTx', () => {
  it('mostra comissão como débito de créditos, mesmo com amount positivo', () => {
    const view = describeCaptainLedgerTx({ type: 'commission', amount: 2.83 });
    expect(view.tone).toBe('debit');
    expect(view.signedAmount).toBeCloseTo(-2.83);
    expect(view.balanceCaption).toBe('Créditos após');
    expect(ledgerToneClass(view.tone)).toBe('text-danger');
  });

  it('corrida cash não parece depósito na carteira', () => {
    const view = describeCaptainLedgerTx({
      type: 'ride_payment',
      paymentMethod: 'cash',
      amount: 56.56,
    });
    expect(view.tone).toBe('info');
    expect(view.amountHint).toMatch(/não entra na carteira/i);
    expect(view.balanceCaption).toBe('Créditos sem alteração');
  });

  it('corrida no cartão entra em a receber', () => {
    const view = describeCaptainLedgerTx({
      type: 'ride_payment',
      paymentMethod: 'card',
      amount: 40,
    });
    expect(view.tone).toBe('credit');
    expect(view.balanceCaption).toBe('A receber após');
  });

  it('ajuste manual respeita o sinal gravado', () => {
    expect(describeCaptainLedgerTx({ type: 'adjustment', amount: 50 }).tone).toBe('credit');
    expect(describeCaptainLedgerTx({ type: 'adjustment', amount: -20 }).tone).toBe('debit');
  });
});
