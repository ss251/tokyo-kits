// SPDX-License-Identifier: MIT
#[test_only]
module tokyo_kits::escrow_tests;

// UNIT FIXTURES ONLY: the runner mints SUI and advances a testing Clock. The live
// demo must use real testnet coins, canonical Clock 0x6, and signed transactions.
use sui::clock::{Self, Clock};
use sui::coin::{Self, Coin};
use sui::event;
use sui::sui::SUI;
use sui::test_scenario::{Self, Scenario};
use tokyo_kits::escrow::{Self, Approved, Closed, Escrow, Opened, OutcomeReceipt};

const DEPOSITOR: address = @0xa;
const RECIPIENT: address = @0xb;
const STRANGER: address = @0xc;
const START: u64 = 1_000;
const DEADLINE: u64 = 2_000;
const AMOUNT: u64 = 123_456;

#[test]
fun opening_custodies_full_balance_and_starts_unapproved() {
    let mut scenario = setup(AMOUNT, RECIPIENT, DEADLINE, b"escrow-42");
    let escrow = scenario.take_shared<Escrow<SUI>>();
    assert!(escrow::depositor(&escrow) == DEPOSITOR);
    assert!(escrow::recipient(&escrow) == RECIPIENT);
    assert!(escrow::amount(&escrow) == AMOUNT);
    assert!(escrow::deadline_ms(&escrow) == DEADLINE);
    assert!(!escrow::is_approved(&escrow));
    assert!(escrow::reference(&escrow) == b"escrow-42");
    assert!(test_scenario::ids_for_address<Coin<SUI>>(DEPOSITOR).is_empty());
    assert!(test_scenario::ids_for_address<Coin<SUI>>(RECIPIENT).is_empty());
    test_scenario::return_shared(escrow);
    scenario.end();
}

#[test]
fun approved_recipient_claims_one_ms_before_deadline_and_consumes_escrow() {
    let mut scenario = setup(AMOUNT, RECIPIENT, DEADLINE, b"escrow-42");
    approve_as_depositor(&mut scenario);
    advance(&mut scenario, DEADLINE - 1);
    scenario.next_tx(RECIPIENT);
    let escrow = scenario.take_shared<Escrow<SUI>>();
    let escrow_id = object::id(&escrow);
    let clock = scenario.take_shared<Clock>();
    escrow::claim(escrow, &clock, scenario.ctx());
    assert!(event::events_by_type<Closed<SUI>>().length() == 1);
    test_scenario::return_shared(clock);
    let effects = scenario.next_tx(RECIPIENT);
    assert!(test_scenario::deleted(&effects).contains(&escrow_id));
    assert!(test_scenario::frozen(&effects).length() == 1);
    assert!(test_scenario::num_user_events(&effects) == 1);
    assert!(!test_scenario::has_most_recent_shared<Escrow<SUI>>());
    assert_outcome(&mut scenario, escrow_id, RECIPIENT, 0, DEADLINE - 1);
    assert!(test_scenario::ids_for_address<Coin<SUI>>(DEPOSITOR).is_empty());
    cleanup_clock(&mut scenario);
    scenario.end();
}

#[test]
fun unapproved_depositor_refunds_at_exact_deadline() {
    let mut scenario = setup(AMOUNT, RECIPIENT, DEADLINE, b"escrow-42");
    advance(&mut scenario, DEADLINE);
    refund_and_assert(&mut scenario, DEADLINE);
    cleanup_clock(&mut scenario);
    scenario.end();
}

#[test]
fun approval_does_not_prevent_depositor_refund_after_deadline() {
    let mut scenario = setup(AMOUNT, RECIPIENT, DEADLINE, b"escrow-42");
    approve_as_depositor(&mut scenario);
    advance(&mut scenario, DEADLINE + 1);
    refund_and_assert(&mut scenario, DEADLINE + 1);
    cleanup_clock(&mut scenario);
    scenario.end();
}

#[test]
fun recipient_can_claim_with_separate_gas_sponsor() {
    let mut scenario = setup(AMOUNT, RECIPIENT, DEADLINE, b"escrow-42");
    approve_as_depositor(&mut scenario);
    scenario.next_tx(RECIPIENT);
    // Preserve this epoch's reference gas price while changing only sponsorship.
    let builder = test_scenario::ctx_builder(&scenario).set_sponsor(STRANGER);
    scenario.next_with_context(builder);
    let escrow = scenario.take_shared<Escrow<SUI>>();
    let escrow_id = object::id(&escrow);
    let clock = scenario.take_shared<Clock>();
    escrow::claim(escrow, &clock, scenario.ctx());
    test_scenario::return_shared(clock);
    scenario.next_tx(RECIPIENT);
    assert_outcome(&mut scenario, escrow_id, RECIPIENT, 0, START);
    assert!(test_scenario::ids_for_address<Coin<SUI>>(STRANGER).is_empty());
    cleanup_clock(&mut scenario);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = 5, location = tokyo_kits::escrow)]
fun recipient_cannot_approve() {
    let mut scenario = setup(AMOUNT, RECIPIENT, DEADLINE, b"escrow-42");
    scenario.next_tx(RECIPIENT);
    attempt_approval(&mut scenario);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = 5, location = tokyo_kits::escrow)]
fun depositor_as_gas_sponsor_cannot_authorize_stranger_approval() {
    let mut scenario = setup(AMOUNT, RECIPIENT, DEADLINE, b"escrow-42");
    scenario.next_tx(STRANGER);
    let builder = test_scenario::ctx_builder(&scenario).set_sponsor(DEPOSITOR);
    scenario.next_with_context(builder);
    attempt_approval(&mut scenario);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = 10, location = tokyo_kits::escrow)]
fun duplicate_approval_rejected() {
    let mut scenario = setup(AMOUNT, RECIPIENT, DEADLINE, b"escrow-42");
    approve_as_depositor(&mut scenario);
    attempt_approval(&mut scenario);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = 8, location = tokyo_kits::escrow)]
fun approval_at_deadline_rejected() {
    let mut scenario = setup(AMOUNT, RECIPIENT, DEADLINE, b"escrow-42");
    advance(&mut scenario, DEADLINE);
    attempt_approval(&mut scenario);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = 6, location = tokyo_kits::escrow)]
fun depositor_cannot_claim_approved_escrow() {
    let mut scenario = setup(AMOUNT, RECIPIENT, DEADLINE, b"escrow-42");
    approve_as_depositor(&mut scenario);
    attempt_claim(&mut scenario);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = 6, location = tokyo_kits::escrow)]
fun recipient_as_gas_sponsor_cannot_authorize_stranger_claim() {
    let mut scenario = setup(AMOUNT, RECIPIENT, DEADLINE, b"escrow-42");
    approve_as_depositor(&mut scenario);
    scenario.next_tx(STRANGER);
    let builder = test_scenario::ctx_builder(&scenario).set_sponsor(RECIPIENT);
    scenario.next_with_context(builder);
    attempt_claim(&mut scenario);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = 7, location = tokyo_kits::escrow)]
fun recipient_cannot_claim_before_approval() {
    let mut scenario = setup(AMOUNT, RECIPIENT, DEADLINE, b"escrow-42");
    scenario.next_tx(RECIPIENT);
    attempt_claim(&mut scenario);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = 8, location = tokyo_kits::escrow)]
fun approved_recipient_cannot_claim_at_exact_deadline() {
    let mut scenario = setup(AMOUNT, RECIPIENT, DEADLINE, b"escrow-42");
    approve_as_depositor(&mut scenario);
    advance(&mut scenario, DEADLINE);
    scenario.next_tx(RECIPIENT);
    attempt_claim(&mut scenario);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = 9, location = tokyo_kits::escrow)]
fun depositor_cannot_refund_one_ms_before_deadline() {
    let mut scenario = setup(AMOUNT, RECIPIENT, DEADLINE, b"escrow-42");
    advance(&mut scenario, DEADLINE - 1);
    attempt_refund(&mut scenario);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = 5, location = tokyo_kits::escrow)]
fun recipient_cannot_refund_after_deadline() {
    let mut scenario = setup(AMOUNT, RECIPIENT, DEADLINE, b"escrow-42");
    advance(&mut scenario, DEADLINE + 1);
    scenario.next_tx(RECIPIENT);
    attempt_refund(&mut scenario);
    scenario.end();
}

#[test]
#[expected_failure(abort_code = 0, location = tokyo_kits::escrow)]
fun zero_amount_rejected() { setup(0, RECIPIENT, DEADLINE, b"ref").end(); }

#[test]
#[expected_failure(abort_code = 1, location = tokyo_kits::escrow)]
fun zero_recipient_rejected() { setup(1, @0x0, DEADLINE, b"ref").end(); }

#[test]
#[expected_failure(abort_code = 2, location = tokyo_kits::escrow)]
fun self_escrow_rejected() { setup(1, DEPOSITOR, DEADLINE, b"ref").end(); }

#[test]
#[expected_failure(abort_code = 3, location = tokyo_kits::escrow)]
fun empty_reference_rejected() { setup(1, RECIPIENT, DEADLINE, b"").end(); }

#[test]
#[expected_failure(abort_code = 3, location = tokyo_kits::escrow)]
fun oversized_reference_rejected() {
    let mut reference = vector[];
    while (reference.length() < 129) reference.push_back(42);
    setup(1, RECIPIENT, DEADLINE, reference).end();
}

#[test]
#[expected_failure(abort_code = 4, location = tokyo_kits::escrow)]
fun deadline_equal_to_now_rejected() { setup(1, RECIPIENT, START, b"ref").end(); }

#[test]
#[expected_failure(abort_code = 4, location = tokyo_kits::escrow)]
fun past_deadline_rejected() { setup(1, RECIPIENT, START - 1, b"ref").end(); }

fun setup(amount: u64, recipient: address, deadline: u64, reference: vector<u8>): Scenario {
    let mut scenario = test_scenario::begin(DEPOSITOR);
    let mut clock = clock::create_for_testing(scenario.ctx());
    clock::set_for_testing(&mut clock, START);
    clock::share_for_testing(clock);
    scenario.next_tx(DEPOSITOR);
    let clock = scenario.take_shared<Clock>();
    let coin = coin::mint_for_testing<SUI>(amount, scenario.ctx());
    escrow::create(coin, recipient, deadline, reference, &clock, scenario.ctx());
    assert!(event::events_by_type<Opened<SUI>>().length() == 1);
    test_scenario::return_shared(clock);
    let effects = scenario.next_tx(DEPOSITOR);
    assert!(test_scenario::num_user_events(&effects) == 1);
    scenario
}

fun advance(scenario: &mut Scenario, timestamp_ms: u64) {
    let mut clock = scenario.take_shared<Clock>();
    clock::set_for_testing(&mut clock, timestamp_ms);
    test_scenario::return_shared(clock);
    scenario.next_tx(DEPOSITOR);
}

fun approve_as_depositor(scenario: &mut Scenario) {
    scenario.next_tx(DEPOSITOR);
    attempt_approval(scenario);
    assert!(event::events_by_type<Approved>().length() == 1);
    let effects = scenario.next_tx(DEPOSITOR);
    assert!(test_scenario::num_user_events(&effects) == 1);
    let escrow = scenario.take_shared<Escrow<SUI>>();
    assert!(escrow::is_approved(&escrow));
    assert!(escrow::amount(&escrow) == AMOUNT);
    test_scenario::return_shared(escrow);
    scenario.next_tx(DEPOSITOR);
}

fun attempt_approval(scenario: &mut Scenario) {
    let mut escrow = scenario.take_shared<Escrow<SUI>>();
    let clock = scenario.take_shared<Clock>();
    escrow::approve(&mut escrow, &clock, scenario.ctx());
    test_scenario::return_shared(escrow);
    test_scenario::return_shared(clock);
}

fun attempt_claim(scenario: &mut Scenario) {
    let escrow = scenario.take_shared<Escrow<SUI>>();
    let clock = scenario.take_shared<Clock>();
    escrow::claim(escrow, &clock, scenario.ctx());
    test_scenario::return_shared(clock);
}

fun attempt_refund(scenario: &mut Scenario) {
    let escrow = scenario.take_shared<Escrow<SUI>>();
    let clock = scenario.take_shared<Clock>();
    escrow::refund(escrow, &clock, scenario.ctx());
    test_scenario::return_shared(clock);
}

fun refund_and_assert(scenario: &mut Scenario, timestamp_ms: u64) {
    let escrow = scenario.take_shared<Escrow<SUI>>();
    let escrow_id = object::id(&escrow);
    let clock = scenario.take_shared<Clock>();
    escrow::refund(escrow, &clock, scenario.ctx());
    assert!(event::events_by_type<Closed<SUI>>().length() == 1);
    test_scenario::return_shared(clock);
    let effects = scenario.next_tx(DEPOSITOR);
    assert!(test_scenario::deleted(&effects).contains(&escrow_id));
    assert!(test_scenario::frozen(&effects).length() == 1);
    assert!(test_scenario::num_user_events(&effects) == 1);
    assert!(!test_scenario::has_most_recent_shared<Escrow<SUI>>());
    assert_outcome(scenario, escrow_id, DEPOSITOR, 1, timestamp_ms);
    assert!(test_scenario::ids_for_address<Coin<SUI>>(RECIPIENT).is_empty());
}

fun assert_outcome(
    scenario: &mut Scenario,
    escrow_id: ID,
    payout_to: address,
    outcome: u8,
    settled_at_ms: u64,
) {
    let receipt = scenario.take_immutable<OutcomeReceipt<SUI>>();
    assert!(escrow::receipt_escrow_id(&receipt) == escrow_id);
    assert!(escrow::receipt_depositor(&receipt) == DEPOSITOR);
    assert!(escrow::receipt_recipient(&receipt) == RECIPIENT);
    assert!(escrow::receipt_payout_to(&receipt) == payout_to);
    assert!(escrow::receipt_amount(&receipt) == AMOUNT);
    assert!(escrow::receipt_outcome(&receipt) == outcome);
    assert!(escrow::receipt_settled_at_ms(&receipt) == settled_at_ms);
    assert!(escrow::receipt_reference(&receipt) == b"escrow-42");
    test_scenario::return_immutable(receipt);
    assert!(coin::burn_for_testing(scenario.take_from_sender<Coin<SUI>>()) == AMOUNT);
}

fun cleanup_clock(scenario: &mut Scenario) {
    clock::destroy_for_testing(scenario.take_shared<Clock>());
}
