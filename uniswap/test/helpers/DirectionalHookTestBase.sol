// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {BaseHook} from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {SwapParams, ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {BeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {BalanceDelta, toBalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {DirectionalFeeHook} from "../../src/DirectionalFeeHook.sol";
import {HookFactory} from "../../src/HookFactory.sol";
import {PoolActor} from "./PoolActor.sol";
import {TestToken} from "./TestToken.sol";

/// @dev Runs identical behavioral checks against a local source fixture and the official Base manager.
abstract contract DirectionalHookTestBase is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint24 internal constant FEE_0_TO_1 = 500;
    uint24 internal constant FEE_1_TO_0 = 3000;
    uint160 internal constant FLAGS = 0x20c0;
    IPoolManager internal manager;
    HookFactory internal factory;
    DirectionalFeeHook internal hook;
    PoolActor internal actor;
    PoolKey internal key;
    TestToken internal token0;
    TestToken internal token1;
    bytes32 internal minedSalt;

    function _initialize(IPoolManager manager_) internal {
        manager = manager_;
        factory = new HookFactory();
        (address predicted, bytes32 salt) = _mine(FEE_0_TO_1, FEE_1_TO_0);
        minedSalt = salt;
        hook = factory.deploy(salt, manager, FEE_0_TO_1, FEE_1_TO_0);
        assertEq(address(hook), predicted, "CREATE2 address differs from mined address");
        TestToken first = new TestToken("HOOK0");
        TestToken second = new TestToken("HOOK1");
        (token0, token1) = address(first) < address(second) ? (first, second) : (second, first);
        key = PoolKey(
            Currency.wrap(address(token0)), Currency.wrap(address(token1)), LPFeeLibrary.DYNAMIC_FEE_FLAG,
            60, IHooks(address(hook))
        );
        manager.initialize(key, uint160(1 << 96));
        actor = new PoolActor(manager);
        token0.mint(address(actor), 1_000_000 ether);
        token1.mint(address(actor), 1_000_000 ether);
        actor.addLiquidity(key, ModifyLiquidityParams(-120, 120, 1_000_000 ether, bytes32(0)));
    }

    function _mine(uint24 fee0, uint24 fee1) internal view returns (address predicted, bytes32 salt) {
        bytes32 codeHash = factory.initCodeHash(manager, fee0, fee1);
        for (uint256 candidate; candidate < 1_000_000; ++candidate) {
            salt = bytes32(candidate);
            predicted = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(factory), salt, codeHash)))));
            if (uint160(predicted) & Hooks.ALL_HOOK_MASK == FLAGS && predicted.code.length == 0) return (predicted, salt);
        }
        revert("no CREATE2 salt found within search budget");
    }

    function _params(bool zeroForOne, bool exactInput) internal pure returns (SwapParams memory) {
        return SwapParams({
            zeroForOne: zeroForOne,
            amountSpecified: exactInput ? -int256(10 ether) : int256(10 ether),
            sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
        });
    }

    function testMinedAddressHasExactPermissionsAndCode() public view {
        assertGt(address(hook).code.length, 0);
        assertEq(uint256(uint160(address(hook)) & Hooks.ALL_HOOK_MASK), uint256(FLAGS));
        assertEq(address(hook.poolManager()), address(manager));
        assertEq(factory.predict(minedSalt, manager, FEE_0_TO_1, FEE_1_TO_0), address(hook));
        Hooks.Permissions memory permissions = hook.getHookPermissions();
        assertTrue(permissions.beforeInitialize && permissions.beforeSwap && permissions.afterSwap);
        assertFalse(permissions.beforeSwapReturnDelta || permissions.afterSwapReturnDelta);
    }

    function testWrongAddressFlagsFailRealConstructor() public {
        bytes32 salt;
        address predicted = factory.predict(salt, manager, FEE_0_TO_1, FEE_1_TO_0);
        while (uint160(predicted) & Hooks.ALL_HOOK_MASK == FLAGS) {
            salt = bytes32(uint256(salt) + 1);
            predicted = factory.predict(salt, manager, FEE_0_TO_1, FEE_1_TO_0);
        }
        vm.expectRevert(abi.encodeWithSelector(Hooks.HookAddressNotValid.selector, predicted));
        factory.deploy(salt, manager, FEE_0_TO_1, FEE_1_TO_0);
    }

    function testCannotDeploySameSaltTwice() public {
        vm.expectRevert();
        factory.deploy(minedSalt, manager, FEE_0_TO_1, FEE_1_TO_0);
    }

    function testRejectsFeeThatPreventsExactOutput() public {
        (, bytes32 salt) = _mine(1_000_000, FEE_1_TO_0);
        vm.expectRevert(abi.encodeWithSelector(DirectionalFeeHook.InvalidFee.selector, uint24(1_000_000)));
        factory.deploy(salt, manager, 1_000_000, FEE_1_TO_0);
    }

    function testUnauthorizedBeforeSwapRejected() public {
        vm.expectRevert(BaseHook.NotPoolManager.selector);
        hook.beforeSwap(address(this), key, _params(true, true), "");
    }

    function testUnauthorizedAfterSwapRejected() public {
        vm.expectRevert(BaseHook.NotPoolManager.selector);
        hook.afterSwap(address(this), key, _params(true, true), BalanceDelta.wrap(0), "");
    }

    function testUnauthorizedInitializationRejected() public {
        vm.expectRevert(BaseHook.NotPoolManager.selector);
        hook.beforeInitialize(address(this), key, uint160(1 << 96));
    }

    function testStaticFeePoolRejectedByInitializationCallback() public {
        PoolKey memory invalid = key;
        invalid.fee = 3000;
        vm.prank(address(manager));
        vm.expectRevert(DirectionalFeeHook.DynamicPoolRequired.selector);
        hook.beforeInitialize(address(this), invalid, uint160(1 << 96));
    }

    function testDynamicFeeOverrideFlagAndZeroHookDelta() public {
        for (uint256 i; i < 2; ++i) {
            bool zeroForOne = i == 0;
            vm.prank(address(manager));
            (bytes4 selector, BeforeSwapDelta delta, uint24 fee) = hook.beforeSwap(address(actor), key, _params(zeroForOne, true), "");
            assertEq(selector, IHooks.beforeSwap.selector);
            assertEq(BeforeSwapDelta.unwrap(delta), 0);
            assertEq(uint256(fee), uint256((zeroForOne ? FEE_0_TO_1 : FEE_1_TO_0) | LPFeeLibrary.OVERRIDE_FEE_FLAG));
        }
    }

    function testAfterSwapEmitsActualDeltasAndRouterSender() public {
        SwapParams memory params = _params(true, true);
        BalanceDelta delta = toBalanceDelta(-10 ether, 9 ether);
        vm.recordLogs();
        vm.prank(address(manager));
        (bytes4 selector, int128 hookDelta) = hook.afterSwap(address(actor), key, params, delta, "");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(selector, IHooks.afterSwap.selector);
        assertEq(hookDelta, 0);
        assertEq(logs.length, 1);
        _assertHookEvent(logs[0], true, -int256(10 ether), delta);
    }

    function _assertHookEvent(Vm.Log memory entry, bool zeroForOne, int256 specified, BalanceDelta delta) internal view {
        assertEq(entry.emitter, address(hook));
        assertEq(entry.topics[0], keccak256("SwapObserved(bytes32,address,bool,int256,int128,int128,uint24)"));
        assertEq(entry.topics[1], PoolId.unwrap(key.toId()));
        assertEq(entry.topics[2], bytes32(uint256(uint160(address(actor)))));
        (bool direction, int256 amount, int128 amount0, int128 amount1, uint24 fee) =
            abi.decode(entry.data, (bool, int256, int128, int128, uint24));
        assertEq(direction, zeroForOne);
        assertEq(amount, specified);
        assertEq(amount0, delta.amount0());
        assertEq(amount1, delta.amount1());
        assertEq(uint256(fee), uint256(zeroForOne ? FEE_0_TO_1 : FEE_1_TO_0));
    }

    function _checkRealSwap(bool zeroForOne, bool exactInput) internal {
        SwapParams memory params = _params(zeroForOne, exactInput);
        uint256 before0 = token0.balanceOf(address(actor));
        uint256 before1 = token1.balanceOf(address(actor));
        vm.recordLogs();
        BalanceDelta delta = actor.swap(key, params);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(int256(token0.balanceOf(address(actor))) - int256(before0), int256(delta.amount0()));
        assertEq(int256(token1.balanceOf(address(actor))) - int256(before1), int256(delta.amount1()));
        if (zeroForOne) {
            assertLt(delta.amount0(), 0);
            assertGt(delta.amount1(), 0);
        } else {
            assertGt(delta.amount0(), 0);
            assertLt(delta.amount1(), 0);
        }
        int128 specifiedDelta = exactInput
            ? (zeroForOne ? delta.amount0() : delta.amount1())
            : (zeroForOne ? delta.amount1() : delta.amount0());
        assertEq(int256(specifiedDelta), params.amountSpecified);
        bool hookEventSeen;
        bool managerEventSeen;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(hook)) {
                _assertHookEvent(logs[i], zeroForOne, params.amountSpecified, delta);
                hookEventSeen = true;
            }
            if (
                logs[i].emitter == address(manager)
                    && logs[i].topics[0] == keccak256("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)")
            ) {
                (,,,,, uint24 actualPoolFee) = abi.decode(logs[i].data, (int128, int128, uint160, uint128, int24, uint24));
                assertEq(uint256(actualPoolFee), uint256(zeroForOne ? FEE_0_TO_1 : FEE_1_TO_0));
                managerEventSeen = true;
            }
        }
        assertTrue(hookEventSeen, "real manager did not call afterSwap");
        assertTrue(managerEventSeen, "missing actual PoolManager swap fee evidence");
        (,,, uint24 storedFee) = manager.getSlot0(key.toId());
        assertEq(storedFee, 0, "per-swap override must not replace stored dynamic fee");
        assertEq(token0.balanceOf(address(hook)), 0);
        assertEq(token1.balanceOf(address(hook)), 0);
    }

    function testRealSwapZeroForOneExactIn() public { _checkRealSwap(true, true); }
    function testRealSwapOneForZeroExactIn() public { _checkRealSwap(false, true); }
    function testRealSwapZeroForOneExactOut() public { _checkRealSwap(true, false); }
    function testRealSwapOneForZeroExactOut() public { _checkRealSwap(false, false); }

    function testSettlementActorRejectsUnauthorizedCallback() public {
        vm.expectRevert(PoolActor.OnlyManager.selector);
        actor.unlockCallback("");
    }
}
