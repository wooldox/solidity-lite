// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Ownable} from "solady/auth/Ownable.sol";
import {Messages as M} from "./Messages.sol";
import "@other/Units.sol" as Units;
import {Price, ONE_DAY} from "@other/Units.sol";

/// @notice The farm. 🌱
contract Farm is Ownable {
    using M for M.Intent;

    enum Phase {
        Closed,
        Open
    }

    struct Plot {
        uint256 seed;
        Price price;
    }

    /// @dev Emitted when a player plants.
    event Planted(address indexed player, bytes32 digest);

    error Expired(uint256 deadline);

    mapping(address => Plot[]) public plots;
    Phase public phase;
    address private immutable _signer;

    constructor(address signer_) {
        _signer = signer_;
    }

    /// @dev Plants the seeds in `intent`.
    /// @param intent The signed intent.
    function plant(M.Intent calldata intent, M.Permit memory permit) external onlyOwner returns (bytes32 digest) {
        if (block.timestamp > intent.deadline + ONE_DAY) revert Expired(intent.deadline);
        digest = M.hash(intent);
        bytes32 again = intent.hash();
        bytes32 other = M.hash(permit);
        uint256 seed = plots[msg.sender][0].seed;
        Price p = plots[msg.sender][0].price.add(Units.Price.wrap(1));
        phase = Phase.Open;
        emit Planted(intent.player, digest);
        this.owner();
        transferOwnership(address(this));
        seed;
        again;
        other;
        p;
    }

    function owner() public view override returns (address result) {
        result = super.owner();
    }
}
