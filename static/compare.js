// static/compare.js (updated)
// Compare page logic: suggestions for left/right, fetch compare and history, draw normalized % change chart

const $c = (id) => document.getElementById(id)

// small helper for formatting numbers
function fmt(n, d = 2) {
    return n === null || n === undefined ? "—" : Number(n).toLocaleString(undefined, { maximumFractionDigits: d })
}

// show suggestions in a specific box
function showSuggestionsFor(boxId, items, inputId) {
    const box = $c(boxId)
    if (!box) return
    box.innerHTML = ''
    if (!items || items.length === 0) { box.style.display = 'none'; return }
    items.forEach(it => {
        const btn = document.createElement('button')
        btn.style.width = '100%'
        btn.style.background = 'transparent'
        btn.style.border = 'none'
        btn.style.padding = '10px'
        btn.style.textAlign = 'left'
        btn.style.color = 'var(--text-secondary)'
        btn.style.cursor = 'pointer'
        btn.innerHTML = `<strong style="color:var(--text-primary)">${it.symbol}</strong> <div class="meta" style="font-size:12px;color:var(--text-muted)">${it.name}</div>`
        btn.addEventListener('click', () => {
            const input = $c(inputId)
            if (input) input.value = it.symbol
            box.style.display = 'none'
        })
        box.appendChild(btn)
    })
    box.style.display = 'block'
}

// debounce helper
function debounce(fn, ms = 220) {
    let t
    return (...args) => {
        if (t) clearTimeout(t)
        t = setTimeout(() => fn(...args), ms)
    }
}

// fetch suggestions from backend
async function fetchSuggestions(q, boxId, inputId) {
    if (!q || q.trim().length === 0) {
        const box = $c(boxId); if (box) box.style.display = 'none'; return
    }
    try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&max=8`)
        const data = await res.json()
        showSuggestionsFor(boxId, data, inputId)
    } catch (err) {
        console.error('suggest err', err)
        const box = $c(boxId); if (box) box.style.display = 'none'
    }
}

const leftInput = $c('leftSearch'), rightInput = $c('rightSearch')
if (leftInput) leftInput.addEventListener('input', debounce((e) => fetchSuggestions(e.target.value, 'leftSuggestions', 'leftSearch')))
if (rightInput) rightInput.addEventListener('input', debounce((e) => fetchSuggestions(e.target.value, 'rightSuggestions', 'rightSearch')))

// Clicking outside hides suggestions
document.addEventListener('click', (ev) => {
    const leftBox = $c('leftSuggestions'), rightBox = $c('rightSuggestions')
    if (leftBox && !leftBox.contains(ev.target) && ev.target !== leftInput) leftBox.style.display = 'none'
    if (rightBox && !rightBox.contains(ev.target) && ev.target !== rightInput) rightBox.style.display = 'none'
})

// Helper to load histories for plotting
async function fetchHistory(symbol, period = '1y', interval = '1d') {
    const res = await fetch(`/api/history/${encodeURIComponent(symbol)}?period=${period}&interval=${interval}`)
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'failed' }))
        throw new Error(err.error || JSON.stringify(err))
    }
    const js = await res.json()
    return js.history || []
}

// Convert series (array of raw prices) to percent change series relative to first non-null
function toPercentSeries(data) {
    // find first non-null numeric
    let base = null
    for (let v of data) {
        if (v !== null && v !== undefined && !Number.isNaN(Number(v))) { base = Number(v); break }
    }
    if (base === null || base === 0) {
        // if we can't compute percent change, return array of nulls
        return data.map(_ => null)
    }
    return data.map(v => (v === null || v === undefined || Number.isNaN(Number(v))) ? null : ((Number(v) - base) / base * 100))
}

// Align dates as union sorted
function buildUnionDates(leftHist, rightHist) {
    const all = Array.from(new Set([...leftHist.map(r => r.date), ...rightHist.map(r => r.date)]))
    all.sort((a, b) => new Date(a) - new Date(b))
    return all
}

// Build series aligned to union dates, keeping raw values (null where absent)
function buildAlignedSeries(dates, hist) {
    const map = new Map(hist.map(r => [r.date, r.Close]))
    return dates.map(d => map.has(d) ? map.get(d) : null)
}

// Map period code to pretty label for y-axis text
function periodToLabel(period) {
    switch (period) {
        case '1mo': return '1 Month'
        case '3mo': return '3 Months'
        case '6mo': return '6 Months'
        case '1y': return '1 Year'
        case '2y': return '2 Years'
        default: return period
    }
}

// compare button handler
$c('btnDoCompare').addEventListener('click', async () => {
    const left = ($c('leftSearch')?.value || '').trim().toUpperCase()
    const right = ($c('rightSearch')?.value || '').trim().toUpperCase()
    const period = $c('comparePeriod')?.value || '1y'
    if (!left || !right) return alert('Choose both tickers')

    try {
        // call /api/compare for quick summary
        const res = await fetch(`/api/compare?left=${encodeURIComponent(left)}&right=${encodeURIComponent(right)}&period=${period}`)
        const j = await res.json()
        if (!res.ok) {
            alert('Compare API error: ' + (j.error || JSON.stringify(j)))
            return
        }
        const leftSummary = j.left.summary
        const rightSummary = j.right.summary

        $c('summaryLeft').innerHTML = `<strong>${left}</strong><div style="margin-top:6px">start: ${fmt(leftSummary.start, 2)} • end: ${fmt(leftSummary.end, 2)} • change: <strong>${fmt(leftSummary.pct_change, 2)}%</strong></div>`
        $c('summaryRight').innerHTML = `<strong>${right}</strong><div style="margin-top:6px">start: ${fmt(rightSummary.start, 2)} • end: ${fmt(rightSummary.end, 2)} • change: <strong>${fmt(rightSummary.pct_change, 2)}%</strong></div>`
        $c('compareSummary').textContent = `${left}: ${fmt(leftSummary.pct_change, 2)}%  •  ${right}: ${fmt(rightSummary.pct_change, 2)}%`

        // fetch histories to plot
        const hLeft = await fetchHistory(left, period, '1d').catch(err => { throw new Error('Left history: ' + err.message) })
        const hRight = await fetchHistory(right, period, '1d').catch(err => { throw new Error('Right history: ' + err.message) })

        // align dates
        const allDates = buildUnionDates(hLeft, hRight)
        const leftRaw = buildAlignedSeries(allDates, hLeft)
        const rightRaw = buildAlignedSeries(allDates, hRight)

        // percent series
        const leftPct = toPercentSeries(leftRaw)
        const rightPct = toPercentSeries(rightRaw)

        // draw normalized percent chart and pass period for axis title
        drawCompareChartPercent(allDates, leftPct, rightPct, left, right, period, leftRaw, rightRaw)
    } catch (err) {
        console.error(err)
        alert('Compare failed: ' + err.message)
    }
})

// Chart drawing: percent-normalized lines with improved tooltip showing raw price
let compareChart = null
function drawCompareChartPercent(labels, leftPct, rightPct, leftLabel, rightLabel, periodCode, leftRaw = null, rightRaw = null) {
    const canvas = $c('compareChart')
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (compareChart) try { compareChart.destroy() } catch (e) { }

    // determine y-axis range from both pct series
    const allVals = [...leftPct, ...rightPct].filter(v => v !== null && v !== undefined && Number.isFinite(v))
    let min = allVals.length ? Math.min(...allVals) : -5
    let max = allVals.length ? Math.max(...allVals) : 5
    // add padding
    const pad = Math.max(5, (max - min) * 0.08)
    min = Math.floor(min - pad)
    max = Math.ceil(max + pad)

    const yTitle = `Percent change — ${periodToLabel(periodCode)}`

    compareChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: leftLabel,
                    data: leftPct,
                    borderColor: '#60a5fa',
                    backgroundColor: 'rgba(96,165,250,0.06)',
                    pointRadius: 0,
                    tension: 0.18,
                    spanGaps: true,
                },
                {
                    label: rightLabel,
                    data: rightPct,
                    borderColor: '#22d3ee',
                    backgroundColor: 'rgba(34,211,238,0.05)',
                    pointRadius: 0,
                    tension: 0.18,
                    spanGaps: true,
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: {
                    ticks: {
                        color: '#ffffff',
                        maxRotation: 45,
                        minRotation: 0,
                        callback: function (val, idx) {
                            const step = Math.max(1, Math.floor(labels.length / 10))
                            if (idx % step !== 0) return ''
                            const d = new Date(labels[idx])
                            if (isNaN(d.getTime())) return labels[idx]
                            return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                        }
                    },
                    grid: { color: 'rgba(255,255,255,0.02)' }
                },
                y: {
                    ticks: {
                        color: '#ffffff',
                        callback: function (v) { return v + '%' }
                    },
                    min: min,
                    max: max,
                    title: {
                        display: true,
                        text: yTitle,
                        color: '#ffffff',
                        font: { size: 12, weight: '600' }
                    },
                    grid: { color: 'rgba(255,255,255,0.02)' }
                }
            }
            ,
            plugins: {
                legend: {
                    labels: { color: '#ffffff' },
                    position: 'top'
                },
                tooltip: {
                    callbacks: {
                        // label shows percent and raw price if available
                        label: function (context) {
                            const dsLabel = context.dataset.label || ''
                            const idx = context.dataIndex
                            const pctVal = context.parsed.y
                            // find raw value from leftRaw/rightRaw if passed
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
