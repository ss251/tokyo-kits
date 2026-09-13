// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AquaSwapVMRouter} from "@1inch/swap-vm/src/routers/AquaSwapVMRouter.sol";
import {Context} from "@1inch/swap-vm/src/libs/VM.sol";
import {FixedRatePricing} from "./FixedRatePricing.sol";

/// @notice A custom app/router extension settling through the official Aqua registry.
/// @dev This is not the official deployed router. The official-router extruction demo is separate.
///      The first 33 opcode indexes are preserved from the pinned upstream source.
contract CustomAquaRouter is AquaSwapVMRouter {
    uint8 public constant FIXED_RATE_OPCODE = 33;

    error UnexpectedUpstreamOpcodeCount();

    constructor(address aqua, address weth, address owner)
        AquaSwapVMRouter(aqua, weth, owner, "TokyoCustomAquaRouter", "1.0.0")
    {}

    function _opcodes()
        internal
        pure
        override
        returns (function(Context memory, bytes calldata) internal[] memory result)
    {
        function(Context memory, bytes calldata) internal[] memory upstream = super._opcodes();
        if (upstream.length != FIXED_RATE_OPCODE) revert UnexpectedUpstreamOpcodeCount();
        result = new function(Context memory, bytes calldata) internal[](upstream.length + 1);
        for (uint256 i; i < upstream.length; ++i) result[i] = upstream[i];
        result[FIXED_RATE_OPCODE] = _fixedRate;
    }

    function _fixedRate(Context memory ctx, bytes calldata args) internal pure {
        ctx.swap = FixedRatePricing.calculate(ctx.query, ctx.swap, args);
    }
}
