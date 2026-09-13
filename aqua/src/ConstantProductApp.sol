// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {AquaApp} from "@1inch/aqua/src/AquaApp.sol";
import {IAqua} from "@1inch/aqua/src/interfaces/IAqua.sol";
import {IXYCSwapCallback} from "@1inch/aqua/examples/apps/interfaces/IXYCSwapCallback.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Generic, unaudited constant-product starter using maker-held Aqua liquidity.
/// @dev Only standard, non-rebasing ERC20s are supported. Shipped balances are allowances,
///      not proof of maker solvency: wallet funds and registry approval must remain available.
contract ConstantProductApp is AquaApp {
    struct Strategy {
        address maker;
        address token0;
        address token1;
        uint16 feeBps;
        bytes32 salt;
    }

    error InvalidRegistry();
    error InvalidStrategy();
    error InvalidAmount();
    error InvalidRecipient();
    error CallbackRequired();
    error InsufficientLiquidity();
    error Slippage(uint256 actual, uint256 minimum);

    event Swap(
        address indexed maker,
        bytes32 indexed strategyHash,
        address indexed taker,
        address recipient,
        bool zeroForOne,
        uint256 amountIn,
        uint256 amountOut
    );

    constructor(IAqua registry) AquaApp(registry) {
        if (address(registry).code.length == 0) revert InvalidRegistry();
    }

    function strategyHash(Strategy calldata strategy) public pure returns (bytes32) {
        return keccak256(abi.encode(strategy));
    }

    function quoteExactIn(Strategy calldata strategy, bool zeroForOne, uint256 amountIn)
        external
        view
        returns (uint256 amountOut)
    {
        (uint256 reserveIn, uint256 reserveOut) = _reserves(strategy, zeroForOne);
        return _price(reserveIn, reserveOut, amountIn, strategy.feeBps);
    }

    /// @notice Output is pulled first; the caller must push input during the callback.
    /// @dev The inherited strategy lock must cover pull, callback, and push verification.
    function swapExactIn(
        Strategy calldata strategy,
        bool zeroForOne,
        uint256 amountIn,
        uint256 minimumOut,
        address recipient,
        bytes calldata callbackData
    ) external nonReentrantStrategy(strategy.maker, strategyHash(strategy)) returns (uint256 amountOut) {
        if (recipient == address(0)) revert InvalidRecipient();
        if (msg.sender.code.length == 0) revert CallbackRequired();
        (uint256 reserveIn, uint256 reserveOut) = _reserves(strategy, zeroForOne);
        amountOut = _price(reserveIn, reserveOut, amountIn, strategy.feeBps);
        if (amountOut < minimumOut) revert Slippage(amountOut, minimumOut);

        bytes32 key = strategyHash(strategy);
        address tokenIn = zeroForOne ? strategy.token0 : strategy.token1;
        address tokenOut = zeroForOne ? strategy.token1 : strategy.token0;
        AQUA.pull(strategy.maker, key, tokenOut, amountOut, recipient);
        IXYCSwapCallback(msg.sender).xycSwapCallback(
            tokenIn, tokenOut, amountIn, amountOut, strategy.maker, address(this), key, callbackData
        );
        _safeCheckAquaPush(strategy.maker, key, tokenIn, reserveIn + amountIn);
        emit Swap(strategy.maker, key, msg.sender, recipient, zeroForOne, amountIn, amountOut);
    }

    function _reserves(Strategy calldata strategy, bool zeroForOne)
        private
        view
        returns (uint256 reserveIn, uint256 reserveOut)
    {
        if (
            strategy.maker == address(0) || strategy.token0 == address(0) || strategy.token1 == address(0)
                || strategy.token0 == strategy.token1 || strategy.feeBps >= 10_000
        ) revert InvalidStrategy();
        (uint256 r0, uint256 r1) = AQUA.safeBalances(
            strategy.maker, address(this), strategyHash(strategy), strategy.token0, strategy.token1
        );
        if (r0 == 0 || r1 == 0) revert InsufficientLiquidity();
        return zeroForOne ? (r0, r1) : (r1, r0);
    }

    function _price(uint256 reserveIn, uint256 reserveOut, uint256 amountIn, uint16 feeBps)
        private
        pure
        returns (uint256 amountOut)
    {
        // Aqua stores uint248 allowances. Reject an input that its push cannot represent.
        if (amountIn == 0 || amountIn > type(uint248).max - reserveIn) revert InvalidAmount();
        uint256 effectiveIn = Math.mulDiv(amountIn, 10_000 - feeBps, 10_000);
        amountOut = Math.mulDiv(reserveOut, effectiveIn, reserveIn + effectiveIn);
        if (amountOut == 0) revert InvalidAmount();
    }
}
