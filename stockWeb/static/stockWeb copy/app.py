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
import io

# load .env
load_dotenv()
ALPHAVANTAGE_KEY = os.getenv("ALPHAVANTAGE_KEY")
NEWSAPI_KEY = os.getenv("NEWSAPI_KEY")  # set in your .env if you want news

app = Flask(__name__, static_folder="static", template_folder="templates")
analyzer = SentimentIntensityAnalyzer()

def trace_to_string():
    buf = io.StringIO()
    traceback.print_exc(file=buf)
    txt = buf.getvalue()
    lines = txt.strip().splitlines()
    return "\n".join(lines[-12:])

@app.route("/")
def home():
    return render_template("index.html")

# in app.py: replace the compare_page route with this
@app.route("/compare")
def compare_page():
    """
    Serve a dedicated compare page which loads the static/compare.js script.
    The compare.js file should implement the UI & behavior (fetch /api/compare).
    """
    return render_template("compare.html")


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

@app.route("/api/history/<symbol>")
def api_history(symbol):
    period = request.args.get("period", "1mo")
    interval = request.args.get("interval", "1d")
    try:
        df = fetch_price_history(symbol, period=period, interval=interval)
        ind = compute_indicators(df)
        if 'date' not in ind.columns:
            ind = ind.reset_index().rename(columns={ind.columns[0]:'date'})
        try:
            ind['date'] = pd.to_datetime(ind['date']).dt.strftime('%Y-%m-%dT%H:%M:%S')
        except Exception:
            ind['date'] = ind['date'].astype(str)
        ind = ind.replace({np.nan: None})
        records = ind.to_dict(orient="records")
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
        return jsonify({"error":"Failed to fetch/process history","message":str(e),"trace":trace_to_string()}), 400

@app.route("/api/predict/<symbol>", methods=["GET"])
def api_predict(symbol):
    period = request.args.get("period", "2y")
    interval = request.args.get("interval", "1d")
    try:
        df = fetch_price_history(symbol, period=period, interval=interval)
        df_ind = compute_indicators(df)
        if 'date' not in df_ind.columns:
            df_ind = df_ind.reset_index().rename(columns={df_ind.columns[0]:'date'})
        result, model, features = train_predict_model(df_ind, n_lags=10)
        if isinstance(result, dict) and "error" in result:
            return jsonify({"error":"model_error","detail": result.get("error")}), 400
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
        return jsonify({"error":"Failed to predict","message":str(e),"trace":trace_to_string()}), 400

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
            return {"count":0,"avg_compound":0,"pos":0,"neg":0,"neu":0}
        compounds = [s['compound'] for s in scores]
        return {
            "count": len(scores),
            "avg_compound": float(sum(compounds)/len(compounds)),
            "pos": float(sum(s['pos'] for s in scores)/len(scores)),
            "neg": float(sum(s['neg'] for s in scores)/len(scores)),
            "neu": float(sum(s['neu'] for s in scores)/len(scores))
        }
    try:
        hscore = score_list(headlines)
        tscore = score_list(tweets)
        ascore = score_list(announcements)
        total_count = hscore["count"] + tscore["count"] + ascore["count"]
        if total_count == 0:
            overall = {"compound":0}
        else:
            overall_comp = (hscore["avg_compound"]*hscore["count"] + tscore["avg_compound"]*tscore["count"] + ascore["avg_compound"]*ascore["count"]) / total_count
            overall = {"compound": overall_comp}
        comp = overall["compound"]
        label = "neutral"
        if comp >= 0.05: label = "positive"
        elif comp <= -0.05: label = "negative"
        return jsonify({
            "headline": hscore,
            "tweets": tscore,
            "announcements": ascore,
            "overall_compound": overall["compound"],
            "sentiment_label": label
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error":"Failed to analyze sentiment","message":str(e),"trace":trace_to_string()}), 400

@app.route("/api/compare")
def api_compare():
    left = request.args.get("left")
    right = request.args.get("right")
    period = request.args.get("period", "1y")
    if not left or not right:
        return jsonify({"error":"provide left and right tickers"}), 400
    try:
        dleft = fetch_price_history(left, period=period)
        dright = fetch_price_history(right, period=period)
        def summarize(df):
            start = df['Close'].iloc[0]
            end = df['Close'].iloc[-1]
            pct = (end - start)/start*100.0
            return {"start": float(start), "end": float(end), "pct_change": float(pct)}
        return jsonify({
            "left": {"symbol": left, "summary": summarize(dleft)},
            "right": {"symbol": right, "summary": summarize(dright)}
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e), "trace": trace_to_string()}), 400

@app.route("/api/extras/<symbol>")
def api_extras(symbol):
    """
    Returns { news: [...], _errors?: {...} }
    Uses NewsAPI.org (NEWSAPI_KEY required in .env).
    """
    q_param = request.args.get("q", "")
    company_q = q_param.strip() or symbol
    results = {"news": []}
    errors = {}

    if NEWSAPI_KEY:
        try:
            params = {
                "q": company_q,
                "pageSize": 12,
                "sortBy": "publishedAt",
                "language": "en",
                "apiKey": NEWSAPI_KEY
            }
            resp = requests.get("https://newsapi.org/v2/everything", params=params, timeout=12)
            data = resp.json()
            if resp.status_code == 200 and data.get("articles"):
                for a in data.get("articles", [])[:12]:
                    results["news"].append({
                        "title": a.get("title"),
                        "source": a.get("source", {}).get("name"),
                        "url": a.get("url"),
                        "publishedAt": a.get("publishedAt"),
                        "description": a.get("description")
                    })
            else:
                errors["newsapi"] = data.get("message") or data.get("status") or f"HTTP {resp.status_code}"
        except Exception as e:
            errors["newsapi"] = str(e)
    else:
        errors["newsapi"] = "NEWSAPI_KEY not set in .env"

    if errors:
        results["_errors"] = errors
    return jsonify(results)

if __name__ == "__main__":
    app.run(debug=True, host="127.0.0.1", port=5000)