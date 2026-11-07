(function () {
  const state = window.HeliosGrid.state;
  const simulation = window.HeliosGridSimulation;
  const currency = new Intl.NumberFormat("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  let toastTimer;

  function formatPrice(value) {
    return (window.HeliosGridChain && window.HeliosGridChain.isOnChain() ? "" : "₨ ") +
      currency.format(value) +
      (window.HeliosGridChain && window.HeliosGridChain.isOnChain() ? " SCT" : "");
  }

  function addCell(row, value, className) {
    const cell = document.createElement("td");
    cell.textContent = value;
    if (className) cell.className = className;
    row.appendChild(cell);
    return cell;
  }

  function renderOrders() {
    [
      { id: "asksList", orders: state.asks, side: "ask" },
      { id: "bidsList", orders: state.bids, side: "bid" }
    ].forEach(function (group) {
      const container = document.getElementById(group.id);
      container.replaceChildren();
      const orders = group.orders.slice().sort(function (a, b) {
        return group.side === "ask" ? a.price - b.price : b.price - a.price;
      });

      if (!orders.length) {
        const empty = document.createElement("div");
        empty.className = "empty-state order-empty";
        empty.textContent = "No open " + (group.side === "ask" ? "sell asks" : "buy bids") + ".";
        container.appendChild(empty);
        return;
      }

      orders.forEach(function (order) {
        const row = document.createElement("div");
        row.className = "order-row " + group.side + "-row";
        const trader = document.createElement("span");
        trader.textContent = order.trader;
        const price = document.createElement("span");
        price.className = "price";
        price.textContent = formatPrice(order.price);
        const quantity = document.createElement("span");
        quantity.textContent = order.quantity.toFixed(1) + " kWh";
        const tag = document.createElement("span");
        tag.className = "tag " + (order.status === "Partially filled" ? "tag--amber" : (group.side === "ask" ? "tag--green" : "tag--blue"));
        tag.textContent = order.status || "Open";
        row.append(trader, price, quantity, tag);
        container.appendChild(row);
      });
    });

    const count = document.getElementById("orderCount");
    if (count) count.textContent = String(state.asks.length + state.bids.length);
    window.updateMarketDepth(state.asks, state.bids);
  }

  function renderTrades() {
    const recentBody = document.getElementById("recentTradesBody");
    const historyBody = document.getElementById("tradeHistoryBody");
    recentBody.replaceChildren();
    historyBody.replaceChildren();

    state.trades.slice(0, 8).forEach(function (trade) {
      const recentRow = document.createElement("tr");
      addCell(recentRow, trade.time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
      addCell(recentRow, trade.seller);
      addCell(recentRow, trade.buyer);
      addCell(recentRow, trade.quantity.toFixed(1));
      addCell(recentRow, formatPrice(trade.price));
      const recentStatus = addCell(recentRow, "");
      const recentTag = document.createElement("span");
      recentTag.className = "tag tag--green";
      recentTag.textContent = "Settled";
      recentStatus.appendChild(recentTag);
      recentBody.appendChild(recentRow);

      const historyRow = document.createElement("tr");
      addCell(historyRow, trade.id);
      addCell(historyRow, trade.seller + " → " + trade.buyer);
      addCell(historyRow, trade.quantity.toFixed(1));
      addCell(historyRow, formatPrice(trade.price));
      addCell(historyRow, formatPrice(trade.wheelingFee !== undefined ? trade.wheelingFee : trade.quantity * trade.price * 0.03));
      addCell(historyRow, formatPrice(trade.netAmount !== undefined ? trade.netAmount : trade.quantity * trade.price * 0.96));
      const historyStatus = addCell(historyRow, "");
      const historyTag = document.createElement("span");
      historyTag.className = "tag tag--green";
      historyTag.textContent = window.HeliosGridChain && window.HeliosGridChain.isOnChain() ? "On-chain" : "Demo";
      historyStatus.appendChild(historyTag);
      historyBody.appendChild(historyRow);
    });
  }

  function renderMeters() {
    const grid = document.getElementById("meterGrid");
    grid.replaceChildren();
    window.HeliosGrid.meters.forEach(function (meter) {
      const card = document.createElement("article");
      card.className = "meter-card";
      const header = document.createElement("div");
      header.className = "meter-card-header";
      const title = document.createElement("strong");
      title.textContent = meter.home;
      const status = document.createElement("span");
      status.className = "tag " + (meter.status === "Online" ? "tag--green" : "tag--amber");
      status.textContent = meter.status;
      header.append(title, status);

      const body = document.createElement("div");
      body.className = "meter-card-body";
      const idLine = document.createElement("div");
      idLine.className = "meter-reading";
      idLine.innerHTML = '<span class="label">Meter ID</span><span class="value"></span>';
      idLine.querySelector(".value").textContent = meter.id;
      body.appendChild(idLine);
      [
        ["Account type", meter.role],
        ["Generation", meter.generation.toFixed(1) + " kWh"],
        ["Consumption", meter.consumption.toFixed(1) + " kWh"]
      ].forEach(function (reading) {
        const line = document.createElement("div");
        line.className = "meter-reading";
        const label = document.createElement("span");
        label.className = "label";
        label.textContent = reading[0];
        const value = document.createElement("span");
        value.className = "value";
        value.textContent = reading[1];
        line.append(label, value);
        body.appendChild(line);
      });
      card.append(header, body);
      grid.appendChild(card);
    });
  }

  function renderBattery() {
    const soc = state.batterySoc;
    document.getElementById("batteryLevel").style.height = soc + "%";
    document.getElementById("batteryPercent").textContent = soc + "%";
    document.getElementById("batteryChargeReading").textContent =
      (state.batteryStoredKWh !== undefined ? state.batteryStoredKWh : soc * 2.5).toFixed(1) + " kWh";
    document.getElementById("batteryCapacityReading").textContent =
      (state.batteryCapacityKWh || 250) + " kWh (LFP)";
    document.getElementById("batteryMetricSub").textContent =
      (state.batteryCapacityKWh || 250) + " kWh community BESS";
    document.getElementById("statBattery").textContent = soc + "%";
    document.getElementById("svgBatterySoc").textContent = "SoC: " + soc + "%";
    const level = document.getElementById("batteryLevel");
    level.classList.toggle("low", soc < 25);
    level.classList.toggle("mid", soc >= 25 && soc < 50);
  }

  function renderCurtailment() {
    const stat = document.getElementById("statCurtail");
    const badge = document.getElementById("curtailBadge");
    stat.textContent = state.curtailed ? "ON" : "OFF";
    stat.style.color = state.curtailed ? "var(--red)" : "var(--green)";
    const sub = stat.parentElement.querySelector(".stat-sub");
    if (sub) sub.textContent = "Emergency status: " + (state.curtailed ? "Curtailment active" : "Normal");
    badge.textContent = state.curtailed ? "Curtailment active" : "Normal";
    badge.className = "tag " + (state.curtailed ? "tag--red" : "tag--green");
  }

  function logEvent(type, message, tone) {
    const terminal = document.getElementById("terminalBody");
    if (!terminal) return;
    const line = document.createElement("div");
    line.className = "terminal-line";
    const time = document.createElement("span");
    time.className = "timestamp";
    time.textContent = "[" + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) + "] ";
    const eventType = document.createElement("span");
    eventType.className = "event-type" + (tone ? " " + tone : "");
    eventType.textContent = type + " ";
    const detail = document.createElement("span");
    detail.textContent = message;
    line.append(time, eventType, detail);
    terminal.appendChild(line);
    terminal.scrollTop = terminal.scrollHeight;
  }

  function showToast(message, icon) {
    const existing = document.querySelector(".toast");
    if (existing) existing.remove();
    window.clearTimeout(toastTimer);

    const toast = document.createElement("div");
    toast.className = "toast";
    toast.setAttribute("role", "status");
    const symbol = document.createElement("i");
    symbol.className = "fas " + (icon || "fa-circle-check");
    symbol.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.textContent = message;
    toast.append(symbol, text);
    document.body.appendChild(toast);
    toastTimer = window.setTimeout(function () {
      toast.classList.add("hiding");
      window.setTimeout(function () { toast.remove(); }, 260);
    }, 3200);
  }

  function refreshView() {
    if (window.HeliosGridChain && window.HeliosGridChain.isOnChain()) {
      window.HeliosGridChain.refresh().then(function () {
        logEvent("CHAIN", "Dashboard refreshed from the local Hardhat blockchain.");
        showToast("On-chain dashboard refreshed");
      }).catch(function (error) {
        console.error("Could not refresh on-chain data:", error);
        showToast("Could not refresh blockchain data: " + error.message, "fa-circle-exclamation");
      });
      return;
    }
    document.getElementById("lastUpdated").textContent = "Viewed " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    window.renderChartsForPage(document.querySelector(".nav-item.active").dataset.page);
    logEvent("DEMO", "Dashboard view refreshed; displayed values are sample data.");
    showToast("Demo dashboard refreshed");
  }

  function postOrder(side) {
    const quantityInput = document.getElementById(side === "sell" ? "sellKwh" : "buyKwh");
    const priceInput = document.getElementById(side === "sell" ? "sellPrice" : "buyPrice");
    if (window.HeliosGridChain && window.HeliosGridChain.isOnChain()) {
      const expiry = document.getElementById(side === "sell" ? "sellExpiry" : "buyExpiry");
      window.HeliosGridChain.submitOrder(side, quantityInput.value, priceInput.value, expiry.value)
        .then(function () { logEvent("CHAIN", side + " order confirmed on-chain."); })
        .catch(function (error) { console.error("On-chain order failed:", error); });
      return;
    }
    const result = simulation.createOrder(side, "Your account", quantityInput.value, priceInput.value);
    if (result.error) {
      showToast(result.error, "fa-circle-exclamation");
      (result.error.includes("amount") ? quantityInput : priceInput).focus();
      return;
    }

    renderOrders();
    const action = side === "sell" ? "Sell ask" : "Buy bid";
    logEvent("ORDER", action + " posted for " + result.order.quantity.toFixed(1) + " kWh at " + formatPrice(result.order.price) + ".");
    showToast(action + " added to the demo order book");
  }

  function executeAuctionFromUI() {
    if (window.HeliosGridChain && window.HeliosGridChain.isOnChain()) {
      window.HeliosGridChain.executeAuction()
        .then(function (matches) { logEvent("CHAIN", matches + " auction match(es) confirmed on-chain."); })
        .catch(function (error) { console.error("On-chain auction failed:", error); });
      return;
    }
    const result = simulation.executeAuction();
    if (result.error) {
      showToast(result.error, "fa-circle-exclamation");
      return;
    }
    if (!result.trades.length) {
      showToast("No compatible bids and asks to match.", "fa-circle-info");
      return;
    }

    renderOrders();
    renderTrades();
    result.trades.forEach(function (trade) {
      logEvent("TRADE", trade.quantity.toFixed(1) + " kWh settled at " + formatPrice(trade.price) + " — " + trade.seller + " to " + trade.buyer + ".");
    });
    showToast(result.trades.length + " demo trade" + (result.trades.length === 1 ? "" : "s") + " matched");
  }

  function updateThemeButton(isDark) {
    const button = document.getElementById("themeToggle");
    button.innerHTML = '<i class="fas ' + (isDark ? "fa-sun" : "fa-moon") + '" aria-hidden="true"></i>';
    button.setAttribute("aria-label", isDark ? "Switch to light theme" : "Switch to dark theme");
  }

  function exportTrades() {
    const rows = [["Trade ID", "Time", "Seller", "Buyer", "Energy kWh", "Price PKR per kWh"]];
    state.trades.forEach(function (trade) {
      rows.push([trade.id, trade.time.toISOString(), trade.seller, trade.buyer, trade.quantity, trade.price]);
    });
    const csv = rows.map(function (row) {
      return row.map(function (cell) { return '"' + String(cell).replace(/"/g, '""') + '"'; }).join(",");
    }).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "heliosgrid-demo-trades.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    showToast("Demo trade history exported as CSV");
  }

  window.showToast = showToast;
  window.switchPage = function (page) {
    const section = document.getElementById("page-" + page);
    if (!section) return;
    document.querySelectorAll(".page-section").forEach(function (item) { item.classList.toggle("active", item === section); });
    document.querySelectorAll(".nav-item").forEach(function (item) {
      const active = item.dataset.page === page;
      item.classList.toggle("active", active);
      if (active) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });
    window.renderChartsForPage(page);
    document.querySelector(".main-content").scrollTop = 0;
  };
  window.refreshData = refreshView;
  window.postSellOrder = function () { postOrder("sell"); };
  window.postBuyOrder = function () { postOrder("buy"); };
  window.executeAuction = executeAuctionFromUI;
  window.chargeBattery = function () {
    if (window.HeliosGridChain && window.HeliosGridChain.isOnChain()) {
      window.HeliosGridChain.updateBattery("charge")
        .then(function () { logEvent("CHAIN", "Community battery charge confirmed on-chain."); })
        .catch(function (error) { console.error("On-chain battery charge failed:", error); });
      return;
    }
    const result = simulation.adjustBattery("charge");
    if (result.error) return showToast(result.error, "fa-circle-exclamation");
    renderBattery();
    logEvent("BATTERY", "Demo battery charged to " + result.soc + "%.");
    showToast("Demo battery charged to " + result.soc + "%");
  };
  window.dischargeBattery = function () {
    if (window.HeliosGridChain && window.HeliosGridChain.isOnChain()) {
      window.HeliosGridChain.updateBattery("discharge")
        .then(function () { logEvent("CHAIN", "Community battery discharge confirmed on-chain."); })
        .catch(function (error) { console.error("On-chain battery discharge failed:", error); });
      return;
    }
    const result = simulation.adjustBattery("discharge");
    if (result.error) return showToast(result.error, "fa-circle-exclamation");
    renderBattery();
    logEvent("BATTERY", "Demo battery discharged to " + result.soc + "%.");
    showToast("Demo battery discharged to " + result.soc + "%");
  };
  window.anchorEpoch = function () {
    if (window.HeliosGridChain && window.HeliosGridChain.isOnChain()) {
      window.HeliosGridChain.anchorEpoch()
        .then(function () { logEvent("CHAIN", "Sample telemetry epoch anchored on-chain."); })
        .catch(function (error) { console.error("On-chain telemetry anchor failed:", error); });
      return;
    }
    const epoch = "EPOCH-" + new Date().toISOString().replace(/\D/g, "").slice(0, 14);
    logEvent("EPOCH", epoch + " prepared for " + window.HeliosGrid.meters.length + " sample meters. Not submitted on-chain.");
    showToast("Sample meter epoch recorded locally");
  };
  window.toggleCurtailment = function (enabled) {
    if (window.HeliosGridChain && window.HeliosGridChain.isOnChain()) {
      window.HeliosGridChain.toggleCurtailment(enabled)
        .then(function () { logEvent("CHAIN", "Grid curtailment update confirmed on-chain."); })
        .catch(function (error) { console.error("On-chain curtailment update failed:", error); });
      return;
    }
    const active = simulation.setCurtailment(enabled);
    renderCurtailment();
    logEvent("GRID", active ? "Demo emergency curtailment enabled; auction matching is paused." : "Demo emergency curtailment disabled.");
    showToast(active ? "Demo curtailment enabled" : "Demo curtailment disabled");
  };
  window.clearTerminal = function () {
    document.getElementById("terminalBody").replaceChildren();
    logEvent("SYSTEM", "Demo event log cleared.");
    showToast("Demo event log cleared");
  };

  window.HeliosGridUI = {
    logChainEvent: function (type, message) {
      logEvent(type, message);
    },
    onChainDataChanged: function () {
      renderOrders();
      renderTrades();
      renderMeters();
      renderBattery();
      renderCurtailment();

      const chainState = window.HeliosGrid.state;
      document.getElementById("generationMetricLabel").textContent = "Energy Traded";
      document.getElementById("statGeneration").textContent = chainState.totalEnergyTradedKWh.toFixed(2);
      document.getElementById("generationMetricSub").textContent = "kWh settled by local contracts";
      document.getElementById("tradesMetricLabel").textContent = "Settled Trades";
      document.getElementById("statTrades").textContent = String(chainState.nextTradeId - 1);
      document.getElementById("tradesMetricSub").textContent = "all-time contract total";
      document.getElementById("priceMetricLabel").textContent = "FiT Floor";
      document.getElementById("statPrice").textContent = chainState.tariff.floor.toFixed(2);
      document.getElementById("priceMetricSub").textContent = "SCT/kWh · ceiling " + chainState.tariff.ceiling.toFixed(2);
      document.getElementById("metersMetricLabel").textContent = "Registered Meters";
      document.getElementById("statMeters").textContent = String(chainState.totalMeters);
      document.getElementById("metersMetricSub").textContent = "registered on this local chain";
      document.getElementById("meterCount").textContent = String(chainState.totalMeters);
      document.getElementById("fitFloorDisplay").textContent = chainState.tariff.floor.toFixed(2) + " SCT/kWh";
      document.getElementById("retailCeilingDisplay").textContent = chainState.tariff.ceiling.toFixed(2) + " SCT/kWh";
      document.getElementById("wheelingFeeDisplay").textContent = chainState.tariff.wheelingPercent + "%";
      document.getElementById("scadaWheeling").textContent = chainState.tariff.wheelingPercent.toFixed(1) + "%";
      document.getElementById("scadaTax").textContent = chainState.tariff.taxPercent.toFixed(1) + "%";
      document.getElementById("scadaFitFloor").textContent = chainState.tariff.floor.toFixed(2) + " SCT";
      document.getElementById("scadaRetailCeiling").textContent = chainState.tariff.ceiling.toFixed(2) + " SCT";
      document.getElementById("sellPrice").min = String(chainState.tariff.floor);
      document.getElementById("sellPrice").max = String(chainState.tariff.ceiling);
      document.getElementById("buyPrice").min = String(chainState.tariff.floor);
      document.getElementById("buyPrice").max = String(chainState.tariff.ceiling);
      document.getElementById("eventStreamTitle").textContent = "heliosgrid-local-chain — chain ID 31337";

      const historyBadge = document.getElementById("tradeHistoryBadge");
      if (historyBadge) {
        historyBadge.className = "tag tag--blue";
        historyBadge.textContent = chainState.trades.length + " on-chain";
      }
      const recentTradesBadge = document.getElementById("recentTradesBadge");
      if (recentTradesBadge) {
        recentTradesBadge.className = "tag tag--green";
        recentTradesBadge.textContent = "On-chain";
      }
      document.getElementById("page-dashboard").querySelector(".page-header p").textContent =
        "Local Hardhat chain — contract-backed trading, tariff, battery, and meter registry data";
      document.getElementById("page-events").querySelector(".page-header p").textContent =
        "Contract events from the local Hardhat deployment";

      window.HeliosGrid.meters = (window.HeliosGridChain && window.HeliosGridChain.localAccounts) || window.HeliosGrid.meters;
    }
  };

  document.addEventListener("DOMContentLoaded", function () {
    document.querySelectorAll(".nav-item").forEach(function (item) {
      item.setAttribute("role", "button");
      item.setAttribute("tabindex", "0");
      item.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          window.switchPage(item.dataset.page);
        }
      });
    });
    document.getElementById("exportTradesButton").addEventListener("click", exportTrades);
    document.getElementById("themeToggle").addEventListener("click", function () {
      const dark = document.documentElement.dataset.theme !== "dark";
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      updateThemeButton(dark);
    });
    renderOrders();
    renderTrades();
    renderMeters();
    renderBattery();
    renderCurtailment();
    window.renderChartsForPage("dashboard");
  });
})();
