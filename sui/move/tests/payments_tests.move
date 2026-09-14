// SPDX-License-Identifier: MIT
#[test_only]
module tokyo_kits::payments_tests;

// UNIT FIXTURES ONLY: mint_for_testing<SUI> creates test-runner coins. These tests
// do not claim a testnet USDC transfer or a sponsored transaction signature.
use sui::coin::{Self, Coin};
use sui::event;
use sui::sui::SUI;
use sui::test_scenario;
use tokyo_kits::payments::{Self, Payment, Receipt};

const PAYER: address = @0xa;
const RECIPIENT: address = @0xb;
const SPONSOR: address = @0xc;

#[test]
fun transfer_freezes_receipt_and_preserves_full_coin_value() {
    let mut scenario = test_scenario::begin(PAYER);
    let coin = coin::mint_for_testing<SUI>(123_456, scenario.ctx());
    let coin_id = object::id(&coin);
    payments::pay(coin, RECIPIENT, b"invoice-42", scenario.ctx());
    assert!(event::events_by_type<Payment<SUI>>().length() == 1);
    let effects = scenario.next_tx(RECIPIENT);
    assert!(test_scenario::frozen(&effects).length() == 1);
    assert!(test_scenario::num_user_events(&effects) == 1);
    assert!(test_scenario::ids_for_address<Coin<SUI>>(PAYER).is_empty());

    let received = scenario.take_from_sender<Coin<SUI>>();
    assert!(object::id(&received) == coin_id);
    assert!(coin::burn_for_testing(received) == 123_456);
    let receipt = scenario.take_immutable<Receipt<SUI>>();
    assert!(payments::payer(&receipt) == PAYER);
    assert!(payments::recipient(&receipt) == RECIPIENT);
    assert!(payments::amount(&receipt) == 123_456);
    assert!(payments::reference(&receipt) == b"invoice-42");
    test_scenario::return_immutable(receipt);
    scenario.end();
}

#[test]
fun sponsored_context_records_sender_as_payer_and_accepts_reference_limit() {
    let builder = test_scenario::ctx_builder_from_sender(PAYER).set_sponsor(SPONSOR);
    let mut scenario = test_scenario::begin_with_context(builder);
    let coin = coin::mint_for_testing<SUI>(1, scenario.ctx());
    payments::pay(coin, RECIPIENT, reference_bytes(128), scenario.ctx());
    scenario.next_tx(RECIPIENT);
    let receipt = scenario.take_immutable<Receipt<SUI>>();
    assert!(payments::payer(&receipt) == PAYER);
    assert!(payments::payer(&receipt) != SPONSOR);
    assert!(payments::reference(&receipt).length() == 128);
    test_scenario::return_immutable(receipt);
    assert!(coin::burn_for_testing(scenario.take_from_sender<Coin<SUI>>()) == 1);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = 0, location = tokyo_kits::payments)]
fun zero_amount_rejected() { attempt_payment(0, RECIPIENT, b"ref"); }

#[test]
#[expected_failure(abort_code = 1, location = tokyo_kits::payments)]
fun zero_recipient_rejected() { attempt_payment(1, @0x0, b"ref"); }

#[test]
#[expected_failure(abort_code = 2, location = tokyo_kits::payments)]
fun self_payment_rejected() { attempt_payment(1, PAYER, b"ref"); }

#[test]
#[expected_failure(abort_code = 3, location = tokyo_kits::payments)]
fun empty_reference_rejected() { attempt_payment(1, RECIPIENT, b""); }

#[test]
#[expected_failure(abort_code = 3, location = tokyo_kits::payments)]
fun oversized_reference_rejected() { attempt_payment(1, RECIPIENT, reference_bytes(129)); }

fun attempt_payment(amount: u64, recipient: address, reference: vector<u8>) {
    let mut scenario = test_scenario::begin(PAYER);
    let coin = coin::mint_for_testing<SUI>(amount, scenario.ctx());
    payments::pay(coin, recipient, reference, scenario.ctx());
    scenario.end();
}

fun reference_bytes(length: u64): vector<u8> {
    let mut bytes = vector[];
    while (bytes.length() < length) bytes.push_back(42);
    bytes
}
