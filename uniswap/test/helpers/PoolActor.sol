// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @dev ERC20-only test actor spending its OWN minted balances. Production demo uses official routers.
contract PoolActor is IUnlockCallback {
    using SafeERC20 for IERC20;
    IPoolManager public immutable manager;
    error OnlyManager();

    constructor(IPoolManager manager_) { manager = manager_; }

    function addLiquidity(PoolKey calldata key, ModifyLiquidityParams calldata params) external returns (BalanceDelta) {
        return abi.decode(manager.unlock(abi.encode(uint8(0), abi.encode(key, params))), (BalanceDelta));
    }

    function swap(PoolKey calldata key, SwapParams calldata params) external returns (BalanceDelta) {
        return abi.decode(manager.unlock(abi.encode(uint8(1), abi.encode(key, params))), (BalanceDelta));
    }

    function unlockCallback(bytes calldata payload) external returns (bytes memory) {
        if (msg.sender != address(manager)) revert OnlyManager();
        (uint8 operation, bytes memory args) = abi.decode(payload, (uint8, bytes));
        BalanceDelta delta;
        PoolKey memory key;
        if (operation == 0) {
            ModifyLiquidityParams memory params;
            (key, params) = abi.decode(args, (PoolKey, ModifyLiquidityParams));
            (delta,) = manager.modifyLiquidity(key, params, "");
        } else {
            SwapParams memory params;
            (key, params) = abi.decode(args, (PoolKey, SwapParams));
            delta = manager.swap(key, params, "");
        }
        _settle(key.currency0, delta.amount0());
        _settle(key.currency1, delta.amount1());
        return abi.encode(delta);
    }

    function _settle(Currency currency, int128 delta) private {
        if (delta < 0) {
            manager.sync(currency);
            IERC20(Currency.unwrap(currency)).safeTransfer(address(manager), uint256(-int256(delta)));
            manager.settle();
        } else if (delta > 0) {
            manager.take(currency, address(this), uint256(int256(delta)));
        }
    }
}
