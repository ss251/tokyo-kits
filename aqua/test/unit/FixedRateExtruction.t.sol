// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {SwapQuery, SwapRegisters} from "@1inch/swap-vm/src/libs/VM.sol";
import {FixedRateExtruction} from "../../src/FixedRateExtruction.sol";
import {FixedRatePricing} from "../../src/FixedRatePricing.sol";

contract FixedRateExtructionUnitTest is Test {
    FixedRateExtruction internal target;
    address internal constant TOKEN0 = address(0x10);
    address internal constant TOKEN1 = address(0x20);

    function setUp() public {
        target = new FixedRateExtruction(address(this));
    }

    function _query(bool exactIn, bool reverse) internal pure returns (SwapQuery memory) {
        return SwapQuery(bytes32(uint256(42)), address(1), address(2), reverse ? TOKEN1 : TOKEN0, reverse ? TOKEN0 : TOKEN1, exactIn);
    }

    function _args(uint256 numerator, uint256 denominator) internal pure returns (bytes memory) {
        return abi.encode(TOKEN0, TOKEN1, numerator, denominator);
    }

    function testFuzzModesMatchAndRegistersPreserved(uint96 amount) public view {
        uint256 input = uint256(amount) + 1;
        SwapRegisters memory registers = SwapRegisters(1000, type(uint256).max, input, 0, 17);
        (uint256 pc, uint256 consumed, SwapRegisters memory quote) =
            target.extruction(true, 150, _query(true, false), registers, _args(3, 2), hex"1234");
        (,, SwapRegisters memory swap) =
            target.extruction(false, 150, _query(true, false), registers, _args(3, 2), hex"1234");
        assertEq(keccak256(abi.encode(quote)), keccak256(abi.encode(swap)));
        assertEq(pc, 150);
        assertEq(consumed, 0);
        assertEq(quote.amountIn, input);
        assertEq(quote.amountOut, input * 3 / 2);
        assertEq(quote.balanceIn, registers.balanceIn);
        assertEq(quote.balanceOut, registers.balanceOut);
        assertEq(quote.amountNetPulled, 17);
    }

    function testExactOutRoundsInputUpForMaker() public view {
        SwapRegisters memory registers = SwapRegisters(100, 100, 0, 5, 0);
        (,, SwapRegisters memory result) = target.extruction(false, 150, _query(false, false), registers, _args(3, 2), "");
        assertEq(result.amountOut, 5);
        assertEq(result.amountIn, 4);
    }

    function testReverseUsesReciprocalRate() public view {
        SwapRegisters memory registers = SwapRegisters(100, 100, 9, 0, 0);
        (,, SwapRegisters memory result) = target.extruction(true, 150, _query(true, true), registers, _args(3, 2), "");
        assertEq(result.amountOut, 6);
        assertEq(result.amountIn, 9);
    }

    function testMulDivHandlesIntermediateOverflow() public view {
        SwapRegisters memory registers = SwapRegisters(1, type(uint256).max, 1 << 200, 0, 0);
        (,, SwapRegisters memory result) = target.extruction(true, 150, _query(true, false), registers, _args(1 << 100, 1 << 100), "");
        assertEq(result.amountOut, 1 << 200);
    }

    function testOnlyConfiguredRouterCanCall() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(FixedRateExtruction.OnlyRouter.selector);
        target.extruction(true, 0, _query(true, false), SwapRegisters(1, 100, 10, 0, 0), _args(1, 1), "");
    }

    function testZeroDenominatorRejected() public {
        vm.expectRevert(FixedRatePricing.InvalidArguments.selector);
        target.extruction(true, 0, _query(true, false), SwapRegisters(1, 100, 10, 0, 0), _args(1, 0), "");
    }

    function testMalformedArgumentsRejected() public {
        vm.expectRevert(FixedRatePricing.InvalidArguments.selector);
        target.extruction(true, 0, _query(true, false), SwapRegisters(1, 100, 10, 0, 0), hex"1234", "");
    }

    function testWrongPairRejected() public {
        SwapQuery memory query = _query(true, false);
        query.tokenOut = address(0x30);
        vm.expectRevert(FixedRatePricing.UnsupportedPair.selector);
        target.extruction(true, 0, query, SwapRegisters(1, 100, 10, 0, 0), _args(1, 1), "");
    }

    function testExcessiveOutputRejected() public {
        vm.expectRevert(FixedRatePricing.InsufficientLiquidity.selector);
        target.extruction(true, 0, _query(true, false), SwapRegisters(1, 10, 10, 0, 0), _args(2, 1), "");
    }

    function testDustOutputRejected() public {
        vm.expectRevert(FixedRatePricing.InvalidAmount.selector);
        target.extruction(true, 0, _query(true, false), SwapRegisters(1, 100, 1, 0, 0), _args(1, 100), "");
    }
}
