// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Minimal World ID v4 uniqueness-verifier interface. V3's verifyProof ABI is incompatible.
/// @dev Official interface at worldcoin/world-id-protocol commit
/// 31405df8bcd5a2784e04ad9890cf095111dcac13, contracts/src/interfaces/IWorldIDVerifier.sol.
interface IWorldIDVerifier {
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
    ) external view;
}

/// @notice A generic, one-action World ID v4 gate with a wallet-bound signal.
/// @dev Production deployment must select an official verifier from addresses.json on World Chain 480.
/// Constructor injection permits an explicitly labeled UNIT TEST fixture; code presence alone does
/// not establish that the verifier is official. The official verifier is an upgradeable proxy.
contract WorldIDGate {
    error VerifierHasNoCode(address verifier);
    error InvalidRpId();
    error EmptyAction();
    error NullifierAlreadyUsed(uint256 nullifier);
    error ExpiredCredentialConstraint(uint64 expiresAtMin, uint256 timestamp);

    event Verified(address indexed account, uint256 indexed nullifier, uint256 indexed actionHash);

    IWorldIDVerifier public immutable verifier;
    uint64 public immutable rpId;
    uint256 public immutable actionHash;
    uint64 public immutable issuerSchemaId;
    uint256 public immutable credentialGenesisIssuedAtMin;

    mapping(uint256 nullifier => bool used) public nullifierUsed;
    mapping(address account => uint256 count) public verifiedCalls;

    /// @param verifier_ Official v4 verifier proxy for the selected staging/production environment.
    /// @param rpId_ Numeric uint64 value of the Developer Portal RP ID's 16 hexadecimal suffix digits.
    /// @param action_ The same UTF-8 action string passed to IDKit, not a prehashed hexadecimal string.
    constructor(IWorldIDVerifier verifier_, uint64 rpId_, string memory action_) {
        if (address(verifier_).code.length == 0) revert VerifierHasNoCode(address(verifier_));
        if (rpId_ == 0) revert InvalidRpId();
        if (bytes(action_).length == 0) revert EmptyAction();

        verifier = verifier_;
        rpId = rpId_;
        // IDKit Core 4.2.4 hashes UTF-8 action bytes and shifts right eight bits.
        actionHash = uint256(keccak256(bytes(action_))) >> 8;
        issuerSchemaId = 1; // Orb credential schema; callers cannot weaken this policy.
        credentialGenesisIssuedAtMin = 0;
    }

    /// @notice The IDKit signal is the caller's canonical 20 address bytes, not UTF-8 hex text.
    function signalHashFor(address account) public pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(account))) >> 8;
    }

    /// @notice Verify an Orb uniqueness proof and record one generic gated action.
    /// @dev Request a proof whose expires_at_min is the server challenge expiry. This is a proven
    /// credential-expiry lower bound, not the credential's actual expiry or an arbitrary proof TTL.
    /// The gate requires that lower bound to be current when mined. It does not authenticate a
    /// server-issued challenge: RP signatures/challenge consumption belong to the server route.
    /// The nullifier is scoped to immutable RP/action, so it can be consumed once across all wallets.
    function verifyAndExecute(
        uint256 nullifier,
        uint256 nonce,
        uint64 expiresAtMin,
        uint256[5] calldata zeroKnowledgeProof
    ) external {
        if (nullifierUsed[nullifier]) revert NullifierAlreadyUsed(nullifier);
        if (uint256(expiresAtMin) < block.timestamp) {
            revert ExpiredCredentialConstraint(expiresAtMin, block.timestamp);
        }

        // Reverts roll back this write. The interface also enforces STATICCALL to the verifier.
        nullifierUsed[nullifier] = true;
        verifier.verify(
            nullifier,
            actionHash,
            rpId,
            nonce,
            signalHashFor(msg.sender),
            expiresAtMin,
            issuerSchemaId,
            credentialGenesisIssuedAtMin,
            zeroKnowledgeProof
        );

        verifiedCalls[msg.sender] += 1;
        emit Verified(msg.sender, nullifier, actionHash);
    }
}
