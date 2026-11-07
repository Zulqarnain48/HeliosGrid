// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./GridTariffManager.sol";

/**
 * @title CommunityBatteryManager
 * @dev Manages communal Battery Energy Storage Systems (BESS) and Virtual Power Plant (VPP)
 * integration for automated Time-of-Use (ToU) arbitrage and physical distribution grid stabilization.
 * Implements IEEE 1547 Volt-Watt reverse power flow absorption to prevent feeder curtailment.
 */
contract CommunityBatteryManager is AccessControl, ReentrancyGuard {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant SCADA_ORACLE_ROLE = keccak256("SCADA_ORACLE_ROLE");

    enum BatteryState { IDLE, CHARGING_SOLAR, DISCHARGING_PEAK, EMERGENCY_SUPPORT }

    struct BatterySystem {
        uint256 batteryId;
        string locationSubstation;
        uint256 totalCapacityKWh;      // Total usable capacity (e.g. 500 kWh)
        uint256 currentStoredKWh;      // Current energy state (18 decimals: 1e18 = 1 kWh)
        uint256 maxChargeRateKW;       // Max charging power (e.g. 100 kW)
        uint256 maxDischargeRateKW;    // Max discharging power (e.g. 100 kW)
        uint16 roundTripEfficiencyBps; // Efficiency e.g. 9000 = 90%
        BatteryState state;
        uint256 lastUpdatedTimestamp;
    }

    IERC20 public immutable paymentToken;
    GridTariffManager public immutable tariffManager;

    uint256 public nextBatteryId = 1;
    mapping(uint256 => BatterySystem) public batteries;

    // Arbitrage accounting: Track cumulative profits distributed to prosumer cooperative
    uint256 public totalArbitrageProfitTokens;
    uint256 public totalAbsorbedSurplusKWh;

    event BatteryRegistered(uint256 indexed batteryId, string location, uint256 capacityKWh, uint256 maxRateKW);
    event BatteryCharged(uint256 indexed batteryId, uint256 energyKWh, uint256 purchasePricePerKWh, uint256 newStoredKWh);
    event BatteryDischarged(uint256 indexed batteryId, uint256 energyKWh, uint256 sellPricePerKWh, uint256 netProfit);
    event VoltWattAbsorptionTriggered(uint256 indexed batteryId, uint256 absorbedKWh, uint256 gridVoltage);

    constructor(
        address initialAdmin,
        address _paymentToken,
        address _tariffManager
    ) {
        require(_paymentToken != address(0), "Invalid token");
        require(_tariffManager != address(0), "Invalid tariff");

        _grantRole(DEFAULT_ADMIN_ROLE, initialAdmin);
        _grantRole(OPERATOR_ROLE, initialAdmin);
        _grantRole(SCADA_ORACLE_ROLE, initialAdmin);

        paymentToken = IERC20(_paymentToken);
        tariffManager = GridTariffManager(_tariffManager);
    }

    /**
     * @notice Registers a new utility-scale or communal battery unit
     */
    function registerBattery(
        string calldata location,
        uint256 capacityKWh,
        uint256 maxRateKW,
        uint16 efficiencyBps
    ) external onlyRole(DEFAULT_ADMIN_ROLE) returns (uint256 batteryId) {
        require(capacityKWh > 0, "Capacity must be > 0");
        require(efficiencyBps <= 10000, "Efficiency bps invalid");

        batteryId = nextBatteryId++;
        batteries[batteryId] = BatterySystem({
            batteryId: batteryId,
            locationSubstation: location,
            totalCapacityKWh: capacityKWh * 1e18,
            currentStoredKWh: 0,
            maxChargeRateKW: maxRateKW,
            maxDischargeRateKW: maxRateKW,
            roundTripEfficiencyBps: efficiencyBps,
            state: BatteryState.IDLE,
            lastUpdatedTimestamp: block.timestamp
        });

        emit BatteryRegistered(batteryId, location, capacityKWh, maxRateKW);
    }

    /**
     * @notice Automated charging during daytime solar surplus when price hits FiT floor
     */
    function chargeSurplusSolar(
        uint256 batteryId,
        uint256 energyKWh,
        uint256 pricePerKWh
    ) external onlyRole(OPERATOR_ROLE) nonReentrant {
        BatterySystem storage b = batteries[batteryId];
        require(b.batteryId > 0, "Battery not found");
        require(b.currentStoredKWh + energyKWh <= b.totalCapacityKWh, "Battery capacity exceeded");

        // Validate price against grid tariff boundaries
        (bool valid, ) = tariffManager.validateTradePrice(pricePerKWh);
        require(valid, "Invalid charging price");

        // Effective energy stored accounting for charging efficiency
        uint256 netStored = (energyKWh * b.roundTripEfficiencyBps) / 10000;
        b.currentStoredKWh += netStored;
        b.state = BatteryState.CHARGING_SOLAR;
        b.lastUpdatedTimestamp = block.timestamp;
        totalAbsorbedSurplusKWh += energyKWh;

        emit BatteryCharged(batteryId, energyKWh, pricePerKWh, b.currentStoredKWh);
    }

    /**
     * @notice Automated discharging during peak evening hours (18:00 - 22:00) to displace expensive retail imports
     */
    function dischargePeakArbitrage(
        uint256 batteryId,
        uint256 energyKWh,
        uint256 sellPricePerKWh,
        address prosumerCoopTreasury
    ) external onlyRole(OPERATOR_ROLE) nonReentrant {
        BatterySystem storage b = batteries[batteryId];
        require(b.batteryId > 0, "Battery not found");
        require(b.currentStoredKWh >= energyKWh, "Insufficient stored energy");
        require(tariffManager.isPeakPeriod(block.timestamp), "Must discharge during peak window");

        b.currentStoredKWh -= energyKWh;
        b.state = BatteryState.DISCHARGING_PEAK;
        b.lastUpdatedTimestamp = block.timestamp;

        // Calculate gross revenue and distribute to cooperative
        uint256 grossRevenue = (energyKWh * sellPricePerKWh) / 1e18;
        totalArbitrageProfitTokens += grossRevenue;
        require(paymentToken.transfer(prosumerCoopTreasury, grossRevenue), "Cooperative transfer failed");

        emit BatteryDischarged(batteryId, energyKWh, sellPricePerKWh, grossRevenue);
    }

    /**
     * @notice IEEE 1547 Volt-Watt Emergency Absorption: SCADA triggers battery absorption
     * when distribution feeder voltage exceeds 242V (+5%), preventing reverse power flow trip.
     */
    function emergencyVoltWattAbsorption(
        uint256 batteryId,
        uint256 energyKWh,
        uint256 measuredVoltageMillivolts
    ) external onlyRole(SCADA_ORACLE_ROLE) {
        BatterySystem storage b = batteries[batteryId];
        require(b.batteryId > 0, "Battery not found");
        require(measuredVoltageMillivolts > 242000, "Voltage below emergency threshold (242V)");

        uint256 availableCapacity = b.totalCapacityKWh - b.currentStoredKWh;
        uint256 actualAbsorbed = energyKWh > availableCapacity ? availableCapacity : energyKWh;
        require(actualAbsorbed > 0, "Battery fully charged; cannot absorb");

        b.currentStoredKWh += actualAbsorbed;
        b.state = BatteryState.EMERGENCY_SUPPORT;
        b.lastUpdatedTimestamp = block.timestamp;
        totalAbsorbedSurplusKWh += actualAbsorbed;

        emit VoltWattAbsorptionTriggered(batteryId, actualAbsorbed, measuredVoltageMillivolts);
    }

    function getBattery(uint256 batteryId) external view returns (BatterySystem memory) {
        return batteries[batteryId];
    }

    function getBatterySoCPercent(uint256 batteryId) external view returns (uint256) {
        BatterySystem memory b = batteries[batteryId];
        if (b.totalCapacityKWh == 0) return 0;
        return (b.currentStoredKWh * 100) / b.totalCapacityKWh;
    }
}
