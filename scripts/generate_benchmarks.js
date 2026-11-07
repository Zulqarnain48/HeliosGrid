const { ethers } = require("hardhat");

async function main() {
  console.log("================================================================================");
  console.log("            GAS BENCHMARKING & THROUGHPUT METRICS EVALUATION                    ");
  console.log("================================================================================");

  const [deployer, gridOperator, regulator, prosumer, consumer, matchmaker, oracle, meterSigner] = await ethers.getSigners();

  // Deploy contracts
  const EnergyToken = await ethers.getContractFactory("EnergyToken");
  const token = await EnergyToken.deploy("Solar Credit Token", "SCT", deployer.address);
  await token.waitForDeployment();

  const SmartMeterRegistry = await ethers.getContractFactory("SmartMeterRegistry");
  const registry = await SmartMeterRegistry.deploy(deployer.address);
  await registry.waitForDeployment();

  const GridTariffManager = await ethers.getContractFactory("GridTariffManager");
  const tariff = await GridTariffManager.deploy(
    deployer.address,
    gridOperator.address,
    regulator.address,
    300,
    100,
    ethers.parseEther("20.0"),
    ethers.parseEther("50.0")
  );
  await tariff.waitForDeployment();

  const EnergyTradingPlatform = await ethers.getContractFactory("EnergyTradingPlatform");
  const platform = await EnergyTradingPlatform.deploy(
    deployer.address,
    await token.getAddress(),
    await registry.getAddress(),
    await tariff.getAddress()
  );
  await platform.waitForDeployment();

  await platform.grantRole(await platform.MATCHMAKER_ROLE(), matchmaker.address);
  await registry.grantRole(await registry.ORACLE_ROLE(), oracle.address);

  await token.requestSandboxTokens(prosumer.address, ethers.parseEther("10000.0"));
  await token.requestSandboxTokens(consumer.address, ethers.parseEther("10000.0"));

  const benchmarks = [];

  // Benchmark 1: Register Smart Meter
  const tx1 = await registry.registerMeter(999, prosumer.address, meterSigner.address, 1, 10);
  const rc1 = await tx1.wait();
  benchmarks.push({ operation: "registerMeter (Onboard device & owner)", gasUsed: rc1.gasUsed.toString() });

  // Register consumer meter for trading
  await registry.registerMeter(888, consumer.address, consumer.address, 0, 0);

  // Benchmark 2: Direct ECDSA Telemetry Attestation
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const registryAddress = await registry.getAddress();
  const readingTimestamp = Math.floor(Date.now() / 1000) + 3600;
  const hash = ethers.solidityPackedKeccak256(
    ["uint256", "address", "uint256", "uint256", "uint256", "uint256", "uint256"],
    [chainId, registryAddress, 999, ethers.parseEther("2.5"), 0, readingTimestamp, 0]
  );
  const sig = await meterSigner.signMessage(ethers.getBytes(hash));
  const tx2 = await registry.recordDirectMeterReading(999, ethers.parseEther("2.5"), 0, readingTimestamp, sig);
  const rc2 = await tx2.wait();
  benchmarks.push({ operation: "recordDirectMeterReading (ECDSA + Inverter Anomaly check)", gasUsed: rc2.gasUsed.toString() });

  // Benchmark 3: Anchor Merkle Root for Batch Telemetry (thousands of readings)
  const fakeRoot = ethers.keccak256(ethers.toUtf8Bytes("Batch_Epoch_Root"));
  const tx3 = await registry.connect(oracle).anchorEpochTelemetry(101, fakeRoot, ethers.parseEther("10000"), ethers.parseEther("8500"));
  const rc3 = await tx3.wait();
  benchmarks.push({ operation: "anchorEpochTelemetry (Anchors 10,000+ off-chain readings)", gasUsed: rc3.gasUsed.toString() });

  // Benchmark 4: Create Sell Order
  const tx4 = await platform.connect(prosumer).createSellOrder(ethers.parseEther("25.0"), ethers.parseEther("30.0"), 3600);
  const rc4 = await tx4.wait();
  benchmarks.push({ operation: "createSellOrder (Prosumer offers excess solar)", gasUsed: rc4.gasUsed.toString() });

  // Benchmark 5: Create Buy Order (with Escrow transfer)
  const escrow = ethers.parseEther("1000.0");
  await token.connect(consumer).approve(await platform.getAddress(), escrow);
  const tx5 = await platform.connect(consumer).createBuyOrder(ethers.parseEther("25.0"), ethers.parseEther("40.0"), 3600);
  const rc5 = await tx5.wait();
  benchmarks.push({ operation: "createBuyOrder (Consumer locks payment escrow)", gasUsed: rc5.gasUsed.toString() });

  // Benchmark 6: Match Orders & Financial Settlement
  const tx6 = await platform.connect(matchmaker).matchOrders(2, 1, ethers.parseEther("25.0"));
  const rc6 = await tx6.wait();
  benchmarks.push({ operation: "matchOrders (Double auction midpoint + 4 transfers)", gasUsed: rc6.gasUsed.toString() });

  // Benchmark 7: Cancel Unfilled Order
  await token.connect(consumer).approve(await platform.getAddress(), escrow);
  await platform.connect(consumer).createBuyOrder(ethers.parseEther("25.0"), ethers.parseEther("40.0"), 3600);
  const tx7 = await platform.connect(consumer).cancelOrder(3);
  const rc7 = await tx7.wait();
  benchmarks.push({ operation: "cancelOrder (Order state update + full escrow refund)", gasUsed: rc7.gasUsed.toString() });

  console.table(benchmarks);

  console.log("\n--- ECONOMIC GAS COST EQUIVALENCE (Assuming 30 Gwei Base Fee & ETH = $3,000) ---");
  for (const b of benchmarks) {
    const gas = BigInt(b.gasUsed);
    const ethCost = Number(gas * 30n * 1000000000n) / 1e18;
    const usdCost = ethCost * 3000;
    // Layer 2 cost (Arbitrum/Optimism ~ 0.05 Gwei or Polygon PoS ~ 0.001 USD)
    const l2Cost = usdCost * 0.01;
    console.log(`- ${b.operation.padEnd(52)} : ${b.gasUsed.padStart(8)} gas | L1: $${usdCost.toFixed(4)} | L2/Polygon: $${l2Cost.toFixed(6)}`);
  }
}

main().catch(console.error);
