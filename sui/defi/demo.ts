// SPDX-License-Identifier: MIT
import { strict as assert } from 'node:assert';
import { bcs } from '@mysten/sui/bcs';
import { Transaction } from '@mysten/sui/transactions';
import { normalizeStructTag } from '@mysten/sui/utils';
import { address, assertTestnet, balanceDelta, clockTime, CLOCK, createdObjectId, expectMoveAbort, findEvent, reserveGasCoinSpend, SUI_TYPE, waitForChainTime, type RecordedTransaction, type ScenarioContext } from '../lib/client';

export const EscrowSchema = bcs.struct('Escrow', { id: bcs.Address, depositor: bcs.Address, recipient: bcs.Address, balance: bcs.u64(), deadline_ms: bcs.u64(), approved: bcs.bool(), reference: bcs.vector(bcs.u8()) });
export const OutcomeSchema = bcs.struct('OutcomeReceipt', { id: bcs.Address, escrow_id: bcs.Address, depositor: bcs.Address, recipient: bcs.Address, payout_to: bcs.Address, amount: bcs.u64(), outcome: bcs.u8(), settled_at_ms: bcs.u64(), reference: bcs.vector(bcs.u8()) });
export const ClosedSchema = bcs.struct('Closed', { escrow_id: bcs.Address, receipt_id: bcs.Address, depositor: bcs.Address, recipient: bcs.Address, payout_to: bcs.Address, amount: bcs.u64(), outcome: bcs.u8(), settled_at_ms: bcs.u64(), reference: bcs.vector(bcs.u8()) });
const OpenedSchema = bcs.struct('Opened', { escrow_id: bcs.Address, depositor: bcs.Address, recipient: bcs.Address, amount: bcs.u64(), deadline_ms: bcs.u64(), reference: bcs.vector(bcs.u8()) });
const ApprovedSchema = bcs.struct('Approved', { escrow_id: bcs.Address, depositor: bcs.Address, recipient: bcs.Address });
export const ESCROW_AMOUNT = 1_000_000n;

function action(ctx: ScenarioContext, name: 'approve' | 'claim' | 'refund', escrowId: string) {
  const tx = new Transaction();
  tx.moveCall({ target: `${ctx.packageId}::escrow::${name}`, typeArguments: [SUI_TYPE], arguments: [tx.object(escrowId), tx.object(CLOCK)] });
  return tx;
}
async function open(ctx: ScenarioContext, deadline: bigint, reference: number[]) {
  const depositor = address(ctx.payer.toSuiAddress()); const recipient = address(ctx.recipient.toSuiAddress());
  const tx = new Transaction(); const [coin] = tx.splitCoins(tx.gas, [ESCROW_AMOUNT]);
  reserveGasCoinSpend(tx, ESCROW_AMOUNT);
  tx.moveCall({ target: `${ctx.packageId}::escrow::create`, typeArguments: [SUI_TYPE], arguments: [coin!, tx.pure.address(recipient), tx.pure.u64(deadline), tx.pure.vector('u8', reference), tx.object(CLOCK)] });
  const proof = await ctx.execute('create shared SUI escrow', tx, ctx.payer);
  const id = createdObjectId(proof, `${ctx.packageId}::escrow::Escrow<${SUI_TYPE}>`);
  const { object } = await ctx.client.getObject({ objectId: id, include: { content: true } });
  assert.equal(object.owner.$kind, 'Shared');
  const state = EscrowSchema.parse(object.content);
  assert.deepEqual(state, { id, depositor, recipient, balance: ESCROW_AMOUNT.toString(), deadline_ms: deadline.toString(), approved: false, reference });
  const event = OpenedSchema.parse(findEvent(proof, `${ctx.packageId}::escrow::Opened<${SUI_TYPE}>`).bcs);
  assert.deepEqual(event, { escrow_id: id, depositor, recipient, amount: ESCROW_AMOUNT.toString(), deadline_ms: deadline.toString(), reference });
  return { id, proof, state };
}
async function verifyOutcome(ctx: ScenarioContext, proof: RecordedTransaction, escrowId: string, outcome: 0 | 1, reference: number[]) {
  const depositor = address(ctx.payer.toSuiAddress()); const recipient = address(ctx.recipient.toSuiAddress()); const payout = outcome === 0 ? recipient : depositor;
  const id = createdObjectId(proof, `${ctx.packageId}::escrow::OutcomeReceipt<${SUI_TYPE}>`);
  const { object } = await ctx.client.getObject({ objectId: id, include: { content: true, previousTransaction: true } });
  assert.equal(normalizeStructTag(object.type), normalizeStructTag(`${ctx.packageId}::escrow::OutcomeReceipt<${SUI_TYPE}>`));
  assert.equal(object.owner.$kind, 'Immutable'); assert.equal(object.previousTransaction, proof.digest);
  const receipt = OutcomeSchema.parse(object.content);
  assert.equal(receipt.id, id); assert.equal(receipt.escrow_id, escrowId); assert.equal(receipt.depositor, depositor);
  assert.equal(receipt.recipient, recipient); assert.equal(receipt.payout_to, payout); assert.equal(BigInt(receipt.amount), ESCROW_AMOUNT);
  assert.equal(receipt.outcome, outcome); assert.deepEqual(receipt.reference, reference);
  assert(proof.transaction.effects.changedObjects.some(change => change.objectId === escrowId && change.idOperation === 'Deleted'), 'Settled escrow was not deleted');
  assert.equal(balanceDelta(proof, payout, SUI_TYPE), ESCROW_AMOUNT, 'Sponsored settlement must pay the exact escrow amount');
  const event = ClosedSchema.parse(findEvent(proof, `${ctx.packageId}::escrow::Closed<${SUI_TYPE}>`).bcs);
  assert.deepEqual(event, { escrow_id: escrowId, receipt_id: id, depositor, recipient, payout_to: payout, amount: receipt.amount, outcome, settled_at_ms: receipt.settled_at_ms, reference });
  return { id, receipt, event };
}

export async function runDefi(ctx: ScenarioContext) {
  await assertTestnet(ctx.client);
  assert.equal(new Set([ctx.payer.toSuiAddress(), ctx.recipient.toSuiAddress(), ctx.sponsor.toSuiAddress()]).size, 3, 'Escrow identities must be distinct');
  const transactions: RecordedTransaction[] = []; const checks: unknown[] = [];
  const claimReference = Array.from(new TextEncoder().encode('tokyo-kits-escrow-approved-claim'));
  const claimDeadline = await clockTime(ctx.client) + 180_000n;
  const first = await open(ctx, claimDeadline, claimReference); transactions.push(first.proof);
  checks.push(await expectMoveAbort(ctx, action(ctx, 'approve', first.id), ctx.sponsor, 5n, 'non-depositor cannot approve'));
  checks.push(await expectMoveAbort(ctx, action(ctx, 'claim', first.id), ctx.recipient, 7n, 'recipient cannot claim without approval'));
  const approval = await ctx.execute('depositor approves recipient claim', action(ctx, 'approve', first.id), ctx.payer); transactions.push(approval);
  const approvedEvent = ApprovedSchema.parse(findEvent(approval, `${ctx.packageId}::escrow::Approved`).bcs);
  assert.deepEqual(approvedEvent, { escrow_id: first.id, depositor: ctx.payer.toSuiAddress(), recipient: ctx.recipient.toSuiAddress() });
  const { object: approvedObject } = await ctx.client.getObject({ objectId: first.id, include: { content: true } });
  assert.equal(EscrowSchema.parse(approvedObject.content).approved, true);
  checks.push(await expectMoveAbort(ctx, action(ctx, 'approve', first.id), ctx.payer, 10n, 'duplicate approval is rejected'));
  checks.push(await expectMoveAbort(ctx, action(ctx, 'claim', first.id), ctx.sponsor, 6n, 'non-recipient cannot claim'));
  const claimed = await ctx.execute('recipient claims approved escrow with sponsored gas', action(ctx, 'claim', first.id), ctx.recipient, ctx.sponsor); transactions.push(claimed);
  const claimReceipt = await verifyOutcome(ctx, claimed, first.id, 0, claimReference);
  assert(BigInt(claimReceipt.receipt.settled_at_ms) < claimDeadline, 'Claim was not before the deadline');

  const refundReference = Array.from(new TextEncoder().encode('tokyo-kits-escrow-expired-refund'));
  const refundDeadline = await clockTime(ctx.client) + 20_000n;
  const second = await open(ctx, refundDeadline, refundReference); transactions.push(second.proof);
  const secondApproval = await ctx.execute('approve second escrow before expiry', action(ctx, 'approve', second.id), ctx.payer); transactions.push(secondApproval);
  checks.push(await expectMoveAbort(ctx, action(ctx, 'refund', second.id), ctx.payer, 9n, 'depositor cannot refund before deadline'));
  await waitForChainTime(ctx.client, refundDeadline);
  checks.push(await expectMoveAbort(ctx, action(ctx, 'claim', second.id), ctx.recipient, 8n, 'approved recipient cannot claim after deadline'));
  checks.push(await expectMoveAbort(ctx, action(ctx, 'refund', second.id), ctx.sponsor, 5n, 'non-depositor cannot refund'));
  const refunded = await ctx.execute('depositor refunds expired escrow with sponsored gas', action(ctx, 'refund', second.id), ctx.payer, ctx.sponsor); transactions.push(refunded);
  const refundReceipt = await verifyOutcome(ctx, refunded, second.id, 1, refundReference);
  assert(BigInt(refundReceipt.receipt.settled_at_ms) >= refundDeadline, 'Refund was before the deadline');
  await ctx.save('defi', { status: 'TESTNET_ESCROW_PROVEN', coinType: SUI_TYPE, amountPerEscrow: ESCROW_AMOUNT,
    depositor: ctx.payer.toSuiAddress(), recipient: ctx.recipient.toSuiAddress(), sponsor: ctx.sponsor.toSuiAddress(),
    claim: { escrowId: first.id, initialState: first.state, deadline: claimDeadline, ...claimReceipt },
    refund: { escrowId: second.id, initialState: second.state, deadline: refundDeadline, ...refundReceipt },
    negativeChecks: checks, transactions, assertions: ['real shared escrow stores deposit', 'only depositor approves', 'only approved recipient claims before deadline', 'only depositor refunds after deadline', 'settlements delete escrows', 'immutable outcome receipts and exact recipient payouts', 'negative simulations require exact Move aborts'] });
  return { claimDigest: claimed.digest, refundDigest: refunded.digest, claimReceiptId: claimReceipt.id, refundReceiptId: refundReceipt.id };
}
