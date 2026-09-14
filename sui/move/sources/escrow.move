// SPDX-License-Identifier: MIT
module tokyo_kits::escrow;

use sui::balance::{Self, Balance};
use sui::clock::{Self, Clock};
use sui::coin::{Self, Coin};
use sui::event;

const EZeroAmount: u64 = 0;
const EZeroRecipient: u64 = 1;
const ESelfEscrow: u64 = 2;
const EInvalidReference: u64 = 3;
const EInvalidDeadline: u64 = 4;
const ENotDepositor: u64 = 5;
const ENotRecipient: u64 = 6;
const ENotApproved: u64 = 7;
const EDeadlineReached: u64 = 8;
const ERefundTooEarly: u64 = 9;
const EAlreadyApproved: u64 = 10;
const MAX_REFERENCE_BYTES: u64 = 128;
const CLAIMED: u8 = 0;
const REFUNDED: u8 = 1;

/// Depositor approval permits the recipient to claim strictly before deadline_ms.
/// At and after that deadline, only the depositor can refund. Settlement consumes
/// the object, so claim and refund cannot both succeed, including across PTBs.
public struct Escrow<phantom T> has key {
    id: UID,
    depositor: address,
    recipient: address,
    balance: Balance<T>,
    deadline_ms: u64,
    approved: bool,
    reference: vector<u8>,
}

/// Frozen settlement evidence. outcome is 0 for a claim and 1 for a refund.
public struct OutcomeReceipt<phantom T> has key {
    id: UID,
    escrow_id: ID,
    depositor: address,
    recipient: address,
    payout_to: address,
    amount: u64,
    outcome: u8,
    settled_at_ms: u64,
    reference: vector<u8>,
}

public struct Opened<phantom T> has copy, drop {
    escrow_id: ID,
    depositor: address,
    recipient: address,
    amount: u64,
    deadline_ms: u64,
    reference: vector<u8>,
}

public struct Approved has copy, drop {
    escrow_id: ID,
    depositor: address,
    recipient: address,
}

public struct Closed<phantom T> has copy, drop {
    escrow_id: ID,
    receipt_id: ID,
    depositor: address,
    recipient: address,
    payout_to: address,
    amount: u64,
    outcome: u8,
    settled_at_ms: u64,
    reference: vector<u8>,
}

public fun create<T>(
    coin: Coin<T>,
    recipient: address,
    deadline_ms: u64,
    reference: vector<u8>,
    clock: &Clock,
    ctx: &mut TxContext,
) {
    let depositor = ctx.sender();
    let amount = coin::value(&coin);
    assert!(amount > 0, EZeroAmount);
    assert!(recipient != @0x0, EZeroRecipient);
    assert!(recipient != depositor, ESelfEscrow);
    assert!(reference.length() > 0 && reference.length() <= MAX_REFERENCE_BYTES, EInvalidReference);
    assert!(deadline_ms > clock::timestamp_ms(clock), EInvalidDeadline);
    let escrow = Escrow<T> {
        id: object::new(ctx),
        depositor,
        recipient,
        balance: coin::into_balance(coin),
        deadline_ms,
        approved: false,
        reference,
    };
    event::emit(Opened<T> {
        escrow_id: object::id(&escrow),
        depositor,
        recipient,
        amount,
        deadline_ms,
        reference: escrow.reference,
    });
    transfer::share_object(escrow);
}

/// Approval is not payment: the recipient must still claim before the deadline.
public fun approve<T>(escrow: &mut Escrow<T>, clock: &Clock, ctx: &TxContext) {
    assert!(ctx.sender() == escrow.depositor, ENotDepositor);
    assert!(clock::timestamp_ms(clock) < escrow.deadline_ms, EDeadlineReached);
    assert!(!escrow.approved, EAlreadyApproved);
    escrow.approved = true;
    event::emit(Approved {
        escrow_id: object::id(escrow),
        depositor: escrow.depositor,
        recipient: escrow.recipient,
    });
}

public fun claim<T>(escrow: Escrow<T>, clock: &Clock, ctx: &mut TxContext) {
    assert!(ctx.sender() == escrow.recipient, ENotRecipient);
    assert!(escrow.approved, ENotApproved);
    let now = clock::timestamp_ms(clock);
    assert!(now < escrow.deadline_ms, EDeadlineReached);
    let payout_to = escrow.recipient;
    settle(escrow, payout_to, CLAIMED, now, ctx);
}

public fun refund<T>(escrow: Escrow<T>, clock: &Clock, ctx: &mut TxContext) {
    assert!(ctx.sender() == escrow.depositor, ENotDepositor);
    let now = clock::timestamp_ms(clock);
    assert!(now >= escrow.deadline_ms, ERefundTooEarly);
    let payout_to = escrow.depositor;
    settle(escrow, payout_to, REFUNDED, now, ctx);
}

fun settle<T>(
    escrow: Escrow<T>,
    payout_to: address,
    outcome: u8,
    settled_at_ms: u64,
    ctx: &mut TxContext,
) {
    let escrow_id = object::id(&escrow);
    let Escrow {
        id, depositor, recipient, balance, deadline_ms: _, approved: _, reference,
    } = escrow;
    object::delete(id);
    let amount = balance::value(&balance);
    let receipt = OutcomeReceipt<T> {
        id: object::new(ctx),
        escrow_id,
        depositor,
        recipient,
        payout_to,
        amount,
        outcome,
        settled_at_ms,
        reference,
    };
    event::emit(Closed<T> {
        escrow_id,
        receipt_id: object::id(&receipt),
        depositor,
        recipient,
        payout_to,
        amount,
        outcome,
        settled_at_ms,
        reference: receipt.reference,
    });
    transfer::public_transfer(coin::from_balance(balance, ctx), payout_to);
    transfer::freeze_object(receipt);
}

public fun depositor<T>(escrow: &Escrow<T>): address { escrow.depositor }
public fun recipient<T>(escrow: &Escrow<T>): address { escrow.recipient }
public fun amount<T>(escrow: &Escrow<T>): u64 { balance::value(&escrow.balance) }
public fun deadline_ms<T>(escrow: &Escrow<T>): u64 { escrow.deadline_ms }
public fun is_approved<T>(escrow: &Escrow<T>): bool { escrow.approved }
public fun reference<T>(escrow: &Escrow<T>): vector<u8> { escrow.reference }

public fun receipt_escrow_id<T>(receipt: &OutcomeReceipt<T>): ID { receipt.escrow_id }
public fun receipt_depositor<T>(receipt: &OutcomeReceipt<T>): address { receipt.depositor }
public fun receipt_recipient<T>(receipt: &OutcomeReceipt<T>): address { receipt.recipient }
public fun receipt_payout_to<T>(receipt: &OutcomeReceipt<T>): address { receipt.payout_to }
public fun receipt_amount<T>(receipt: &OutcomeReceipt<T>): u64 { receipt.amount }
public fun receipt_outcome<T>(receipt: &OutcomeReceipt<T>): u8 { receipt.outcome }
public fun receipt_settled_at_ms<T>(receipt: &OutcomeReceipt<T>): u64 { receipt.settled_at_ms }
public fun receipt_reference<T>(receipt: &OutcomeReceipt<T>): vector<u8> { receipt.reference }
