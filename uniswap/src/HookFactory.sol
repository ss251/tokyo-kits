// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {DirectionalFeeHook} from "./DirectionalFeeHook.sol";

/// @notice Permissionless CREATE2 factory. Mine salts against THIS factory address and exact init code.
contract HookFactory {
    uint160 public constant REQUIRED_FLAGS = Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG;
    uint160 public constant FLAG_MASK = Hooks.ALL_HOOK_MASK;

    event HookDeployed(address indexed hook, bytes32 indexed salt, bytes32 initCodeHash);

    function deploy(bytes32 salt, IPoolManager manager, uint24 feeZeroForOne, uint24 feeOneForZero)
        external
        returns (DirectionalFeeHook hook)
    {
        hook = new DirectionalFeeHook{salt: salt}(manager, feeZeroForOne, feeOneForZero);
        emit HookDeployed(address(hook), salt, initCodeHash(manager, feeZeroForOne, feeOneForZero));
    }

    function initCodeHash(IPoolManager manager, uint24 feeZeroForOne, uint24 feeOneForZero)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(type(DirectionalFeeHook).creationCode, abi.encode(manager, feeZeroForOne, feeOneForZero)));
    }

    function predict(bytes32 salt, IPoolManager manager, uint24 feeZeroForOne, uint24 feeOneForZero)
        external
        view
        returns (address)
    {
        return address(uint160(uint256(keccak256(abi.encodePacked(
            bytes1(0xff), address(this), salt, initCodeHash(manager, feeZeroForOne, feeOneForZero)
        )))));
    }
}
