// SPDX-License-Identifier: MIT
import { strict as assert } from 'node:assert';
import { bcs } from '@mysten/sui/bcs';
import { Transaction } from '@mysten/sui/transactions';
import { normalizeStructTag } from '@mysten/sui/utils';
import { address, assertTestnet, balance, balanceDelta, createdObjectId, findEvent, NotProvenError, selectCoin, SUI_TYPE, USDC_TYPE, type ScenarioContext } from '../lib/client';

export const PaymentReceiptSchema = bcs.struct('Receipt', { id: bcs.Address, payer: bcs.Address, recipient: bcs.Address, amount: bcs.u64(), reference: bcs.vector(bcs.u8()) });
export const PaymentEventSchema = bcs.struct('Payment', { receipt_id: bcs.Address, payer: bcs.Address, recipient: bcs.Address, amount: bcs.u64(), reference: bcs.vector(bcs.u8()) });
export const PAYMENT_AMOUNT = 1_000_000n; // One official testnet USDC (6 decimals).

export async function runPayments(ctx: ScenarioContext) {
  await assertTestnet(ctx.client);
  const payer = address(ctx.payer.toSuiAddress()); const recipient = address(ctx.recipient.toSuiAddress()); const sponsor = address(ctx.sponsor.toSuiAddress());
  assert.equal(new Set([payer, recipient, sponsor]).size, 3, 'Payment sender, recipient and gas sponsor must be distinct');
  const payerUsdc = await balance(ctx.client, payer, USDC_TYPE);
  if (payerUsdc < PAYMENT_AMOUNT) throw new NotProvenError(`Official Circle testnet USDC is required. Open https://faucet.circle.com, select Sui Testnet, and fund payer ${payer}. The public faucet needs no account but may require a human reCAPTCHA. Re-run with the same ignored .run account state. Native SUI or a self-minted token cannot prove this stablecoin payment.`);
  const { coinMetadata } = await ctx.client.getCoinMetadata({ coinType: USDC_TYPE });
  assert(coinMetadata && coinMetadata.decimals === 6 && coinMetadata.symbol === 'USDC', 'Official testnet USDC metadata mismatch');
  const coin = await selectCoin(ctx.client, payer, USDC_TYPE, PAYMENT_AMOUNT);
  const before = { payerUsdc, recipientUsdc: await balance(ctx.client, recipient, USDC_TYPE), payerSui: await balance(ctx.client, payer), sponsorSui: await balance(ctx.client, sponsor) };
  const reference = Array.from(new TextEncoder().encode('tokyo-kits-official-usdc-sponsored-payment'));
  const tx = new Transaction();
  const [payment] = tx.splitCoins(tx.object(coin.objectId), [PAYMENT_AMOUNT]);
  tx.moveCall({ target: `${ctx.packageId}::payments::pay`, typeArguments: [USDC_TYPE], arguments: [payment!, tx.pure.address(recipient), tx.pure.vector('u8', reference)] });
  const proof = await ctx.execute('official USDC payment with distinct gas sponsor and immutable receipt', tx, ctx.payer, ctx.sponsor);
  const receiptType = `${ctx.packageId}::payments::Receipt<${USDC_TYPE}>`;
  const receiptId = createdObjectId(proof, receiptType);
  const { object } = await ctx.client.getObject({ objectId: receiptId, include: { content: true, previousTransaction: true } });
  assert.equal(normalizeStructTag(object.type), normalizeStructTag(receiptType));
  assert.equal(object.owner.$kind, 'Immutable', 'Payment receipt must be immutable');
  assert.equal(object.previousTransaction, proof.digest, 'Receipt does not belong to this payment');
  const receipt = PaymentReceiptSchema.parse(object.content);
  assert.equal(receipt.id, receiptId); assert.equal(receipt.payer, payer); assert.equal(receipt.recipient, recipient);
  assert.equal(BigInt(receipt.amount), PAYMENT_AMOUNT); assert.deepEqual(receipt.reference, reference);
  const event = PaymentEventSchema.parse(findEvent(proof, `${ctx.packageId}::payments::Payment<${USDC_TYPE}>`).bcs);
  assert.deepEqual(event, { receipt_id: receiptId, payer, recipient, amount: PAYMENT_AMOUNT.toString(), reference });
  assert.equal(balanceDelta(proof, payer, USDC_TYPE), -PAYMENT_AMOUNT);
  assert.equal(balanceDelta(proof, recipient, USDC_TYPE), PAYMENT_AMOUNT);
  assert.equal(balanceDelta(proof, payer, SUI_TYPE), 0n, 'Sender must not pay gas');
  assert.equal(proof.transaction.transaction.gasData.owner, sponsor);
  assert.equal(proof.transaction.signatures.length, 2, 'Sender and sponsor must both sign');
  const after = { payerUsdc: await balance(ctx.client, payer, USDC_TYPE), recipientUsdc: await balance(ctx.client, recipient, USDC_TYPE), payerSui: await balance(ctx.client, payer), sponsorSui: await balance(ctx.client, sponsor) };
  assert.equal(before.payerUsdc - after.payerUsdc, PAYMENT_AMOUNT);
  assert.equal(after.recipientUsdc - before.recipientUsdc, PAYMENT_AMOUNT);
  assert.equal(after.payerSui, before.payerSui, 'Sender SUI balance changed despite gas sponsorship');
  assert.equal(after.sponsorSui - before.sponsorSui, balanceDelta(proof, sponsor, SUI_TYPE), 'Sponsor balance does not match effects');
  await ctx.save('payments', { status: 'OFFICIAL_USDC_SPONSORED_PAYMENT_PROVEN', network: 'testnet', coinType: USDC_TYPE, decimals: 6, amount: PAYMENT_AMOUNT,
    payer, recipient, sponsor, before, after, receiptId, receipt, event, transactions: [proof],
    assertions: ['official Circle USDC type and metadata', 'sender and recipient exact USDC deltas', 'distinct gas owner and two signatures', 'sender SUI unchanged', 'immutable receipt and matching event decoded from BCS'] });
  return { digest: proof.digest, receiptId };
}
