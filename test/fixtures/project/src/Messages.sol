// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title Messages
/// @dev Signed messages and their struct hashes.
library Messages {
    /// @dev Plants one Seed per `seedIds` entry.
    struct Intent {
        address player;
        uint256[] seedIds;
        uint256 deadline;
    }

    /// @param player Who must send it.
    /// @param plantingIds The plantings to fertilize.
    struct Permit {
        address player;
        uint256[] plantingIds;
    }

    bytes32 internal constant INTENT_TYPEHASH = keccak256("Intent(address player,uint256[] seedIds,uint256 deadline)");

    /// @dev Struct hash of an intent.
    /// @param m The intent.
    /// @return The EIP-712 struct hash.
    function hash(Intent memory m) internal pure returns (bytes32) {
        return keccak256(abi.encode(INTENT_TYPEHASH, m.player, _hashIds(m.seedIds), m.deadline));
    }

    /// @dev Struct hash of a permit.
    function hash(Permit memory p) internal pure returns (bytes32) {
        return keccak256(abi.encode(p.player, _hashIds(p.plantingIds)));
    }

    function _hashIds(uint256[] memory ids) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(ids));
    }
}
