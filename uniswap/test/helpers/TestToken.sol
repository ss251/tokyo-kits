// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Test-only token; never a substitute PoolManager or deployed sponsor contract.
contract TestToken is ERC20 {
    constructor(string memory symbol) ERC20(symbol, symbol) {}
    function mint(address recipient, uint256 amount) external { _mint(recipient, amount); }
}
