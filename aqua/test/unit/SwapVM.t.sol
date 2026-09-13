// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Aqua} from "@1inch/aqua/src/Aqua.sol";
import {ISwapVM} from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import {AquaSwapVMRouter} from "@1inch/swap-vm/src/routers/AquaSwapVMRouter.sol";
import {SwapVMTestBase} from "../helpers/SwapVMTestBase.sol";

/// @dev Local source fixtures ONLY, kept separate from official-address fork proofs.
contract SwapVMUnitTest is SwapVMTestBase {
    function setUp() public {
        Aqua registry = new Aqua();
        AquaSwapVMRouter router = new AquaSwapVMRouter(address(registry), address(0), address(this), "SwapVM", "1.0.0");
        _initializeVM(registry, ISwapVM(address(router)));
    }
}
