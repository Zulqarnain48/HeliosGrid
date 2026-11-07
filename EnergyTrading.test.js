const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Peer-to-Peer Solar Energy Trading System", function () {
  let EnergyToken, token;
  let SmartMeterRegistry, registry;
  let GridTariffManager, tariffManager;
  let EnergyTradingPlatform, platform;

  let owner, prosumer, consumer, gridTreasury, regTreasury, matchmaker, oracle, meterSignerProsumer, meterSignerConsumer, attacker;

  // Fixed scale: 1 kWh = 1e18 units
  const ONE_KWH = ethers.parseEther("1.0");
  const HUNDRED_KWH = ethers.parseEther("100.0");
  const FIFTY_KWH = ethers.parseEther("50.0");

  // Prices: 30 tokens per kWh
  const FIT_FLOOR = ethers.parseEther("20.0");
  const RETAIL_CEILING = ethers.parseEther("50.0");
  const PROSUMER_ASK_PRICE = ethers.parseEther("30.0");
  const CONSUMER_BID_PRICE = ethers.parseEther("40.0");

  beforeEach(async function () {
    [
      owner,
      prosumer,
      consumer,
      gridTreasury,
      regTreasury,
      matchmaker,
      oracle,
      meterSignerProsumer,
      meterSignerConsumer,
      attacker,
    ] = await ethers.getSigners();

    // 1. Deploy EnergyToken
    EnergyToken = await ethers.getContractFactory("EnergyToken");
    token = await EnergyToken.deploy("Solar Credit Token", "SCT", owner.address);
    await token.waitForDeployment();

    // 2. Deploy SmartMeterRegistry
    SmartMeterRegistry = await ethers.getContractFactory("SmartMeterRegistry");
    registry = await SmartMeterRegistry.deploy(owner.address);
    await registry.waitForDeployment();

    // 3. Deploy GridTariffManager
    // 300 bps wheeling (3%), 100 bps tax (1%)
    GridTariffManager = await ethers.getContractFactory("GridTariffManager");
    tariffManager = await GridTariffManager.deploy(
      owner.address,
      gridTreasury.address,
      regTreasury.address,
      300, // 3% wheeling fee
      100, // 1% regulatory tax
      FIT_FLOOR,
      RETAIL_CEILING
    );
    await tariffManager.waitForDeployment();

    // 4. Deploy EnergyTradingPlatform
    EnergyTradingPlatform = await ethers.getContractFactory("EnergyTradingPlatform");
    platform = await EnergyTradingPlatform.deploy(
      owner.address,
      await token.getAddress(),
      await registry.getAddress(),
      await tariffManager.getAddress()
    );
    await platform.waitForDeployment();

    // Grant roles
    const MATCHMAKER_ROLE = await platform.MATCHMAKER_ROLE();
    await platform.grantRole(MATCHMAKER_ROLE, matchmaker.address);

    const ORACLE_ROLE = await registry.ORACLE_ROLE();
    await registry.grantRole(ORACLE_ROLE, oracle.address);

    // Distribute sandbox tokens for tests
    const INITIAL_FUNDS = ethers.parseEther("10000.0");
    await token.requestSandboxTokens(prosumer.address, INITIAL_FUNDS);
    await token.requestSandboxTokens(consumer.address, INITIAL_FUNDS);

    // Register smart meters:
    // Meter 101: Prosumer with 10 kW rooftop solar PV inverter
    await registry.registerMeter(
      101,
      prosumer.address,
      meterSignerProsumer.address,
      1, // PROSUMER_SOLAR
      10 // 10 kW capacity
    );

    // Meter 202: Consumer pure load
    await registry.registerMeter(
      202,
      consumer.address,
      meterSignerConsumer.address,
      0, // CONSUMER_ONLY
      0
    );
  });

  describe("Task 3 Prototype Validation: Smart Meter Registry & Cryptographic Attestation", function () {
    it("should correctly store registered meter profiles and enforce uniqueness", async function () {
      const meter = await registry.getMeter(101);
      expect(meter.ownerResident).to.equal(prosumer.address);
      expect(meter.deviceSignerAddress).to.equal(meterSignerProsumer.address);
      expect(meter.maxInverterCapacityKW).to.equal(10);
      expect(meter.status).to.equal(1); // ACTIVE

      // Duplicate registration should fail
      await expect(
        registry.registerMeter(101, attacker.address, attacker.address, 0, 0)
      ).to.be.revertedWith("Meter ID already registered");
    });

    it("should verify ECDSA signed direct smart meter reading from hardware device", async function () {
      const meterId = 101;
      const deltaGen = ethers.parseEther("5.0"); // 5 kWh generated in 1 hour (valid for 10 kW inverter)
      const deltaCon = ethers.parseEther("1.0"); // 1 kWh consumed
      const latestBlock = await ethers.provider.getBlock("latest");
      const readingTimestamp = latestBlock.timestamp + 3600; // 1 hour later
      const nonce = await registry.meterNonces(meterId);

      const registryAddress = await registry.getAddress();
      const { chainId } = await ethers.provider.getNetwork();

      const messageHash = ethers.solidityPackedKeccak256(
        ["uint256", "address", "uint256", "uint256", "uint256", "uint256", "uint256"],
        [chainId, registryAddress, meterId, deltaGen, deltaCon, readingTimestamp, nonce]
      );

      const signature = await meterSignerProsumer.signMessage(ethers.getBytes(messageHash));

      await expect(
        registry.recordDirectMeterReading(meterId, deltaGen, deltaCon, readingTimestamp, signature)
      ).to.emit(registry, "DirectReadingAttested");

      const profile = await registry.getMeter(meterId);
      expect(profile.cumulativeGenerationKWh).to.equal(deltaGen);
      expect(profile.cumulativeConsumptionKWh).to.equal(deltaCon);
    });

    it("should flag meter tampering if generation exceeds physical inverter capacity (GIGO Defense)", async function () {
      const meterId = 101; // 10 kW inverter
      // 100 kWh in 10 seconds is physically impossible!
      const impossibleDeltaGen = ethers.parseEther("100.0");
      const deltaCon = 0;
      const latestBlock = await ethers.provider.getBlock("latest");
      const readingTimestamp = latestBlock.timestamp + 10;
      const nonce = await registry.meterNonces(meterId);

      const registryAddress = await registry.getAddress();
      const { chainId } = await ethers.provider.getNetwork();

      const messageHash = ethers.solidityPackedKeccak256(
        ["uint256", "address", "uint256", "uint256", "uint256", "uint256", "uint256"],
        [chainId, registryAddress, meterId, impossibleDeltaGen, deltaCon, readingTimestamp, nonce]
      );

      const signature = await meterSignerProsumer.signMessage(ethers.getBytes(messageHash));

      await expect(
        registry.recordDirectMeterReading(meterId, impossibleDeltaGen, deltaCon, readingTimestamp, signature)
      ).to.emit(registry, "TamperAlert");

      const profile = await registry.getMeter(meterId);
      expect(profile.status).to.equal(3); // TAMPER_FLAGGED
    });

    it("should support off-chain Merkle root telemetry anchoring for high throughput", async function () {
      const epochId = 1;
      const fakeMerkleRoot = ethers.keccak256(ethers.toUtf8Bytes("Epoch_1_Sample_Merkle_Root"));
      const totalGen = ethers.parseEther("1500.0");
      const totalCon = ethers.parseEther("1200.0");

      await expect(
        registry.connect(oracle).anchorEpochTelemetry(epochId, fakeMerkleRoot, totalGen, totalCon)
      ).to.emit(registry, "EpochAnchored");

      const anchor = await registry.epochAnchors(epochId);
      expect(anchor.merkleRoot).to.equal(fakeMerkleRoot);
      expect(anchor.totalSocietyGenerationKWh).to.equal(totalGen);
    });
  });

  describe("Task 3 Prototype Validation: National Grid Operator Tariff Manager", function () {
    it("should validate dynamic P2P prices against FiT floor and Retail ceiling", async function () {
      const [valid1] = await tariffManager.validateTradePrice(ethers.parseEther("30.0"));
      expect(valid1).to.be.true;

      const [valid2, reason2] = await tariffManager.validateTradePrice(ethers.parseEther("15.0"));
      expect(valid2).to.be.false;
      expect(reason2).to.include("below national Grid Feed-in-Tariff");

      const [valid3, reason3] = await tariffManager.validateTradePrice(ethers.parseEther("55.0"));
      expect(valid3).to.be.false;
      expect(reason3).to.include("above national Grid Retail");
    });

    it("should accurately calculate wheeling fees and regulatory taxes", async function () {
      const energy = HUNDRED_KWH;
      const price = PROSUMER_ASK_PRICE;
      const timestamp = 1700000000; // Normal hour (not peak)

      const [gross, wheeling, tax, net] = await tariffManager.calculateFees(energy, price, timestamp);
      expect(gross).to.equal(ethers.parseEther("3000.0"));
      expect(wheeling).to.equal(ethers.parseEther("90.0"));
      expect(tax).to.equal(ethers.parseEther("30.0"));
      expect(net).to.equal(ethers.parseEther("2880.0"));
    });

    it("should allow grid operator to toggle emergency curtailment and block solar sales", async function () {
      await tariffManager.setEmergencyCurtailment(true, "Distribution feeder transformer thermal overload");
      expect(await tariffManager.checkCurtailment()).to.be.true;

      await expect(
        platform.connect(prosumer).createSellOrder(HUNDRED_KWH, PROSUMER_ASK_PRICE, 3600)
      ).to.be.revertedWith("Grid Curtailment Active: Solar exports throttled");
    });
  });

  describe("Task 3 Prototype Validation: P2P Double-Auction Matching & Settlement Engine", function () {
    it("should place sell order and buy order with escrow locking", async function () {
      await expect(
        platform.connect(prosumer).createSellOrder(HUNDRED_KWH, PROSUMER_ASK_PRICE, 3600)
      ).to.emit(platform, "OrderCreated");

      const sellOrder = await platform.getOrder(1);
      expect(sellOrder.creator).to.equal(prosumer.address);
      expect(sellOrder.remainingEnergyKWh).to.equal(HUNDRED_KWH);

      const requiredEscrow = ethers.parseEther("4000.0");
      await token.connect(consumer).approve(await platform.getAddress(), requiredEscrow);

      const consumerBalBefore = await token.balanceOf(consumer.address);
      await expect(
        platform.connect(consumer).createBuyOrder(HUNDRED_KWH, CONSUMER_BID_PRICE, 3600)
      ).to.emit(platform, "OrderCreated");

      const consumerBalAfter = await token.balanceOf(consumer.address);
      expect(consumerBalBefore - consumerBalAfter).to.equal(requiredEscrow);

      const buyOrder = await platform.getOrder(2);
      expect(buyOrder.escrowLockedAmount).to.equal(requiredEscrow);
    });

    it("should execute double-auction match at midpoint price and distribute all funds correctly", async function () {
      await platform.connect(prosumer).createSellOrder(HUNDRED_KWH, PROSUMER_ASK_PRICE, 3600);

      const escrow = ethers.parseEther("4000.0");
      await token.connect(consumer).approve(await platform.getAddress(), escrow);
      await platform.connect(consumer).createBuyOrder(HUNDRED_KWH, CONSUMER_BID_PRICE, 3600);

      const prosumerBalBefore = await token.balanceOf(prosumer.address);
      const consumerBalBefore = await token.balanceOf(consumer.address);
      const gridBalBefore = await token.balanceOf(gridTreasury.address);
      const regBalBefore = await token.balanceOf(regTreasury.address);

      const matchTx = await platform.connect(matchmaker).matchOrders(2, 1, HUNDRED_KWH);
      const receipt = await matchTx.wait();

      console.log(`\n      [Gas Benchmark] matchOrders Gas Used: ${receipt.gasUsed.toString()}`);

      const trade = await platform.getTrade(1);
      const prosumerBalAfter = await token.balanceOf(prosumer.address);
      const consumerBalAfter = await token.balanceOf(consumer.address);
      const gridBalAfter = await token.balanceOf(gridTreasury.address);
      const regBalAfter = await token.balanceOf(regTreasury.address);

      expect(prosumerBalAfter - prosumerBalBefore).to.equal(trade.netProsumerAmount);
      expect(gridBalAfter - gridBalBefore).to.equal(trade.wheelingFee);
      expect(regBalAfter - regBalBefore).to.equal(trade.regulatoryTax);
      expect(consumerBalAfter - consumerBalBefore).to.equal(escrow - trade.grossAmount);

      const buyOrder = await platform.getOrder(2);
      const sellOrder = await platform.getOrder(1);
      expect(buyOrder.status).to.equal(2); // FILLED
      expect(sellOrder.status).to.equal(2); // FILLED
    });

    it("should handle partial order fills correctly", async function () {
      await platform.connect(prosumer).createSellOrder(HUNDRED_KWH, PROSUMER_ASK_PRICE, 3600);

      const escrow = ethers.parseEther("2000.0");
      await token.connect(consumer).approve(await platform.getAddress(), escrow);
      await platform.connect(consumer).createBuyOrder(FIFTY_KWH, CONSUMER_BID_PRICE, 3600);

      await platform.connect(matchmaker).matchOrders(2, 1, FIFTY_KWH);

      const buyOrder = await platform.getOrder(2);
      const sellOrder = await platform.getOrder(1);

      expect(buyOrder.status).to.equal(2); // FILLED
      expect(sellOrder.status).to.equal(1); // PARTIALLY_FILLED
      expect(sellOrder.remainingEnergyKWh).to.equal(FIFTY_KWH);
    });

    it("should allow buyer to cancel unfilled order and receive 100% escrow refund", async function () {
      const escrow = ethers.parseEther("4000.0");
      await token.connect(consumer).approve(await platform.getAddress(), escrow);
      await platform.connect(consumer).createBuyOrder(HUNDRED_KWH, CONSUMER_BID_PRICE, 3600);

      const balBefore = await token.balanceOf(consumer.address);
      await platform.connect(consumer).cancelOrder(1);
      const balAfter = await token.balanceOf(consumer.address);

      expect(balAfter - balBefore).to.equal(escrow);

      const order = await platform.getOrder(1);
      expect(order.status).to.equal(3); // CANCELLED
    });

    it("should prevent unauthorized cancellation and self-trading", async function () {
      await platform.connect(prosumer).createSellOrder(HUNDRED_KWH, PROSUMER_ASK_PRICE, 3600);

      await expect(
        platform.connect(attacker).cancelOrder(1)
      ).to.be.revertedWith("Not authorized to cancel");

      const escrow = ethers.parseEther("4000.0");
      await token.connect(prosumer).approve(await platform.getAddress(), escrow);
      await platform.connect(prosumer).createBuyOrder(HUNDRED_KWH, CONSUMER_BID_PRICE, 3600);

      await expect(
        platform.connect(matchmaker).matchOrders(2, 1, HUNDRED_KWH)
      ).to.be.revertedWith("Cannot trade with oneself");
    });
  });
});
