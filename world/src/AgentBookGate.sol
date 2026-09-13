// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IAgentBook { function lookupHuman(address agent) external view returns (uint256); }

/// @notice Records an agent action only when the official AgentBook links its caller to a human.
contract AgentBookGate {
    IAgentBook public immutable agentBook;
    error MissingRegistry();
    error UnregisteredAgent();
    event AgentAction(address indexed agent, uint256 indexed humanId, bytes32 note);

    constructor(IAgentBook book) {
        if (address(book).code.length == 0) revert MissingRegistry();
        agentBook = book;
    }

    function record(bytes32 note) external {
        uint256 humanId = agentBook.lookupHuman(msg.sender);
        if (humanId == 0) revert UnregisteredAgent();
        emit AgentAction(msg.sender, humanId, note);
    }
}
