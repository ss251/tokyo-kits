// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IAqua} from "@1inch/aqua/src/interfaces/IAqua.sol";
import {ISwapVM} from "@1inch/swap-vm/src/interfaces/ISwapVM.sol";
import {MakerTraitsLib} from "@1inch/swap-vm/src/libs/MakerTraits.sol";
import {TakerTraitsLib} from "@1inch/swap-vm/src/libs/TakerTraits.sol";
import {FixedRateExtruction} from "../../src/FixedRateExtruction.sol";
import {CustomAquaRouter} from "../../src/CustomAquaRouter.sol";
import {TestToken} from "./TestToken.sol";

abstract contract SwapVMTestBase is Test {
    uint256 internal constant RESERVE = 1_000_000 ether;
    address internal maker = address(0xA11CE);
    IAqua internal aqua;
    ISwapVM internal officialStyleRouter;
    CustomAquaRouter internal customRouter;
    FixedRateExtruction internal target;
    TestToken internal token0;
    TestToken internal token1;

    function _initializeVM(IAqua registry, ISwapVM router) internal {
        aqua = registry;
        officialStyleRouter = router;
        customRouter = new CustomAquaRouter(address(aqua), address(0), address(this));
        target = new FixedRateExtruction(address(router));
        token0 = new TestToken("VM0");
        token1 = new TestToken("VM1");
        token0.mint(maker, RESERVE);
        token1.mint(maker, RESERVE);
        token0.mint(address(this), RESERVE);
        token1.mint(address(this), RESERVE);
        vm.startPrank(maker);
        token0.approve(address(aqua), type(uint256).max);
        token1.approve(address(aqua), type(uint256).max);
        vm.stopPrank();
        token0.approve(address(router), type(uint256).max);
        token1.approve(address(router), type(uint256).max);
        token0.approve(address(customRouter), type(uint256).max);
        token1.approve(address(customRouter), type(uint256).max);
    }

    function _tokens() internal view returns (address[] memory tokens) {
        tokens = new address[](2);
        tokens[0] = address(token0);
        tokens[1] = address(token1);
    }

    function _order(bool useCustom, uint256 numerator, uint256 denominator) internal view returns (ISwapVM.Order memory) {
        bytes memory args = abi.encode(address(token0), address(token1), numerator, denominator);
        MakerTraitsLib.Args memory makerArgs;
        makerArgs.maker = maker;
        makerArgs.useAquaInsteadOfSignature = true;
        // The pinned router's Extruction opcode is 32; custom fixed-rate opcode is 33.
        makerArgs.program = useCustom
            ? abi.encodePacked(uint8(33), uint8(128), args)
            : abi.encodePacked(uint8(32), uint8(148), address(target), args);
        return MakerTraitsLib.build(makerArgs);
    }

    function _takerData(bool exactIn, uint256 threshold) internal view returns (bytes memory) {
        TakerTraitsLib.Args memory args;
        args.taker = address(this);
        args.isExactIn = exactIn;
        args.useTransferFromAndAquaPush = true;
        args.threshold = abi.encode(threshold);
        return TakerTraitsLib.build(args);
    }

    function _ship(ISwapVM router, ISwapVM.Order memory order) internal returns (bytes32 key) {
        uint256[] memory balances = new uint256[](2);
        balances[0] = RESERVE;
        balances[1] = RESERVE;
        vm.prank(maker);
        key = aqua.ship(address(router), abi.encode(order), _tokens(), balances);
        assertEq(key, router.hash(order));
    }

    function _checkFill(bool useCustom, bool exactIn, bool reverse) internal {
        ISwapVM router = useCustom ? ISwapVM(address(customRouter)) : officialStyleRouter;
        ISwapVM.Order memory order = _order(useCustom, 3, 2);
        _ship(router, order);
        assertEq(token0.balanceOf(maker), RESERVE, "ship must retain custody");
        assertEq(token1.balanceOf(maker), RESERVE, "ship must retain custody");
        TestToken input = reverse ? token1 : token0;
        TestToken output = reverse ? token0 : token1;
        uint256 amount = 10 ether;
        bytes memory takerData = _takerData(exactIn, exactIn ? 1 : RESERVE);
        (uint256 quotedIn, uint256 quotedOut,) = router.quote(order, address(input), address(output), amount, takerData);
        assertEq(token1.balanceOf(maker), RESERVE, "quote must retain custody");
        takerData = _takerData(exactIn, exactIn ? quotedOut : quotedIn);
        uint256 takerBefore = output.balanceOf(address(this));
        (uint256 actualIn, uint256 actualOut,) = router.swap(order, address(input), address(output), amount, takerData);
        assertEq(actualIn, quotedIn);
        assertEq(actualOut, quotedOut);
        assertEq(input.balanceOf(maker), RESERVE + quotedIn);
        assertEq(output.balanceOf(maker), RESERVE - quotedOut);
        assertEq(output.balanceOf(address(this)), takerBefore + quotedOut);
        assertEq(input.balanceOf(address(aqua)), 0);
        assertEq(output.balanceOf(address(aqua)), 0);
    }

    function testExtructionExactInThroughRouter() public { _checkFill(false, true, false); }
    function testExtructionExactOutThroughRouter() public { _checkFill(false, false, false); }
    function testExtructionReverseThroughRouter() public { _checkFill(false, true, true); }
    function testCustomOpcodeExactInThroughRouter() public { _checkFill(true, true, false); }
    function testCustomOpcodeExactOutThroughRouter() public { _checkFill(true, false, false); }
    function testCustomOpcodeReverseThroughRouter() public { _checkFill(true, true, true); }

    function testDockedVMOrderCannotFill() public {
        ISwapVM.Order memory order = _order(false, 1, 1);
        bytes32 key = _ship(officialStyleRouter, order);
        vm.prank(maker);
        aqua.dock(address(officialStyleRouter), key, _tokens());
        bytes memory takerData = _takerData(true, 1);
        vm.expectRevert();
        officialStyleRouter.swap(order, address(token0), address(token1), 1 ether, takerData);
        assertEq(token1.balanceOf(maker), RESERVE);
    }

    function testVMThresholdProtectsTaker() public {
        ISwapVM.Order memory order = _order(false, 1, 1);
        _ship(officialStyleRouter, order);
        bytes memory takerData = _takerData(true, 2 ether);
        vm.expectRevert();
        officialStyleRouter.swap(order, address(token0), address(token1), 1 ether, takerData);
        assertEq(token0.balanceOf(maker), RESERVE);
        assertEq(token1.balanceOf(maker), RESERVE);
    }
}
