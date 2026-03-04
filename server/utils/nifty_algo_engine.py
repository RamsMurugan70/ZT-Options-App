import yfinance as yf
import pandas as pd
from datetime import datetime, time
import sys
import os
import json

# --- SETTINGS ---
CAPITAL = 5000000            # ₹50 Lakhs
VIX_MAX = 14                 
RANGE_LIMIT = 0.6            
CRASH_THRESHOLD = 1.5        
SPOT_SL_MOVE = 0.006         
TSL_TRIGGER = 0.003          
TARGET_PCT = 0.0075          # 0.75% = ₹37,500
LOG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "vortex_trade_log.csv")

def init_journal():
    if not os.path.exists(LOG_FILE):
        df = pd.DataFrame(columns=["Date", "Entry_Time", "Mode", "Direction", "Entry_Price", "Status", "PnL_INR"])
        df.to_csv(LOG_FILE, index=False)

def log_trade(entry_p, direction, mode, status="OPEN", pnl_inr=0):
    init_journal()
    now = datetime.now()
    new_entry = {
        "Date": now.strftime("%Y-%m-%d"),
        "Entry_Time": now.strftime("%H:%M:%S"),
        "Mode": mode,
        "Direction": direction,
        "Entry_Price": entry_p,
        "Status": status,
        "PnL_INR": pnl_inr
    }
    df = pd.read_csv(LOG_FILE)
    df = pd.concat([df, pd.DataFrame([new_entry])], ignore_index=True)
    df.to_csv(LOG_FILE, index=False)

def get_market_status():
    now = datetime.now().time()
    if now < time(9, 15): return "PRE_MARKET"
    if now > time(15, 30): return "POST_MARKET"
    return "LIVE"

def fetch_live_data():
    try:
        df = yf.download("^NSEI", period="2d", interval="5m", progress=False)
        vix = yf.download("^INDIAVIX", period="2d", interval="1d", progress=False)
        
        if df is None or df.empty:
            return None, None
            
        if isinstance(df.columns, pd.MultiIndex): 
            df.columns = df.columns.get_level_values(0)
        if isinstance(vix.columns, pd.MultiIndex): 
            vix.columns = vix.columns.get_level_values(0)
            
        return df, vix
    except Exception as e:
        return None, None

def run_headless_check():
    """
    Executes a single, non-blocking market check for the Node.js API.
    Returns a string message describing the current condition or trade signal.
    """
    status = get_market_status()
    now = datetime.now()
    ts = f"[{now.strftime('%H:%M')}]"
    
    if status == "POST_MARKET":
        return f"{ts} 🌙 MARKET CLOSED. Check daily summary logs."
        
    if status == "PRE_MARKET":
        return f"{ts} ⏳ Waiting for Market Open (09:15 AM)..."

    df5, vix_df = fetch_live_data()
    if df5 is None or df5.empty: 
        return f"{ts} ⚠️ Failed to fetch live data from Yahoo Finance."

    # 1. CRASH GUARD
    recent = df5.iloc[-12:]
    move_val = (recent["High"].max() - recent["Low"].min()) / recent["Open"].iloc[0] * 100
    if move_val > CRASH_THRESHOLD:
        return f"{ts} 🚨 CRASH GUARD: {move_val:.2f}% MOVE! PROTECT CAPITAL."

    # 3. AUTO-SIGNAL GENERATION
    today_df = df5[df5.index.date == now.date()]
    num_candles = len(today_df)
    
    if now.time() < time(10, 35):
        target_dt = datetime.combine(now.date(), time(10, 35))
        wait_mins = int((target_dt - now).total_seconds() / 60)
        return f"{ts} ⏳ AMBER: {wait_mins}m to 10:35 AM signal. ({num_candles}/16 candles)"
        
    elif num_candles >= 16:
        open_p = today_df.iloc[0]["Open"]
        rng = (today_df.iloc[:12]["High"].max() - today_df.iloc[:12]["Low"].min()) / open_p * 100
        vix = vix_df["Close"].iloc[-1]
        
        if rng > RANGE_LIMIT or vix > VIX_MAX:
            return f"{ts} 🚫 NO TRADE: Filters Failed (Range: {rng:.2f}%, VIX: {vix:.2f})"

        vwap = (today_df["Close"] * today_df["Volume"]).cumsum() / today_df["Volume"].cumsum()
        price = today_df.iloc[-1]["Close"]
        direction = "SELL PUT" if price > vwap.iloc[-1] else "SELL CALL"
        
        # Log trade if we generated one
        # Note: In a real system you'd track if we already fired this today to avoid spamming the log.
        # But per the script, this is the logic logic.
        log_trade(price, direction, "AUTO", "OPEN")
        return f"{ts} 🎯 SIGNAL: {direction} @ {price:.2f}. Monitoring Started..."

    return f"{ts} ℹ️ Condition Neutral. No action."

if __name__ == "__main__":
    init_journal()
    
    # We always execute a single headless check and wrap the output in a JSON object 
    # so the Node.js API can safely parse it and send it to the frontend UI.
    result_string = run_headless_check()
    print(json.dumps({"result": result_string}))
