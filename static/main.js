/* main.js - frontend logic for stock dashboard
   Expects backend routes:
    - GET /api/search?q=
    - GET /api/history/<SYMBOL>?period=&interval=
    - GET /api/predict/<SYMBOL>
    - POST /api/sentiment
    - GET /api/compare?left=&right=&period=
*/

const $ = id => document.getElementById(id);
let selectedTicker = null;
let priceChart, rsiChart, macdChart;

function fmt(n, d=2){ return (n===null||n===undefined)? '—' : Number(n).toLocaleString(undefined, {maximumFractionDigits:d}); }

function showSuggestions(items){
  const box = $('suggestions');
  box.innerHTML = '';
  if(!items || items.length===0){ box.style.display='none'; return; }
  items.forEach(it=>{
    const b = document.createElement('button');
    b.innerHTML = `<div style="text-align:left"><strong style="color:#fff">${it.symbol}</strong> <span class="meta">${it.name}</span></div>`;
    b.addEventListener('click', ()=> {
      $('search').value = it.symbol;
      selectedTicker = it.symbol;
      box.style.display='none';
      fetchTicker(it.symbol);
    });
    box.appendChild(b);
  });
  box.style.display='block';
}

/* search/autocomplete */
let searchTimer = null;
$('search').addEventListener('input', (e)=>{
  const q = e.target.value.trim();
  if(searchTimer) clearTimeout(searchTimer);
  if(!q){ $('suggestions').style.display='none'; return; }
  searchTimer = setTimeout(async ()=>{
    try{
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&max=8`);
      const data = await res.json();
      showSuggestions(data);
    }catch(err){
      console.error(err);
      $('suggestions').style.display='none';
    }
  }, 240);
});

$('search').addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); const t = e.target.value.trim(); if(t) fetchTicker(t); } });

/* fetch ticker data */
async function fetchTicker(symbol){
  selectedTicker = symbol.toUpperCase();
  $('k_ticker').textContent = selectedTicker;
  $('k_close').textContent = '...';
  $('k_pred').textContent = '...';
  $('k_conf').textContent = '...';
  try{
    const period = $('period').value;
    const interval = $('interval').value;
    const hRes = await fetch(`/api/history/${selectedTicker}?period=${period}&interval=${interval}`);
    const hData = await hRes.json();
    if(hRes.status !== 200){
      alert('History error: ' + (hData.error||JSON.stringify(hData)));
      return;
    }
    const hist = hData.history || [];
    if(!hist.length){ alert('No history returned'); return; }

    const dates = hist.map(r=>r.date);
    const close = hist.map(r=>r.Close);
    const sma7 = hist.map(r=>r.sma7);
    const sma30 = hist.map(r=>r.sma30);
    const ema20 = hist.map(r=>r.ema20);
    const bb_high = hist.map(r=>r.bb_high);
    const bb_low = hist.map(r=>r.bb_low);
    const rsi = hist.map(r=>r.rsi);
    const macd = hist.map(r=>r.macd);
    const macd_signal = hist.map(r=>r.macd_signal);

    $('k_close').textContent = fmt(close[close.length-1],2);

    const pRes = await fetch(`/api/predict/${selectedTicker}?period=2y&interval=1d`);
    const pData = await pRes.json();
    if(pRes.ok){
      $('k_pred').textContent = fmt(pData.predicted_close,2);
      $('k_conf').textContent = (Math.round(pData.confidence*100)/100).toFixed(2) + '%';
    } else {
      $('k_pred').textContent = 'n/a';
      $('k_conf').textContent = 'n/a';
    }

    drawPriceChart(dates, close, sma7, sma30, ema20, bb_high, bb_low);
    drawRsiChart(dates, rsi);
    drawMacdChart(dates, macd, macd_signal);

  }catch(err){
    console.error(err);
    alert('Failed to fetch ticker data. See console.');
  }
}

/* Chart helpers */
function createOrReplaceChart(canvasId, cfg){
  const ctx = document.getElementById(canvasId).getContext('2d');
  if(canvasId==='priceChart' && priceChart){ priceChart.destroy(); }
  if(canvasId==='rsiChart' && rsiChart){ rsiChart.destroy(); }
  if(canvasId==='macdChart' && macdChart){ macdChart.destroy(); }
  return new Chart(ctx, cfg);
}

function drawPriceChart(labels, close, sma7, sma30, ema20, bb_high, bb_low){
  const cfg = {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        { label:'Close', data:close, borderWidth:2, pointRadius:0, borderColor:'#9be7c4', tension:0.15, fill:false, yAxisID:'y'},
        { label:'SMA7', data:sma7, borderWidth:1, pointRadius:0, borderColor:'#3ad29f', tension:0.12, fill:false, yAxisID:'y'},
        { label:'SMA30', data:sma30, borderWidth:1, pointRadius:0, borderColor:'#1dd3a7', tension:0.12, fill:false, yAxisID:'y'},
        { label:'EMA20', data:ema20, borderWidth:1, pointRadius:0, borderColor:'#4bd1a6', tension:0.12, fill:false, yAxisID:'y'},
        { label:'BB High', data:bb_high, borderWidth:0.5, pointRadius:0, borderColor:'rgba(100,255,180,0.2)', borderDash:[4,6], fill:false, yAxisID:'y'},
        { label:'BB Low', data:bb_low, borderWidth:0.5, pointRadius:0, borderColor:'rgba(100,255,180,0.2)', borderDash:[4,6], fill:'+1', yAxisID:'y' },
      ]
    },
    options:{
      responsive:true,
      interaction:{mode:'index', intersect:false},
      scales:{
        y:{ position:'left', ticks:{color:'#bfeadf'}, grid:{color:'rgba(255,255,255,0.03)'} },
        x:{ ticks:{color: '#9fb7a8'}, grid:{display:false} }
      },
      plugins:{ legend:{display:true, labels:{color:'#cfeee0'}}, tooltip:{mode:'index', intersect:false} }
    }
  };
  priceChart = createOrReplaceChart('priceChart', cfg);
}

function drawRsiChart(labels, rsi){
  const cfg = {
    type:'line',
    data:{labels, datasets:[{label:'RSI', data:rsi, borderColor:'#ffd166', borderWidth:1, pointRadius:0, tension:0.15}]},
    options:{
      responsive:true,
      scales:{ x:{display:false}, y:{ticks:{color:'#cfcfcf'}, suggestedMax:100, suggestedMin:0, grid:{color:'rgba(255,255,255,0.03)'} } },
      plugins:{legend:{display:false}, tooltip:{enabled:true}}
    }
  };
  rsiChart = createOrReplaceChart('rsiChart', cfg);
  const latest = rsi.filter(x=>x!==null && x!==undefined).slice(-1)[0];
  $('rsiVal').textContent = latest ? latest.toFixed(2) : '—';
}

function drawMacdChart(labels, macd, macd_signal){
  const cfg = {
    type:'bar',
    data:{
      labels,
      datasets:[
        { type:'line', label:'MACD', data:macd, borderColor:'#7ad0ff', borderWidth:1, pointRadius:0, tension:0.15, yAxisID:'y'},
        { type:'line', label:'Signal', data:macd_signal, borderColor:'#9be7c4', borderWidth:1, pointRadius:0, tension:0.15, yAxisID:'y' }
      ]
    },
    options:{
      responsive:true,
      scales:{ x:{display:false}, y:{ticks:{color:'#cfcfcf'}, grid:{color:'rgba(255,255,255,0.03)'} } },
      plugins:{legend:{display:false}}
    }
  };
  macdChart = createOrReplaceChart('macdChart', cfg);
  const latest = macd.filter(x=>x!==null && x!==undefined).slice(-1)[0];
  $('macdVal').textContent = latest ? latest.toFixed(4) : '—';
}

/* buttons */
$('btnFetch').addEventListener('click', ()=>{
  const t = $('search').value.trim();
  if(!t) return alert('Type a ticker or pick a suggestion.');
  fetchTicker(t);
});

$('btnCompare').addEventListener('click', async ()=>{
  const left = selectedTicker;
  const right = $('compareTicker').value.trim().toUpperCase();
  if(!left || !right){ alert('Choose main ticker and comparison ticker'); return; }
  try{
    const period = $('period').value;
    const res = await fetch(`/api/compare?left=${left}&right=${right}&period=${period}`);
    const data = await res.json();
    if(!res.ok){ alert(data.error || 'Compare failed'); return; }
    const l = data.left.summary;
    const r = data.right.summary;
    $('compareResult').innerHTML = `<div><strong>${left}</strong> ${fmt(l.pct_change,2)}% vs <strong>${right}</strong> ${fmt(r.pct_change,2)}%</div>`;
  }catch(err){ console.error(err); alert('Compare failed'); }
});

/* sentiment */
$('btnSent').addEventListener('click', async ()=>{
  const text = $('sentInput').value.trim();
  if(!text) return alert('Paste some headlines/tweets (one per line).');
  const lines = text.split('\n').map(s=>s.trim()).filter(Boolean);
  try{
    $('sentResult').innerHTML = 'Analyzing <span class="loader"></span>';
    const res = await fetch('/api/sentiment', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ headlines: lines })
    });
    const data = await res.json();
    if(!res.ok){ $('sentResult').textContent = data.error || 'Analysis failed'; return; }
    const label = data.sentiment_label;
    const score = (data.overall_compound||0).toFixed(3);
    $('sentResult').innerHTML = `<div><strong style="color:${label==='positive'?'#7ef1b1': label==='negative'?'#ff9b9b':'#cfd6df'}">${label.toUpperCase()}</strong> — score ${score}</div>
      <div class="small muted" style="margin-top:6px">Headlines: ${data.headline.count || 0} • Tweets: ${data.tweets.count || 0} • Announcements: ${data.announcements.count || 0}</div>`;
  }catch(err){ console.error(err); $('sentResult').textContent = 'Failed to analyze'; }
});

$('btnClear').addEventListener('click', ()=>{ $('sentInput').value=''; $('sentResult').innerHTML=''; });

/* demo prefetch (optional) */
window.addEventListener('load', ()=>{
  (async ()=> {
    try{
      await fetch('/api/search?q=goog&max=6');
    }catch(e){}
  })();
});
