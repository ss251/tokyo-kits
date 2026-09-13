// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IAqua} from "@1inch/aqua/src/interfaces/IAqua.sol";
import {AquaAppTestBase} from "../helpers/AquaAppTestBase.sol";

/// @dev Requires an RPC or a local Anvil fork. No local replacement registry and no vm.etch.
contract AquaOfficialForkTest is AquaAppTestBase {
    address internal constant OFFICIAL_AQUA = address(bytes20(hex"1111113ccf1426a8e30e2bff5e005d929bf6a90a"));

    function setUp() public {
        vm.createSelectFork(vm.envString("POLYGON_RPC_URL"));
        assertGt(OFFICIAL_AQUA.code.length, 0, "official Aqua has no code on selected fork");
        _initialize(IAqua(OFFICIAL_AQUA));
    }
}
