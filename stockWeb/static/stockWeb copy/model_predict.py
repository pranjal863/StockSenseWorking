# model_predict.py
import pandas as pd
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import r2_score, mean_squared_error
import joblib
from datetime import timedelta

def prepare_features(df, n_lags=10):
    """
    Build lag features from df: expects df with 'Close' and computed indicators.
    Returns features X and target y (next-day Close).
    """
    df2 = df.copy()
    # ensure there's a date column and convert
    if 'date' in df2.columns:
        df2['date'] = pd.to_datetime(df2['date'])
        df2 = df2.sort_values("date").reset_index(drop=True)
    else:
        # if no date, try to use index after resetting
        df2 = df2.reset_index()
        if 'date' in df2.columns:
            df2['date'] = pd.to_datetime(df2['date'])
            df2 = df2.sort_values("date").reset_index(drop=True)

    # Create lagged closes (safely)
    if 'Close' not in df2.columns:
        raise ValueError("DataFrame must contain 'Close' column for modeling")

    for lag in range(1, n_lags+1):
        df2[f'close_lag_{lag}'] = df2['Close'].shift(lag)

    # fill indicator NaNs with forward/backfill then 0
    df2 = df2.fillna(method='ffill').fillna(0)

    # target is next day's Close
    df2['target'] = df2['Close'].shift(-1)

    # drop rows without target
    df2 = df2.dropna(subset=['target']).reset_index(drop=True)

    # feature columns: only include what exists
    possible_features = [f'close_lag_{i}' for i in range(1, n_lags+1)] + ['sma7','sma30','ema20','rsi','macd','volatility']
    feature_cols = [c for c in possible_features if c in df2.columns]

    if len(feature_cols) == 0:
        raise ValueError("No feature columns available for training")

    X = df2[feature_cols]
    y = df2['target']
    return X, y, df2

def train_predict_model(df, n_lags=10):
    """
    Train a RandomForest on historical features and return:
      - dict with prediction, confidence and r2
      - trained model object (in memory)
      - list of feature column names
    """
    X, y, df2 = prepare_features(df, n_lags=n_lags)

    # require a minimum number of rows for training
    if len(X) < 50:
        return {"error":"not enough historical data"}, None, None

    tscv = TimeSeriesSplit(n_splits=3)
    rmses = []
    r2s = []
    models = []

    for train_idx, test_idx in tscv.split(X):
        Xtr, Xte = X.iloc[train_idx], X.iloc[test_idx]
        ytr, yte = y.iloc[train_idx], y.iloc[test_idx]
        m = RandomForestRegressor(n_estimators=100, random_state=42)
        m.fit(Xtr, ytr)
        ypred = m.predict(Xte)
        r2s.append(r2_score(yte, ypred))
        rmses.append(mean_squared_error(yte, ypred, squared=False))
        models.append(m)

    # final model trained on all data
    final_model = RandomForestRegressor(n_estimators=200, random_state=42)
    final_model.fit(X, y)

    # predict next day using last available features
    last_row = X.iloc[[-1]]
    pred = final_model.predict(last_row)[0]

    # confidence derived from mean R^2 (clamped)
    mean_r2 = np.nanmean(r2s) if r2s else 0.0
    mean_r2 = max(min(mean_r2, 1.0), -1.0)
    conf = (mean_r2 + 0.5) / 1.5
    conf_score = float(max(0, min(1, conf)) * 100)

    return {"prediction": float(pred), "confidence": conf_score, "r2": float(mean_r2)}, final_model, X.columns.tolist()