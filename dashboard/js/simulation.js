(function () {
  const state = window.HeliosGrid.state;
  const MIN_PRICE = 8;
  const MAX_PRICE = 45;
  const MAX_QUANTITY = 500;

  function validateOrder(quantityValue, priceValue) {
    const quantity = Number(quantityValue);
    const price = Number(priceValue);

    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > MAX_QUANTITY) {
      return { error: "Enter an energy amount greater than 0 and no more than 500 kWh." };
    }
    if (!Number.isFinite(price) || price < MIN_PRICE || price > MAX_PRICE) {
      return { error: "Price must be between ₨ 8 and ₨ 45 per kWh." };
    }
    return { quantity: quantity, price: price };
  }

  function createOrder(side, trader, quantityValue, priceValue) {
    const validated = validateOrder(quantityValue, priceValue);
    if (validated.error) return validated;

    const order = {
      id: state.nextOrderId++,
      trader: trader,
      quantity: validated.quantity,
      price: validated.price
    };
    (side === "sell" ? state.asks : state.bids).push(order);
    return { order: order };
  }

  function executeAuction() {
    if (state.curtailed) return { error: "Auction paused while emergency curtailment is active." };

    const asks = state.asks.slice().sort(function (a, b) { return a.price - b.price || a.id - b.id; });
    const bids = state.bids.slice().sort(function (a, b) { return b.price - a.price || a.id - b.id; });
    const trades = [];
    let askIndex = 0;
    let bidIndex = 0;

    while (askIndex < asks.length && bidIndex < bids.length) {
      const ask = asks[askIndex];
      const bid = bids[bidIndex];
      if (bid.price < ask.price) break;

      const quantity = Math.min(ask.quantity, bid.quantity);
      const trade = {
        id: "DEMO-" + String(state.nextTradeId++).padStart(3, "0"),
        time: new Date(),
        seller: ask.trader,
        buyer: bid.trader,
        quantity: quantity,
        price: (ask.price + bid.price) / 2
      };
      trades.push(trade);

      ask.quantity = Number((ask.quantity - quantity).toFixed(4));
      bid.quantity = Number((bid.quantity - quantity).toFixed(4));
      if (ask.quantity <= 0.0001) askIndex += 1;
      if (bid.quantity <= 0.0001) bidIndex += 1;
    }

    trades.forEach(function (trade) {
      state.trades.unshift(trade);
      state.asks = state.asks.filter(function (order) { return order.quantity > 0.0001; });
      state.bids = state.bids.filter(function (order) { return order.quantity > 0.0001; });
    });

    return { trades: trades };
  }

  function adjustBattery(direction) {
    const delta = direction === "charge" ? 5 : -5;
    if ((delta > 0 && state.batterySoc === 100) || (delta < 0 && state.batterySoc === 0)) {
      return { error: delta > 0 ? "Battery is already at its maximum charge." : "Battery is already empty." };
    }
    state.batterySoc = Math.max(0, Math.min(100, state.batterySoc + delta));
    return { soc: state.batterySoc };
  }

  function setCurtailment(enabled) {
    state.curtailed = Boolean(enabled);
    return state.curtailed;
  }

  window.HeliosGridSimulation = {
    createOrder: createOrder,
    executeAuction: executeAuction,
    adjustBattery: adjustBattery,
    setCurtailment: setCurtailment
  };
})();
