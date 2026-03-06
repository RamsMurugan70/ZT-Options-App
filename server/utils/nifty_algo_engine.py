import yfinance as yf
import pandas as pd
from datetime import datetime, time
import time as pytime
import json
import sys

def fetch_data_up_to_930():
    try:
        # Fetch 5-minute data
        df = yf.download("^NSEI", period="5d", interval="5m", progress=False)
        vix = yf.download("^INDIAVIX", period="2d", interval="1d", progress=False)
        
        if df is None or df.empty:
            return None, None, "Failed to fetch NIFTY data."
            
        if isinstance(df.columns, pd.MultiIndex): 
            df.columns = df.columns.get_level_values(0)
        if isinstance(vix.columns, pd.MultiIndex): 
            vix.columns = vix.columns.get_level_values(0)
            
        return df, vix, None
    except Exception as e:
        return None, None, f"Error: {e}"

def calculate_risk_score(df, vix_df):
    now = datetime.now()
    today_date = now.date()
    # Filter df for today
    today_df = df[df.index.date == today_date].copy()
    
    # Filter df for previous days
    prev_days = df[df.index.date < today_date]
    if prev_days.empty or today_df.empty:
        return None, "Not enough market data for today/yesterday to calculate score."
        
    prev_close = prev_days.iloc[-1]["Close"]
    
    # We need data up to ~9:30 AM. In yfinance, the first three 5m candles are 09:15, 09:20, 09:25
    first_15m = today_df.iloc[:3]
    if len(first_15m) < 3:
        return None, "Market just opened. Not enough 5m candles yet to calculate the 15-minute breakouts."
        
    open_price = first_15m.iloc[0]["Open"]
    min15_high = first_15m["High"].max()
    min15_low = first_15m["Low"].min()
    current_spot_930 = first_15m.iloc[2]["Close"]
    
    current_vix = vix_df["Close"].iloc[-1]
    
    # Calculation
    risk_score = 0
    warnings = []
    
    gap_pct = ((open_price - prev_close) / prev_close) * 100
    
    if gap_pct <= -1.5:
        risk_score += 4
        warnings.append(f"Severe Gap Down ({gap_pct:.2f}%). High panic.")
    elif gap_pct <= -0.75:
        risk_score += 2
        warnings.append(f"Moderate Gap Down ({gap_pct:.2f}%). Elevated risk.")
    elif gap_pct >= 1.0:
        risk_score += 3
        warnings.append(f"Severe Gap Up ({gap_pct:.2f}%). Profit-taking reversal risk.")
        
    if current_vix >= 22.0:
        risk_score += 3
        warnings.append(f"VIX Extreme ({current_vix:.2f}). Massive intraday swings priced in.")
    elif current_vix >= 18.0:
        risk_score += 2
        warnings.append(f"VIX Elevated ({current_vix:.2f}). Premiums are fat, but risky.")
        
    is_breaking_high = current_spot_930 > min15_high
    is_breaking_low = current_spot_930 < min15_low
    
    if gap_pct < 0 and is_breaking_high:
        risk_score += 3
        warnings.append("V-Shape Reversal! Gapped down but breaking 15m High. DEADLY for Call Sellers.")
    elif gap_pct > 0 and is_breaking_low:
        risk_score += 2
        warnings.append("Trap Reversal! Gapped up but breaking 15m Low. Dangerous for Put Sellers.")
        
    if is_breaking_high and current_vix > 18:
        risk_score += 1
        warnings.append("Breakout occurring alongside high volatility. Explosive move likely.")

    risk_score = min(risk_score, 10)
    
    action = "🟢 SAFE TO SELL (Naked)"
    if risk_score >= 8:
        action = "🔴 DO NOT TRADE"
    elif risk_score >= 5:
        action = "🟡 TRADE WITH HEDGE (e.g. Bear Call Spread ONLY)"
        
    return {
        "score": risk_score,
        "action": action,
        "warnings": warnings,
        "gap": gap_pct,
        "vix": current_vix
    }, None

def run_headless_check():
    now = datetime.now()
    current_time = now.time()
    ts = f"[{now.strftime('%H:%M')}]"
    
    if current_time < time(9, 15) or current_time > time(15, 30):
        return f"{ts} 🌙 market closed, execute this on a trading day at 9:30AM."

    if current_time >= time(9, 15) and current_time < time(9, 30):
        # We need to wait
        target_time = now.replace(hour=9, minute=30, second=5, microsecond=0)
        wait_seconds = (target_time - datetime.now()).total_seconds()
        
        # User requested to "say 'waiting till 9:30AM...' and hang there"
        # We can't print natively because Node expects a single JSON, but we will block execution.
        # Note: If triggered from UI, the UI will just spin until we return.
        pytime.sleep(wait_seconds)
        
        # After sleeping, update time
        now = datetime.now()
        current_time = now.time()
        ts = f"[{now.strftime('%H:%M')}]"

    df, vix_df, err = fetch_data_up_to_930()
    if err:
        return f"{ts} ⚠️ {err}"
        
    # HOLIDAY CHECK: If today's date does not exist in the fetched yfinance data, the market is closed.
    today_date = now.date()
    if today_date not in df.index.date:
        return f"{ts} 🌙 Market closed today (Weekend or Holiday)."
        
    score_data, err = calculate_risk_score(df, vix_df)
    if err:
        return f"{ts} ⚠️ {err}"
        
    score = score_data['score']
    action = score_data['action']
    gap = score_data['gap']
    vix = score_data['vix']
    warnings_list = score_data['warnings']
    
    base_msg = (
        f"{ts} 📊 9:30 AM MARKET RISK SCORE: {score}/10\n"
        f"Recommendation: {action}\n"
        f"Gap: {gap:.2f}% | India VIX: {vix:.2f}\n"
    )
    
    if warnings_list:
        joined_warns = "\n - ".join(warnings_list)
        base_msg += f"\nRisk Factors:\n - {joined_warns}\n"
        
    if current_time >= time(12, 0):
        base_msg += "\n⚠️ CAUTION: You may be taking the positions a bit too late and I used data available only upto 9:30AM, so be cautious and do more research before taking positions."
        
    return base_msg

if __name__ == "__main__":
    result_string = run_headless_check()
    print(json.dumps({"result": result_string}))
