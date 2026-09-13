// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {WorldIDGate, IWorldIDVerifier} from "../src/WorldIDGate.sol";

/// @dev UNIT TEST ONLY. This checks complete calldata equality and never verifies a real World ID.
contract UnitOnlyExpectedProofVerifier is IWorldIDVerifier {
    error UnitOnlyInvalidProof();

    bytes32 private expectedArguments;

    function setExpectedArguments(bytes32 expected) external {
        expectedArguments = expected;
    }

    function verify(
        uint256 nullifier,
        uint256 action,
        uint64 rpId,
        uint256 nonce,
        uint256 signalHash,
        uint64 expiresAtMin,
        uint64 issuerSchemaId,
        uint256 credentialGenesisIssuedAtMin,
        uint256[5] calldata zeroKnowledgeProof
    ) external view {
        bytes32 actual = keccak256(
            abi.encode(
                nullifier,
                action,
                rpId,
                nonce,
                signalHash,
                expiresAtMin,
                issuerSchemaId,
                credentialGenesisIssuedAtMin,
                zeroKnowledgeProof
            )
        );
        if (actual != expectedArguments) revert UnitOnlyInvalidProof();
    }
}

/// @notice Acceptance tests here are UNIT fixtures, not official verification or human-proof receipts.
contract WorldIDGateTest is Test {
    UnitOnlyExpectedProofVerifier private verifier;
    WorldIDGate private gate;

    address private constant ALICE = address(0xA11CE);
    address private constant BOB = address(0xB0B);
    uint64 private constant RP_ID = 0x1234567890abcdef;
    string private constant ACTION = "tokyo-starter-verify";
    uint256 private constant NULLIFIER = 123;
    uint256 private constant NONCE = 456;
    uint64 private constant NOW = 1_900_000_000;
    uint64 private constant EXPIRES = NOW + 300;

    event Verified(address indexed account, uint256 indexed nullifier, uint256 indexed actionHash);

    function setUp() public {
        vm.warp(NOW);
        verifier = new UnitOnlyExpectedProofVerifier();
        gate = new WorldIDGate(verifier, RP_ID, ACTION);
        _allow(ALICE, NULLIFIER, NONCE, EXPIRES, _proof());
    }

    function testUnitScopeAndAddressByteEncoding() public view {
        assertEq(address(gate.verifier()), address(verifier));
        assertEq(gate.rpId(), RP_ID);
        assertEq(gate.actionHash(), uint256(keccak256(bytes(ACTION))) >> 8);
        assertEq(gate.issuerSchemaId(), 1);
        assertEq(gate.credentialGenesisIssuedAtMin(), 0);
        assertEq(gate.signalHashFor(ALICE), uint256(keccak256(hex"00000000000000000000000000000000000a11ce")) >> 8);
        assertNotEq(gate.signalHashFor(ALICE), uint256(keccak256("0x00000000000000000000000000000000000a11ce")) >> 8);
        assertNotEq(gate.signalHashFor(ALICE), uint256(keccak256(abi.encode(ALICE))) >> 8);
    }

    function testUnitRejectsVerifierWithoutCode() public {
        vm.expectRevert(abi.encodeWithSelector(WorldIDGate.VerifierHasNoCode.selector, BOB));
        new WorldIDGate(IWorldIDVerifier(BOB), RP_ID, ACTION);
    }

    function testUnitRejectsEmptyScope() public {
        vm.expectRevert(WorldIDGate.InvalidRpId.selector);
        new WorldIDGate(verifier, 0, ACTION);
        vm.expectRevert(WorldIDGate.EmptyAction.selector);
        new WorldIDGate(verifier, RP_ID, "");
    }

    function testUnitValidMockRecordsCallerAndEvent() public {
        vm.expectEmit(true, true, true, true, address(gate));
        emit Verified(ALICE, NULLIFIER, uint256(keccak256(bytes(ACTION))) >> 8);
        _submit(ALICE, NULLIFIER, NONCE, EXPIRES, _proof());
        assertTrue(gate.nullifierUsed(NULLIFIER));
        assertEq(gate.verifiedCalls(ALICE), 1);
        assertEq(gate.verifiedCalls(BOB), 0);
    }

    function testUnitNullifierCannotBeReusedBySameOrDifferentWallet() public {
        _submit(ALICE, NULLIFIER, NONCE, EXPIRES, _proof());
        vm.expectRevert(abi.encodeWithSelector(WorldIDGate.NullifierAlreadyUsed.selector, NULLIFIER));
        _submit(ALICE, NULLIFIER, NONCE, EXPIRES, _proof());
        // Even a second correctly-bound fixture proof cannot reuse this action's consumed nullifier.
        _allow(BOB, NULLIFIER, NONCE + 1, EXPIRES, _proof());
        vm.expectRevert(abi.encodeWithSelector(WorldIDGate.NullifierAlreadyUsed.selector, NULLIFIER));
        _submit(BOB, NULLIFIER, NONCE + 1, EXPIRES, _proof());
        assertEq(gate.verifiedCalls(ALICE), 1);
        assertEq(gate.verifiedCalls(BOB), 0);
    }

    function testUnitCopiedProofCannotBeFrontRunByAnotherWallet() public {
        vm.expectRevert(UnitOnlyExpectedProofVerifier.UnitOnlyInvalidProof.selector);
        _submit(BOB, NULLIFIER, NONCE, EXPIRES, _proof());
        _assertUnused();
        // Failed theft does not burn the legitimate caller's proof.
        _submit(ALICE, NULLIFIER, NONCE, EXPIRES, _proof());
        assertEq(gate.verifiedCalls(ALICE), 1);
    }

    function testUnitEveryProofWordIsPassedToVerifier() public {
        for (uint256 i; i < 5; ++i) {
            uint256[5] memory invalidProof = _proof();
            invalidProof[i] += 1;
            vm.expectRevert(UnitOnlyExpectedProofVerifier.UnitOnlyInvalidProof.selector);
            _submit(ALICE, NULLIFIER, NONCE, EXPIRES, invalidProof);
            _assertUnused();
        }
    }

    function testUnitProofPublicInputsCannotBeChanged() public {
        vm.expectRevert(UnitOnlyExpectedProofVerifier.UnitOnlyInvalidProof.selector);
        _submit(ALICE, NULLIFIER + 1, NONCE, EXPIRES, _proof());
        assertFalse(gate.nullifierUsed(NULLIFIER + 1));
        vm.expectRevert(UnitOnlyExpectedProofVerifier.UnitOnlyInvalidProof.selector);
        _submit(ALICE, NULLIFIER, NONCE + 1, EXPIRES, _proof());
        vm.expectRevert(UnitOnlyExpectedProofVerifier.UnitOnlyInvalidProof.selector);
        _submit(ALICE, NULLIFIER, NONCE, EXPIRES + 1, _proof());
        _assertUnused();
    }

    function testUnitProofForDifferentActionOrRpIsRejected() public {
        WorldIDGate otherAction = new WorldIDGate(verifier, RP_ID, "different-action");
        vm.expectRevert(UnitOnlyExpectedProofVerifier.UnitOnlyInvalidProof.selector);
        vm.prank(ALICE);
        otherAction.verifyAndExecute(NULLIFIER, NONCE, EXPIRES, _proof());
        assertFalse(otherAction.nullifierUsed(NULLIFIER));

        WorldIDGate otherRp = new WorldIDGate(verifier, RP_ID + 1, ACTION);
        vm.expectRevert(UnitOnlyExpectedProofVerifier.UnitOnlyInvalidProof.selector);
        vm.prank(ALICE);
        otherRp.verifyAndExecute(NULLIFIER, NONCE, EXPIRES, _proof());
        assertFalse(otherRp.nullifierUsed(NULLIFIER));
    }

    function testUnitPastCredentialConstraintRejectedEvenIfFixtureAccepts() public {
        uint64 expired = NOW - 1;
        _allow(ALICE, NULLIFIER, NONCE, expired, _proof());
        vm.expectRevert(abi.encodeWithSelector(WorldIDGate.ExpiredCredentialConstraint.selector, expired, uint256(NOW)));
        _submit(ALICE, NULLIFIER, NONCE, expired, _proof());
        _assertUnused();
    }

    function testUnitCredentialConstraintCanEqualCurrentBlockTimestamp() public {
        _allow(ALICE, NULLIFIER, NONCE, NOW, _proof());
        _submit(ALICE, NULLIFIER, NONCE, NOW, _proof());
        assertEq(gate.verifiedCalls(ALICE), 1);
    }

    function testUnitUnconsumedProofExpiresAsBlocksAdvance() public {
        vm.warp(EXPIRES + 1);
        vm.expectRevert(
            abi.encodeWithSelector(WorldIDGate.ExpiredCredentialConstraint.selector, EXPIRES, uint256(EXPIRES + 1))
        );
        _submit(ALICE, NULLIFIER, NONCE, EXPIRES, _proof());
        _assertUnused();
    }

    function testUnitDifferentNullifiersCanExecuteIndependently() public {
        _submit(ALICE, NULLIFIER, NONCE, EXPIRES, _proof());
        _allow(BOB, NULLIFIER + 1, NONCE + 1, EXPIRES, _proof());
        _submit(BOB, NULLIFIER + 1, NONCE + 1, EXPIRES, _proof());
        assertTrue(gate.nullifierUsed(NULLIFIER));
        assertTrue(gate.nullifierUsed(NULLIFIER + 1));
        assertEq(gate.verifiedCalls(ALICE), 1);
        assertEq(gate.verifiedCalls(BOB), 1);
    }

    function _allow(address account, uint256 nullifier, uint256 nonce, uint64 expiry, uint256[5] memory proof)
        private
    {
        verifier.setExpectedArguments(
            keccak256(
                abi.encode(
                    nullifier,
                    uint256(keccak256(bytes(ACTION))) >> 8,
                    RP_ID,
                    nonce,
                    uint256(keccak256(abi.encodePacked(account))) >> 8,
                    expiry,
                    uint64(1),
                    uint256(0),
                    proof
                )
            )
        );
    }

    function _submit(address account, uint256 nullifier, uint256 nonce, uint64 expiry, uint256[5] memory proof)
        private
    {
        vm.prank(account);
        gate.verifyAndExecute(nullifier, nonce, expiry, proof);
    }

    function _assertUnused() private view {
        assertFalse(gate.nullifierUsed(NULLIFIER));
        assertEq(gate.verifiedCalls(ALICE), 0);
        assertEq(gate.verifiedCalls(BOB), 0);
    }

    function _proof() private pure returns (uint256[5] memory) {
        // A marker accepted only by UnitOnlyExpectedProofVerifier. Not a cryptographic proof.
        return [uint256(11), uint256(22), uint256(33), uint256(44), uint256(55)];
    }
}
