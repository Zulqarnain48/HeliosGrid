const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("================================================================================");
  console.log("               DEPLOYING SOLAR P2P CONTRACTS TO NETWORK                         ");
  console.log("================================================================================");

  const [deployer, gridOperator, regulator] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log(`[+] Network Name : ${network.name} (Chain ID: ${network.chainId})`);
  console.log(`[+] Deployer     : ${deployer.address}`);
  console.log(`[+] Balance      : ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH/MATIC`);

  // 1. Deploy EnergyToken
  console.log("\n[1/5] Deploying EnergyToken (SCT)...");
  const EnergyToken = await ethers.getContractFactory("EnergyToken");
  const token = await EnergyToken.deploy("Solar Credit Token", "SCT", deployer.address);
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log(`[✓] EnergyToken deployed at: ${tokenAddress}`);

  // 2. Deploy SmartMeterRegistry
  console.log("\n[2/5] Deploying SmartMeterRegistry...");
  const SmartMeterRegistry = await ethers.getContractFactory("SmartMeterRegistry");
  const registry = await SmartMeterRegistry.deploy(deployer.address);
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log(`[✓] SmartMeterRegistry deployed at: ${registryAddress}`);

  // 3. Deploy GridTariffManager
  console.log("\n[3/5] Deploying GridTariffManager...");
  const GridTariffManager = await ethers.getContractFactory("GridTariffManager");
  const gridTreasury = gridOperator ? gridOperator.address : deployer.address;
  const regTreasury = regulator ? regulator.address : deployer.address;
  const fitFloor = ethers.parseEther("20.0");
  const retailCeiling = ethers.parseEther("50.0");

  const tariff = await GridTariffManager.deploy(
    deployer.address,
    gridTreasury,
    regTreasury,
    300, // 3% wheeling fee
    100, // 1% regulatory tax
    fitFloor,
    retailCeiling
  );
  await tariff.waitForDeployment();
  const tariffAddress = await tariff.getAddress();
  console.log(`[✓] GridTariffManager deployed at: ${tariffAddress}`);

  // 4. Deploy EnergyTradingPlatform
  console.log("\n[4/5] Deploying EnergyTradingPlatform...");
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

  // 5. Deploy CommunityBatteryManager
  console.log("\n[5/5] Deploying CommunityBatteryManager...");
  const CommunityBatteryManager = await ethers.getContractFactory("CommunityBatteryManager");
  const battery = await CommunityBatteryManager.deploy(deployer.address, tokenAddress, tariffAddress);
  await battery.waitForDeployment();
  const batteryAddress = await battery.getAddress();
  console.log(`[✓] CommunityBatteryManager deployed at: ${batteryAddress}`);

  const localAccounts = [];
  if (network.chainId === 31337n) {
    console.log("\n[+] Seeding local Hardhat accounts for dashboard testing...");
    const matchmakerRole = await platform.MATCHMAKER_ROLE();
    const oracleRole = await registry.ORACLE_ROLE();
    const gridOperatorRole = await tariff.GRID_OPERATOR_ROLE();
    const batteryOperatorRole = await battery.OPERATOR_ROLE();
    const accountsToSeed = (await ethers.getSigners()).slice(0, 10);

    for (let index = 0; index < accountsToSeed.length; index += 1) {
      const account = accountsToSeed[index];
      const isProsumer = index < 4;
      const meterId = 1001 + index;

      await (await registry.registerMeter(
        meterId,
        account.address,
        account.address,
        isProsumer ? 1 : 0,
        isProsumer ? 10 : 0
      )).wait();
      await (await token.requestSandboxTokens(account.address, ethers.parseEther("5000"))).wait();

      if (account.address.toLowerCase() !== deployer.address.toLowerCase()) {
        await (await platform.grantRole(matchmakerRole, account.address)).wait();
        await (await registry.grantRole(oracleRole, account.address)).wait();
        await (await tariff.grantRole(gridOperatorRole, account.address)).wait();
        await (await battery.grantRole(batteryOperatorRole, account.address)).wait();
      }

      localAccounts.push({ address: account.address, meterId, role: isProsumer ? "Prosumer" : "Consumer" });
    }

    await (await battery.registerBattery("Pakistan Housing Society", 250, 50, 10000)).wait();
    await (await token.transfer(batteryAddress, ethers.parseEther("10000"))).wait();
    await (await battery.chargeSurplusSolar(
      1,
      ethers.parseEther("182.5"),
      ethers.parseEther("20")
    )).wait();
    console.log(`[✓] Registered ${localAccounts.length} test meters and seeded the community battery`);
  }

  // Save deployment artifact
  const deploymentInfo = {
    network: network.name,
    chainId: network.chainId.toString(),
    deployedAt: new Date().toISOString(),
    contracts: {
      EnergyToken: tokenAddress,
      SmartMeterRegistry: registryAddress,
      GridTariffManager: tariffAddress,
      EnergyTradingPlatform: platformAddress,
      CommunityBatteryManager: batteryAddress,
    },
    localAccounts,
    treasuries: {
      gridOperatorTreasury: gridTreasury,
      regulatorTreasury: regTreasury,
    },
  };

  const outputPath = path.join(__dirname, "..", "docs", "DEPLOYED_ADDRESSES.json");
  fs.writeFileSync(outputPath, JSON.stringify(deploymentInfo, null, 2));
  console.log(`\n[✓] Deployment records saved to: docs/DEPLOYED_ADDRESSES.json`);
  console.log("================================================================================\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
