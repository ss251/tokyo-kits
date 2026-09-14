// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice Minimal read/write/event target for the MultiBaas integration starter.
contract KitCounter {
    error Unauthorized(address caller);

    address public immutable owner;
    uint256 public value;

    event Incremented(address indexed caller, uint256 value);

    constructor() {
        owner = msg.sender;
    }

    function increment() external {
        if (msg.sender != owner) revert Unauthorized(msg.sender);
        uint256 next = value + 1;
        value = next;
        emit Incremented(msg.sender, next);
    }
}
