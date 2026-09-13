// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {DirectionalHookTestBase} from "../helpers/DirectionalHookTestBase.sol";

contract DirectionalFeeHookOfficialForkTest is DirectionalHookTestBase {
    address internal constant OFFICIAL_MANAGER = address(bytes20(hex"498581ff718922c3f8e6a244956af099b2652b2b"));

    function setUp() public {
        vm.createSelectFork(vm.envString("BASE_RPC_URL"));
        assertGt(OFFICIAL_MANAGER.code.length, 0, "official Base PoolManager missing from fork");
        _initialize(IPoolManager(OFFICIAL_MANAGER));
    }
}
