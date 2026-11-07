// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./SmartMeterRegistry.sol";
import "./GridTariffManager.sol";

/**
 * @title EnergyTradingPlatform
 * @dev Double-auction and bilateral peer-to-peer solar energy trading engine.
 * Interacts with SmartMeterRegistry for device verification and GridTariffManager
 * for national grid wheeling fee calculations and tariff boundary enforcement.
 */
contract EnergyTradingPlatform is AccessControl, ReentrancyGuard, Pausable {
    bytes32 public constant MATCHMAKER_ROLE = keccak256("MATCHMAKER_ROLE");

    enum OrderType { BUY, SELL }
    enum OrderStatus { OPEN, PARTIALLY_FILLED, FILLED, CANCELLED, EXPIRED }

    struct Order {
        uint256 orderId;
        address creator;
        uint256 meterId;
        OrderType orderType;
        uint256 totalEnergyKWh;      // 18 decimals (1e18 = 1 kWh)
        uint256 remainingEnergyKWh;
        uint256 pricePerKWh;         // Payment tokens per 1 kWh (1e18 scale)
        uint256 escrowLockedAmount;  // Locked tokens (for buyers)
        uint256 expiryTimestamp;
        OrderStatus status;
    }

    struct TradeRecord {
        uint256 tradeId;
        uint256 buyOrderId;
        uint256 sellOrderId;
        address buyer;
        address seller;
        uint256 buyerMeterId;
        uint256 sellerMeterId;
        uint256 energyAmountKWh;
        uint256 clearedPricePerKWh;
        uint256 grossAmount;
        uint256 wheelingFee;
        uint256 regulatoryTax;
        uint256 netProsumerAmount;
        uint256 timestamp;
    }

    struct SettlementValues {
        uint256 grossAmount;
        uint256 wheelingFee;
        uint256 regulatoryTax;
        uint256 netProsumerAmount;
        uint256 clearedPrice;
    }

    IERC20 public immutable paymentToken;
    SmartMeterRegistry public immutable meterRegistry;
    GridTariffManager public immutable tariffManager;

    uint256 public nextOrderId = 1;
    uint256 public nextTradeId = 1;

    // Total metrics
    uint256 public totalEnergyTradedKWh;
    uint256 public totalWheelingFeesCollected;
    uint256 public totalTaxCollected;

    mapping(uint256 => Order) public orders;
    mapping(uint256 => TradeRecord) public trades;

    event OrderCreated(
        uint256 indexed orderId,
        address indexed creator,
        uint256 indexed meterId,
        OrderType orderType,
        uint256 energyKWh,
        uint256 pricePerKWh,
        uint256 expiry
    );
    event OrderCancelled(uint256 indexed orderId, address indexed creator, uint256 refundedAmount);
    event OrderStatusChanged(uint256 indexed orderId, OrderStatus newStatus);
    event TradeExecuted(
        uint256 indexed tradeId,
        uint256 indexed buyOrderId,
        uint256 indexed sellOrderId,
        address buyer,
        address seller,
        uint256 energyKWh,
        uint256 clearedPrice,
        uint256 netProsumerAmount,
        uint256 wheelingFee
    );

    constructor(
        address initialAdmin,
        address _paymentToken,
        address _meterRegistry,
        address _tariffManager
    ) {
        require(_paymentToken != address(0), "Invalid token address");
        require(_meterRegistry != address(0), "Invalid registry address");
        require(_tariffManager != address(0), "Invalid tariff address");

        _grantRole(DEFAULT_ADMIN_ROLE, initialAdmin);
        _grantRole(MATCHMAKER_ROLE, initialAdmin);

        paymentToken = IERC20(_paymentToken);
        meterRegistry = SmartMeterRegistry(_meterRegistry);
        tariffManager = GridTariffManager(_tariffManager);
    }

    /**
     * @notice Prosumer creates a sell order for excess solar power
     */
    function createSellOrder(
        uint256 energyKWh,
        uint256 pricePerKWh,
        uint256 durationSeconds
    ) external whenNotPaused nonReentrant returns (uint256 orderId) {
        require(energyKWh > 0, "Energy amount must be > 0");
        require(durationSeconds >= 300, "Min order duration is 5 minutes");

        // Verify physical grid curtailment status
        require(!tariffManager.checkCurtailment(), "Grid Curtailment Active: Solar exports throttled");

        // Check tariff price bounds
        (bool priceValid, string memory reason) = tariffManager.validateTradePrice(pricePerKWh);
        require(priceValid, reason);

        // Verify sender's registered smart meter
        uint256 meterId = meterRegistry.residentToMeterId(msg.sender);
        require(meterId > 0, "No smart meter registered for sender");
        SmartMeterRegistry.MeterProfile memory profile = meterRegistry.getMeter(meterId);
        require(profile.status == SmartMeterRegistry.MeterStatus.ACTIVE, "Meter is not active or tamper-flagged");
        require(profile.meterType != SmartMeterRegistry.MeterType.CONSUMER_ONLY, "Consumer meter cannot sell solar");

        orderId = nextOrderId++;
        uint256 expiry = block.timestamp + durationSeconds;

        orders[orderId] = Order({
            orderId: orderId,
            creator: msg.sender,
            meterId: meterId,
            orderType: OrderType.SELL,
            totalEnergyKWh: energyKWh,
            remainingEnergyKWh: energyKWh,
            pricePerKWh: pricePerKWh,
            escrowLockedAmount: 0,
            expiryTimestamp: expiry,
            status: OrderStatus.OPEN
        });

        emit OrderCreated(orderId, msg.sender, meterId, OrderType.SELL, energyKWh, pricePerKWh, expiry);
    }

    /**
     * @notice Consumer creates a buy order and locks payment tokens into escrow
     */
    function createBuyOrder(
        uint256 energyKWh,
        uint256 maxPricePerKWh,
        uint256 durationSeconds
    ) external whenNotPaused nonReentrant returns (uint256 orderId) {
        require(energyKWh > 0, "Energy amount must be > 0");
        require(durationSeconds >= 300, "Min order duration is 5 minutes");

        (bool priceValid, string memory reason) = tariffManager.validateTradePrice(maxPricePerKWh);
        require(priceValid, reason);

        uint256 meterId = meterRegistry.residentToMeterId(msg.sender);
        require(meterId > 0, "No smart meter registered for sender");
        SmartMeterRegistry.MeterProfile memory profile = meterRegistry.getMeter(meterId);
        require(profile.status == SmartMeterRegistry.MeterStatus.ACTIVE, "Meter is not active or tamper-flagged");

        // Escrow calculation: maximum potential cost
        uint256 requiredEscrow = (energyKWh * maxPricePerKWh) / 1e18;
        require(requiredEscrow > 0, "Escrow amount must be > 0");

        // Lock payment tokens into contract escrow
        bool success = paymentToken.transferFrom(msg.sender, address(this), requiredEscrow);
        require(success, "Escrow token transfer failed");

        orderId = nextOrderId++;
        uint256 expiry = block.timestamp + durationSeconds;

        orders[orderId] = Order({
            orderId: orderId,
            creator: msg.sender,
            meterId: meterId,
            orderType: OrderType.BUY,
            totalEnergyKWh: energyKWh,
            remainingEnergyKWh: energyKWh,
            pricePerKWh: maxPricePerKWh,
            escrowLockedAmount: requiredEscrow,
            expiryTimestamp: expiry,
            status: OrderStatus.OPEN
        });

        emit OrderCreated(orderId, msg.sender, meterId, OrderType.BUY, energyKWh, maxPricePerKWh, expiry);
    }

    /**
     * @notice Matchmaker (or off-chain double-auction engine) executes a trade match
     */
    function matchOrders(
        uint256 buyOrderId,
        uint256 sellOrderId,
        uint256 matchAmountKWh
    ) external whenNotPaused onlyRole(MATCHMAKER_ROLE) nonReentrant returns (uint256 tradeId) {
        return _executeTradeInternal(buyOrderId, sellOrderId, matchAmountKWh);
    }

    /**
     * @notice Direct peer matching: buyer takes a specific open sell order
     */
    function fillSellOrder(
        uint256 sellOrderId,
        uint256 amountKWh
    ) external whenNotPaused nonReentrant returns (uint256 tradeId) {
        Order storage sellOrder = orders[sellOrderId];
        require(sellOrder.status == OrderStatus.OPEN || sellOrder.status == OrderStatus.PARTIALLY_FILLED, "Order not fillable");
        require(sellOrder.orderType == OrderType.SELL, "Must be sell order");
        require(amountKWh > 0 && amountKWh <= sellOrder.remainingEnergyKWh, "Invalid match amount");

        uint256 buyerMeterId = meterRegistry.residentToMeterId(msg.sender);
        require(buyerMeterId > 0, "Buyer must have registered meter");
        SmartMeterRegistry.MeterProfile memory buyerProfile = meterRegistry.getMeter(buyerMeterId);
        require(buyerProfile.status == SmartMeterRegistry.MeterStatus.ACTIVE, "Buyer meter not active");

        uint256 requiredEscrow = (amountKWh * sellOrder.pricePerKWh) / 1e18;
        require(paymentToken.transferFrom(msg.sender, address(this), requiredEscrow), "Escrow transfer failed");

        uint256 tempBuyOrderId = nextOrderId++;
        orders[tempBuyOrderId] = Order({
            orderId: tempBuyOrderId,
            creator: msg.sender,
            meterId: buyerMeterId,
            orderType: OrderType.BUY,
            totalEnergyKWh: amountKWh,
            remainingEnergyKWh: amountKWh,
            pricePerKWh: sellOrder.pricePerKWh,
            escrowLockedAmount: requiredEscrow,
            expiryTimestamp: block.timestamp + 3600,
            status: OrderStatus.OPEN
        });

        return _executeTradeInternal(tempBuyOrderId, sellOrderId, amountKWh);
    }

    /**
     * @dev Core trade execution and settlement logic
     */
    function _executeTradeInternal(
        uint256 buyOrderId,
        uint256 sellOrderId,
        uint256 matchAmountKWh
    ) internal returns (uint256 tradeId) {
        Order storage buyOrder = orders[buyOrderId];
        Order storage sellOrder = orders[sellOrderId];

        require(buyOrder.orderType == OrderType.BUY && sellOrder.orderType == OrderType.SELL, "Invalid order types");
        require(buyOrder.status == OrderStatus.OPEN || buyOrder.status == OrderStatus.PARTIALLY_FILLED, "Buy order not active");
        require(sellOrder.status == OrderStatus.OPEN || sellOrder.status == OrderStatus.PARTIALLY_FILLED, "Sell order not active");
        require(block.timestamp <= buyOrder.expiryTimestamp && block.timestamp <= sellOrder.expiryTimestamp, "Order expired");
        require(buyOrder.creator != sellOrder.creator, "Cannot trade with oneself");
        require(buyOrder.pricePerKWh >= sellOrder.pricePerKWh, "Bid price lower than Ask price");
        require(matchAmountKWh > 0 && matchAmountKWh <= buyOrder.remainingEnergyKWh && matchAmountKWh <= sellOrder.remainingEnergyKWh, "Invalid match amount");

        SettlementValues memory s;
        // Uniform Price Double-Auction: Clear at midpoint
        s.clearedPrice = (buyOrder.pricePerKWh + sellOrder.pricePerKWh) / 2;

        (
            s.grossAmount,
            s.wheelingFee,
            s.regulatoryTax,
            s.netProsumerAmount
        ) = tariffManager.calculateFees(matchAmountKWh, s.clearedPrice, block.timestamp);

        uint256 buyerEscrowPortion = (matchAmountKWh * buyOrder.pricePerKWh) / 1e18;
        require(buyOrder.escrowLockedAmount >= buyerEscrowPortion, "Insufficient escrow locked");
        buyOrder.escrowLockedAmount -= buyerEscrowPortion;
        uint256 buyerSurplusRefund = buyerEscrowPortion - s.grossAmount;

        buyOrder.remainingEnergyKWh -= matchAmountKWh;
        sellOrder.remainingEnergyKWh -= matchAmountKWh;
        buyOrder.status = (buyOrder.remainingEnergyKWh == 0) ? OrderStatus.FILLED : OrderStatus.PARTIALLY_FILLED;
        sellOrder.status = (sellOrder.remainingEnergyKWh == 0) ? OrderStatus.FILLED : OrderStatus.PARTIALLY_FILLED;

        totalEnergyTradedKWh += matchAmountKWh;
        totalWheelingFeesCollected += s.wheelingFee;
        totalTaxCollected += s.regulatoryTax;

        tradeId = nextTradeId++;
        trades[tradeId] = TradeRecord({
            tradeId: tradeId,
            buyOrderId: buyOrderId,
            sellOrderId: sellOrderId,
            buyer: buyOrder.creator,
            seller: sellOrder.creator,
            buyerMeterId: buyOrder.meterId,
            sellerMeterId: sellOrder.meterId,
            energyAmountKWh: matchAmountKWh,
            clearedPricePerKWh: s.clearedPrice,
            grossAmount: s.grossAmount,
            wheelingFee: s.wheelingFee,
            regulatoryTax: s.regulatoryTax,
            netProsumerAmount: s.netProsumerAmount,
            timestamp: block.timestamp
        });

        // Financial Settlements:
        // 1. Prosumer net payout
        require(paymentToken.transfer(sellOrder.creator, s.netProsumerAmount), "Seller transfer failed");
        // 2. DISCO wheeling fee
        require(paymentToken.transfer(tariffManager.gridOperatorTreasury(), s.wheelingFee), "Grid fee transfer failed");
        // 3. Regulator tax
        require(paymentToken.transfer(tariffManager.regulatorTreasury(), s.regulatoryTax), "Tax transfer failed");
        // 4. Buyer surplus refund
        if (buyerSurplusRefund > 0) {
            require(paymentToken.transfer(buyOrder.creator, buyerSurplusRefund), "Buyer refund failed");
        }

        emit TradeExecuted(
            tradeId,
            buyOrderId,
            sellOrderId,
            buyOrder.creator,
            sellOrder.creator,
            matchAmountKWh,
            s.clearedPrice,
            s.netProsumerAmount,
            s.wheelingFee
        );
    }

    /**
     * @notice Cancels an order and refunds any unspent escrow tokens (for buy orders)
     */
    function cancelOrder(uint256 orderId) external nonReentrant {
        Order storage order = orders[orderId];
        require(order.creator == msg.sender || hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Not authorized to cancel");
        require(order.status == OrderStatus.OPEN || order.status == OrderStatus.PARTIALLY_FILLED, "Order cannot be cancelled");

        order.status = OrderStatus.CANCELLED;
        uint256 refund = order.escrowLockedAmount;
        order.escrowLockedAmount = 0;

        if (refund > 0) {
            require(paymentToken.transfer(order.creator, refund), "Refund failed");
        }

        emit OrderCancelled(orderId, msg.sender, refund);
        emit OrderStatusChanged(orderId, OrderStatus.CANCELLED);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function getOrder(uint256 orderId) external view returns (Order memory) {
        return orders[orderId];
    }

    function getTrade(uint256 tradeId) external view returns (TradeRecord memory) {
        return trades[tradeId];
    }
}
