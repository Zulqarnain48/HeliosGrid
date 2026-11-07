(function () {
  const instances = new Map();
  const hours = ["00:00", "03:00", "06:00", "09:00", "12:00", "15:00", "18:00", "21:00"];
  const primary = "#2563eb";
  const green = "#15803d";
  const amber = "#b45309";

  function line(label, values, color, fill) {
    return {
      label: label,
      data: values,
      borderColor: color,
      backgroundColor: fill || color + "18",
      borderWidth: 2,
      pointRadius: 2,
      pointHoverRadius: 4,
      fill: Boolean(fill),
      tension: 0.35
    };
  }

  function chartOptions(unit) {
    return {
      responsive: true,
      maintainAspectRatio: true,
      interaction: { intersect: false, mode: "index" },
      plugins: {
        legend: { display: true, position: "bottom", labels: { usePointStyle: true, boxWidth: 7, padding: 16 } },
        tooltip: { callbacks: { label: function (context) { return " " + context.dataset.label + ": " + context.formattedValue + (unit || ""); } } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 8, color: "#64748b" } },
        y: { beginAtZero: true, grid: { color: "rgba(148, 163, 184, 0.18)" }, ticks: { color: "#64748b" } }
      }
    };
  }

  const chartDefinitions = {
    chartLoadProfile: {
      type: "line",
      data: { labels: hours, datasets: [line("Solar generation", [8, 5, 10, 52, 94, 78, 28, 10], green, "rgba(21,128,61,.12)"), line("Society load", [22, 18, 20, 34, 48, 54, 86, 62], primary)] },
      unit: " kW"
    },
    chartPriceHistory: {
      type: "line",
      data: { labels: hours, datasets: [line("Market price", [11.2, 10.8, 12.4, 13.1, 14.3, 13.7, 16.2, 14.8], amber)] },
      unit: " PKR"
    },
    chartMarketDepth: {
      type: "bar",
      data: { labels: ["12.50", "13.00", "13.50", "14.00", "14.50", "15.00", "15.50", "16.00"], datasets: [{ label: "Sell asks (kWh)", data: [45, 32, 25, 18, 0, 22, 0, 0], backgroundColor: "rgba(21,128,61,.65)" }, { label: "Buy bids (kWh)", data: [0, 0, 25, 15, 0, 40, 35, 20], backgroundColor: "rgba(37,99,235,.65)" }] },
      unit: " kWh"
    },
    chartGeneration: {
      type: "line",
      data: { labels: hours, datasets: [line("Generation", [0, 0, 4, 28, 46, 34, 8, 0], amber, "rgba(180,83,9,.12)")] },
      unit: " kWh"
    },
    chartConsumption: {
      type: "doughnut",
      data: { labels: ["P2P solar", "National grid"], datasets: [{ data: [21.2, 13.3], backgroundColor: [green, "#cbd5e1"], borderWidth: 0, hoverOffset: 5 }] },
      unit: " kWh"
    },
    chartBatterySoc: {
      type: "line",
      data: { labels: hours, datasets: [line("Battery SoC", [48, 42, 40, 55, 81, 92, 78, 73], green)] },
      unit: "%"
    },
    chartTelemetry: {
      type: "line",
      data: { labels: ["-60m", "-50m", "-40m", "-30m", "-20m", "-10m", "Now"], datasets: [line("Generation", [18, 22, 35, 48, 54, 42, 51], amber), line("Consumption", [34, 31, 39, 43, 46, 44, 49], primary)] },
      unit: " kW"
    }
  };

  ["sparkGen", "sparkTrades", "sparkPrice", "sparkBattery"].forEach(function (id, index) {
    const values = [
      [5, 8, 6, 12, 10, 16, 14, 20],
      [8, 10, 9, 14, 13, 16, 15, 19],
      [14, 12, 13, 11, 12, 10, 11, 9],
      [7, 8, 7, 10, 9, 12, 11, 14]
    ][index];
    chartDefinitions[id] = {
      type: "line",
      data: { labels: values.map(function (_, i) { return i; }), datasets: [{ data: values, borderColor: [green, primary, amber, green][index], borderWidth: 1.8, pointRadius: 0, tension: 0.4, fill: true, backgroundColor: [green, primary, amber, green][index] + "14" }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { enabled: false } }, scales: { x: { display: false }, y: { display: false } }, elements: { line: { capBezierPoints: true } } }
    };
  });

  function renderChart(id) {
    const canvas = document.getElementById(id);
    const definition = chartDefinitions[id];
    if (!canvas || !definition) return;

    if (!window.Chart) {
      let fallback = canvas.parentElement.querySelector(".chart-fallback");
      if (!fallback) {
        fallback = document.createElement("p");
        fallback.className = "chart-fallback";
        fallback.textContent = "Charts need an internet connection to load. Other dashboard features still work.";
        canvas.insertAdjacentElement("afterend", fallback);
      }
      return;
    }

    const existing = instances.get(id);
    if (existing) {
      existing.resize();
      return;
    }

    const options = definition.options || chartOptions(definition.unit);
    instances.set(id, new window.Chart(canvas.getContext("2d"), {
      type: definition.type,
      data: definition.data,
      options: options
    }));
  }

  window.renderChartsForPage = function (page) {
    const pageCharts = {
      dashboard: ["chartLoadProfile", "chartPriceHistory", "sparkGen", "sparkTrades", "sparkPrice", "sparkBattery"],
      orderbook: ["chartMarketDepth"],
      prosumer: ["chartGeneration"],
      consumer: ["chartConsumption"],
      battery: ["chartBatterySoc"],
      iot: ["chartTelemetry"]
    };
    (pageCharts[page] || []).forEach(renderChart);
  };

  window.updateMarketDepth = function (asks, bids) {
    const prices = Array.from(new Set(asks.concat(bids).map(function (order) {
      return order.price.toFixed(2);
    }))).sort(function (a, b) { return Number(a) - Number(b); });
    const askTotals = new Map();
    const bidTotals = new Map();
    asks.forEach(function (order) {
      const key = order.price.toFixed(2);
      askTotals.set(key, (askTotals.get(key) || 0) + order.quantity);
    });
    bids.forEach(function (order) {
      const key = order.price.toFixed(2);
      bidTotals.set(key, (bidTotals.get(key) || 0) + order.quantity);
    });

    const definition = chartDefinitions.chartMarketDepth;
    definition.data.labels = prices;
    definition.data.datasets[0].data = prices.map(function (price) { return askTotals.get(price) || 0; });
    definition.data.datasets[1].data = prices.map(function (price) { return bidTotals.get(price) || 0; });
    const chart = instances.get("chartMarketDepth");
    if (chart) chart.update();
  };
})();
