// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
import {Test} from "forge-std/Test.sol";
import {AgentBookGate, IAgentBook} from "../src/AgentBookGate.sol";

/// @dev Test fixture only. Official-fork demos never replace AgentBook.
contract AgentBookFixture is IAgentBook {
    mapping(address => uint256) public lookupHuman;
    function registerFixture(address agent, uint256 human) external { lookupHuman[agent] = human; }
}

contract AgentBookGateTest is Test {
    AgentBookFixture private book;
    AgentBookGate private gate;
    event AgentAction(address indexed agent, uint256 indexed humanId, bytes32 note);
    function setUp() public { book = new AgentBookFixture(); gate = new AgentBookGate(book); }
    function testRejectsUnregisteredCaller() public {
        vm.expectRevert(AgentBookGate.UnregisteredAgent.selector);
        gate.record(bytes32(uint256(1)));
    }
    function testUsesCallerIdentityNotClaimedIdentity() public {
        book.registerFixture(address(this), 42);
        vm.expectEmit(true, true, false, true, address(gate));
        emit AgentAction(address(this), 42, bytes32(uint256(1)));
        gate.record(bytes32(uint256(1)));
        vm.prank(address(123));
        vm.expectRevert(AgentBookGate.UnregisteredAgent.selector);
        gate.record(bytes32(uint256(1)));
    }
    function testRejectsAbsentRegistry() public {
        vm.expectRevert(AgentBookGate.MissingRegistry.selector);
        new AgentBookGate(IAgentBook(address(123)));
    }
}
