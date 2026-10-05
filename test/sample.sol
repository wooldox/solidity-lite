// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721A} from "ERC721A/ERC721A.sol";
import "./Other.sol";

type Price is uint128;
using {add as +} for Price global;

enum Phase { Closed, Open }

error NotOwner(address caller);
event Planted(address indexed player, uint256 seedId, bytes32 anonymousId);

/// @notice A sample contract.
/// @param x unused
abstract contract Farm is ERC721A, IFarm {
    using FarmMessages for FarmMessages.PlantIntent;

    uint256 public constant MAX_SEEDS = 100;
    address public immutable owner;
    uint256 transient lock;
    mapping(address player => uint256[] ids) internal seeds;
    Phase public phase;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        _;
    }

    constructor(address owner_) payable {
        owner = owner_;
    }

    receive() external payable {}
    fallback() external {}

    function plant(FarmMessages.PlantIntent calldata m, bytes calldata sig) external virtual override returns (bool ok) {
        require(block.timestamp <= m.deadline, "expired");
        uint256 total = m.seedIds.length * 2 ether + 1 days;
        for (uint256 i; i < m.seedIds.length; ++i) {
            unchecked { total += i; }
            emit Planted(msg.sender, m.seedIds[i], keccak256(sig));
        }
        delete phase;
        Foo f = new Foo{value: 1 wei}();
        uint256 max = type(uint256).max;
        assembly {
            let p := mload(0x40)
            mstore(p, total)
        }
        return true && !false;
    }
}
