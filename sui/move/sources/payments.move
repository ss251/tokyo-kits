// SPDX-License-Identifier: MIT
module tokyo_kits::payments;

use sui::coin::{Self, Coin};
use sui::event;

const EZeroAmount: u64 = 0;
const EZeroRecipient: u64 = 1;
const ESelfPayment: u64 = 2;
const EInvalidReference: u64 = 3;
const MAX_REFERENCE_BYTES: u64 = 128;

/// Public, immutable evidence of one transfer. The coin type is part of its type.
public struct Receipt<phantom T> has key {
    id: UID,
    payer: address,
    recipient: address,
    amount: u64,
    reference: vector<u8>,
}

public struct Payment<phantom T> has copy, drop {
    receipt_id: ID,
    payer: address,
    recipient: address,
    amount: u64,
    reference: vector<u8>,
}

/// Transfer the entire supplied coin and freeze its receipt atomically.
/// The sender remains the payer when a different account sponsors transaction gas.
public fun pay<T>(
    coin: Coin<T>,
    recipient: address,
    reference: vector<u8>,
    ctx: &mut TxContext,
) {
    let payer = ctx.sender();
    let amount = coin::value(&coin);
    assert!(amount > 0, EZeroAmount);
    assert!(recipient != @0x0, EZeroRecipient);
    assert!(recipient != payer, ESelfPayment);
    assert!(reference.length() > 0 && reference.length() <= MAX_REFERENCE_BYTES, EInvalidReference);

    let receipt = Receipt<T> {
        id: object::new(ctx),
        payer,
        recipient,
        amount,
        reference,
    };
    event::emit(Payment<T> {
        receipt_id: object::id(&receipt),
        payer,
        recipient,
        amount,
        reference: receipt.reference,
    });
    transfer::public_transfer(coin, recipient);
    transfer::freeze_object(receipt);
}

public fun payer<T>(receipt: &Receipt<T>): address { receipt.payer }
public fun recipient<T>(receipt: &Receipt<T>): address { receipt.recipient }
public fun amount<T>(receipt: &Receipt<T>): u64 { receipt.amount }
public fun reference<T>(receipt: &Receipt<T>): vector<u8> { receipt.reference }
