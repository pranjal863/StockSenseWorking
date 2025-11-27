# app.py
from flask import Flask, request, jsonify, render_template
from util_data import suggest_tickers, fetch_price_history, compute_indicators
from model_predict import train_predict_model
from dotenv import load_dotenv
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
import traceback
import os
import requests
import pandas as pd
import numpy as np
import json
import sys
import io

# Load .env first so os.getenv() reads values from .env
load_dotenv()

ALPHAVANTAGE_KEY = os.getenv("ALPHAVANTAGE_KEY")

app = Flask(__name__, static_folder="static", template_folder="templates")
analyzer = SentimentIntensityAnalyzer()


def trace_to_string():
    """Return a short traceback string for returning in JSON (helpful for debugging)."""
    buf = io.StringIO()
    traceback.print_exc(file=buf)
    txt = buf.getvalue()
    # shorten to last ~10 lines to avoid huge responses
    lines = txt.strip().splitlines()
    return "\n".join(lines[-12:])


@app.route("/")
def home():
    return render_template("index.html")


@app.route("/api/search")
def api_search():
    q = request.args.get("q", "")
    max_sugg = int(request.args.get("max", 8))
    try:
        results = suggest_tickers(q, max_suggestions=max_sugg)
        return jsonify(results)
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e), "trace": trace_to_string()}), 500


@app.route("/api/alpha/<symbol>")
def api_alpha(symbol):
    if not ALPHAVANTAGE_KEY:
        return jsonify({"error": "AlphaVantage API key not configured. Set ALPHAVANTAGE_KEY in .env"}), 500
    try:
        url = f"https://www.alphavantage.co/query?function=OVERVIEW&symbol={symbol}&apikey={ALPHAVANTAGE_KEY}"
        resp = requests.get(url, timeout=15)
        data = resp.json()
        if "Note" in data:
            return jsonify({"error": data["Note"]}), 429
        if "Information" in data:
            return jsonify({"error": data["Information"]}), 400
        if not data or data == {}:
            return jsonify({"error": f"No overview data for symbol {symbol} (AlphaVantage returned empty)."}), 404
        return jsonify(data)
    except requests.exceptions.RequestException as e:
        return jsonify({"error": "Network error contacting AlphaVantage", "detail": str(e), "trace": trace_to_string()}), 502
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e), "trace": trace_to_string()}), 500


@app.route("/api/history/<symbol>")
def api_history(symbol):
    """
    Robust history endpoint:
     - ensures 'date' column exists and is ISO string
     - replaces NaNs with null for JSON
     - returns clear trace on error
    """
    period = request.args.get("period", "1y")
    interval = request.args.get("interval", "1d")
    try:
        # 1) fetch raw price data (yfinance)
        df = fetch_price_history(symbol, period=period, interval=interval)

        # 2) compute indicators (util_data)
        ind = compute_indicators(df)  # returns DataFrame with date column or datetime index

        # 3) ensure 'date' column exists - normalize possible names or index
        if 'date' not in ind.columns:
            # common candidates to rename
            for candidate in ('Date', 'date_time', 'datetime', 'index'):
                if candidate in ind.columns:
                    ind = ind.rename(columns={candidate: 'date'})
                    break
            else:
                # try reset_index (index usually contains datetime)
                ind = ind.reset_index()
                # rename first datetime-like column to 'date'
                if 'date' not in ind.columns:
                    for c in ind.columns:
                        try:
                            if pd.api.types.is_datetime64_any_dtype(ind[c]):
                                ind = ind.rename(columns={c: 'date'})
                                break
                        except Exception:
                            continue
                    # fallback: just rename first column to date
                    if 'date' not in ind.columns and len(ind.columns) > 0:
                        ind = ind.rename(columns={ind.columns[0]: 'date'})

        # 4) coerce date -> datetime -> ISO string
        try:
            ind['date'] = pd.to_datetime(ind['date'])
            ind['date'] = ind['date'].dt.strftime('%Y-%m-%dT%H:%M:%S')
        except Exception:
            # If conversion fails, convert to string as fallback
            ind['date'] = ind['date'].astype(str)

        # 5) convert numpy types and replace NaN with None for JSON
        # Use DataFrame.where to replace NaN with None (np.nan -> None)
        ind = ind.replace({np.nan: None})
        # also ensure native Python types when producing dicts
        records = ind.to_dict(orient="records")
        # force all numpy numbers to python numbers
        def normalize(obj):
            if isinstance(obj, dict):
                return {k: normalize(v) for k, v in obj.items()}
            if isinstance(obj, (np.integer,)):
                return int(obj)
            if isinstance(obj, (np.floating,)):
                return float(obj)
            if isinstance(obj, np.bool_):
                return bool(obj)
            return obj
        records = [normalize(r) for r in records]

        return jsonify({"symbol": symbol, "history": records})
    except Exception as e:
        traceback.print_exc()
        return jsonify({
            "error": "Failed to fetch/process history",
            "message": str(e),
            "trace": trace_to_string()
        }), 400


@app.route("/api/predict/<symbol>", methods=["GET"])
def api_predict(symbol):
    period = request.args.get("period", "2y")
    interval = request.args.get("interval", "1d")
    try:
        df = fetch_price_history(symbol, period=period, interval=interval)
        df_ind = compute_indicators(df)

        # model expects 'date' column present (prepare_features checks as well)
        if 'date' not in df_ind.columns:
            df_ind = df_ind.reset_index().rename(columns={df_ind.columns[0]: 'date'})

        # call the model trainer/predictor
        result, model, features = train_predict_model(df_ind, n_lags=10)
        if isinstance(result, dict) and "error" in result:
            return jsonify({"error": "model_error", "detail": result.get("error")}), 400

        last_close = None
        try:
            last_close = float(df_ind['Close'].iloc[-1])
        except Exception:
            last_close = None

        predicted = float(result['prediction'])
        pct_change = None
        if last_close:
            pct_change = (predicted - last_close) / last_close * 100.0

        out = {
            "symbol": symbol,
            "last_close": last_close,
            "predicted_close": predicted,
            "predicted_pct_change": pct_change,
            "confidence": result.get('confidence'),
            "r2": result.get('r2')
        }
        return jsonify(out)
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": "Failed to predict", "message": str(e), "trace": trace_to_string()}), 400


@app.route("/api/sentiment", methods=["POST"])
def api_sentiment():
    data = request.get_json() or {}
    headlines = data.get("headlines", [])
    tweets = data.get("tweets", [])
    announcements = data.get("announcements", [])

    def score_list(items):
        scores = []
        for t in items:
            v = analyzer.polarity_scores(str(t))
            scores.append(v)
        if not scores:
            return {"count": 0, "avg_compound": 0, "pos": 0, "neg": 0, "neu": 0}
        compounds = [s['compound'] for s in scores]
        return {
            "count": len(scores),
            "avg_compound": float(sum(compounds) / len(compounds)),
            "pos": float(sum(s['pos'] for s in scores) / len(scores)),
            "neg": float(sum(s['neg'] for s in scores) / len(scores)),
            "neu": float(sum(s['neu'] for s in scores) / len(scores))
        }

    try:
        hscore = score_list(headlines)
        tscore = score_list(tweets)
        ascore = score_list(announcements)

        total_count = hscore["count"] + tscore["count"] + ascore["count"]
        if total_count == 0:
            overall = {"compound": 0}
        else:
            overall_comp = (hscore["avg_compound"] * hscore["count"] + tscore["avg_compound"] * tscore["count"] + ascore["avg_compound"] * ascore["count"]) / total_count
            overall = {"compound": overall_comp}

        comp = overall["compound"]
        label = "neutral"
        if comp >= 0.05:
            label = "positive"
        elif comp <= -0.05:
            label = "negative"

        return jsonify({
            "headline": hscore,
            "tweets": tscore,
            "announcements": ascore,
            "overall_compound": overall["compound"],
            "sentiment_label": label
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": "Failed to analyze sentiment", "message": str(e), "trace": trace_to_string()}), 400


@app.route("/api/compare")
def api_compare():
    left = request.args.get("left")
    right = request.args.get("right")
    period = request.args.get("period", "1y")
    if not left or not right:
        return jsonify({"error": "provide left and right tickers"}), 400
    try:
        dleft = fetch_price_history(left, period=period)
        dright = fetch_price_history(right, period=period)
        def summarize(df):
            start = df['Close'].iloc[0]
            end = df['Close'].iloc[-1]
            pct = (end - start) / start * 100.0
            return {"start": float(start), "end": float(end), "pct_change": float(pct)}
        return jsonify({
            "left": {"symbol": left, "summary": summarize(dleft)},
            "right": {"symbol": right, "summary": summarize(dright)}
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e), "trace": trace_to_string()}), 400

# app.py  (add this)
@app.route("/compare")
def compare_page():
    """Renders the compare UI page."""
    return render_template("compare.html")


if __name__ == "__main__":
    app.run(debug=True, host="127.0.0.1", port=5000)
