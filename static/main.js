/* main.js - frontend logic for stock dashboard
   Expects backend routes:
    - GET /api/search?q=
    - GET /api/history/<SYMBOL>?period=&interval=
    - GET /api/predict/<SYMBOL>
    - POST /api/sentiment
    - GET /api/compare?left=&right=&period=
*/

/* NOTE: removed the invalid import that caused a syntax error:
   import { Chart } from "@/components/ui/chart"
   Chart.js is loaded from CDN and available as global Chart.
*/

const $ = (id) => document.getElementById(id)
let selectedTicker = null
let priceChart, rsiChart, macdChart

function fmt(n, d = 2) {
  return n === null || n === undefined ? "—" : Number(n).toLocaleString(undefined, { maximumFractionDigits: d })
}

function showSuggestions(items) {
  const box = $("suggestions")
  if (!box) return
  box.innerHTML = ""
  if (!items || items.length === 0) {
    box.style.display = "none"
    return
  }
  items.forEach((it) => {
    const b = document.createElement("button")
    b.innerHTML = `<div style="text-align:left"><strong style="color:#fff">${it.symbol}</strong> <span class="meta">${it.name}</span></div>`
    b.addEventListener("click", () => {
      const s = $("search")
      if (s) s.value = it.symbol
      selectedTicker = it.symbol
      box.style.display = "none"
      fetchTicker(it.symbol)
    })
    box.appendChild(b)
  })
  box.style.display = "block"
}

/* search/autocomplete */
let searchTimer = null
const searchInput = $("search")
if (searchInput) {
  searchInput.addEventListener("input", (e) => {
    const q = e.target.value.trim()
    if (searchTimer) clearTimeout(searchTimer)
    if (!q) {
      const suggestionsEl = $("suggestions")
      if (suggestionsEl) suggestionsEl.style.display = "none"
      return
    }
    searchTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&max=8`)
        const data = await res.json()
        showSuggestions(data)
      } catch (err) {
        console.error(err)
        const suggestionsEl = $("suggestions")
        if (suggestionsEl) suggestionsEl.style.display = "none"
      }
    }, 240)
  })

  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault()
      const t = e.target.value.trim()
      if (t) fetchTicker(t)
    }
  })
}

/* fetch ticker data */
async function fetchTicker(symbol) {
  selectedTicker = symbol.toUpperCase()
  const elTicker = $("k_ticker"), elClose = $("k_close"), elPred = $("k_pred"), elConf = $("k_conf")
  if (elTicker) elTicker.textContent = selectedTicker
  if (elClose) elClose.textContent = "..."
  if (elPred) elPred.textContent = "..."
  if (elConf) elConf.textContent = "..."
  try {
    const period = $("period") ? $("period").value : "1y"
    const interval = $("interval") ? $("interval").value : "1d"
    const hRes = await fetch(`/api/history/${selectedTicker}?period=${period}&interval=${interval}`)
    const hData = await hRes.json()
    if (hRes.status !== 200) {
      alert("History error: " + (hData.error || JSON.stringify(hData)))
      console.error('history error', hData)
      return
    }
    const hist = hData.history || []
    if (!hist.length) {
      alert("No history returned")
      return
    }

    const dates = hist.map((r) => r.date)
    const close = hist.map((r) => r.Close)
    const sma7 = hist.map((r) => r.sma7)
    const sma30 = hist.map((r) => r.sma30)
    const ema20 = hist.map((r) => r.ema20)
    const bb_high = hist.map((r) => r.bb_high)
    const bb_low = hist.map((r) => r.bb_low)
    const rsi = hist.map((r) => r.rsi)
    const macd = hist.map((r) => r.macd)
    const macd_signal = hist.map((r) => r.macd_signal)

    if (elClose) elClose.textContent = fmt(close[close.length - 1], 2)

    const pRes = await fetch(`/api/predict/${selectedTicker}?period=2y&interval=1d`)
    const pData = await pRes.json()
    if (pRes.ok) {
      if (elPred) elPred.textContent = fmt(pData.predicted_close, 2)
      if (elConf) elConf.textContent = (Math.round(pData.confidence * 100) / 100).toFixed(2) + "%"
    } else {
      if (elPred) elPred.textContent = "n/a"
      if (elConf) elConf.textContent = "n/a"
    }

    drawPriceChart(dates, close, sma7, sma30, ema20, bb_high, bb_low)
    drawRsiChart(dates, rsi)
    drawMacdChart(dates, macd, macd_signal)
  } catch (err) {
    console.error(err)
    alert("Failed to fetch ticker data. See console.")
  }
}

/* Charting helpers */
function createOrReplaceChart(canvasId, cfg) {
  const canvas = document.getElementById(canvasId)
  if (!canvas) return null
  const ctx = canvas.getContext("2d")
  if (canvasId === "priceChart" && priceChart) {
    try { priceChart.destroy() } catch (e) {}
  }
  if (canvasId === "rsiChart" && rsiChart) {
    try { rsiChart.destroy() } catch (e) {}
  }
  if (canvasId === "macdChart" && macdChart) {
    try { macdChart.destroy() } catch (e) {}
  }
  return new Chart(ctx, cfg)
}

/* ... keep the rest of charting functions the same as your original code ... */
/* For brevity, copy the drawPriceChart, drawRsiChart and drawMacdChart functions exactly
   from your previous main.js (they were fine once import removed). */

function drawPriceChart(labels, close, sma7, sma30, ema20, bb_high, bb_low) {
  const maxTicksLimit = Math.min(12, Math.max(4, Math.floor(labels.length / 2)))
  const step = Math.max(1, Math.ceil(labels.length / maxTicksLimit))

  function formatTickLabel(value, index) {
    const d = new Date(value)
    if (isNaN(d.getTime())) return value
    const years = new Set(labels.map((l) => new Date(l).getFullYear()))
    const showYear = index === 0 || (years.size > 1 && d.getMonth() === 0 && d.getDate() === 1)
    const opts = { month: "short", day: "numeric" }
    if (showYear) opts.year = "numeric"
    return d.toLocaleDateString(undefined, opts)
  }

  const cfg = {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        { label: "Close", data: close, borderWidth: 2, pointRadius: 0, borderColor: "#60a5fa", tension: 0.15, fill: false, yAxisID: "y" },
        { label: "SMA7", data: sma7, borderWidth: 1, pointRadius: 0, borderColor: "#22d3ee", tension: 0.12, fill: false, yAxisID: "y" },
        { label: "SMA30", data: sma30, borderWidth: 1, pointRadius: 0, borderColor: "#10b981", tension: 0.12, fill: false, yAxisID: "y" },
        { label: "EMA20", data: ema20, borderWidth: 1, pointRadius: 0, borderColor: "#8b5cf6", tension: 0.12, fill: false, yAxisID: "y" },
        { label: "BB High", data: bb_high, borderWidth: 0.5, pointRadius: 0, borderColor: "rgba(96,165,250,0.3)", borderDash: [4, 6], fill: false, yAxisID: "y" },
        { label: "BB Low", data: bb_low, borderWidth: 0.5, pointRadius: 0, borderColor: "rgba(96,165,250,0.3)", borderDash: [4, 6], fill: "+1", yAxisID: "y" },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      layout: { padding: { left: 8, right: 8, top: 6, bottom: 6 } },
      scales: {
        y: { position: "left", ticks: { color: "#94a3b8" }, grid: { color: "rgba(255,255,255,0.03)" } },
        x: {
          ticks: {
            color: "#64748b",
            maxRotation: 45,
            minRotation: 0,
            autoSkip: false,
            callback: function (val, index) {
              if (index % step !== 0) return ""
              return formatTickLabel(this.getLabelForValue(val), index)
            },
            font: { size: 11 },
          },
          grid: { display: false },
        },
      },
      plugins: { legend: { display: true, labels: { color: "#94a3b8", boxWidth: 12, padding: 12 } }, tooltip: { mode: "index", intersect: false } },
    },
  }

  priceChart = createOrReplaceChart("priceChart", cfg)
  setTimeout(() => {
    try { priceChart.resize() } catch (e) {}
  }, 50)
}

function drawRsiChart(labels, rsi) {
  const cfg = {
    type: "line",
    data: { labels, datasets: [{ label: "RSI", data: rsi, borderColor: "#fbbf24", borderWidth: 1, pointRadius: 0, tension: 0.15 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { x: { display: false }, y: { ticks: { color: "#94a3b8" }, suggestedMax: 100, suggestedMin: 0, grid: { color: "rgba(255,255,255,0.03)" } } },
      plugins: { legend: { display: false }, tooltip: { enabled: true } },
    },
  }
  rsiChart = createOrReplaceChart("rsiChart", cfg)
  const latest = rsi.filter((x) => x !== null && x !== undefined).slice(-1)[0]
  const rsiValEl = $("rsiVal")
  if (rsiValEl) rsiValEl.textContent = latest ? latest.toFixed(2) : "—"
}

function drawMacdChart(labels, macd, macd_signal) {
  const cfg = {
    type: "bar",
    data: { labels, datasets: [ { type: "line", label: "MACD", data: macd, borderColor: "#60a5fa", borderWidth: 1, pointRadius: 0, tension: 0.15, yAxisID: "y" }, { type: "line", label: "Signal", data: macd_signal, borderColor: "#22d3ee", borderWidth: 1, pointRadius: 0, tension: 0.15, yAxisID: "y" } ] },
    options: { responsive: true, maintainAspectRatio: false, scales: { x: { display: false }, y: { ticks: { color: "#94a3b8" }, grid: { color: "rgba(255,255,255,0.03)" } } }, plugins: { legend: { display: false } } },
  }
  macdChart = createOrReplaceChart("macdChart", cfg)
  const latest = macd.filter((x) => x !== null && x !== undefined).slice(-1)[0]
  const macdValEl = $("macdVal")
  if (macdValEl) macdValEl.textContent = latest ? latest.toFixed(4) : "—"
}

/* buttons */
const btnFetch = $("btnFetch")
if (btnFetch) {
  btnFetch.addEventListener("click", () => {
    const t = $("search") ? $("search").value.trim() : ""
    if (!t) return alert("Type a ticker or pick a suggestion.")
    fetchTicker(t)
  })
}

const btnCompare = $("btnCompare")
if (btnCompare) {
  btnCompare.addEventListener("click", async () => {
    const left = selectedTicker
    const right = $("compareTicker") ? $("compareTicker").value.trim().toUpperCase() : ""
    if (!left || !right) {
      alert("Choose main ticker and comparison ticker")
      return
    }
    try {
      const period = $("period") ? $("period").value : "1y"
      const res = await fetch(`/api/compare?left=${left}&right=${right}&period=${period}`)
      const data = await res.json()
      if (!res.ok) {
        alert(data.error || "Compare failed")
        return
      }
      const l = data.left.summary
      const r = data.right.summary
      const el = $("compareResult")
      if (el) el.innerHTML = `<div><strong>${left}</strong> ${fmt(l.pct_change, 2)}% vs <strong>${right}</strong> ${fmt(r.pct_change, 2)}%</div>`
    } catch (err) {
      console.error(err)
      alert("Compare failed")
    }
  })
}

/* sentiment */
const btnSent = $("btnSent")
if (btnSent) {
  btnSent.addEventListener("click", async () => {
    const text = $("sentInput") ? $("sentInput").value.trim() : ""
    if (!text) return alert("Paste some headlines/tweets (one per line).")
    const lines = text.split("\n").map((s) => s.trim()).filter(Boolean)
    try {
      const sentResultEl = $("sentResult")
      if (sentResultEl) sentResultEl.innerHTML = 'Analyzing <span class="loader"></span>'
      const res = await fetch("/api/sentiment", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ headlines: lines }) })
      const data = await res.json()
      if (!res.ok) {
        if (sentResultEl) sentResultEl.textContent = data.error || "Analysis failed"
        return
      }
      const label = data.sentiment_label
      const score = (data.overall_compound || 0).toFixed(3)
      if (sentResultEl) sentResultEl.innerHTML = `<div><strong style="color:${label === "positive" ? "#10b981" : label === "negative" ? "#ef4444" : "#94a3b8"}">${label.toUpperCase()}</strong> — score ${score}</div>
        <div class="card-subtitle" style="margin-top:6px">Headlines: ${data.headline?.count || 0} • Tweets: ${data.tweets?.count || 0} • Announcements: ${data.announcements?.count || 0}</div>`
    } catch (err) {
      console.error(err)
      const sentResultEl = $("sentResult")
      if (sentResultEl) sentResultEl.textContent = "Failed to analyze"
    }
  })
}

const btnClear = $("btnClear")
if (btnClear) {
  btnClear.addEventListener("click", () => {
    const si = $("sentInput")
    if (si) si.value = ""
    const sr = $("sentResult")
    if (sr) sr.innerHTML = ""
  })
}

window.addEventListener("load", () => {
  ;(async () => {
    try {
      await fetch("/api/search?q=goog&max=6")
    } catch (e) {}
  })()
})
