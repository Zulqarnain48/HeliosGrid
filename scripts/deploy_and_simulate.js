const { ethers } = require("hardhat");

async function main() {
  console.log("================================================================================");
  console.log("   PEER-TO-PEER SOLAR ENERGY TRADING WITH NATIONAL GRID TARIFF INTEGRATION     ");
  console.log("             SMART CONTRACT DEPLOYMENT & COMPLETE SIMULATION                   ");
  console.log("================================================================================");

  const [deployer, gridOperator, regulator, prosumer1, prosumer2, consumer1, consumer2, matchmaker, oracle] = await ethers.getSigners();

  console.log("\n[+] Deployer Account:", deployer.address);
  console.log("[+] Grid Operator Treasury:", gridOperator.address);
  console.log("[+] Energy Regulator Treasury:", regulator.address);

  // 1. Deploy EnergyToken
  console.log("\n--- STEP 1: Deploying Energy Utility Settlement Token (SCT) ---");
  const EnergyToken = await ethers.getContractFactory("EnergyToken");
  const token = await EnergyToken.deploy("Solar Credit Token", "SCT", deployer.address);
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log(`[✓] EnergyToken deployed at: ${tokenAddress}`);

  // 2. Deploy SmartMeterRegistry
  console.log("\n--- STEP 2: Deploying SmartMeterRegistry ---");
  const SmartMeterRegistry = await ethers.getContractFactory("SmartMeterRegistry");
  const registry = await SmartMeterRegistry.deploy(deployer.address);
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log(`[✓] SmartMeterRegistry deployed at: ${registryAddress}`);

  // 3. Deploy GridTariffManager
  // Parameters: 300 bps (3.0%) wheeling fee, 100 bps (1.0%) regulatory tax,
  // FiT Floor: 20 tokens/kWh, Retail Ceiling: 50 tokens/kWh
  console.log("\n--- STEP 3: Deploying GridTariffManager (NEPRA / DISCO Rules) ---");
  const GridTariffManager = await ethers.getContractFactory("GridTariffManager");
  const fitFloor = ethers.parseEther("20.0");
  const retailCeiling = ethers.parseEther("50.0");
  const tariff = await GridTariffManager.deploy(
    deployer.address,
    gridOperator.address,
    regulator.address,
    300, // 3%
    100, // 1%
    fitFloor,
    retailCeiling
  );
  await tariff.waitForDeployment();
  const tariffAddress = await tariff.getAddress();
  console.log(`[✓] GridTariffManager deployed at: ${tariffAddress}`);

  // 4. Deploy EnergyTradingPlatform
  console.log("\n--- STEP 4: Deploying EnergyTradingPlatform (Double Auction Engine) ---");
  const EnergyTradingPlatform = await ethers.getContractFactory("EnergyTradingPlatform");
  const platform = await EnergyTradingPlatform.deploy(
    deployer.address,
    tokenAddress,
    registryAddress,
    tariffAddress
  );
  await platform.waitForDeployment();
  const platformAddress = await platform.getAddress();
  console.log(`[✓] EnergyTradingPlatform deployed at: ${platformAddress}`);

  // Assign roles
  const MATCHMAKER_ROLE = await platform.MATCHMAKER_ROLE();
  await platform.grantRole(MATCHMAKER_ROLE, matchmaker.address);
  const ORACLE_ROLE = await registry.ORACLE_ROLE();
  await registry.grantRole(ORACLE_ROLE, oracle.address);

  // 5. Onboarding Housing Society Smart Meters
  console.log("\n--- STEP 5: Registering Community Smart Meters ---");
  // Prosumer 1: Villa 12 (15 kW Solar PV Inverter)
  const txReg1 = await registry.registerMeter(1001, prosumer1.address, prosumer1.address, 1, 15);
  const rcReg1 = await txReg1.wait();
  console.log(`[✓] Registered Meter #1001 (Prosumer 1 - 15kW Solar) - Gas: ${rcReg1.gasUsed}`);

  // Prosumer 2: Villa 18 (8 kW Solar PV Inverter)
  const txReg2 = await registry.registerMeter(1002, prosumer2.address, prosumer2.address, 1, 8);
  const rcReg2 = await txReg2.wait();
  console.log(`[✓] Registered Meter #1002 (Prosumer 2 - 8kW Solar)  - Gas: ${rcReg2.gasUsed}`);

  // Consumer 1: Apartment 4B (Pure Load)
  const txReg3 = await registry.registerMeter(2001, consumer1.address, consumer1.address, 0, 0);
  const rcReg3 = await txReg3.wait();
  console.log(`[✓] Registered Meter #2001 (Consumer 1 - Load Only)   - Gas: ${rcReg3.gasUsed}`);

  // Consumer 2: Apartment 7A (Pure Load)
  const txReg4 = await registry.registerMeter(2002, consumer2.address, consumer2.address, 0, 0);
  const rcReg4 = await txReg4.wait();
  console.log(`[✓] Registered Meter #2002 (Consumer 2 - Load Only)   - Gas: ${rcReg4.gasUsed}`);

  // 6. Token Faucet for Residents
  console.log("\n--- STEP 6: Funding Resident Wallets with Settlement Credits ---");
  const FUND_AMOUNT = ethers.parseEther("5000.0");
  await token.requestSandboxTokens(consumer1.address, FUND_AMOUNT);
  await token.requestSandboxTokens(consumer2.address, FUND_AMOUNT);
  console.log(`[✓] Funded Consumer 1 & 2 with 5,000 SCT tokens each`);

  // 7. Simulating Smart Meter Telemetry Attestation
  console.log("\n--- STEP 7: Smart Meter Telemetry & Merkle Epoch Anchoring ---");
  // Off-chain batch anchoring
  const fakeEpochRoot = ethers.keccak256(ethers.toUtf8Bytes("Epoch_42_HighFrequency_Batch_Proof"));
  const txAnchor = await registry.connect(oracle).anchorEpochTelemetry(
    42,
    fakeEpochRoot,
    ethers.parseEther("480.5"), // Society Gen: 480.5 kWh
    ethers.parseEther("390.2")  // Society Con: 390.2 kWh
  );
  const rcAnchor = await txAnchor.wait();
  console.log(`[✓] Anchored Epoch #42 Merkle Root (Batching 2,500 1-min readings) - Gas Used: ${rcAnchor.gasUsed}`);

  // 8. Order Placement & Double-Auction Clearing
  console.log("\n--- STEP 8: Dynamic P2P Order Book Simulation ---");
  const sellKWh = ethers.parseEther("50.0"); // 50 kWh offered
  const askPrice = ethers.parseEther("28.0"); // 28 tokens/kWh ask
  const txSell = await platform.connect(prosumer1).createSellOrder(sellKWh, askPrice, 3600);
  const rcSell = await txSell.wait();
  console.log(`[✓] Prosumer 1 posted SELL Order: 50 kWh @ 28 SCT/kWh - Gas: ${rcSell.gasUsed}`);

  const buyKWh = ethers.parseEther("50.0"); // 50 kWh demanded
  const bidPrice = ethers.parseEther("36.0"); // 36 tokens/kWh max bid
  const requiredEscrow = (buyKWh * bidPrice) / ethers.parseEther("1.0");

  // Approve tokens
  await token.connect(consumer1).approve(platformAddress, requiredEscrow);
  const txBuy = await platform.connect(consumer1).createBuyOrder(buyKWh, bidPrice, 3600);
  const rcBuy = await txBuy.wait();
  console.log(`[✓] Consumer 1 posted BUY Order: 50 kWh @ max 36 SCT/kWh (Escrow locked: 1,800 SCT) - Gas: ${rcBuy.gasUsed}`);

  // 9. Match & Financial Settlement
  console.log("\n--- STEP 9: Double-Auction Matching & Multi-Party Settlement ---");
  const txMatch = await platform.connect(matchmaker).matchOrders(2, 1, buyKWh);
  const rcMatch = await txMatch.wait();
  console.log(`[✓] Orders Matched at Midpoint: Cleared Price = 32.0 SCT/kWh - Gas: ${rcMatch.gasUsed}`);

  const trade = await platform.getTrade(1);
  console.log("\n======================== FINANCIAL SETTLEMENT BREAKDOWN ========================");
  console.log(`  Gross Energy Traded       : ${ethers.formatEther(trade.energyAmountKWh)} kWh`);
  console.log(`  Cleared Price             : ${ethers.formatEther(trade.clearedPricePerKWh)} SCT/kWh`);
  console.log(`  Gross Transaction Value   : ${ethers.formatEther(trade.grossAmount)} SCT`);
  console.log(`  DISCO Grid Wheeling Fee   : ${ethers.formatEther(trade.wheelingFee)} SCT (3% Use-of-System)`);
  console.log(`  NEPRA Regulatory Tax      : ${ethers.formatEther(trade.regulatoryTax)} SCT (1% Government Levy)`);
  console.log(`  Prosumer Net Payout       : ${ethers.formatEther(trade.netProsumerAmount)} SCT`);
  console.log(`  Consumer Escrow Refund    : ${ethers.formatEther(requiredEscrow - trade.grossAmount)} SCT (Surplus return)`);
  console.log("================================================================================");

  // 10. Balances Verification
  console.log("\n--- STEP 10: Verifying On-Chain Ledgers ---");
  console.log(`  Prosumer 1 Balance : ${ethers.formatEther(await token.balanceOf(prosumer1.address))} SCT`);
  console.log(`  Consumer 1 Balance : ${ethers.formatEther(await token.balanceOf(consumer1.address))} SCT`);
  console.log(`  Grid DISCO Treasury: ${ethers.formatEther(await token.balanceOf(gridOperator.address))} SCT`);
  console.log(`  Regulator Treasury : ${ethers.formatEther(await token.balanceOf(regulator.address))} SCT`);

  console.log("\n[SUCCESS] Entire P2P Solar Energy Trading & Grid Settlement Simulation Complete!\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
