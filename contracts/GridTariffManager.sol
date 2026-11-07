// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title GridTariffManager
 * @dev Enforces national electric power regulatory authority (NEPRA) / DISCO billing rules,
 * wheeling charges (Use-of-System), dynamic feed-in tariffs, time-of-use (ToU) windows,
 * and emergency physical grid curtailment.
 */
contract GridTariffManager is AccessControl {
    bytes32 public constant GRID_OPERATOR_ROLE = keccak256("GRID_OPERATOR_ROLE");
    bytes32 public constant REGULATOR_ROLE = keccak256("REGULATOR_ROLE");

    // Wheeling charge in basis points (e.g. 300 bps = 3.0%)
    uint256 public wheelingBasisPoints;
    // Regulatory tax/levy in basis points (e.g. 100 bps = 1.0%)
    uint256 public regulatoryTaxBasisPoints;

    // Minimum Feed-in Tariff (Floor price prosumer can receive from National Grid)
    uint256 public feedInTariffFloor;
    // National Grid Retail Import Tariff (Ceiling price prosumer would pay to import)
    uint256 public retailGridTariffCeiling;

    // Time-of-Use Peak Window (Hour of day: 0 to 23, in local timezone offset)
    uint8 public peakStartHour; // e.g. 18 (6 PM)
    uint8 public peakEndHour;   // e.g. 22 (10 PM)
    uint256 public peakWheelingMultiplier; // 150 = 1.5x in percentage

    // Emergency curtailment state (Grid operator forces solar shutdown on line congestion)
    bool public isEmergencyCurtailmentActive;

    // Address receiving DISCO wheeling revenue
    address public gridOperatorTreasury;
    // Address receiving regulatory taxes / NEPRA levy
    address public regulatorTreasury;

    event TariffUpdated(uint256 newWheelingBps, uint256 newTaxBps, uint256 newFiTFloor, uint256 newRetailCeiling);
    event EmergencyCurtailmentToggled(bool indexed active, string reason);
    event TreasuriesUpdated(address indexed gridTreasury, address indexed regTreasury);

    constructor(
        address initialAdmin,
        address _gridOperatorTreasury,
        address _regulatorTreasury,
        uint256 _wheelingBps,
        uint256 _taxBps,
        uint256 _fitFloor,
        uint256 _retailCeiling
    ) {
        require(_gridOperatorTreasury != address(0), "Invalid grid treasury");
        require(_regulatorTreasury != address(0), "Invalid reg treasury");
        require(_fitFloor <= _retailCeiling, "FiT floor must be <= Retail ceiling");

        _grantRole(DEFAULT_ADMIN_ROLE, initialAdmin);
        _grantRole(GRID_OPERATOR_ROLE, initialAdmin);
        _grantRole(REGULATOR_ROLE, initialAdmin);

        gridOperatorTreasury = _gridOperatorTreasury;
        regulatorTreasury = _regulatorTreasury;
        wheelingBasisPoints = _wheelingBps;
        regulatoryTaxBasisPoints = _taxBps;
        feedInTariffFloor = _fitFloor;
        retailGridTariffCeiling = _retailCeiling;

        peakStartHour = 18;
        peakEndHour = 22;
        peakWheelingMultiplier = 150; // 1.5x
    }

    /**
     * @notice Validates that a P2P trade price respects economic boundaries
     */
    function validateTradePrice(uint256 pricePerKWh) external view returns (bool, string memory) {
        if (pricePerKWh < feedInTariffFloor) {
            return (false, "Price below national Grid Feed-in-Tariff floor");
        }
        if (pricePerKWh > retailGridTariffCeiling) {
            return (false, "Price above national Grid Retail Import ceiling");
        }
        return (true, "");
    }

    /**
     * @notice Checks whether physical curtailment is active
     */
    function checkCurtailment() external view returns (bool) {
        return isEmergencyCurtailmentActive;
    }

    /**
     * @notice Computes grid wheeling fee and regulatory tax for an energy trade
     */
    function calculateFees(
        uint256 energyAmountKWh,
        uint256 pricePerKWh,
        uint256 tradeTimestamp
    ) external view returns (uint256 grossAmount, uint256 wheelingFee, uint256 regulatoryTax, uint256 netProsumerAmount) {
        grossAmount = (energyAmountKWh * pricePerKWh) / 1e18;

        uint256 effectiveWheelingBps = wheelingBasisPoints;
        if (isPeakPeriod(tradeTimestamp)) {
            effectiveWheelingBps = (effectiveWheelingBps * peakWheelingMultiplier) / 100;
        }

        wheelingFee = (grossAmount * effectiveWheelingBps) / 10000;
        regulatoryTax = (grossAmount * regulatoryTaxBasisPoints) / 10000;

        require(grossAmount >= (wheelingFee + regulatoryTax), "Fees exceed gross trade amount");
        netProsumerAmount = grossAmount - wheelingFee - regulatoryTax;
    }

    /**
     * @notice Helper to check if a timestamp falls within peak grid hours
     */
    function isPeakPeriod(uint256 timestamp) public view returns (bool) {
        uint256 hour = (timestamp / 3600) % 24;
        return (hour >= peakStartHour && hour < peakEndHour);
    }

    /**
     * @notice Toggles emergency solar power curtailment on local transformer congestion
     */
    function setEmergencyCurtailment(bool active, string calldata reason) external onlyRole(GRID_OPERATOR_ROLE) {
        isEmergencyCurtailmentActive = active;
        emit EmergencyCurtailmentToggled(active, reason);
    }

    /**
     * @notice Updates tariff schedule
     */
    function updateTariffParameters(
        uint256 newWheelingBps,
        uint256 newTaxBps,
        uint256 newFiTFloor,
        uint256 newRetailCeiling
    ) external onlyRole(REGULATOR_ROLE) {
        require(newFiTFloor <= newRetailCeiling, "FiT floor must be <= Retail ceiling");
        wheelingBasisPoints = newWheelingBps;
        regulatoryTaxBasisPoints = newTaxBps;
        feedInTariffFloor = newFiTFloor;
        retailGridTariffCeiling = newRetailCeiling;
        emit TariffUpdated(newWheelingBps, newTaxBps, newFiTFloor, newRetailCeiling);
    }

    function setTreasuries(address _gridTreasury, address _regTreasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_gridTreasury != address(0) && _regTreasury != address(0), "Invalid treasuries");
        gridOperatorTreasury = _gridTreasury;
        regulatorTreasury = _regTreasury;
        emit TreasuriesUpdated(_gridTreasury, _regTreasury);
    }
}
