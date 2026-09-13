// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {WorldIDGate, IWorldIDVerifier} from "../src/WorldIDGate.sol";

/// @notice NEGATIVE FORK COVERAGE ONLY. No valid human proof is generated or accepted here.
/// @dev Both official v4 environments are deployed on World Chain mainnet (480), not Sepolia (4801).
/// A zero Merkle root fails the official registry's inclusion check before Groth16 verification.
contract WorldIDGateForkTest is Test {
    address private constant STAGING = address(bytes20(hex"703a6316c975deabf30b637c155edD53e24657db"));
    address private constant PRODUCTION = address(bytes20(hex"00000000009e00f9fe82cfeebb4556686da094d7"));
    bytes4 private constant INVALID_MERKLE_ROOT = bytes4(keccak256("InvalidMerkleRoot()"));

    function setUp() public {
        vm.createSelectFork(vm.envString("WORLD_RPC_URL"));
        assertEq(block.chainid, 480, "World ID v4 requires World Chain mainnet");
        assertGt(STAGING.code.length, 0, "official staging verifier code missing");
        assertGt(PRODUCTION.code.length, 0, "official production verifier code missing");
    }

    function testForkOfficialStagingRejectsUnknownMerkleRoot() public {
        _checkOfficialRejection(STAGING);
    }

    function testForkOfficialProductionRejectsUnknownMerkleRoot() public {
        _checkOfficialRejection(PRODUCTION);
    }

    function _checkOfficialRejection(address verifierAddress) private {
        // RP 1 is only a negative fixture: the root fails before RP validation is reached.
        WorldIDGate gate = new WorldIDGate(IWorldIDVerifier(verifierAddress), 1, "tokyo-starter-negative-check");
        uint256[5] memory invalidProof;
        vm.expectRevert(INVALID_MERKLE_ROOT);
        gate.verifyAndExecute(123, 456, uint64(block.timestamp + 300), invalidProof);
        assertFalse(gate.nullifierUsed(123));
        assertEq(gate.verifiedCalls(address(this)), 0);
    }
}
