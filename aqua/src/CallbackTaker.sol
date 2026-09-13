// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IXYCSwapCallback} from "@1inch/aqua/examples/apps/interfaces/IXYCSwapCallback.sol";
import {IAqua} from "@1inch/aqua/src/interfaces/IAqua.sol";
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ConstantProductApp} from "./ConstantProductApp.sol";

/// @notice A payer-bound callback example: callers approve this taker, never its callback caller.
contract CallbackTaker is IXYCSwapCallback, ReentrancyGuard {
    using SafeERC20 for IERC20;

    ConstantProductApp public immutable APP;
    IAqua public immutable AQUA;
    bytes32 private _expected;
    address private _payer;

    error InvalidApp();
    error UnauthorizedCallback();
    error MissingCallback();
    error UnsupportedToken();

    constructor(ConstantProductApp app) {
        if (address(app).code.length == 0) revert InvalidApp();
        APP = app;
        AQUA = app.AQUA();
    }

    function swapExactIn(
        ConstantProductApp.Strategy calldata strategy,
        bool zeroForOne,
        uint256 amountIn,
        uint256 minimumOut,
        address recipient
    ) external nonReentrant returns (uint256 amountOut) {
        address tokenIn = zeroForOne ? strategy.token0 : strategy.token1;
        address tokenOut = zeroForOne ? strategy.token1 : strategy.token0;
        _payer = msg.sender;
        _expected = keccak256(abi.encode(tokenIn, tokenOut, amountIn, strategy.maker, APP.strategyHash(strategy)));
        amountOut = APP.swapExactIn(strategy, zeroForOne, amountIn, minimumOut, recipient, "");
        if (_expected != bytes32(0)) revert MissingCallback();
        delete _payer;
    }

    function xycSwapCallback(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256,
        address maker,
        address app,
        bytes32 key,
        bytes calldata callbackData
    ) external override {
        if (
            msg.sender != address(APP) || app != address(APP) || _payer == address(0)
                || callbackData.length != 0 || _expected == bytes32(0)
                || _expected != keccak256(abi.encode(tokenIn, tokenOut, amountIn, maker, key))
        ) revert UnauthorizedCallback();
        // Consume the authorization before invoking token code or Aqua.
        delete _expected;
        IERC20 token = IERC20(tokenIn);
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(_payer, address(this), amountIn);
        if (token.balanceOf(address(this)) - beforeBalance != amountIn) revert UnsupportedToken();
        token.forceApprove(address(AQUA), amountIn);
        AQUA.push(maker, app, key, tokenIn, amountIn);
        token.forceApprove(address(AQUA), 0);
    }
}
