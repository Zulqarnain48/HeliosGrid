(function () {
  const state = {
    asks: [
      { id: 1, trader: "House-A7", price: 12.5, quantity: 45 },
      { id: 2, trader: "House-B3", price: 13, quantity: 32 },
      { id: 3, trader: "House-C1", price: 13.75, quantity: 28.5 },
      { id: 4, trader: "House-D9", price: 14.2, quantity: 18 },
      { id: 5, trader: "House-E5", price: 15, quantity: 22 }
    ],
    bids: [
      { id: 6, trader: "House-F2", price: 16, quantity: 20 },
      { id: 7, trader: "House-G8", price: 15.5, quantity: 35 },
      { id: 8, trader: "House-H4", price: 14.75, quantity: 40 },
      { id: 9, trader: "House-I6", price: 14, quantity: 15 },
      { id: 10, trader: "House-J1", price: 13.5, quantity: 25 }
    ],
    trades: [
      { id: "DEMO-024", time: new Date(Date.now() - 4 * 60000), seller: "House-A7", buyer: "House-F2", quantity: 12, price: 14.25 },
      { id: "DEMO-023", time: new Date(Date.now() - 11 * 60000), seller: "House-C1", buyer: "House-H4", quantity: 8.5, price: 14.25 },
      { id: "DEMO-022", time: new Date(Date.now() - 19 * 60000), seller: "House-B3", buyer: "House-G8", quantity: 10, price: 14.25 }
    ],
    batterySoc: 73,
    batteryStoredKWh: 182.5,
    batteryCapacityKWh: 250,
    curtailed: false,
    nextOrderId: 11,
    nextTradeId: 25,
    registeredMeters: []
  };

  const meters = [
    { id: "MTR-001", home: "House-A7", role: "Prosumer", generation: 18.4, consumption: 7.2, status: "Online" },
    { id: "MTR-002", home: "House-B3", role: "Prosumer", generation: 15.8, consumption: 8.1, status: "Online" },
    { id: "MTR-003", home: "House-C1", role: "Prosumer", generation: 12.6, consumption: 6.4, status: "Online" },
    { id: "MTR-004", home: "House-F2", role: "Consumer", generation: 0, consumption: 9.7, status: "Online" },
    { id: "MTR-005", home: "House-G8", role: "Consumer", generation: 0, consumption: 11.2, status: "Online" },
    { id: "MTR-006", home: "House-H4", role: "Consumer", generation: 0, consumption: 8.9, status: "Syncing" }
  ];

  window.HeliosGrid = { state: state, meters: meters };
})();
