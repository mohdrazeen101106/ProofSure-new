// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../src/interfaces/AggregatorV3Interface.sol";

/**
 * @notice Mock Chainlink feed for local testing / demo.
 * Defaults to 300,000 INR per ETH with 8 decimals (price = 300000 * 1e8).
 * Mirrors ZK premium / claim ETH conversion (scripts/convert_payout_to_eth.js, backend/eth_price.py).
 * Update via setPrice() or setRoundData() to simulate price moves.
 */
contract MockAggregatorV3 is AggregatorV3Interface {
    int256 private _price;
    uint8 private _decimals;
    uint80 private _roundId = 1;
    uint256 private _updatedAt;
    // Live feeds always report fresh timestamps. Set false via setRoundData()
    // to simulate a backdated/stale feed for testing the StalePrice path.
    bool private _live = true;

    constructor(int256 price_, uint8 decimals_) {
        _price = price_;
        _decimals = decimals_;
        _updatedAt = block.timestamp;
    }

    function setPrice(int256 p) external {
        _price = p;
        _roundId++;
        _updatedAt = block.timestamp;
        _live = true;
    }

    function setRoundData(int256 p, uint256 updatedAt_) external {
        _price = p;
        _updatedAt = updatedAt_;
        _roundId++;
        _live = false;
    }

    function setDecimals(uint8 d) external { _decimals = d; }

    function decimals() external view returns (uint8) { return _decimals; }

    function description() external view returns (string memory) { return "Mock ETH/INR"; }
    function version() external view returns (uint256) { return 1; }

    function getRoundData(uint80) external view returns (uint80, int256, uint256, uint256, uint80) {
        return (_roundId, _price, _updatedAt, _updatedAt, _roundId);
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        uint256 upd = _live ? block.timestamp : _updatedAt;
        return (_roundId, _price, 0, upd, _roundId);
    }
}
