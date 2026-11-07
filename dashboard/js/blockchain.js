(function () {
  const CHAIN_ID = 31337;
  const RPC_URL = "http://127.0.0.1:8545";
  const CONTRACT_NAMES = [
    "EnergyToken",
    "SmartMeterRegistry",
    "GridTariffManager",
    "EnergyTradingPlatform",
    "CommunityBatteryManager"
  ];
  const statusLabels = ["Open", "Partially filled", "Filled", "Cancelled", "Expired"];
  const contracts = {};
  let deployment;
  let readProvider;
  let walletProvider;
  let signer;
  let account;
  let activeMode = false;
  let refreshTimer;

  function notify(message, icon) {
    if (window.showToast) window.showToast(message, icon);
    else console.error(message);
  }

  function setStatus(message, connected) {
    const badge = document.getElementById("networkStatus");
    if (!badge) return;
    badge.className = "badge " + (connected ? "badge--live" : "badge--warn");
    badge.replaceChildren();
    const icon = document.createElement("i");
    icon.className = "fas " + (connected ? "fa-link" : "fa-plug");
    badge.append(icon, document.createTextNode(" " + message));
  }

  function shortAddress(address) {
    return address ? address.slice(0, 6) + "…" + address.slice(-4) : "";
  }

  async function loadContracts(provider) {
    const response = await fetch("/api/deployment", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(response.status === 404 ? "Contracts are not deployed yet." : "Could not load deployed contract addresses.");
    }

    deployment = await response.json();
    if (Number(deployment.chainId) !== CHAIN_ID) {
      throw new Error("The saved deployment is not for the local Hardhat chain (31337). Redeploy locally.");
    }

    const missing = CONTRACT_NAMES.filter(function (name) { return !deployment.contracts[name]; });
    if (missing.length) {
      throw new Error("Missing deployed contract address(es): " + missing.join(", ") + ". Run the local deployment command.");
    }

    for (const name of CONTRACT_NAMES) {
      const address = deployment.contracts[name];
      const code = await provider.getCode(address);
      if (code === "0x") {
        throw new Error(name + " is not deployed on this Hardhat node. Restart the node, then deploy the contracts again.");
      }

      const artifactResponse = await fetch("/api/abi/" + name, { cache: "no-store" });
      if (!artifactResponse.ok) {
        throw new Error("Could not load " + name + " ABI. Compile the contracts first.");
      }
      const artifact = await artifactResponse.json();
      contracts[name] = new window.ethers.Contract(address, artifact.abi, provider);
    }

    renderContractAddresses();
    return deployment;
  }

  function renderContractAddresses() {
    CONTRACT_NAMES.forEach(function (name) {
      const element = document.querySelector('[data-contract-address="' + name + '"]');
      if (element && deployment && deployment.contracts[name]) {
        element.textContent = shortAddress(deployment.contracts[name]);
        element.title = deployment.contracts[name];
      }
      const status = document.querySelector('[data-contract-status="' + name + '"]');
      if (status && contracts[name]) {
        status.className = "tag tag--green";
        status.textContent = "On-chain";
      }
    });
  }

  function updateWalletUI() {
    const button = document.getElementById("walletButton");
    const avatar = document.getElementById("accountAvatar");
    const updated = document.getElementById("lastUpdated");
    if (!button || !avatar) return;

    if (account) {
      button.textContent = shortAddress(account);
      button.title = "Connected wallet " + account;
      avatar.textContent = account.slice(2, 4).toUpperCase();
      avatar.title = account;
      avatar.setAttribute("data-tooltip", account);
    } else {
      button.textContent = "Connect Wallet";
      button.title = "Connect MetaMask on the local Hardhat network";
      avatar.textContent = "HG";
      avatar.title = "Wallet not connected";
      avatar.setAttribute("data-tooltip", "Wallet not connected");
    }

    if (updated && walletProvider && account) {
      contracts.EnergyToken.balanceOf(account).then(function (balance) {
        updated.textContent = window.ethers.formatUnits(balance, 18) + " SCT";
      }).catch(function (error) {
        console.error("Could not read wallet token balance:", error);
      });
    } else if (updated) {
      updated.textContent = activeMode ? "Read-only connection" : "Sample view";
    }
  }

  async function refreshChainData() {
    if (!activeMode || !deployment) return;

    const ethers = window.ethers;
    const platform = contracts.EnergyTradingPlatform;
    const registry = contracts.SmartMeterRegistry;
    const tariff = contracts.GridTariffManager;
    const battery = contracts.CommunityBatteryManager;
    const [nextOrderId, nextTradeId, totalEnergy, totalMeters, latestEpoch, curtailed, floor, ceiling, wheelingBps, taxBps] = await Promise.all([
      platform.nextOrderId(),
      platform.nextTradeId(),
      platform.totalEnergyTradedKWh(),
      registry.totalRegisteredMeters(),
      registry.latestEpochId(),
      tariff.isEmergencyCurtailmentActive(),
      tariff.feedInTariffFloor(),
      tariff.retailGridTariffCeiling(),
      tariff.wheelingBasisPoints(),
      tariff.regulatoryTaxBasisPoints()
    ]);

    const firstOrderId = nextOrderId > 100n ? nextOrderId - 100n : 1n;
    const orderIds = [];
    for (let id = firstOrderId; id < nextOrderId; id += 1n) orderIds.push(id);
    const orderRecords = await Promise.all(orderIds.map(function (id) { return platform.getOrder(id); }));
    const asks = [];
    const bids = [];
    orderRecords.forEach(function (order, index) {
      const status = Number(order.status);
      if ((status !== 0 && status !== 1) || order.expiryTimestamp <= BigInt(Math.floor(Date.now() / 1000))) return;
      const item = {
        id: Number(order.orderId),
        trader: shortAddress(order.creator),
        account: order.creator,
        quantity: Number(ethers.formatUnits(order.remainingEnergyKWh, 18)),
        price: Number(ethers.formatUnits(order.pricePerKWh, 18)),
        remainingRaw: order.remainingEnergyKWh,
        status: statusLabels[status],
        orderType: Number(order.orderType)
      };
      if (item.orderType === 1) asks.push(item);
      else bids.push(item);
    });
    asks.sort(function (a, b) { return a.price - b.price; });
    bids.sort(function (a, b) { return b.price - a.price; });

    const firstTradeId = nextTradeId > 26n ? nextTradeId - 25n : 1n;
    const tradeIds = [];
    for (let id = firstTradeId; id < nextTradeId; id += 1n) tradeIds.push(id);
    const tradeRecords = await Promise.all(tradeIds.map(function (id) { return platform.getTrade(id); }));
    const trades = tradeRecords.reverse().map(function (trade) {
      return {
        id: "CHAIN-" + trade.tradeId.toString(),
        time: new Date(Number(trade.timestamp) * 1000),
        seller: shortAddress(trade.seller),
        buyer: shortAddress(trade.buyer),
        quantity: Number(ethers.formatUnits(trade.energyAmountKWh, 18)),
        price: Number(ethers.formatUnits(trade.clearedPricePerKWh, 18)),
        wheelingFee: Number(ethers.formatUnits(trade.wheelingFee, 18)),
        netAmount: Number(ethers.formatUnits(trade.netProsumerAmount, 18))
      };
    });

    const [soc, batteryData] = await Promise.all([
      battery.getBatterySoCPercent(1),
      battery.getBattery(1)
    ]);
    const registeredMeters = await Promise.all((deployment.localAccounts || []).map(async function (localAccount) {
      const profile = await registry.getMeter(localAccount.meterId);
      return {
        id: "MTR-" + localAccount.meterId,
        home: shortAddress(localAccount.address),
        role: localAccount.role,
        generation: Number(ethers.formatUnits(profile.cumulativeGenerationKWh, 18)),
        consumption: Number(ethers.formatUnits(profile.cumulativeConsumptionKWh, 18)),
        status: Number(profile.status) === 1 ? "Online" : "Inactive"
      };
    }));
    const [network, blockNumber] = await Promise.all([
      readProvider.getNetwork(),
      readProvider.getBlockNumber()
    ]);

    window.HeliosGrid.state.asks = asks;
    window.HeliosGrid.state.bids = bids;
    window.HeliosGrid.state.trades = trades;
    window.HeliosGrid.state.batterySoc = Number(soc);
    window.HeliosGrid.state.batteryStoredKWh = Number(ethers.formatUnits(batteryData.currentStoredKWh, 18));
    window.HeliosGrid.state.batteryCapacityKWh = Number(ethers.formatUnits(batteryData.totalCapacityKWh, 18));
    window.HeliosGrid.state.curtailed = curtailed;
    window.HeliosGrid.state.nextOrderId = Number(nextOrderId);
    window.HeliosGrid.state.nextTradeId = Number(nextTradeId);
    window.HeliosGrid.state.totalEnergyTradedKWh = Number(ethers.formatUnits(totalEnergy, 18));
    window.HeliosGrid.state.totalMeters = Number(totalMeters);
    window.HeliosGrid.state.latestEpochId = Number(latestEpoch);
    window.HeliosGrid.state.registeredMeters = registeredMeters;
    window.HeliosGrid.state.tariff = {
      floor: Number(ethers.formatUnits(floor, 18)),
      ceiling: Number(ethers.formatUnits(ceiling, 18)),
      wheelingPercent: Number(wheelingBps) / 100,
      taxPercent: Number(taxBps) / 100
    };
    window.HeliosGrid.meters = registeredMeters.length ? registeredMeters : window.HeliosGrid.meters;

    setStatus("Hardhat local · #" + blockNumber, true);
    document.getElementById("networkStatus").title = "Chain ID " + network.chainId + " · local Hardhat node";
    if (window.HeliosGridUI) window.HeliosGridUI.onChainDataChanged();
    updateWalletUI();
  }

  function scheduleRefresh() {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(function () {
      refreshChainData().catch(function (error) {
        console.error("Could not refresh on-chain dashboard data:", error);
      });
    }, 350);
  }

  function watchContractEvents() {
    contracts.EnergyTradingPlatform.on("OrderCreated", function (orderId, creator, meterId, orderType, energyKWh, pricePerKWh) {
      if (window.HeliosGridUI) window.HeliosGridUI.logChainEvent(
        "ORDER",
        "#" + orderId + " " + (Number(orderType) === 1 ? "sell" : "buy") + " order by " + shortAddress(creator) +
          " · " + window.ethers.formatUnits(energyKWh, 18) + " kWh at " + window.ethers.formatUnits(pricePerKWh, 18) + " SCT/kWh"
      );
      scheduleRefresh();
    });
    contracts.EnergyTradingPlatform.on("TradeExecuted", function (tradeId, buyOrderId, sellOrderId, buyer, seller, energyKWh, price) {
      if (window.HeliosGridUI) window.HeliosGridUI.logChainEvent(
        "TRADE",
        "#" + tradeId + " · " + window.ethers.formatUnits(energyKWh, 18) + " kWh at " +
          window.ethers.formatUnits(price, 18) + " SCT/kWh · " + shortAddress(seller) + " → " + shortAddress(buyer)
      );
      scheduleRefresh();
    });
    contracts.EnergyTradingPlatform.on("OrderStatusChanged", scheduleRefresh);
    contracts.GridTariffManager.on("EmergencyCurtailmentToggled", function (active, reason) {
      if (window.HeliosGridUI) window.HeliosGridUI.logChainEvent("GRID", active ? "Curtailment active: " + reason : "Curtailment cleared.");
      scheduleRefresh();
    });
    contracts.CommunityBatteryManager.on("BatteryCharged", function (batteryId, energyKWh, pricePerKWh) {
      if (window.HeliosGridUI) window.HeliosGridUI.logChainEvent("BATTERY", "Battery #" + batteryId + " charged by " + window.ethers.formatUnits(energyKWh, 18) + " kWh.");
      scheduleRefresh();
    });
    contracts.CommunityBatteryManager.on("BatteryDischarged", function (batteryId, energyKWh) {
      if (window.HeliosGridUI) window.HeliosGridUI.logChainEvent("BATTERY", "Battery #" + batteryId + " discharged by " + window.ethers.formatUnits(energyKWh, 18) + " kWh.");
      scheduleRefresh();
    });
    contracts.SmartMeterRegistry.on("EpochAnchored", function (epochId, merkleRoot) {
      if (window.HeliosGridUI) window.HeliosGridUI.logChainEvent("EPOCH", "#" + epochId + " anchored · " + merkleRoot);
      scheduleRefresh();
    });
  }

  async function initializeReadOnly() {
    if (!window.ethers) throw new Error("Ethers.js failed to load from the local project server.");
    readProvider = new window.ethers.JsonRpcProvider(
      window.location.origin + "/api/rpc",
      { chainId: CHAIN_ID, name: "hardhat" },
      { staticNetwork: true }
    );
    const network = await readProvider.getNetwork();
    if (Number(network.chainId) !== CHAIN_ID) {
      throw new Error("Expected local Hardhat chain ID 31337, received " + network.chainId + ".");
    }

    await loadContracts(readProvider);
    activeMode = true;
    watchContractEvents();
    await refreshChainData();
    return true;
  }

  async function ensureLocalWalletNetwork() {
    const chainId = await window.ethereum.request({ method: "eth_chainId" });
    if (Number(chainId) === CHAIN_ID) return;

    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x" + CHAIN_ID.toString(16) }]
      });
    } catch (error) {
      if (error.code !== 4902) throw error;
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: "0x" + CHAIN_ID.toString(16),
          chainName: "Local Hardhat",
          nativeCurrency: { name: "Hardhat ETH", symbol: "ETH", decimals: 18 },
          rpcUrls: [RPC_URL]
        }]
      });
    }
  }

  async function connectWallet() {
    if (!window.ethereum) {
      throw new Error("MetaMask was not found. Install the MetaMask browser extension to send local transactions.");
    }

    await ensureLocalWalletNetwork();
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    if (!accounts.length) throw new Error("MetaMask did not provide an account.");

    walletProvider = new window.ethers.BrowserProvider(window.ethereum);
    signer = await walletProvider.getSigner();
    account = await signer.getAddress();
    const network = await walletProvider.getNetwork();
    if (Number(network.chainId) !== CHAIN_ID) throw new Error("Switch MetaMask to the Local Hardhat network (31337).");

    if (!readProvider) {
      readProvider = new window.ethers.JsonRpcProvider(
        window.location.origin + "/api/rpc",
        { chainId: CHAIN_ID, name: "hardhat" },
        { staticNetwork: true }
      );
    }
    if (!deployment) await loadContracts(readProvider);

    CONTRACT_NAMES.forEach(function (name) {
      contracts[name] = contracts[name].connect(signer);
    });
    activeMode = true;
    updateWalletUI();
    window.ethereum.removeListener("accountsChanged", handleAccountsChanged);
    window.ethereum.on("accountsChanged", handleAccountsChanged);
    window.ethereum.removeListener("chainChanged", handleChainChanged);
    window.ethereum.on("chainChanged", handleChainChanged);
    await refreshChainData();
    notify("Wallet connected to the local Hardhat blockchain.");
  }

  async function handleAccountsChanged(accounts) {
    if (!accounts.length) {
      account = null;
      signer = null;
      walletProvider = null;
      updateWalletUI();
      setStatus("Hardhat local · read-only", true);
      return;
    }
    walletProvider = new window.ethers.BrowserProvider(window.ethereum);
    signer = await walletProvider.getSigner();
    account = await signer.getAddress();
    CONTRACT_NAMES.forEach(function (name) {
      contracts[name] = new window.ethers.Contract(deployment.contracts[name], contracts[name].interface, signer);
    });
    updateWalletUI();
    scheduleRefresh();
  }

  function handleChainChanged() {
    window.location.reload();
  }

  function requireWallet() {
    if (!activeMode) throw new Error("Start the local Hardhat node and deploy the contracts first.");
    if (!account || !signer) throw new Error("Connect your MetaMask wallet before submitting a blockchain transaction.");
    return account;
  }

  function getErrorMessage(error) {
    return error.shortMessage || error.reason || (error.info && error.info.error && error.info.error.message) || error.message || "Blockchain transaction failed.";
  }

  async function transact(action, callback) {
    try {
      const result = await callback();
      notify(action + " confirmed on the local blockchain.");
      await refreshChainData();
      return result;
    } catch (error) {
      console.error(action + " failed:", error);
      throw error;
    }
  }

  async function withErrorToast(action, callback) {
    try {
      return await callback();
    } catch (error) {
      notify(action + " failed: " + getErrorMessage(error), "fa-circle-exclamation");
      throw error;
    }
  }

  async function submitOrder(side, quantity, price, durationHours) {
    const owner = requireWallet();
    const meterId = await contracts.SmartMeterRegistry.residentToMeterId(owner);
    if (meterId === 0n) throw new Error("This wallet has no registered smart meter. Use one of the local test accounts seeded by deploy.js.");

    const amount = window.ethers.parseUnits(String(quantity), 18);
    const unitPrice = window.ethers.parseUnits(String(price), 18);
    const duration = Math.max(300, Number(durationHours) * 3600);

    return transact(side === "sell" ? "Sell order" : "Buy order", async function () {
      if (side === "buy") {
        const escrow = amount * unitPrice / window.ethers.parseEther("1");
        const currentAllowance = await contracts.EnergyToken.allowance(owner, deployment.contracts.EnergyTradingPlatform);
        if (currentAllowance < escrow) {
          await (await contracts.EnergyToken.approve(deployment.contracts.EnergyTradingPlatform, escrow)).wait();
        }
        return (await contracts.EnergyTradingPlatform.createBuyOrder(amount, unitPrice, duration)).wait();
      }
      return (await contracts.EnergyTradingPlatform.createSellOrder(amount, unitPrice, duration)).wait();
    });
  }

  async function executeAuction() {
    requireWallet();
    const role = await contracts.EnergyTradingPlatform.MATCHMAKER_ROLE();
    if (!await contracts.EnergyTradingPlatform.hasRole(role, account)) {
      throw new Error("This wallet is not a matchmaker. Use a seeded local Hardhat account or grant MATCHMAKER_ROLE.");
    }

    const asks = window.HeliosGrid.state.asks.slice().sort(function (a, b) { return a.price - b.price; });
    const bids = window.HeliosGrid.state.bids.slice().sort(function (a, b) { return b.price - a.price; });
    let matches = 0;
    return transact("Auction", async function () {
      for (const bid of bids) {
        for (const ask of asks) {
          if (bid.remainingRaw <= 0n) break;
          if (ask.remainingRaw <= 0n) continue;
          if (bid.price < ask.price) break;
          if (bid.account.toLowerCase() === ask.account.toLowerCase()) continue;
          const amount = bid.remainingRaw < ask.remainingRaw ? bid.remainingRaw : ask.remainingRaw;
          await (await contracts.EnergyTradingPlatform.matchOrders(
            bid.id,
            ask.id,
            amount
          )).wait();
          bid.remainingRaw -= amount;
          ask.remainingRaw -= amount;
          matches += 1;
        }
      }
      if (!matches) throw new Error("No compatible, unexpired buy and sell orders are available to match.");
      return matches;
    });
  }

  async function updateBattery(direction) {
    requireWallet();
    const battery = contracts.CommunityBatteryManager;
    const details = await battery.getBattery(1);
    if (details.totalCapacityKWh === 0n) throw new Error("No community battery is registered in the deployed contract.");
    const step = details.totalCapacityKWh / 20n;
    const floor = await contracts.GridTariffManager.feedInTariffFloor();

    return transact(direction === "charge" ? "Battery charge" : "Battery discharge", async function () {
      if (direction === "charge") {
        const available = details.totalCapacityKWh - details.currentStoredKWh;
        const amount = step < available ? step : available;
        if (amount === 0n) throw new Error("Battery is already full.");
        return (await battery.chargeSurplusSolar(1, amount, floor)).wait();
      }

      const amount = step < details.currentStoredKWh ? step : details.currentStoredKWh;
      if (amount === 0n) throw new Error("Battery is empty.");
      return (await battery.dischargePeakArbitrage(1, amount, floor, account)).wait();
    });
  }

  async function toggleCurtailment(enabled) {
    requireWallet();
    return transact("Grid curtailment update", async function () {
      return (await contracts.GridTariffManager.setEmergencyCurtailment(
        enabled,
        enabled ? "Dashboard operator enabled local test curtailment" : "Dashboard operator restored local test exports"
      )).wait();
    });
  }

  async function anchorEpoch() {
    requireWallet();
    const epochId = BigInt(window.HeliosGrid.state.latestEpochId + 1);
    const root = window.ethers.hexlify(window.ethers.randomBytes(32));
    return transact("Sample telemetry epoch", async function () {
      return (await contracts.SmartMeterRegistry.anchorEpochTelemetry(
        epochId,
        root,
        window.ethers.parseEther("480.5"),
        window.ethers.parseEther("390.2")
      )).wait();
    });
  }

  window.HeliosGridChain = {
    initialize: async function () {
      try {
        await initializeReadOnly();
        setStatus("Hardhat local · #" + await readProvider.getBlockNumber(), true);
        return true;
      } catch (error) {
        activeMode = false;
        setStatus("Blockchain offline · demo mode", false);
        console.info("Local blockchain is not ready:", error.message);
        return false;
      }
    },
    isOnChain: function () { return activeMode; },
    connectWallet: connectWallet,
    submitOrder: function (side, quantity, price, durationHours) {
      return withErrorToast("Order", function () { return submitOrder(side, quantity, price, durationHours); });
    },
    executeAuction: function () { return withErrorToast("Auction", executeAuction); },
    updateBattery: function (direction) {
      return withErrorToast("Battery update", function () { return updateBattery(direction); });
    },
    toggleCurtailment: function (enabled) {
      return withErrorToast("Curtailment", function () { return toggleCurtailment(enabled); });
    },
    anchorEpoch: function () { return withErrorToast("Telemetry anchor", anchorEpoch); },
    refresh: refreshChainData
  };

  document.addEventListener("DOMContentLoaded", function () {
    document.getElementById("walletButton").addEventListener("click", function () {
      if (account) {
        notify("Connected wallet: " + account);
        return;
      }
      connectWallet().catch(function (error) {
        console.error("Wallet connection failed:", error);
        notify(getErrorMessage(error), "fa-circle-exclamation");
      });
    });
    window.HeliosGridChain.initialize();
  });
})();
