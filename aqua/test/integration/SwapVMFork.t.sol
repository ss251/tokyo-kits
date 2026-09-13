// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IAqua} from "@1inch/aqua/src/interfaces/IAqua.sol";
import {ISwapVM} from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import {SwapVMTestBase} from "../helpers/SwapVMTestBase.sol";

contract SwapVMOfficialForkTest is SwapVMTestBase {
    address internal constant OFFICIAL_AQUA = address(bytes20(hex"1111113ccf1426a8e30e2bff5e005d929bf6a90a"));
    address internal constant OFFICIAL_ROUTER = address(bytes20(hex"111111338c5091e8440b67b168bae16a668ac0de"));

    function setUp() public {
        vm.createSelectFork(vm.envString("POLYGON_RPC_URL"));
        assertGt(OFFICIAL_AQUA.code.length, 0, "official registry absent");
        assertGt(OFFICIAL_ROUTER.code.length, 0, "official router absent");
        _initializeVM(IAqua(OFFICIAL_AQUA), ISwapVM(OFFICIAL_ROUTER));
    }
}
