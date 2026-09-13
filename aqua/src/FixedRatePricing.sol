// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {SwapQuery, SwapRegisters} from "@1inch/swap-vm/src/libs/VM.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Shared deterministic arithmetic for the extruction and custom opcode examples.
library FixedRatePricing {
    error InvalidArguments();
    error UnsupportedPair();
    error InvalidAmount();
    error InsufficientLiquidity();
    error AquaBalanceCapacityExceeded();

    function calculate(SwapQuery memory query, SwapRegisters memory swap, bytes calldata args)
        internal
        pure
        returns (SwapRegisters memory result)
    {
        if (args.length != 128) revert InvalidArguments();
        (address token0, address token1, uint256 numerator, uint256 denominator) =
            abi.decode(args, (address, address, uint256, uint256));
        if (token0 == address(0) || token1 == address(0) || token0 == token1 || numerator == 0 || denominator == 0) {
            revert InvalidArguments();
        }
        if (query.tokenIn == token1 && query.tokenOut == token0) {
            (numerator, denominator) = (denominator, numerator);
        } else if (query.tokenIn != token0 || query.tokenOut != token1) {
            revert UnsupportedPair();
        }
        result = swap;
        if (query.isExactIn) {
            if (swap.amountIn == 0) revert InvalidAmount();
            result.amountOut = Math.mulDiv(swap.amountIn, numerator, denominator);
        } else {
            if (swap.amountOut == 0) revert InvalidAmount();
            result.amountIn = Math.mulDiv(swap.amountOut, denominator, numerator, Math.Rounding.Ceil);
        }
        if (result.amountIn == 0 || result.amountOut == 0) revert InvalidAmount();
        if (result.amountOut > swap.balanceOut) revert InsufficientLiquidity();
        if (swap.balanceIn > type(uint248).max || result.amountIn > type(uint248).max - swap.balanceIn) {
            revert AquaBalanceCapacityExceeded();
        }
    }
}
