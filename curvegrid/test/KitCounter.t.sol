// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {KitCounter} from "../src/KitCounter.sol";

/// @dev Minimal Foundry cheatcode declarations keep this test dependency-free.
interface Vm {
    struct Log {
        bytes32[] topics;
        bytes data;
        address emitter;
    }

    function prank(address sender) external;
    function expectRevert(bytes calldata revertData) external;
    function expectEmit(bool topic1, bool topic2, bool topic3, bool data, address emitter) external;
    function store(address target, bytes32 slot, bytes32 value) external;
    function recordLogs() external;
    function getRecordedLogs() external returns (Log[] memory);
}

contract KitCounterTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant STRANGER = address(0xBEEF);
    KitCounter private counter;

    event Incremented(address indexed caller, uint256 value);

    function setUp() public {
        counter = new KitCounter();
    }

    function testConstructorUsesDeployerAndStartsAtZero() public view {
        require(counter.owner() == address(this), "owner must be the deployer");
        require(counter.value() == 0, "counter must start at zero");
    }

    function testOwnerIsTheActualDeploymentCaller() public {
        vm.prank(STRANGER);
        KitCounter other = new KitCounter();
        require(other.owner() == STRANGER, "deployment caller must own counter");
        vm.prank(STRANGER);
        other.increment();
        require(other.value() == 1, "deployer must be authorized");
    }

    function testIncrementEmitsCallerAndNewValueFromCounter() public {
        vm.expectEmit(true, false, false, true, address(counter));
        emit Incremented(address(this), 1);
        counter.increment();
        require(counter.value() == 1, "successful increment must persist");
    }

    function testRepeatedIncrementsPreserveMonotonicState() public {
        counter.increment();
        counter.increment();
        vm.expectEmit(true, false, false, true, address(counter));
        emit Incremented(address(this), 3);
        counter.increment();
        require(counter.value() == 3, "each successful call must increment once");
    }

    function testUnauthorizedIncrementRevertsWithoutStateOrEvent() public {
        counter.increment();
        vm.recordLogs();
        vm.expectRevert(abi.encodeWithSelector(KitCounter.Unauthorized.selector, STRANGER));
        vm.prank(STRANGER);
        counter.increment();
        require(counter.value() == 1, "unauthorized call changed state");
        require(vm.getRecordedLogs().length == 0, "unauthorized call emitted an event");
        require(counter.owner() == address(this), "unauthorized call changed owner");
    }

    function testOwnerCanReachMaximumWithoutWrapping() public {
        // Unit boundary fixture only: value is slot zero; owner is immutable.
        vm.store(address(counter), bytes32(0), bytes32(type(uint256).max - 1));
        vm.expectEmit(true, false, false, true, address(counter));
        emit Incremented(address(this), type(uint256).max);
        counter.increment();
        require(counter.value() == type(uint256).max, "maximum value should be reachable");
    }

    function testIncrementAtMaximumRevertsWithoutStateOrEvent() public {
        // Unit boundary fixture only; the MultiBaas demo never changes storage directly.
        vm.store(address(counter), bytes32(0), bytes32(type(uint256).max));
        vm.recordLogs();
        vm.expectRevert(abi.encodeWithSignature("Panic(uint256)", uint256(0x11)));
        counter.increment();
        require(counter.value() == type(uint256).max, "overflow changed state");
        require(vm.getRecordedLogs().length == 0, "overflow emitted an event");
    }
}
