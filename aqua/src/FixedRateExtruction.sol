// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IExtruction} from "@1inch/swap-vm/src/instructions/Extruction.sol";
import {SwapQuery, SwapRegisters} from "@1inch/swap-vm/src/libs/VM.sol";
import {FixedRatePricing} from "./FixedRatePricing.sol";

/// @notice Deterministic external pricing instruction for the pinned official AquaSwapVMRouter.
/// @dev Args are abi.encode(token0, token1, numerator, denominator), in atomic token units.
///      One token0 atomic unit buys numerator/denominator token1 atomic units.
///      The maker chooses that immutable rate in the shipped program. This is not an oracle.
contract FixedRateExtruction is IExtruction {
    address public immutable ROUTER;

    error InvalidRouter();
    error OnlyRouter();

    constructor(address router) {
        if (router.code.length == 0) revert InvalidRouter();
        ROUTER = router;
    }

    /// @dev Identical code in quote and swap modes; no storage writes, calls, or taker-arg consumption.
    function extruction(
        bool,
        uint256 nextPC,
        SwapQuery calldata query,
        SwapRegisters calldata swap,
        bytes calldata args,
        bytes calldata
    ) external view override returns (uint256 updatedNextPC, uint256 choppedLength, SwapRegisters memory result) {
        if (msg.sender != ROUTER) revert OnlyRouter();
        return (nextPC, 0, FixedRatePricing.calculate(query, swap, args));
    }
}
