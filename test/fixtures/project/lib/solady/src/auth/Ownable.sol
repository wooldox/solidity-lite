// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

/// @notice A stand-in owner contract for tests.
abstract contract Ownable {
    /// @dev The caller is not the owner.
    error Unauthorized();

    /// @dev Returns the owner of the contract.
    function owner() public view virtual returns (address result) {
        return address(0);
    }

    /**
     * @dev Allows the owner to transfer the ownership to `newOwner`.
     * @param newOwner The new owner.
     */
    function transferOwnership(address newOwner) public payable virtual onlyOwner {}

    /// @dev Marks a function as only callable by the owner.
    modifier onlyOwner() virtual {
        _;
    }
}
