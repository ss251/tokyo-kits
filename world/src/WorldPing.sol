// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice A zero-value transaction surface for MiniKit; contains no identity claim.
contract WorldPing {
    event Ping(address indexed sender, bytes32 note);
    function ping(bytes32 note) external { emit Ping(msg.sender, note); }
}
