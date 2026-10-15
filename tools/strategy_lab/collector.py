"""PRAXIS Strategy Lab: audited UTC 1m forward-test collector (stdlib only).

Runs outside ChatGPT's network-restricted sandbox, e.g. on GitHub Actions.
No credentials, no brokerage order endpoints, no retrospective predictions.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import statistics
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "research" / "strategy_lab" / "data"
MARKETS = {"BTC-USD": "XBTUSD", "ETH-USD": "ETHUSD"}
HORIZONS = {5: .05, 15: .10, 60: .20}  # percent units
STRATEGIES = ("MOM20", "MR30", "BASE_LAST")
USER_AGENT = "PRAXIS-Strategy-Lab/1.0 (+github.com/lisboapulse-alt/Praxis)"


def utc(sec: int | float) -> str:
    return datetime.fromtimestamp(sec, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def epoch(s: str) -> int:
    return int(datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp())


def http_json(url: str):
    req = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    with urlopen(req, timeout=18) as response:
        if response.status != 200:
            raise ValueError(f"HTTP status {response.status}")
        return json.load(response)


def read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def append_jsonl(path: Path, rows: list[dict]) -> None:
    if not rows:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n")


def atomic_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def canonicalize(rows: list[dict], now: int) -> list[dict]:
    """Keep ONLY finalized, internally coherent, 1-min UTC bars."""
    result = {}
    for raw in rows:
        bar = {k: float(raw[k]) for k in ("o", "h", "l", "c", "v")}
        t = int(raw["t"])  # bar CLOSE epoch seconds, not open
        if t % 60 or t > now - 10 or t < now - 24 * 3600:
            continue
        if any(not math.isfinite(z) for z in bar.values()):
            continue
        if min(bar["o"], bar["h"], bar["l"], bar["c"]) <= 0 or bar["v"] < 0:
            continue
        if bar["l"] > min(bar["o"], bar["c"]) or bar["h"] < max(bar["o"], bar["c"]):
            continue
        if t in result and result[t] != {"t": t, **bar}:
            raise ValueError("Conflicting 1m candles at identical timestamp")
        result[t] = {"t": t, **bar}
    return [result[t] for t in sorted(result)]


def fetch_coinbase(symbol: str, now: int) -> tuple[list[dict], str]:
    # Maximum 300 1m buckets per request. Fetch 240 minutes.
    params = urlencode({"granularity": 60, "start": utc(now - 240*60), "end": utc(now)})
    url = f"https://api.exchange.coinbase.com/products/{symbol}/candles?{params}"
    payload = http_json(url)
    if not isinstance(payload, list):
        raise ValueError("Coinbase unexpected candle response")
    candles = [{"t": int(r[0])+60, "o": r[3], "h": r[2], "l": r[1], "c": r[4], "v": r[5]} for r in payload if len(r)>=6]
    return canonicalize(candles,now), url


def fetch_kraken(symbol: str, now: int) -> tuple[list[dict], str]:
    pair = MARKETS[symbol]
    url = f"https://api.kraken.com/0/public/OHLC?{urlencode({'pair':pair,'interval':1})}"
    payload = http_json(url)
    if payload.get("error"):
        raise ValueError("Kraken API: " + ",".join(payload["error"]))
    pairs = {k:v for k,v in payload.get("result", {}).items() if k != "last"}
    if len(pairs)!=1:
        raise ValueError("Kraken returned unexpected number of symbols")
    series = next(iter(pairs.values()))
    # Kraken returns its current still-forming candle as final row. Exclude explicitly.
    candles = [{"t": int(r[0])+60, "o":r[1], "h":r[2], "l":r[3], "c":r[4], "v":r[6]} for r in series[:-1] if len(r)>=8]
    return canonicalize(candles,now), url


def choose_source(symbol: str, now: int, errors: list[str]):
    for provider, fun in (("coinbase-exchange",fetch_coinbase),("kraken-spot",fetch_kraken)):
        try:
            rows,url = fun(symbol,now)
            if len(rows)<31:
                raise ValueError(f"Only {len(rows)} finalized 1m candles")
            if now-rows[-1]["t"] > 180:
                raise ValueError("Most recent finalized candle is stale")
            last = rows[-31:]
            if any(b["t"]-a["t"] != 60 for a,b in zip(last,last[1:])):
                raise ValueError("31-candle window contains gaps")
            return {"provider":provider,"symbol":symbol,"url":url,"candles":rows}
        except Exception as e:
            errors.append(f"{symbol}/{provider}: {type(e).__name__}: {str(e)[:160]}")
    return None


def forecasts(closes: list[float]) -> dict[str,str]:
    if len(closes)<31:
        raise ValueError("Need at least 31 finalized closes")
    mom = closes[-1]/closes[-21]-1.0
    momentum = "UP" if mom>0.001 else "DOWN" if mom<-.001 else "FLAT"
    sample = closes[-30:]
    sigma = statistics.pstdev(sample)
    z = (closes[-1]-statistics.mean(sample))/sigma if sigma else 0.0
    mr = "DOWN" if z>=1.5 else "UP" if z<=-1.5 else "FLAT"
    last = "UP" if closes[-1]>closes[-2] else "DOWN" if closes[-1]<closes[-2] else "FLAT"
    return {"MOM20":momentum,"MR30":mr,"BASE_LAST":last}


def determine_outcome(initial: float, final: float, horizon: int) -> tuple[str,float]:
    pct=(final/initial -1)*100
    threshold=HORIZONS[horizon]
    return ("UP" if pct>threshold else "DOWN" if pct< -threshold else "FLAT"),pct


def run(now: int | None=None):
    now=int(time.time()) if now is None else int(now)
    rid="GHA_"+datetime.fromtimestamp(now,timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    errors=[]
    source_results={}
    for symbol in MARKETS:
        result=choose_source(symbol,now,errors)
        if result:
            source_results[symbol]=result
    prior=read_jsonl(DATA/"predictions.jsonl")
    # Maintain provider identity even if the chosen new-forecast feed switches.
    source_cache={(s,r["provider"]):r for s,r in source_results.items()}
    for p in prior:
        k=(p["symbol"],p["provider"])
        if k in source_cache or epoch(p["target_utc"])>now-10:
            continue
        adapter={"coinbase-exchange":fetch_coinbase,"kraken-spot":fetch_kraken}.get(p["provider"])
        if not adapter:
            errors.append(f"Unknown historical provider: {p['provider']}")
            continue
        try:
            bars,url=adapter(p["symbol"],now)
            source_cache[k]={"provider":p["provider"],"symbol":p["symbol"],"url":url,"candles":bars}
        except Exception as exc:
            errors.append(f"validation feed {p['symbol']}/{p['provider']}: {type(exc).__name__}: {str(exc)[:160]}")
    already={p["prediction_id"] for p in prior}
    validations=read_jsonl(DATA/"validations.jsonl")
    validated={v["prediction_id"] for v in validations}
    new_validations=[]
    # Same exact provider/pair AND exact 1-min close timestamp as entry prediction.
    for p in prior:
        if p["prediction_id"] in validated or epoch(p["target_utc"])>now-10:
            continue
        result=source_cache.get((p["symbol"],p["provider"]))
        if result is None:
            continue
        closes={r["t"]:r["c"] for r in result["candles"]}
        target=epoch(p["target_utc"])
        if target not in closes:
            continue
        actual,pct=determine_outcome(float(p["price_initial"]),closes[target],p["horizon_min"])
        new_validations.append({"prediction_id":p["prediction_id"],"run_id":rid,"validated_at_utc":utc(now),"target_utc":p["target_utc"],"actual_price":closes[target],"return_pct":round(pct,8),"actual_class":actual,"correct":p["predicted_class"]==actual,"provider":p["provider"],"symbol":p["symbol"],"source_url":result["url"]})
        validated.add(p["prediction_id"])
    new_predictions=[]
    for symbol, result in source_results.items():
        candles=result["candles"]
        last=candles[-1]
        t0=last["t"]
        # Never backdate a forward-test, and do not emit if the earliest horizon is matured.
        if now>=t0+5*60-10:
            errors.append(f"{symbol}: last available candle too old to forecast 5m")
            continue
        signals=forecasts([x["c"] for x in candles])
        for strategy in STRATEGIES:
            for minutes in HORIZONS:
                pid=f"{result['provider']}|{symbol}|{strategy}|v1|{minutes}m|{t0}"
                if pid in already:
                    continue
                new_predictions.append({"prediction_id":pid,"run_id":rid,"issued_at_utc":utc(now),"t0_utc":utc(t0),"target_utc":utc(t0+minutes*60),"symbol":symbol,"provider":result["provider"],"strategy":strategy,"version":"1.0","horizon_min":minutes,"predicted_class":signals[strategy],"price_initial":last["c"],"source_url":result["url"],"input_1m_candles":len(candles),"input_through_utc":utc(t0),"flat_threshold_pct":HORIZONS[minutes],"probabilities":None})
                already.add(pid)
    append_jsonl(DATA/"predictions.jsonl",new_predictions)
    append_jsonl(DATA/"validations.jsonl",new_validations)
    snapshots={m:{"provider":r["provider"],"url":r["url"],"latest_final_candle_utc":utc(r["candles"][-1]["t"]),"candles":r["candles"][-240:]} for m,r in source_results.items()}
    atomic_json(DATA/"latest.json", {"updated_at_utc":utc(now),"instruments":snapshots})
    total_validations=validations+new_validations
    all_pred=prior+new_predictions
    byid={p["prediction_id"]:p for p in all_pred}
    groups=defaultdict(list)
    for v in total_validations:
        p=byid.get(v["prediction_id"])
        if p:
            groups[(p["provider"],p["symbol"],p["strategy"],p["horizon_min"])].append(v)
    scorecard=[{"provider":k[0],"symbol":k[1],"strategy":k[2],"horizon_min":k[3],"n":len(vs),"n_correct":sum(v["correct"] for v in vs),"accuracy":sum(v["correct"] for v in vs)/len(vs),"note":"Horizons overlap: observations not independent; no winner declaration"} for k,vs in sorted(groups.items())]
    atomic_json(DATA/"scorecard.json",{"updated_at_utc":utc(now),"scores":scorecard})
    status="OK" if len(source_results)==len(MARKETS) else "PARTIAL" if source_results else "NO_MARKET_DATA"
    report={"run_id":rid,"at_utc":utc(now),"status":status,"sources":{k:r["provider"] for k,r in source_results.items()},"new_predictions":len(new_predictions),"new_validations":len(new_validations),"total_predictions":len(all_pred),"total_validations":len(total_validations),"errors":errors,"note":"No live orders; signals are research-only; Excel sync is performed separately by scheduled ChatGPT task"}
    append_jsonl(DATA/"runs.jsonl",[report])
    print(json.dumps(report,ensure_ascii=False,indent=2))
    return report


if __name__=="__main__":
    run()