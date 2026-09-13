// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {BaseHook} from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";

/// @notice Minimal dynamic-LP-fee hook: each direction selects an immutable fee per swap.
/// @dev Fees are pips (1_000_000 = 100%). This hook takes no token delta and owns no liquidity.
///      It is a generic, unaudited template. BaseHook authenticates every external callback.
contract DirectionalFeeHook is BaseHook {
    using PoolIdLibrary for PoolKey;

    uint24 public immutable feeZeroForOne;
    uint24 public immutable feeOneForZero;

    error InvalidManager();
    error InvalidFee(uint24 fee);
    error DynamicPoolRequired();

    /// @dev sender is the PoolManager caller (usually a router), not necessarily the end user.
    event SwapObserved(
        bytes32 indexed poolId,
        address indexed sender,
        bool zeroForOne,
        int256 amountSpecified,
        int128 amount0,
        int128 amount1,
        uint24 feePips
    );

    constructor(IPoolManager manager, uint24 zeroForOneFee, uint24 oneForZeroFee) BaseHook(manager) {
        if (address(manager).code.length == 0) revert InvalidManager();
        // A 100% fee prevents exact-output swaps, so keep both supported directions below it.
        if (zeroForOneFee >= LPFeeLibrary.MAX_LP_FEE) revert InvalidFee(zeroForOneFee);
        if (oneForZeroFee >= LPFeeLibrary.MAX_LP_FEE) revert InvalidFee(oneForZeroFee);
        feeZeroForOne = zeroForOneFee;
        feeOneForZero = oneForZeroFee;
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory permissions) {
        permissions.beforeInitialize = true;
        permissions.beforeSwap = true;
        permissions.afterSwap = true;
    }

    function feeForDirection(bool zeroForOne) public view returns (uint24) {
        return zeroForOne ? feeZeroForOne : feeOneForZero;
    }

    function _beforeInitialize(address, PoolKey calldata key, uint160) internal pure override returns (bytes4) {
        _requireDynamic(key);
        return IHooks.beforeInitialize.selector;
    }

    function _beforeSwap(address, PoolKey calldata key, SwapParams calldata params, bytes calldata)
        internal
        view
        override
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        _requireDynamic(key);
        return (
            IHooks.beforeSwap.selector,
            BeforeSwapDelta.wrap(0),
            feeForDirection(params.zeroForOne) | LPFeeLibrary.OVERRIDE_FEE_FLAG
        );
    }

    function _afterSwap(address sender, PoolKey calldata key, SwapParams calldata params, BalanceDelta delta, bytes calldata)
        internal
        override
        returns (bytes4, int128)
    {
        emit SwapObserved(
            PoolId.unwrap(key.toId()), sender, params.zeroForOne, params.amountSpecified,
            delta.amount0(), delta.amount1(), feeForDirection(params.zeroForOne)
        );
        return (IHooks.afterSwap.selector, 0);
    }

    function _requireDynamic(PoolKey calldata key) private pure {
        if (key.fee != LPFeeLibrary.DYNAMIC_FEE_FLAG) revert DynamicPoolRequired();
    }
}
