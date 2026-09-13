// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IAqua} from "@1inch/aqua/src/interfaces/IAqua.sol";
import {AquaApp} from "@1inch/aqua/src/AquaApp.sol";
import {IXYCSwapCallback} from "@1inch/aqua/examples/apps/interfaces/IXYCSwapCallback.sol";
import {ConstantProductApp} from "../../src/ConstantProductApp.sol";
import {CallbackTaker} from "../../src/CallbackTaker.sol";
import {TestToken} from "./TestToken.sol";

contract UnpaidCallback is IXYCSwapCallback {
    function fill(ConstantProductApp app, ConstantProductApp.Strategy calldata strategy) external {
        app.swapExactIn(strategy, true, 10 ether, 1, address(this), "");
    }

    function xycSwapCallback(address, address, uint256, uint256, address, address, bytes32, bytes calldata)
        external
        pure
    {}
}

contract ReenteringCallback is IXYCSwapCallback {
    ConstantProductApp private _app;
    ConstantProductApp.Strategy private _strategy;

    function fill(ConstantProductApp app, ConstantProductApp.Strategy calldata strategy) external {
        _app = app;
        _strategy = strategy;
        app.swapExactIn(strategy, true, 10 ether, 1, address(this), "");
    }

    function xycSwapCallback(address, address, uint256, uint256, address, address, bytes32, bytes calldata)
        external
    {
        _app.swapExactIn(_strategy, true, 10 ether, 1, address(this), "");
    }
}

/// @dev Same behavioral tests run against a local source fixture and the official fork registry.
abstract contract AquaAppTestBase is Test {
    uint256 internal constant RESERVE0 = 1_000_000 ether;
    uint256 internal constant RESERVE1 = 2_000_000 ether;
    address internal maker = address(0xA11CE);
    IAqua internal aqua;
    ConstantProductApp internal app;
    CallbackTaker internal taker;
    TestToken internal token0;
    TestToken internal token1;
    ConstantProductApp.Strategy internal strategy;
    bytes32 internal key;

    function _initialize(IAqua registry) internal {
        aqua = registry;
        token0 = new TestToken("TEST0");
        token1 = new TestToken("TEST1");
        app = new ConstantProductApp(aqua);
        taker = new CallbackTaker(app);
        token0.mint(maker, RESERVE0);
        token1.mint(maker, RESERVE1);
        token0.mint(address(this), RESERVE0);
        token1.mint(address(this), RESERVE1);
        token0.approve(address(taker), type(uint256).max);
        token1.approve(address(taker), type(uint256).max);
        vm.startPrank(maker);
        token0.approve(address(aqua), type(uint256).max);
        token1.approve(address(aqua), type(uint256).max);
        vm.stopPrank();
        strategy = ConstantProductApp.Strategy(maker, address(token0), address(token1), 30, bytes32(uint256(1)));
        key = _ship(strategy);
    }

    function _tokens() internal view returns (address[] memory tokens) {
        tokens = new address[](2);
        tokens[0] = address(token0);
        tokens[1] = address(token1);
    }

    function _ship(ConstantProductApp.Strategy memory configuration) internal returns (bytes32) {
        uint256[] memory balances = new uint256[](2);
        balances[0] = RESERVE0;
        balances[1] = RESERVE1;
        vm.prank(maker);
        return aqua.ship(address(app), abi.encode(configuration), _tokens(), balances);
    }

    function testShipAndQuoteKeepMakerCustody() public view {
        assertEq(token0.balanceOf(maker), RESERVE0);
        assertEq(token1.balanceOf(maker), RESERVE1);
        assertEq(token0.balanceOf(address(aqua)), 0);
        assertEq(token1.balanceOf(address(aqua)), 0);
        assertGt(app.quoteExactIn(strategy, true, 10 ether), 0);
        assertEq(token1.balanceOf(maker), RESERVE1);
        assertEq(key, app.strategyHash(strategy));
    }

    function testFuzzQuoteEqualsSwapAndConservesCustody(uint96 rawInput, bool zeroForOne) public {
        uint256 amountIn = bound(uint256(rawInput), 1e12, 10_000 ether);
        uint256 expected = app.quoteExactIn(strategy, zeroForOne, amountIn);
        TestToken input = zeroForOne ? token0 : token1;
        TestToken output = zeroForOne ? token1 : token0;
        uint256 beforeIn = input.balanceOf(maker);
        uint256 beforeOut = output.balanceOf(maker);
        address recipient = address(0xB0B);
        uint256 actual = taker.swapExactIn(strategy, zeroForOne, amountIn, expected, recipient);
        assertEq(actual, expected);
        assertEq(input.balanceOf(maker), beforeIn + amountIn);
        assertEq(output.balanceOf(maker), beforeOut - expected);
        assertEq(output.balanceOf(recipient), expected);
        assertEq(input.balanceOf(address(aqua)), 0);
        assertEq(input.balanceOf(address(taker)), 0);
        assertEq(input.allowance(address(taker), address(aqua)), 0);
        (uint256 trackedIn, uint256 trackedOut) =
            aqua.safeBalances(maker, address(app), key, address(input), address(output));
        assertEq(trackedIn, beforeIn + amountIn);
        assertEq(trackedOut, beforeOut - expected);
    }

    function testSlippageRevertsWithoutMovingFunds() public {
        uint256 expected = app.quoteExactIn(strategy, true, 10 ether);
        vm.expectRevert(abi.encodeWithSelector(ConstantProductApp.Slippage.selector, expected, expected + 1));
        taker.swapExactIn(strategy, true, 10 ether, expected + 1, address(this));
        assertEq(token1.balanceOf(maker), RESERVE1);
        assertEq(token0.balanceOf(maker), RESERVE0);
    }

    function testNonpaymentRevertsOutputPullAtomically() public {
        UnpaidCallback unpaid = new UnpaidCallback();
        vm.expectRevert(
            abi.encodeWithSelector(AquaApp.MissingTakerAquaPush.selector, address(token0), RESERVE0, RESERVE0 + 10 ether)
        );
        unpaid.fill(app, strategy);
        assertEq(token1.balanceOf(address(unpaid)), 0);
        assertEq(token1.balanceOf(maker), RESERVE1);
        (uint256 balance,) = aqua.rawBalances(maker, address(app), key, address(token1));
        assertEq(balance, RESERVE1);
    }

    function testReentrantFillRevertsAtomically() public {
        ReenteringCallback attacker = new ReenteringCallback();
        vm.expectRevert();
        attacker.fill(app, strategy);
        assertEq(token1.balanceOf(address(attacker)), 0);
        assertEq(token1.balanceOf(maker), RESERVE1);
    }

    function testCallbackCannotSpendUnrelatedPayerAllowance() public {
        vm.expectRevert(CallbackTaker.UnauthorizedCallback.selector);
        taker.xycSwapCallback(
            address(token0), address(token1), 10 ether, 1, maker, address(app), key, abi.encode(address(this))
        );
        assertEq(token0.balanceOf(address(this)), RESERVE0);
    }

    function testAppCannotCallTakerOutsideActiveFill() public {
        vm.prank(address(app));
        vm.expectRevert(CallbackTaker.UnauthorizedCallback.selector);
        taker.xycSwapCallback(address(token0), address(token1), 10 ether, 1, maker, address(app), key, "");
    }

    function testDockRevokesQuoteAndSwapWithoutMovingWalletFunds() public {
        vm.prank(maker);
        aqua.dock(address(app), key, _tokens());
        vm.expectRevert();
        app.quoteExactIn(strategy, true, 10 ether);
        vm.expectRevert();
        taker.swapExactIn(strategy, true, 10 ether, 1, address(this));
        assertEq(token0.balanceOf(maker), RESERVE0);
        assertEq(token1.balanceOf(maker), RESERVE1);
    }

    function testCannotReuseDockedStrategyHash() public {
        vm.prank(maker);
        aqua.dock(address(app), key, _tokens());
        vm.expectRevert();
        _ship(strategy);
        ConstantProductApp.Strategy memory next = strategy;
        next.salt = bytes32(uint256(2));
        bytes32 newKey = _ship(next);
        assertNotEq(newKey, key);
        assertGt(app.quoteExactIn(next, true, 10 ether), 0);
    }

    function testWalletApprovalRevocationPreventsFill() public {
        vm.prank(maker);
        token1.approve(address(aqua), 0);
        // Quotes expose mathematical liquidity, not maker solvency or ERC20 allowance.
        assertGt(app.quoteExactIn(strategy, true, 10 ether), 0);
        vm.expectRevert();
        taker.swapExactIn(strategy, true, 10 ether, 1, address(this));
        assertEq(token0.balanceOf(maker), RESERVE0);
    }

    function testZeroInputRejected() public {
        vm.expectRevert(ConstantProductApp.InvalidAmount.selector);
        app.quoteExactIn(strategy, true, 0);
    }

    function testInvalidFeeRejectedBeforeRegistryQuery() public {
        ConstantProductApp.Strategy memory invalid = strategy;
        invalid.feeBps = 10_000;
        vm.expectRevert(ConstantProductApp.InvalidStrategy.selector);
        app.quoteExactIn(invalid, true, 1 ether);
    }

    function testUnshippedStrategyCannotUseMakerFunds() public {
        ConstantProductApp.Strategy memory changed = strategy;
        changed.salt = bytes32(uint256(999));
        vm.expectRevert();
        taker.swapExactIn(changed, true, 10 ether, 1, address(this));
        assertEq(token1.balanceOf(maker), RESERVE1);
    }
}
