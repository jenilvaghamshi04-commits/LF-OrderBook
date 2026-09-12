"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, AlertCircle, BellRing, RefreshCw, Settings, Volume2, VolumeX, Wifi, X } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type Level = [string, string];
type Book = { asks: Level[]; bids: Level[]; id?: number; current?: number; update?: number };
type DepthAlert = { id: string; side: "Buy" | "Sell"; value: number; threshold: number; time: Date };
const ROWS = 18;
const DEPTH_RANGE_PERCENT = 2;
const RE_ALERT_INTERVAL_MS = 60_000;
const DEFAULT_DEPTH_THRESHOLD = 400;
const BUY_THRESHOLD_STORAGE_KEY = "lf-orderbook-buy-depth-threshold";
const SELL_THRESHOLD_STORAGE_KEY = "lf-orderbook-sell-depth-threshold";
const LEGACY_THRESHOLD_STORAGE_KEY = "lf-orderbook-depth-threshold";

function calculateDepth(book: Book) {
  const bestAsk = Number(book.asks?.[0]?.[0]);
  const bestBid = Number(book.bids?.[0]?.[0]);
  const midpoint = bestAsk > 0 && bestBid > 0 ? (bestAsk + bestBid) / 2 : 0;
  if (!midpoint) return { midpoint: 0, buy: 0, sell: 0 };

  const lowerBound = midpoint * (1 - DEPTH_RANGE_PERCENT / 100);
  const upperBound = midpoint * (1 + DEPTH_RANGE_PERCENT / 100);
  const total = (levels: Level[], side: "buy" | "sell") => levels.reduce((sum, [rawPrice, rawAmount]) => {
    const levelPrice = Number(rawPrice);
    const levelAmount = Number(rawAmount);
    if (!Number.isFinite(levelPrice) || !Number.isFinite(levelAmount) || levelAmount <= 0) return sum;
    const isInRange = side === "buy"
      ? levelPrice >= lowerBound && levelPrice <= midpoint
      : levelPrice >= midpoint && levelPrice <= upperBound;
    return isInRange ? sum + levelPrice * levelAmount : sum;
  }, 0);

  return { midpoint, buy: total(book.bids || [], "buy"), sell: total(book.asks || [], "sell") };
}

function price(value: string) {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n >= 1
    ? n.toLocaleString(undefined, { maximumFractionDigits: 6 })
    : n.toLocaleString(undefined, { minimumFractionDigits: 6, maximumFractionDigits: 10 });
}

function amount(value: string) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : value;
}

function usdtValue(value: number) {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function OrderRows({ rows, side, midpoint }: { rows: Level[]; side: "ask" | "bid"; midpoint: number }) {
  const levels = useMemo(() => rows.map(([p, a]) => [p, a, Number(p) * Number(a)] as const), [rows]);
  const max = Math.max(...levels.map(([, , value]) => value), 1);

  return <div className="book-rows">{levels.map(([p, a, value], i) => {
    const distance = midpoint ? Math.abs((Number(p) - midpoint) / midpoint) * 100 : 100;
    const distanceClass = distance < 2 ? "distance-under-2" : distance <= 5 ? "distance-2-to-5" : "distance-over-5";
    return (
    <div className={`book-row ${distanceClass}`} key={`${side}-${p}-${i}`}>
      <span className="depth" style={{ width: `${Math.max(2, (value / max) * 100)}%` }} />
      <span className="mono price">{price(p)}</span>
      <span className="mono">{amount(a)}</span>
      <span className="mono muted">{usdtValue(value)}</span>
    </div>
  );})}</div>;
}

export default function Home() {
  const [book, setBook] = useState<Book | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [buyThreshold, setBuyThreshold] = useState(DEFAULT_DEPTH_THRESHOLD);
  const [sellThreshold, setSellThreshold] = useState(DEFAULT_DEPTH_THRESHOLD);
  const [buyThresholdDraft, setBuyThresholdDraft] = useState(String(DEFAULT_DEPTH_THRESHOLD));
  const [sellThresholdDraft, setSellThresholdDraft] = useState(String(DEFAULT_DEPTH_THRESHOLD));
  const [alerts, setAlerts] = useState<DepthAlert[]>([]);
  const audioContext = useRef<AudioContext | null>(null);
  const soundEnabledRef = useRef(false);
  const depthThresholdRef = useRef({ buy: DEFAULT_DEPTH_THRESHOLD, sell: DEFAULT_DEPTH_THRESHOLD });
  const latestDepth = useRef({ buy: 0, sell: 0, ready: false });
  const previousLowState = useRef({ buy: false, sell: false, ready: false });
  const lastAlertAt = useRef({ buy: 0, sell: 0 });
  const alarmInterval = useRef<number | null>(null);
  const alarmTimeout = useRef<number | null>(null);

  const ring = useCallback((context: AudioContext) => {
    const notes = [740, 980];
    notes.forEach((frequency, index) => {
      const start = context.currentTime + index * 0.22;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "square";
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.62, start + 0.025);
      gain.gain.setValueAtTime(0.62, start + 0.15);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.21);
      oscillator.connect(gain); gain.connect(context.destination);
      oscillator.start(start); oscillator.stop(start + 0.22);
    });
  }, []);

  const getAudioContext = useCallback(() => {
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return null;
    audioContext.current ||= new AudioContextClass();
    return audioContext.current;
  }, []);

  const stopAlarm = useCallback(() => {
    if (alarmInterval.current !== null) window.clearInterval(alarmInterval.current);
    if (alarmTimeout.current !== null) window.clearTimeout(alarmTimeout.current);
    alarmInterval.current = null;
    alarmTimeout.current = null;
  }, []);

  const playAlert = useCallback(async () => {
    if (!soundEnabledRef.current) return;
    const context = getAudioContext();
    if (!context) return;
    if (context.state === "suspended") await context.resume().catch(() => undefined);
    if (context.state === "running") {
      stopAlarm();
      ring(context);
      alarmInterval.current = window.setInterval(() => ring(context), 900);
      alarmTimeout.current = window.setTimeout(stopAlarm, 30000);
    }
    if ("vibrate" in navigator) navigator.vibrate([120, 60, 120]);
  }, [getAudioContext, ring, stopAlarm]);

  const enableSound = useCallback(async () => {
    const context = getAudioContext();
    if (!context) return;
    await context.resume();
    soundEnabledRef.current = true;
    setSoundEnabled(true);
    localStorage.setItem("lf-orderbook-sound", "enabled");
    const threshold = depthThresholdRef.current;
    if (latestDepth.current.ready && (latestDepth.current.buy < threshold.buy || latestDepth.current.sell < threshold.sell)) {
      void playAlert();
    } else {
      ring(context);
    }
  }, [getAudioContext, playAlert, ring]);

  const toggleSound = useCallback(async () => {
    if (soundEnabledRef.current) {
      soundEnabledRef.current = false;
      setSoundEnabled(false);
      localStorage.removeItem("lf-orderbook-sound");
      stopAlarm();
      if ("vibrate" in navigator) navigator.vibrate(0);
      return;
    }
    await enableSound();
  }, [enableSound, stopAlarm]);

  const testSound = useCallback(async () => {
    if (!soundEnabledRef.current) return;
    const context = getAudioContext();
    if (!context) return;
    if (context.state === "suspended") await context.resume().catch(() => undefined);
    if (context.state === "running") ring(context);
  }, [getAudioContext, ring]);

  useEffect(() => {
    const legacyThreshold = Number(localStorage.getItem(LEGACY_THRESHOLD_STORAGE_KEY));
    const storedBuy = Number(localStorage.getItem(BUY_THRESHOLD_STORAGE_KEY));
    const storedSell = Number(localStorage.getItem(SELL_THRESHOLD_STORAGE_KEY));
    const fallback = Number.isFinite(legacyThreshold) && legacyThreshold > 0 ? legacyThreshold : DEFAULT_DEPTH_THRESHOLD;
    const savedBuy = Number.isFinite(storedBuy) && storedBuy > 0 ? storedBuy : fallback;
    const savedSell = Number.isFinite(storedSell) && storedSell > 0 ? storedSell : fallback;
    depthThresholdRef.current = { buy: savedBuy, sell: savedSell };
    queueMicrotask(() => {
      setBuyThreshold(savedBuy);
      setSellThreshold(savedSell);
      setBuyThresholdDraft(String(savedBuy));
      setSellThresholdDraft(String(savedSell));
    });
    if (localStorage.getItem("lf-orderbook-sound") !== "enabled") return;
    soundEnabledRef.current = true;
    queueMicrotask(() => setSoundEnabled(true));
    const unlock = async () => {
      const context = getAudioContext();
      if (context?.state === "suspended") await context.resume().catch(() => undefined);
    };
    window.addEventListener("pointerdown", unlock, { once:true });
    window.addEventListener("keydown", unlock, { once:true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [getAudioContext]);

  useEffect(() => () => stopAlarm(), [stopAlarm]);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/orderbook", { cache: "no-store" });
      const data = await response.json() as Book & { message?: string };
      if (!response.ok) throw new Error(data?.message || "Order book unavailable");
      const depth = calculateDepth(data);
      if (!depth.midpoint) throw new Error("Order book does not contain a valid bid and ask");
      latestDepth.current = { buy: depth.buy, sell: depth.sell, ready: true };
      const thresholds = depthThresholdRef.current;
      const lowState = { buy: depth.buy < thresholds.buy, sell: depth.sell < thresholds.sell };
      const previous = previousLowState.current;
      const now = Date.now();
      const detected: DepthAlert[] = [];
      const buyAlertDue = !previous.ready || !previous.buy || now - lastAlertAt.current.buy >= RE_ALERT_INTERVAL_MS;
      const sellAlertDue = !previous.ready || !previous.sell || now - lastAlertAt.current.sell >= RE_ALERT_INTERVAL_MS;
      if (lowState.buy && buyAlertDue) {
        detected.push({ id:`Buy-${now}`, side:"Buy", value:depth.buy, threshold:thresholds.buy, time:new Date() });
        lastAlertAt.current.buy = now;
      }
      if (lowState.sell && sellAlertDue) {
        detected.push({ id:`Sell-${now}`, side:"Sell", value:depth.sell, threshold:thresholds.sell, time:new Date() });
        lastAlertAt.current.sell = now;
      }
      if (!lowState.buy) lastAlertAt.current.buy = 0;
      if (!lowState.sell) lastAlertAt.current.sell = 0;
      previousLowState.current = { ...lowState, ready: true };
      if (detected.length) {
        setAlerts((current) => [...detected.reverse(), ...current].slice(0, 5));
        void playAlert();
      }
      setBook(data); setUpdatedAt(new Date()); setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Order book unavailable");
    } finally { setLoading(false); }
  }, [playAlert]);

  useEffect(() => {
    queueMicrotask(() => void load());
    const timer = window.setInterval(load, 3000);
    return () => window.clearInterval(timer);
  }, [load]);

  const asks = useMemo(() => [...(book?.asks || [])].slice(0, ROWS).reverse(), [book]);
  const bids = useMemo(() => (book?.bids || []).slice(0, ROWS), [book]);
  const bestAsk = Number(book?.asks?.[0]?.[0]);
  const bestBid = Number(book?.bids?.[0]?.[0]);
  const midpoint = bestAsk && bestBid ? (bestAsk + bestBid) / 2 : 0;
  const spread = bestAsk && bestBid ? bestAsk - bestBid : 0;
  const spreadPct = midpoint ? (spread / midpoint) * 100 : 0;
  const depth = useMemo(() => book ? calculateDepth(book) : { midpoint: 0, buy: 0, sell: 0 }, [book]);
  const buyLiquidity = depth.buy;
  const sellLiquidity = depth.sell;
  const buyDepthLow = Boolean(book) && buyLiquidity < buyThreshold;
  const sellDepthLow = Boolean(book) && sellLiquidity < sellThreshold;

  const saveThresholds = useCallback(() => {
    const nextBuyThreshold = Number(buyThresholdDraft);
    const nextSellThreshold = Number(sellThresholdDraft);
    if (!Number.isFinite(nextBuyThreshold) || nextBuyThreshold <= 0 || !Number.isFinite(nextSellThreshold) || nextSellThreshold <= 0) return;
    depthThresholdRef.current = { buy: nextBuyThreshold, sell: nextSellThreshold };
    setBuyThreshold(nextBuyThreshold);
    setSellThreshold(nextSellThreshold);
    localStorage.setItem(BUY_THRESHOLD_STORAGE_KEY, String(nextBuyThreshold));
    localStorage.setItem(SELL_THRESHOLD_STORAGE_KEY, String(nextSellThreshold));
    localStorage.removeItem(LEGACY_THRESHOLD_STORAGE_KEY);
    previousLowState.current = { buy: false, sell: false, ready: false };
    lastAlertAt.current = { buy: 0, sell: 0 };
    stopAlarm();
  }, [buyThresholdDraft, sellThresholdDraft, stopAlarm]);

  const thresholdDraftsValid = Number.isFinite(Number(buyThresholdDraft)) && Number(buyThresholdDraft) > 0
    && Number.isFinite(Number(sellThresholdDraft)) && Number(sellThresholdDraft) > 0;

  return <main>
    <header className="topbar">
      <div className="brand" aria-label="LF order book">
        <span className="brand-mark">LF</span>
        <span className="brand-copy"><strong>LF / USDT</strong><small>Spot order book</small></span>
      </div>
      <div className="source">
        <span className={`live-dot ${error ? "offline" : ""}`} />
        <span>{error ? "Connection issue" : "Live · Gate.io"}</span>
        <button className={`sound-button sound-toggle ${soundEnabled ? "enabled" : ""}`} onClick={toggleSound} aria-pressed={soundEnabled} aria-label={soundEnabled ? "Turn sound alerts off" : "Turn sound alerts on"} title={soundEnabled ? "Turn sound off" : "Turn sound on"}>
          {soundEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
          <b>{soundEnabled ? "Sound on" : "Sound off"}</b>
        </button>
        <button className="sound-button test-button" onClick={testSound} disabled={!soundEnabled} aria-label="Test notification sound" title="Test notification sound">
          <BellRing size={15} />
          <b>Test</b>
        </button>
        <Dialog onOpenChange={(open) => { if (open) { setBuyThresholdDraft(String(buyThreshold)); setSellThresholdDraft(String(sellThreshold)); } }}>
          <DialogTrigger asChild><button aria-label="Depth alert settings" title="Depth alert settings"><Settings size={15} /></button></DialogTrigger>
          <DialogContent className="settings-dialog">
            <DialogHeader>
              <DialogTitle>Depth alert setting</DialogTitle>
              <DialogDescription>Set separate alarm targets for buy and sell depth within 2% of the mid-price.</DialogDescription>
            </DialogHeader>
            <div className="threshold-fields">
              <label className="threshold-field buy-threshold-field">
                <span><i className="liquidity-dot buy-dot" />Buy-side minimum depth</span>
                <div><input type="number" min="1" step="1" inputMode="decimal" value={buyThresholdDraft} onChange={(event) => setBuyThresholdDraft(event.target.value)} aria-describedby="buy-threshold-help" /><b>USDT</b></div>
                <small id="buy-threshold-help">Current buy setting: {usdtValue(buyThreshold)} USDT</small>
              </label>
              <label className="threshold-field sell-threshold-field">
                <span><i className="liquidity-dot sell-dot" />Sell-side minimum depth</span>
                <div><input type="number" min="1" step="1" inputMode="decimal" value={sellThresholdDraft} onChange={(event) => setSellThresholdDraft(event.target.value)} aria-describedby="sell-threshold-help" /><b>USDT</b></div>
                <small id="sell-threshold-help">Current sell setting: {usdtValue(sellThreshold)} USDT</small>
              </label>
            </div>
            <DialogFooter>
              <DialogClose asChild><button className="settings-cancel">Cancel</button></DialogClose>
              <DialogClose asChild><button className="settings-save" onClick={saveThresholds} disabled={!thresholdDraftsValid}>Save settings</button></DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <button onClick={load} aria-label="Refresh order book" title="Refresh now"><RefreshCw size={15} className={loading ? "spin" : ""} /></button>
      </div>
    </header>

    <section className="market-strip" aria-label="Market summary">
      <div><span>Mid price</span><strong className="mono">{midpoint ? price(String(midpoint)) : "—"}</strong></div>
      <div><span>Best bid</span><strong className="mono bid-text">{bestBid ? price(String(bestBid)) : "—"}</strong></div>
      <div><span>Best ask</span><strong className="mono ask-text">{bestAsk ? price(String(bestAsk)) : "—"}</strong></div>
      <div><span>Spread</span><strong className="mono">{spread ? `${price(String(spread))} · ${spreadPct.toFixed(3)}%` : "—"}</strong></div>
    </section>

    <section className="orderbook" aria-live="polite">
      <div className="panel-title">
        <div><Activity size={18} /><h1>Order book</h1></div>
        <span>{updatedAt ? `Updated ${updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "Connecting…"}</span>
      </div>
      <div className="columns" aria-hidden="true"><span>Price (USDT)</span><span>Amount (LF)</span><span>Value (USDT)</span></div>
      {error && !book ? (
        <div className="state"><AlertCircle size={28} /><strong>Can’t load Gate.io data</strong><span>{error}</span><button onClick={load}>Try again</button></div>
      ) : loading && !book ? (
        <div className="state"><RefreshCw className="spin" size={27} /><strong>Connecting to Gate.io</strong><span>Loading the LF/USDT market depth…</span></div>
      ) : <>
        <OrderRows rows={asks} side="ask" midpoint={midpoint} />
        <div className="spread-line">
          <span className="mono mid-price">{midpoint ? price(String(midpoint)) : "—"}</span>
          <div className="liquidity-totals">
            <span className={buyDepthLow ? "depth-low" : "depth-ok"}><small><i className="liquidity-dot buy-dot" />Buy depth (−2%)</small><strong className="mono buy-total">{usdtValue(buyLiquidity)} / {usdtValue(buyThreshold)} USDT</strong></span>
            <span className={sellDepthLow ? "depth-low" : "depth-ok"}><small><i className="liquidity-dot sell-dot" />Sell depth (+2%)</small><strong className="mono sell-total">{usdtValue(sellLiquidity)} / {usdtValue(sellThreshold)} USDT</strong></span>
          </div>
          <small className="spread"><Wifi size={13} /> Spread {spreadPct.toFixed(3)}%</small>
        </div>
        <OrderRows rows={bids} side="bid" midpoint={midpoint} />
      </>}
    </section>
    <aside className="alert-stack" aria-live="assertive" aria-label="Order notifications">
      {alerts.map((alert) => <div className={`order-alert ${alert.side.toLowerCase()}`} key={alert.id}>
        <span className={`alert-dot ${alert.side.toLowerCase()}`} />
        <div><strong>{alert.side} depth is below {usdtValue(alert.threshold)} USDT</strong><small>Repeats in 1 minute if depth stays low</small><b className="mono">{usdtValue(alert.value)} / {usdtValue(alert.threshold)} USDT</b></div>
        <button onClick={() => { stopAlarm(); setAlerts((current) => current.filter((item) => item.id !== alert.id)); }} aria-label="Close notification and stop sound"><X size={15} /> Close</button>
      </div>)}
    </aside>
    <footer><span>Public market data from Gate.io</span><span>Targets: Buy {usdtValue(buyThreshold)} · Sell {usdtValue(sellThreshold)} USDT · repeats every 1 min while low</span></footer>
  </main>;
}
