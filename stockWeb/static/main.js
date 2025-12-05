// static/main.js
// frontend logic for stock dashboard

const $ = id => document.getElementById(id);

// DOM elements
const searchInput = $('search');
const suggestionsBox = $('suggestions');
const fetchBtn = $('btnFetch');
const compareBtn = $('btnCompare');
const compareInput = $('compareTicker');

const k_ticker = $('k_ticker');
const k_close = $('k_close');
const k_pred = $('k_pred');
const k_conf = $('k_conf');

const newsFeed = $('newsFeed');
const newsModal = document.getElementById('newsModal');
const modalTitle = document.getElementById('modalTitle');
const modalDesc = document.getElementById('modalDesc');
const modalSource = document.getElementById('modalSource');
const modalUrl = document.getElementById('modalUrl');
const modalClose = document.getElementById('newsModalClose');

let priceChart = null, rsiChart = null, macdChart = null;
let selectedTicker = null;

function fmt(n,d=2){ return n===null||n===undefined ? '—' : Number(n).toLocaleString(undefined,{maximumFractionDigits:d}); }

/* ---------- suggestions ---------- */
let searchTimer = null;
searchInput.addEventListener('input', (e) => {
  const q = e.target.value.trim();
  if (searchTimer) clearTimeout(searchTimer);
  if (!q) { suggestionsBox.style.display='none'; return; }
  searchTimer = setTimeout(async () => {
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&max=8`);
      const data = await res.json();
      showSuggestions(data);
    } catch (err) {
      console.error(err);
      suggestionsBox.style.display='none';
    }
  }, 220);
});

function showSuggestions(items){
  suggestionsBox.innerHTML = '';
  if (!items || items.length===0) { suggestionsBox.style.display='none'; return; }
  items.forEach(it => {
    const b = document.createElement('button');
    b.innerHTML = `<div style="text-align:left"><strong style="color:#fff">${it.symbol}</strong> <div class="meta" style="font-size:12px;color:var(--text-muted)">${it.name}</div></div>`;
    b.addEventListener('click', () => {
      searchInput.value = it.symbol;
      selectedTicker = it.symbol;
      suggestionsBox.style.display='none';
      fetchTicker(it.symbol);
    });
    suggestionsBox.appendChild(b);
  });
  suggestionsBox.style.display='block';
}

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); const t = e.target.value.trim(); if (t) fetchTicker(t); }
});

/* ---------- fetch ticker ---------- */
async function fetchTicker(symbol){
  selectedTicker = symbol.toUpperCase();
  k_ticker.textContent = selectedTicker;
  k_close.textContent = '...';
  k_pred.textContent = '...';
  k_conf.textContent = '...';

  try {
    const period = $('period').value;
    const interval = $('interval').value;
    const hRes = await fetch(`/api/history/${selectedTicker}?period=${period}&interval=${interval}`);
    const hData = await hRes.json();
    if (!hRes.ok) { alert("History error: " + (hData.error || JSON.stringify(hData))); return; }
    const hist = hData.history || [];
    if (!hist.length) { alert("No history returned"); return; }

    // arrays
    const dates = hist.map(r => r.date);
    const close = hist.map(r => r.Close);
    const open = hist.map(r => r.Open);
    const high = hist.map(r => r.High);
    const low = hist.map(r => r.Low);
    const volume = hist.map(r => r.Volume);
    const sma7 = hist.map(r => r.sma7);
    const sma30 = hist.map(r => r.sma30);
    const ema20 = hist.map(r => r.ema20);
    const bb_high = hist.map(r => r.bb_high);
    const bb_low = hist.map(r => r.bb_low);
    const rsi = hist.map(r => r.rsi);
    const macd = hist.map(r => r.macd);
    const macd_signal = hist.map(r => r.macd_signal);

    k_close.textContent = fmt(close[close.length-1], 2);

    // predict (non-blocking)
    try {
      const pRes = await fetch(`/api/predict/${selectedTicker}?period=2y&interval=1d`);
      const pData = await pRes.json();
      if (pRes.ok){
        k_pred.textContent = fmt(pData.predicted_close, 2);
        k_conf.textContent = (Math.round(pData.confidence * 100) / 100).toFixed(2) + '%';
      } else {
        k_pred.textContent = 'n/a';
        k_conf.textContent = 'n/a';
      }
    } catch (e){
      console.error('predict error', e);
      k_pred.textContent = 'n/a';
      k_conf.textContent = 'n/a';
    }

    // chart + indicators
    drawPriceChart({
      labels: dates, close, open, high, low, volume,
      sma7, sma30, ema20, bb_high, bb_low,
      period: $('period').value
    });
    drawRsiChart(dates, rsi);
    drawMacdChart(dates, macd, macd_signal);

    // load news (no popup) - news feed on sidebar
    await loadNews(selectedTicker);

  } catch (err) {
    console.error(err);
    alert('Failed to fetch ticker data. See console.');
  }
}

/* ---------- charts ---------- */
function createOrReplaceChart(canvasId, cfg){
  const ctx = document.getElementById(canvasId).getContext('2d');
  if (canvasId==='priceChart' && priceChart){ priceChart.destroy(); priceChart=null; }
  if (canvasId==='rsiChart' && rsiChart){ rsiChart.destroy(); rsiChart=null; }
  if (canvasId==='macdChart' && macdChart){ macdChart.destroy(); macdChart=null; }
  return new Chart(ctx, cfg);
}

/* timeframe-aware price chart with OHLCV tooltip */
function drawPriceChart(opts) {
  const { labels, close, open, high, low, volume, sma7, sma30, ema20, bb_high, bb_low, period } = opts;
  const maxTicksLimit = Math.min(12, Math.max(4, Math.floor(labels.length / 2)));
  const step = Math.max(1, Math.ceil(labels.length / maxTicksLimit));

  function formatTickLabel(value, index) {
    const d = new Date(value);
    if (isNaN(d.getTime())) return value;
    if (period === '1d') return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    if (period === '5d' || period === '1mo') return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    if (period === '6mo' || period === '1y') return d.toLocaleDateString(undefined, { month: 'short' });
    if (period === '5y') return d.getFullYear().toString();
    return d.toLocaleDateString();
  }

  function tooltipTitle(items) {
    if (!items || items.length === 0) return '';
    const idx = items[0].dataIndex;
    const d = new Date(labels[idx]);
    if (period === '1d') {
      return d.toLocaleString(undefined, { year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
    }
    return d.toLocaleString(undefined, { year:'numeric', month:'short', day:'numeric' });
  }

  const tooltipCallbacks = {
    title: (items) => tooltipTitle(items),
    label: (context) => {
      const idx = context.dataIndex;
      const datasetLabel = context.dataset.label || '';
      const closeVal = close[idx] != null ? Number(close[idx]).toLocaleString(undefined, {maximumFractionDigits:2}) : '—';
      const openVal = open[idx] != null ? Number(open[idx]).toLocaleString(undefined, {maximumFractionDigits:2}) : '—';
      const highVal = high[idx] != null ? Number(high[idx]).toLocaleString(undefined, {maximumFractionDigits:2}) : '—';
      const lowVal = low[idx] != null ? Number(low[idx]).toLocaleString(undefined, {maximumFractionDigits:2}) : '—';
      const volVal = volume[idx] != null ? Number(volume[idx]).toLocaleString() : '—';

      if (datasetLabel === 'Close') {
        return [
          `Close: ${closeVal}`,
          `Open:  ${openVal}`,
          `High:  ${highVal}`,
          `Low:   ${lowVal}`,
          `Volume: ${volVal}`
        ];
      }
      const v = context.formattedValue;
      return `${datasetLabel}: ${v}`;
    }
  };

  const cfg = {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        { label: 'Close', data: close, borderWidth: 2, pointRadius: 0, borderColor: '#60a5fa', tension: 0.15, yAxisID: 'y' },
        { label: 'SMA7', data: sma7, borderWidth: 1, pointRadius: 0, borderColor: '#22d3ee', tension: 0.12, yAxisID: 'y' },
        { label: 'SMA30', data: sma30, borderWidth: 1, pointRadius: 0, borderColor: '#10b981', tension: 0.12, yAxisID: 'y' },
        { label: 'EMA20', data: ema20, borderWidth: 1, pointRadius: 0, borderColor: '#8b5cf6', tension: 0.12, yAxisID: 'y' },
        { label: 'BB High', data: bb_high, borderWidth: 0.6, pointRadius: 0, borderColor: 'rgba(96,165,250,0.25)', borderDash: [4,6], yAxisID: 'y' },
        { label: 'BB Low', data: bb_low, borderWidth: 0.6, pointRadius: 0, borderColor: 'rgba(96,165,250,0.25)', borderDash: [4,6], fill: '-1', yAxisID: 'y' },
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        y: { position:'left', ticks:{ color:'#ffffff' }, grid:{ color:'rgba(255,255,255,0.03)' } },
        x: {
          ticks: {
            color: '#ffffff',
            callback: function (val, index) {
              if (index % step !== 0) return '';
              return formatTickLabel(this.getLabelForValue(val), index);
            },
            font: { size: 11 }
          },
          grid: { display: false }
        }
      },
      plugins: {
        legend: { labels: { color: '#ffffff' } },
        tooltip: {
          mode: 'index',
          intersect: false,
          callbacks: tooltipCallbacks,
          displayColors: false
        }
      }
    }
  };

  priceChart = createOrReplaceChart('priceChart', cfg);
  setTimeout(()=>{ try{ priceChart.resize(); } catch(e){} }, 50);
}

function drawRsiChart(labels, rsi){
  const cfg = {
    type:'line',
    data:{ labels, datasets:[{ label:'RSI', data:rsi, borderColor:'#f59e0b', borderWidth:1, pointRadius:0, tension:0.15 }]},
    options:{ responsive:true, maintainAspectRatio:false, scales:{ x:{ display:false }, y:{ ticks:{ color:'#94a3b8' }, suggestedMax:100, suggestedMin:0, grid:{ color:'rgba(255,255,255,0.03)'} } }, plugins:{ legend:{ display:false } } }
  };
  rsiChart = createOrReplaceChart('rsiChart', cfg);
  const latest = rsi.filter(x => x !== null && x !== undefined).slice(-1)[0];
  $('rsiVal').textContent = latest ? Number(latest).toFixed(2) : '—';
}

function drawMacdChart(labels, macd, macd_signal){
  const cfg = {
    type:'bar',
    data:{ labels, datasets:[
      { type:'line', label:'MACD', data:macd, borderColor:'#60a5fa', borderWidth:1, pointRadius:0, tension:0.15, yAxisID:'y' },
      { type:'line', label:'Signal', data:macd_signal, borderColor:'#22d3ee', borderWidth:1, pointRadius:0, tension:0.15, yAxisID:'y' },
    ]},
    options:{ responsive:true, maintainAspectRatio:false, scales:{ x:{ display:false }, y:{ ticks:{ color:'#94a3b8' }, grid:{ color:'rgba(255,255,255,0.03)'} } }, plugins:{ legend:{ display:false }}}
  };
  macdChart = createOrReplaceChart('macdChart', cfg);
  const latest = macd.filter(x => x !== null && x !== undefined).slice(-1)[0];
  $('macdVal').textContent = latest ? Number(latest).toFixed(4) : '—';
}

/* ---------- Compare ---------- */
compareBtn.addEventListener('click', async () => {
  const left = selectedTicker;
  const right = compareInput.value.trim().toUpperCase();
  if (!left || !right) { alert('Choose main ticker and comparison ticker'); return; }
  try {
    const period = $('period').value;
    const res = await fetch(`/api/compare?left=${left}&right=${right}&period=${period}`);
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Compare failed'); return; }
    const l = data.left.summary, r = data.right.summary;
    $('compareResult').innerHTML = `<div><strong style="color:#60a5fa">${left}</strong> ${fmt(l.pct_change,2)}% vs <strong style="color:#22d3ee">${right}</strong> ${fmt(r.pct_change,2)}%</div>`;
  } catch (err) { console.error(err); alert('Compare failed') }
});

/* ---------- News feed ---------- */
async function loadNews(symbol){
  newsFeed.innerHTML = `<div class="placeholder">Loading news...<\/div>`;
  try {
    const res = await fetch(`/api/extras/${symbol}`);
    const data = await res.json();
    if (!data.news || data.news.length===0) {
      newsFeed.innerHTML = `<div class="placeholder">No news found for ${symbol}.</div>`;
      return;
    }
    newsFeed.innerHTML = '';
    data.news.forEach(article => {
      const item = document.createElement('div');
      item.className = 'news-item';
      const sDate = article.publishedAt ? (new Date(article.publishedAt)).toLocaleString() : '';
      // show short initials (first letters) as visual (title initials)
      const initials = (article.title || '').split(' ').slice(0,3).map(w => w[0]).join('').toUpperCase();
      item.innerHTML = `<div style="display:flex;gap:10px;align-items:center">
                          <div style="width:40px;height:40px;border-radius:8px;background:linear-gradient(135deg,#0ea5e9,#2563eb);display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff">${initials}</div>
                          <div style="flex:1">
                            <div class="news-title">${article.title}</div>
                            <div class="news-meta">${article.source || ''} • ${sDate}</div>
                          </div>
                        </div>`;
      item.addEventListener('click', () => {
        modalTitle.textContent = article.title || '';
        modalSource.textContent = `${article.source || ''} • ${sDate}`;
        modalDesc.textContent = article.description || article.title || 'No description';
        modalUrl.href = article.url || '#';
        newsModal.classList.remove('hidden');
      });
      newsFeed.appendChild(item);
    });
  } catch (err) {
    console.error('news error', err);
    newsFeed.innerHTML = `<div class="placeholder">Error loading news.</div>`;
  }
}

modalClose.addEventListener('click', () => newsModal.classList.add('hidden'));
window.addEventListener('click', (e) => { if (e.target === newsModal) newsModal.classList.add('hidden'); });

/* ---------- buttons ---------- */
$('btnFetch').addEventListener('click', () => {
  const t = searchInput.value.trim();
  if (!t) return alert('Type a ticker or pick a suggestion.');
  fetchTicker(t);
});

/* warm call */
window.addEventListener('load', async () => {
  try { await fetch('/api/search?q=goog&max=6'); } catch(e){}
});