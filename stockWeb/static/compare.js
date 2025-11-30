// static/compare.js (fixed to match compare.html IDs + small improvements)

const $c = id => document.getElementById(id);
function fmt(n, d = 2) { return n === null || n === undefined ? "—" : Number(n).toLocaleString(undefined, { maximumFractionDigits: d }); }

function showSuggestionsFor(boxId, items, inputId) {
  const box = $c(boxId); if (!box) return;
  box.innerHTML = ''
  if (!items || items.length === 0) { box.style.display = 'none'; return; }
  items.forEach(it => {
    const btn = document.createElement('button')
    btn.style.width = '100%'; btn.style.background = 'transparent'; btn.style.border = 'none';
    btn.style.padding = '10px'; btn.style.textAlign = 'left'; btn.style.color = 'var(--text-secondary)'; btn.style.cursor = 'pointer'
    btn.innerHTML = `<strong style="color:var(--text-primary)">${it.symbol}</strong> <div class="meta" style="font-size:12px;color:var(--text-muted)">${it.name}</div>`
    btn.addEventListener('click', () => { const input = $c(inputId); if (input) input.value = it.symbol; box.style.display = 'none' })
    box.appendChild(btn)
  })
  box.style.display = 'block'
}
function debounce(fn, ms = 220) { let t; return (...args) => { if (t) clearTimeout(t); t = setTimeout(() => fn(...args), ms) } }

async function fetchSuggestions(q, boxId, inputId) {
  if (!q || q.trim().length === 0) { const box = $c(boxId); if (box) box.style.display = 'none'; return; }
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&max=8`);
    const data = await res.json();
    showSuggestionsFor(boxId, data, inputId);
  } catch (err) {
    console.error(err);
    const box = $c(boxId); if (box) box.style.display = 'none';
  }
}

const leftInput = $c('leftSearch'), rightInput = $c('rightSearch');
if (leftInput) leftInput.addEventListener('input', debounce((e) => fetchSuggestions(e.target.value, 'leftSuggestions', 'leftSearch')));
if (rightInput) rightInput.addEventListener('input', debounce((e) => fetchSuggestions(e.target.value, 'rightSuggestions', 'rightSearch')));

document.addEventListener('click', (ev) => {
  const leftBox = $c('leftSuggestions'), rightBox = $c('rightSuggestions')
  if (leftBox && !leftBox.contains(ev.target) && ev.target !== leftInput) leftBox.style.display = 'none'
  if (rightBox && !rightBox.contains(ev.target) && ev.target !== rightInput) rightBox.style.display = 'none'
})

async function fetchHistory(symbol, period = '1y', interval = '1d') {
  const res = await fetch(`/api/history/${encodeURIComponent(symbol)}?period=${period}&interval=${interval}`)
  if (!res.ok) { const err = await res.json().catch(() => ({ error: 'failed' })); throw new Error(err.error || JSON.stringify(err)) }
  const js = await res.json(); return js.history || []
}

function toPercentSeries(data) {
  let base = null
  for (let v of data) { if (v !== null && v !== undefined && !Number.isNaN(Number(v))) { base = Number(v); break } }
  if (base === null || base === 0) return data.map(_ => null)
  return data.map(v => (v === null || v === undefined || Number.isNaN(Number(v))) ? null : ((Number(v) - base) / base * 100))
}

function buildUnionDates(leftHist, rightHist) {
  const all = Array.from(new Set([...leftHist.map(r => r.date), ...rightHist.map(r => r.date)]));
  all.sort((a, b) => new Date(a) - new Date(b));
  return all
}
function buildAlignedSeries(dates, hist) {
  const map = new Map(hist.map(r => [r.date, r.Close]));
  return dates.map(d => map.has(d) ? map.get(d) : null)
}
function periodToLabel(period) {
  switch (period) {
    case '1mo': return '1 Month';
    case '3mo': return '3 Months';
    case '6mo': return '6 Months';
    case '1y': return '1 Year';
    case '2y': return '2 Years';
    default: return period
  }
}

// NOTE: button id in compare.html is "btnCompareRun" — use that
const btnDoCompare = $c('btnCompareRun');
if (btnDoCompare) btnDoCompare.addEventListener('click', async () => {
  const left = ($c('leftSearch')?.value || '').trim().toUpperCase()
  const right = ($c('rightSearch')?.value || '').trim().toUpperCase()
  const period = $c('period')?.value || '1y'
  if (!left || !right) return alert('Choose both tickers')
  try {
    // call compare summary
    const res = await fetch(`/api/compare?left=${encodeURIComponent(left)}&right=${encodeURIComponent(right)}&period=${period}`)
    const j = await res.json(); if (!res.ok) { alert('Compare API error: ' + (j.error || JSON.stringify(j))); return }
    const leftSummary = j.left.summary || {}, rightSummary = j.right.summary || {}
    const elSummaryLeft = $c('leftSummary'), elSummaryRight = $c('rightSummary'), elCompareSummary = $c('compareSummary')
    if (elSummaryLeft) elSummaryLeft.innerHTML = `<strong>${left}</strong><div style="margin-top:6px">start: ${fmt(leftSummary.start, 2)} • end: ${fmt(leftSummary.end, 2)} • change: <strong>${fmt(leftSummary.pct_change, 2)}%</strong></div>`
    if (elSummaryRight) elSummaryRight.innerHTML = `<strong>${right}</strong><div style="margin-top:6px">start: ${fmt(rightSummary.start, 2)} • end: ${fmt(rightSummary.end, 2)} • change: <strong>${fmt(rightSummary.pct_change, 2)}%</strong></div>`
    if (elCompareSummary) elCompareSummary.textContent = `${left}: ${fmt(leftSummary.pct_change, 2)}%  •  ${right}: ${fmt(rightSummary.pct_change, 2)}%`

    // set ticker labels (present in HTML)
    const leftLabelEl = $c('leftTickerLabel'), rightLabelEl = $c('rightTickerLabel');
    if (leftLabelEl) leftLabelEl.textContent = left;
    if (rightLabelEl) rightLabelEl.textContent = right;

    // fetch full histories for chart
    const hLeft = await fetchHistory(left, period, '1d').catch(err => { throw new Error('Left history: ' + err.message) })
    const hRight = await fetchHistory(right, period, '1d').catch(err => { throw new Error('Right history: ' + err.message) })
    const allDates = buildUnionDates(hLeft, hRight)
    const leftRaw = buildAlignedSeries(allDates, hLeft)
    const rightRaw = buildAlignedSeries(allDates, hRight)
    const leftPct = toPercentSeries(leftRaw)
    const rightPct = toPercentSeries(rightRaw)
    drawCompareChartPercent(allDates, leftPct, rightPct, left, right, period, leftRaw, rightRaw)
  } catch (err) { console.error(err); alert('Compare failed: ' + err.message) }
})

let compareChart = null
function drawCompareChartPercent(labels, leftPct, rightPct, leftLabel, rightLabel, periodCode, leftRaw = null, rightRaw = null) {
  const canvas = $c('compareChart'); if (!canvas) return; const ctx = canvas.getContext('2d')
  if (compareChart) try { compareChart.destroy(); compareChart = null } catch (e) { console.warn('destroy err', e) }
  const allVals = [...leftPct, ...rightPct].filter(v => v !== null && v !== undefined && Number.isFinite(v))
  let min = allVals.length ? Math.min(...allVals) : -5; let max = allVals.length ? Math.max(...allVals) : 5
  const pad = Math.max(5, (max - min) * 0.08); min = Math.floor(min - pad); max = Math.ceil(max + pad)
  const yTitle = `Percent change — ${periodToLabel(periodCode)}`

  function xLabelCallback(val, idx) {
    if (!labels || labels.length === 0) return ''
    const step = Math.max(1, Math.floor(labels.length / 10))
    if (idx % step !== 0) return ''
    const raw = labels[idx]
    const d = new Date(raw); if (isNaN(d.getTime())) return raw
    if (labels.length <= 7) return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    if (labels.length <= 60) return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
  }

  compareChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: leftLabel, data: leftPct, borderColor: '#60a5fa', backgroundColor: 'rgba(96,165,250,0.06)', pointRadius: 0, tension: 0.18, spanGaps: true },
        { label: rightLabel, data: rightPct, borderColor: '#22d3ee', backgroundColor: 'rgba(34,211,238,0.05)', pointRadius: 0, tension: 0.18, spanGaps: true }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          ticks: { color: '#ffffff', maxRotation: 45, minRotation: 0, callback: xLabelCallback },
          grid: { color: 'rgba(255,255,255,0.02)' }
        },
        y: {
          ticks: { color: '#ffffff', callback: function (v) { return v + '%' } },
          min: min, max: max,
          title: { display: true, text: yTitle, color: '#ffffff', font: { size: 12, weight: '600' } },
          grid: { color: 'rgba(255,255,255,0.02)' }
        }
      },
      plugins: {
        legend: { labels: { color: '#ffffff', font: { size: 13, weight: '600' }, boxWidth: 14, padding: 14 }, position: 'top' },
        tooltip: {
          callbacks: {
            label: function (context) {
              const dsLabel = context.dataset.label || ''; const idx = context.dataIndex; const pctVal = context.parsed.y
              let raw = null
              if (dsLabel === leftLabel && leftRaw) raw = leftRaw[idx]
              if (dsLabel === rightLabel && rightRaw) raw = rightRaw[idx]
              const pctText = (pctVal === null || pctVal === undefined) ? '—' : pctVal.toFixed(2) + '%'
              const rawText = raw === null || raw === undefined ? '' : ` (${Number(raw).toLocaleString(undefined, { maximumFractionDigits: 2 })})`
              return `${dsLabel}: ${pctText}${rawText}`
            }
          }
        }
      }
    }
  })
}
