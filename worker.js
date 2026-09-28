const RENDER_ORIGIN = "https://lf-orderbook1.onrender.com";
const GATE_API = "https://api.gateio.ws/api/v4";

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

async function gateMarket() {
  const headers = { "Accept": "application/json", "User-Agent": "LF-OrderBook/1.0" };
  const [bookResponse, tradesResponse] = await Promise.all([
    fetch(`${GATE_API}/spot/order_book?currency_pair=LF_USDT&limit=1000&with_id=true`, { headers }),
    fetch(`${GATE_API}/spot/trades?currency_pair=LF_USDT&limit=1`, { headers }),
  ]);
  const [book, trades] = await Promise.all([bookResponse.json(), tradesResponse.json()]);
  const trade = Array.isArray(trades) ? trades[0] : null;
  if (!bookResponse.ok || !tradesResponse.ok || !Array.isArray(book?.bids) || !Array.isArray(book?.asks) || !Number(trade?.price)) {
    throw new Error("Gate.io market feed unavailable");
  }
  return {
    book,
    lastTrade: {
      price: Number(trade.price),
      amount: Number(trade.amount),
      side: trade.side || "",
      tradeId: String(trade.id || ""),
      timestamp: Number(trade.create_time_ms) || Number(trade.create_time) * 1000 || Date.now(),
      source: "Gate.io edge",
    },
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/market") {
      try { return json(await gateMarket()); }
      catch (error) { return json({ message: error.message }, 502); }
    }

    if (url.pathname === "/api/last-trade") {
      try { return json((await gateMarket()).lastTrade); }
      catch (error) { return json({ message: error.message }, 502); }
    }

    if (url.pathname === "/api/exchange-volume") {
      try {
        const response = await fetch(`${GATE_API}/spot/tickers?currency_pair=LF_USDT`, { headers: { "Accept": "application/json" } });
        const data = await response.json();
        const ticker = Array.isArray(data) ? data[0] : null;
        if (!response.ok || !ticker) throw new Error("Gate.io volume unavailable");
        return json({ quoteVolume: Number(ticker.quote_volume) || 0, baseVolume: Number(ticker.base_volume) || 0, source: "Gate.io live" });
      } catch (error) { return json({ message: error.message }, 502); }
    }

    if (url.pathname.startsWith("/api/")) {
      const upstreamUrl = new URL(url.pathname + url.search, RENDER_ORIGIN);
      const headers = new Headers(request.headers);
      headers.delete("host");
      const upstream = await fetch(upstreamUrl, {
        method: request.method,
        headers,
        body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
        redirect: "follow",
      });
      const responseHeaders = new Headers(upstream.headers);
      responseHeaders.set("Cache-Control", "no-store");
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
      });
    }

    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    if (url.pathname === "/" || url.pathname === "/index.html" || url.pathname === "/sw.js") {
      headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
    } else {
      headers.set("Cache-Control", "public, max-age=300");
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  },
};
