// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Test-only mintable asset. Never a replacement for the official Aqua contracts.
contract TestToken is ERC20 {
    constructor(string memory symbol) ERC20(symbol, symbol) {}

    function mint(address recipient, uint256 amount) external {
        _mint(recipient, amount);
    }
}
