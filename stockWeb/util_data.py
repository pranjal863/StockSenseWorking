# util_data.py
import yfinance as yf
import pandas as pd
import numpy as np
from ta.trend import SMAIndicator, EMAIndicator, MACD
from ta.volatility import BollingerBands
from ta.momentum import RSIIndicator
import os
from difflib import get_close_matches

# small default ticker list for suggestions (common names)
DEFAULT_TICKERS = [
    ("AAPL","Apple Inc"),
    ("MSFT","Microsoft Corporation"),
    ("GOOGL","Alphabet Inc Class A"),
    ("GOOG","Alphabet Inc Class C"),
    ("AMZN","Amazon.com Inc"),
    ("META","Meta Platforms Inc"),
    ("TSLA","Tesla Inc"),
    ("NFLX","Netflix Inc"),
    ("NVDA","NVIDIA Corporation"),
    ("IBM","International Business Machines")
]

def load_tickers_csv(path="tickers.csv"):
    """
    If you put a tickers.csv in project root with columns 'symbol' and 'name',
    it will be used for better suggestions. Otherwise the DEFAULT_TICKERS is used.
    """
    if os.path.exists(path):
        try:
            df = pd.read_csv(path, dtype=str)
            # expect columns symbol,name
            if "symbol" in df.columns and "name" in df.columns:
                return list(zip(df["symbol"].str.upper().tolist(), df["name"].tolist()))
        except Exception:
            pass
    return DEFAULT_TICKERS

_TICKER_DB = load_tickers_csv()

def suggest_tickers(query, max_suggestions=20):
    """
    Fuzzy search suggestions using difflib.get_close_matches on symbol and name.
    Returns list of dicts: {"symbol":..., "name":...}
    """
    q = (query or "").strip().lower()
    if not q:
        return []
    # build searchable strings
    symbols = [s for s,_ in _TICKER_DB]
    names = [n.lower() for _,n in _TICKER_DB]
    # exact symbol startswith or name contains
    exacts = [ (s,n) for s,n in _TICKER_DB if s.lower().startswith(q) or q in n.lower()]
    # fuzzy matches on names
    matches = []
    close = get_close_matches(q, names, n=max_suggestions, cutoff=0.4)
    for cname in close:
        # find the matching symbol (original case)
        try:
            sym = [s for s,n in _TICKER_DB if n.lower() == cname][0]
            matches.append((sym, [n for s,n in _TICKER_DB if s==sym][0]))
        except Exception:
            continue
    # combine and dedupe
    items = exacts + matches
    seen = set()
    out = []
    for s,n in items:
        if s in seen: continue
        seen.add(s)
        out.append({"symbol":s,"name":n})
        if len(out) >= max_suggestions:
            break
    # fallback: symbol contains q
    if len(out) < max_suggestions:
        for s,n in _TICKER_DB:
            if q in s.lower() and s not in seen:
                out.append({"symbol":s,"name":n}); seen.add(s)
                if len(out) >= max_suggestions: break
    return out

def fetch_price_history(symbol, period="1y", interval="1d"):
    """
    Fetch historical OHLCV for a ticker using yfinance.
    period examples: "1y","6mo","5y" ; interval examples: "1d","1h"
    Returns a dataframe with Date index and Open,High,Low,Close,Adj Close,Volume
    """
    ticker = yf.Ticker(symbol)
    df = ticker.history(period=period, interval=interval, auto_adjust=False)
    if df is None or df.empty:
        raise ValueError("No data for symbol: " + symbol)
    # ensure index is datetime
    df = df.copy()
    df.index = pd.to_datetime(df.index)
    return df

def compute_indicators(df):
    """
    Accepts a df with 'Close' column, returns DataFrame with columns added:
    sma7, sma30, ema20, rsi, macd, macd_signal, bb_high, bb_low, volatility
    Ensures result contains a 'date' column (datetime) and resets index.
    """
    out = df.copy()
    # ensure Close exists
    if 'Close' not in out.columns:
        raise ValueError("DataFrame must contain 'Close' column")

    close = out['Close'].fillna(method='ffill')

    # SMA
    out['sma7'] = SMAIndicator(close, window=7, fillna=True).sma_indicator()
    out['sma30'] = SMAIndicator(close, window=30, fillna=True).sma_indicator()
    # EMA(20) as example
    out['ema20'] = EMAIndicator(close, window=20, fillna=True).ema_indicator()
    # RSI
    out['rsi'] = RSIIndicator(close, window=14, fillna=True).rsi()
    # MACD
    macd = MACD(close, window_slow=26, window_fast=12, window_sign=9)
    out['macd'] = macd.macd()
    out['macd_signal'] = macd.macd_signal()
    # Bollinger Bands
    bb = BollingerBands(close, window=20, window_dev=2)
    out['bb_high'] = bb.bollinger_hband()
    out['bb_low'] = bb.bollinger_lband()
    # volatility (20-day rolling std of returns annualized approx)
    out['returns'] = close.pct_change().fillna(0)
    out['volatility'] = out['returns'].rolling(window=20).std().fillna(0) * np.sqrt(252)

    # keep essential columns
    keep = ['Open','High','Low','Close','Volume','sma7','sma30','ema20','rsi','macd','macd_signal','bb_high','bb_low','volatility']

    # Select present columns only (in case some are missing)
    keep_present = [c for c in keep if c in out.columns]

    # reset index to turn datetime index into a column
    res = out[keep_present].reset_index()

    # determine the name of the date column created by reset_index
    # usually it's 'index' if index has no name or the name if present
    # we'll normalize it to 'date'
    if 'date' not in res.columns:
        # common candidates
        for cand in ('Date','date_time','datetime','index'):
            if cand in res.columns:
                res = res.rename(columns={cand: 'date'})
                break
        else:
            # if none match, pick the first column that is datetime-like
            for c in res.columns:
                if pd.api.types.is_datetime64_any_dtype(res[c]):
                    res = res.rename(columns={c: 'date'})
                    break
            # as last fallback, name the first column 'date'
            if 'date' not in res.columns:
                res = res.rename(columns={res.columns[0]:'date'})

    # Ensure date is datetime type
    res['date'] = pd.to_datetime(res['date'])

    return res