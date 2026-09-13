// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Aqua} from "@1inch/aqua/src/Aqua.sol";
import {AquaAppTestBase} from "../helpers/AquaAppTestBase.sol";

/// @dev Local unit fixture ONLY. Official deployment proof lives in test/integration and receipts/.
contract ConstantProductAppUnitTest is AquaAppTestBase {
    function setUp() public {
        _initialize(new Aqua());
    }
}
