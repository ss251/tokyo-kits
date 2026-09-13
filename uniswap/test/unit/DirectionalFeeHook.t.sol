// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {DirectionalHookTestBase} from "../helpers/DirectionalHookTestBase.sol";

/// @dev Local official-source fixture ONLY; deployed-address proof is in test/integration.
contract DirectionalFeeHookUnitTest is DirectionalHookTestBase {
    function setUp() public { _initialize(new PoolManager(address(this))); }
}
