// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

/// @dev A price in wei.
type Price is uint128;

function add(Price a, Price b) pure returns (Price) {
    return Price.wrap(Price.unwrap(a) + Price.unwrap(b));
}

using {add} for Price global;

uint256 constant ONE_DAY = 1 days;
