const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const port = Number(process.env.PORT) || 3000;
const publicDir = path.join(__dirname, "public");
const files = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/sync.js": ["sync.js", "text/javascript; charset=utf-8"],
  "/favicon.svg": ["favicon.svg", "image/svg+xml"],
  "/manifest.webmanifest": ["manifest.webmanifest", "application/manifest+json"],
  "/sw.js": ["sw.js", "text/javascript; charset=utf-8"]
};

const telegramToken = process.env.TELEGRAM_BOT_TOKEN || "";
const telegramChatId = process.env.TELEGRAM_CHAT_ID || "";
let telegramBuyThreshold = Number(process.env.TELEGRAM_BUY_THRESHOLD) || 500;
let telegramSellThreshold = Number(process.env.TELEGRAM_SELL_THRESHOLD) || 300;
let telegramTotalThreshold = Number(process.env.TELEGRAM_TOTAL_THRESHOLD) || 1000;
const telegramCooldown = new Map();
const telegramLowSince = new Map();
const CONFIRM_LOW_MS = 60000;
const depthSampleWindow = [];
const DEX_PAIR_URL = "https://api.dexscreener.com/latest/dex/pairs/ethereum/0xb37361ebebfe7e0f0d98300f0a8ae777daa1cc12";
const LF_TOKEN_ADDRESS = "0x957c7fa189a408e78543113412f6ae1a9b4022c4";
const DEX_TOKEN_URL = `https://api.dexscreener.com/latest/dex/tokens/${LF_TOKEN_ADDRESS}`;
const GECKOTERMINAL_URL = `https://api.geckoterminal.com/api/v2/networks/eth/tokens/${LF_TOKEN_ADDRESS}`;
const COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/token_price/ethereum?contract_addresses=0x957c7fA189a408E78543113412f6Ae1a9b4022C4&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true&include_last_updated_at=true";
const API_HEADERS = {Accept:"application/json", "User-Agent":"LF-OrderBook/1.0"};
let orderbookCache={book:null,updatedAt:0};
let orderbookRequest=null;
let dexCache={value:null,updatedAt:0};
let dexRequest=null;
let lastTradeCache={value:null,updatedAt:0};
let lastTradeRequest=null;
let exchangeVolumeCache={value:null,updatedAt:0};
let exchangeVolumeRequest=null;
let telegramMuted = false;
let telegramUpdateOffset = 0;
let telegramPolling = false;
const telegramWebhookSecret = telegramToken ? crypto.createHash("sha256").update(telegramToken).digest("hex") : "";
function json(res,status,body){res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});res.end(JSON.stringify(body));}
function readJson(req){return new Promise((resolve,reject)=>{let body="";req.on("data",chunk=>{body+=chunk;if(body.length>10000)req.destroy();});req.on("end",()=>{try{resolve(JSON.parse(body||"{}"));}catch(error){reject(error);}});req.on("error",reject);});}
async function telegram(req,res){
  if(!telegramToken||!telegramChatId)return json(res,503,{configured:false,message:"Telegram is not configured on Render"});
  if(req.method==="GET")return json(res,200,{configured:true});
  if(req.method!=="POST")return json(res,405,{message:"Method not allowed"});
  try{const data=await readJson(req),side=["buy","sell","total"].includes(data.side)?data.side:"test",value=Number(data.value),threshold=Number(data.threshold);
    if(side!=="test"&&telegramMuted)return json(res,200,{sent:false,muted:true});
    if(side!=="test"&&Date.now()-(telegramCooldown.get(side)||0)<55000)return json(res,200,{sent:false,cooldown:true});
    const message=side==="test"?"✅ LF Orderbook Telegram alerts are working.":`🚨 LF/USDT ${side.toUpperCase()} depth alert\nCurrent: ${value.toFixed(2)} USDT\nMinimum: ${threshold.toFixed(2)} USDT\nRange: 2% from mid-price`;
    const upstream=await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:telegramChatId,text:message}),signal:AbortSignal.timeout(10000)}),result=await upstream.json();
    if(!upstream.ok||!result.ok)throw new Error(result.description||"Telegram request failed");if(side!=="test")telegramCooldown.set(side,Date.now());return json(res,200,{sent:true});
  }catch(error){return json(res,502,{message:error.message||"Could not send Telegram alert"});}
}

async function sendTelegramMessage(message,side){
  if(!telegramToken||!telegramChatId||telegramMuted)return;
  if(Date.now()-(telegramCooldown.get(side)||0)<55000)return;
  const upstream=await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:telegramChatId,text:message}),signal:AbortSignal.timeout(10000)});
  if(upstream.ok)telegramCooldown.set(side,Date.now());
}
async function replyTelegram(message){
  if(!telegramToken||!telegramChatId)return;
  const upstream=await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:telegramChatId,text:message}),signal:AbortSignal.timeout(10000)});
  if(!upstream.ok){const result=await upstream.json().catch(()=>({}));throw new Error(result.description||"Telegram reply failed");}
}
async function saveTelegramState(){
  if(!telegramToken)return;
  const description=`LF Orderbook monitor. Shared v2: buy=${telegramBuyThreshold};sell=${telegramSellThreshold};total=${telegramTotalThreshold};muted=${telegramMuted?1:0}`;
  const upstream=await fetch(`https://api.telegram.org/bot${telegramToken}/setMyDescription`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({description}),signal:AbortSignal.timeout(10000)}),result=await upstream.json();
  if(!upstream.ok||!result.ok)throw new Error(result.description||"Could not save Telegram settings");
}
async function loadTelegramState(){
  if(!telegramToken)return;
  try{const upstream=await fetch(`https://api.telegram.org/bot${telegramToken}/getMyDescription`,{signal:AbortSignal.timeout(10000)}),result=await upstream.json(),description=result?.result?.description||"",match=description.match(/Shared v2: buy=([\d.]+);sell=([\d.]+);total=([\d.]+);muted=([01])/);
    if(match){telegramBuyThreshold=Number(match[1])||telegramBuyThreshold;telegramSellThreshold=Number(match[2])||telegramSellThreshold;telegramTotalThreshold=Number(match[3])||telegramTotalThreshold;telegramMuted=match[4]==="1";return true;}
  }catch(error){console.error("Telegram state:",error.message);}return false;
}
function sharedSettings(){return {buy:telegramBuyThreshold,sell:telegramSellThreshold,total:telegramTotalThreshold,muted:telegramMuted};}
async function settingsApi(req,res){
  if(req.method==="GET")return json(res,200,sharedSettings());
  if(req.method!=="POST")return json(res,405,{message:"Method not allowed"});
  try{const data=await readJson(req),buy=Number(data.buy),sell=Number(data.sell),total=Number(data.total);if([buy,sell,total].some(value=>!Number.isFinite(value)||value<=0||value>1000000000))return json(res,400,{message:"Enter valid buy, sell, and total amounts"});telegramBuyThreshold=buy;telegramSellThreshold=sell;telegramTotalThreshold=total;telegramCooldown.clear();await saveTelegramState();return json(res,200,{saved:true,...sharedSettings()});}catch(error){return json(res,502,{message:error.message||"Could not save shared settings"});}
}
async function getDepthSnapshot(){
  const [book,trade]=await Promise.all([getRawOrderbook(),getLastTrade()]);
  const ask=Number(book.asks?.[0]?.[0]),bid=Number(book.bids?.[0]?.[0]),reference=Number(trade.price);
  if(!reference)throw new Error("No valid LF/USDT last trade price");
  const sum=(levels,side)=>levels.reduce((total,[price,amount])=>{price=Number(price);amount=Number(amount);const inside=side==="buy"?price>=reference*.98&&price<=reference:price>=reference&&price<=reference*1.02;return inside?total+price*amount:total;},0);
  const rawBuy=sum(book.bids||[],"buy"),rawSell=sum(book.asks||[],"sell");
  depthSampleWindow.push({buy:rawBuy,sell:rawSell});if(depthSampleWindow.length>5)depthSampleWindow.shift();
  const median=side=>{const values=depthSampleWindow.map(item=>item[side]).sort((a,b)=>a-b),middle=Math.floor(values.length/2);return values.length%2?values[middle]:(values[middle-1]+values[middle])/2;};
  const buy=median("buy"),sell=median("sell");
  return {buy,sell,total:buy+sell,bid,ask,lastTrade:reference};
}
async function getRawOrderbook(){
  const now=Date.now();
  if(orderbookCache.book&&now-orderbookCache.updatedAt<750)return orderbookCache.book;
  if(orderbookCache.book&&now-orderbookCache.updatedAt<15000){if(!orderbookRequest)refreshOrderbook().catch(()=>{});return orderbookCache.book;}
  return refreshOrderbook();
}
async function refreshOrderbook(){
  if(orderbookRequest)return orderbookRequest;
  orderbookRequest=(async()=>{try{const upstream=await fetch("https://api.gateio.ws/api/v4/spot/order_book?currency_pair=LF_USDT&limit=1000&with_id=true",{headers:API_HEADERS,signal:AbortSignal.timeout(8000)}),book=await upstream.json();
    if(!upstream.ok||!Array.isArray(book?.bids)||!Array.isArray(book?.asks))throw new Error("Gate.io order book is unavailable");
    orderbookCache={book,updatedAt:Date.now()};return book;
  }catch(error){if(orderbookCache.book&&Date.now()-orderbookCache.updatedAt<15000)return orderbookCache.book;throw error;}finally{orderbookRequest=null;}})();
  return orderbookRequest;
}
async function getLastTrade(){
  if(lastTradeCache.value&&Date.now()-lastTradeCache.updatedAt<1000)return lastTradeCache.value;
  if(lastTradeRequest)return lastTradeRequest;
  lastTradeRequest=(async()=>{try{const upstream=await fetch("https://api.gateio.ws/api/v4/spot/trades?currency_pair=LF_USDT&limit=1",{headers:API_HEADERS,signal:AbortSignal.timeout(8000)}),trades=await upstream.json(),trade=trades?.[0],price=Number(trade?.price);
    if(!upstream.ok||!price)throw new Error("Gate.io last trade is unavailable");
    const value={price,amount:Number(trade.amount)||0,side:trade.side||"",tradeId:String(trade.id||""),timestamp:Number(trade.create_time_ms)||Number(trade.create_time)*1000||Date.now(),source:"Gate.io last completed trade"};lastTradeCache={value,updatedAt:Date.now()};return value;
  }catch(error){if(lastTradeCache.value&&Date.now()-lastTradeCache.updatedAt<15000)return {...lastTradeCache.value,source:"Gate.io last completed trade · cached"};throw error;}finally{lastTradeRequest=null;}})();
  return lastTradeRequest;
}
async function getExchangeVolume(){
  if(exchangeVolumeCache.value&&Date.now()-exchangeVolumeCache.updatedAt<15000)return exchangeVolumeCache.value;
  if(exchangeVolumeRequest)return exchangeVolumeRequest;
  exchangeVolumeRequest=(async()=>{try{const upstream=await fetch("https://api.gateio.ws/api/v4/spot/tickers?currency_pair=LF_USDT",{headers:API_HEADERS,signal:AbortSignal.timeout(8000)}),tickers=await upstream.json(),ticker=tickers?.[0],baseVolume=Number(ticker?.base_volume),quoteVolume=Number(ticker?.quote_volume);
    if(!upstream.ok||!Number.isFinite(baseVolume)||!Number.isFinite(quoteVolume))throw new Error("Gate.io exchange volume is unavailable");
    const value={baseVolume,quoteVolume,period:"24h",source:"Gate.io",updatedAt:Date.now()};exchangeVolumeCache={value,updatedAt:Date.now()};return value;
  }catch(error){if(exchangeVolumeCache.value&&Date.now()-exchangeVolumeCache.updatedAt<300000)return {...exchangeVolumeCache.value,source:"Gate.io · cached"};throw error;}finally{exchangeVolumeRequest=null;}})();
  return exchangeVolumeRequest;
}
async function getDexPrice(){
  if(dexCache.value&&Date.now()-dexCache.updatedAt<10000)return dexCache.value;
  if(dexCache.value&&Date.now()-dexCache.updatedAt<300000){if(!dexRequest)refreshDexPrice().catch(()=>{});return {...dexCache.value,source:`${dexCache.value.source.replace(/ · cached$/,'')} · cached`};}
  return refreshDexPrice();
}
async function refreshDexPrice(){
  if(dexRequest)return dexRequest;
  const fromPair=pair=>{if(!Number(pair?.priceUsd))return null;return {price:Number(pair.priceUsd),change24h:Number(pair.priceChange?.h24)||0,liquidity:Number(pair.liquidity?.usd)||0,volume24h:Number(pair.volume?.h24)||0,source:`DexScreener · ${pair.dexId||"DEX"}`,updatedAt:Date.now()};};
  const dexScreener=async url=>{const upstream=await fetch(url,{headers:API_HEADERS,signal:AbortSignal.timeout(8000)}),data=await upstream.json();if(!upstream.ok)throw new Error(`DexScreener ${upstream.status}`);const pairs=[data?.pair,...(data?.pairs||[])].filter(Boolean).sort((a,b)=>(Number(b?.liquidity?.usd)||0)-(Number(a?.liquidity?.usd)||0)),value=fromPair(pairs[0]);if(!value)throw new Error("DexScreener returned no LF price");return value;};
  const geckoTerminal=async()=>{const upstream=await fetch(GECKOTERMINAL_URL,{headers:API_HEADERS,signal:AbortSignal.timeout(8000)}),data=await upstream.json(),token=data?.data?.attributes,price=Number(token?.price_usd);if(!upstream.ok||!price)throw new Error(`GeckoTerminal ${upstream.status}`);return {price,change24h:Number(token?.price_change_percentage?.h24)||0,liquidity:Number(token?.total_reserve_in_usd)||0,volume24h:Number(token?.volume_usd?.h24)||0,source:"GeckoTerminal",updatedAt:Date.now()};};
  const coinGecko=async()=>{const upstream=await fetch(COINGECKO_URL,{headers:API_HEADERS,signal:AbortSignal.timeout(8000)}),data=await upstream.json(),token=data?.[LF_TOKEN_ADDRESS];if(!upstream.ok||!Number(token?.usd))throw new Error(`CoinGecko ${upstream.status}`);return {price:Number(token.usd),change24h:Number(token.usd_24h_change)||0,liquidity:0,volume24h:Number(token.usd_24h_vol)||0,source:"CoinGecko",updatedAt:Number(token.last_updated_at)*1000||Date.now()};};
  dexRequest=(async()=>{try{const value=await Promise.any([dexScreener(DEX_PAIR_URL),dexScreener(DEX_TOKEN_URL),geckoTerminal(),coinGecko()]);dexCache={value,updatedAt:Date.now()};return value;}catch(error){
    if(dexCache.value)return {...dexCache.value,source:`${dexCache.value.source.replace(/ · cached$/,'')} · cached`};
    throw new Error("DEX price is unavailable from all providers");}
  })().finally(()=>{dexRequest=null;});
  return dexRequest;
}
function telegramBookChunks(book,side,count,dex){
  const asks=book.asks||[],bids=book.bids||[],ask=Number(asks[0]?.[0]),bid=Number(bids[0]?.[0]),mid=ask&&bid?(ask+bid)/2:0;
  const sections=[];
  const add=(title,levels)=>{const selected=count==="all"?levels:levels.slice(0,count);sections.push(`${title} (${selected.length}/${levels.length})\n`+selected.map(([p,a],i)=>`${i+1}. ${Number(p).toFixed(10)} | ${Number(a).toFixed(2)} LF | ${(Number(p)*Number(a)).toFixed(2)} USDT`).join("\n"));};
  if(side!=="sell")add("🟢 BUY ORDERS — highest price first",bids);
  if(side!=="buy")add("🔴 SELL ORDERS — lowest price first",asks);
  const header=`📖 LF/USDT ORDER BOOK\nOrderbook mid: ${mid.toFixed(10)} USDT${dex?`\nDEX price: ${dex.price.toFixed(10)} USDT (${dex.source})`:""}\nPrice | Amount | Value`;
  const chunks=[];let current=header;
  for(const section of sections){for(const line of section.split("\n")){if(`${current}\n${line}`.length>3600){chunks.push(current);current="📖 LF/USDT ORDER BOOK (continued)";}current+=`\n${line}`;}}
  if(current)chunks.push(current);return chunks;
}
async function handleTelegramCommand(text){
  const [raw,...args]=text.trim().split(/\s+/),command=raw.toLowerCase().split("@")[0];
  if(command==="/mute"){
    const mode=(args[0]||"").toLowerCase();
    telegramMuted=mode==="on"?true:mode==="off"?false:!telegramMuted;
    await saveTelegramState();
    return `🔕 Telegram alerts are now ${telegramMuted?"MUTED":"ACTIVE"}.\nUse /mute again, /mute on, or /mute off.`;
  }
  if(command==="/setbuy"||command==="/setsell"||command==="/settotal"){
    const value=Number(args[0]);
    if(!Number.isFinite(value)||value<=0||value>1000000000)return `⚠️ Enter a valid USDT amount.\nExample: ${command} 400`;
    if(command==="/setbuy")telegramBuyThreshold=value;
    if(command==="/setsell")telegramSellThreshold=value;
    if(command==="/settotal")telegramTotalThreshold=value;
    telegramCooldown.clear();
    await saveTelegramState();
    const label=command==="/setbuy"?"Buy":command==="/setsell"?"Sell":"Total";
    return `✅ ${label} minimum depth updated to ${value.toFixed(2)} USDT.\nUse /settings to view all targets.`;
  }
  if(command==="/setdepth"){
    if(args.length===2&&["buy","sell","total"].includes(args[0].toLowerCase())){
      const side=args[0].toLowerCase(),value=Number(args[1]);
      if(!Number.isFinite(value)||value<=0||value>1000000000)return "⚠️ Enter a valid amount.\nExample: /setdepth buy 400";
      if(side==="buy")telegramBuyThreshold=value;if(side==="sell")telegramSellThreshold=value;if(side==="total")telegramTotalThreshold=value;
      telegramCooldown.clear();
      await saveTelegramState();
      return `✅ ${side[0].toUpperCase()+side.slice(1)} minimum depth updated to ${value.toFixed(2)} USDT.\nUse /settings to view all targets.`;
    }
    if(args.length===3){
      const [buy,sell,total]=args.map(Number);
      if([buy,sell,total].some(value=>!Number.isFinite(value)||value<=0||value>1000000000))return "⚠️ Enter three valid amounts.\nExample: /setdepth 400 300 700";
      telegramBuyThreshold=buy;telegramSellThreshold=sell;telegramTotalThreshold=total;telegramCooldown.clear();
      await saveTelegramState();
      return `✅ All depth targets updated.\nBuy: ${buy.toFixed(2)} USDT\nSell: ${sell.toFixed(2)} USDT\nTotal: ${total.toFixed(2)} USDT`;
    }
    return "⚙️ Set depth commands\n/setbuy 400\n/setsell 300\n/settotal 700\n/setdepth 400 300 700\n/setdepth buy 400";
  }
  if(command==="/settings")return `⚙️ LF/USDT alert settings\nBuy minimum: ${telegramBuyThreshold.toFixed(2)} USDT\nSell minimum: ${telegramSellThreshold.toFixed(2)} USDT\nTotal minimum: ${telegramTotalThreshold.toFixed(2)} USDT\nDepth range: ±2% from last trade price\nRepeat interval: 1 minute\nAlerts: ${telegramMuted?"Muted":"Active"}`;
  if(command==="/price"){
    const [depth,dex]=await Promise.all([getDepthSnapshot(),getDexPrice()]),difference=depth.lastTrade?(dex.price-depth.lastTrade)/depth.lastTrade*100:0;
    return `💱 LF/USDT prices\nDEX price: ${dex.price.toFixed(10)} USDT\nLast trade: ${depth.lastTrade.toFixed(10)} USDT\nDifference: ${difference>=0?"+":""}${difference.toFixed(2)}%\nSource: ${dex.source}`;
  }
  if(command==="/orderbook"||command==="/buybook"||command==="/sellbook"){
    const requested=(args[0]||"20").toLowerCase(),count=requested==="all"?"all":Math.max(1,Math.min(100,Number.parseInt(requested,10)||20));
    const [book,dex]=await Promise.all([getRawOrderbook(),getDexPrice().catch(()=>null)]);
    return telegramBookChunks(book,command==="/buybook"?"buy":command==="/sellbook"?"sell":"both",count,dex);
  }
  if(command==="/status"||command==="/depth"){
    const depth=await getDepthSnapshot();
    if(command==="/depth")return `📊 LF/USDT depth (±2% from last trade)\nBuy: ${depth.buy.toFixed(2)} USDT\nSell: ${depth.sell.toFixed(2)} USDT\nTotal: ${depth.total.toFixed(2)} USDT\nLast trade: ${depth.lastTrade.toFixed(10)} USDT`;
    const low=[];if(depth.buy<telegramBuyThreshold)low.push("buy");if(depth.sell<telegramSellThreshold)low.push("sell");if(depth.total<telegramTotalThreshold)low.push("total");
    return `${low.length?"🔴 ATTENTION":"🟢 HEALTHY"} — LF/USDT monitor\nConnection: Live · Gate.io\nAlerts: ${telegramMuted?"Muted":"Active"}\nDepth status: ${low.length?`${low.join(", ")} below target`:"All targets met"}\nBuy: ${depth.buy.toFixed(2)} USDT\nSell: ${depth.sell.toFixed(2)} USDT\nTotal: ${depth.total.toFixed(2)} USDT`;
  }
  return null;
}
async function handleTelegramUpdate(update){
  const message=update?.message,text=message?.text||"";
  if(String(message?.chat?.id)!==String(telegramChatId)||!text.startsWith("/"))return;
  try{const reply=await handleTelegramCommand(text);for(const part of (Array.isArray(reply)?reply:[reply]))if(part)await replyTelegram(part);}catch(error){await replyTelegram(`⚠️ ${error.message||"Command failed"}`).catch(()=>{});}
}
async function telegramWebhook(req,res){
  if(req.method!=="POST")return json(res,405,{message:"Method not allowed"});
  if(!telegramToken||req.headers["x-telegram-bot-api-secret-token"]!==telegramWebhookSecret)return json(res,403,{message:"Forbidden"});
  try{const update=await readJson(req);json(res,200,{ok:true});await handleTelegramUpdate(update);}catch(error){if(!res.headersSent)json(res,400,{message:"Invalid update"});console.error("Telegram webhook:",error.message);}
}
async function pollTelegramCommands(){
  if(!telegramToken||telegramPolling)return;
  telegramPolling=true;
  try{
    const upstream=await fetch(`https://api.telegram.org/bot${telegramToken}/getUpdates?offset=${telegramUpdateOffset}&timeout=0&allowed_updates=%5B%22message%22%5D`,{signal:AbortSignal.timeout(10000)}),result=await upstream.json();
    if(!upstream.ok||!result.ok)throw new Error(result.description||"Could not read Telegram commands");
    for(const update of result.result||[]){
      telegramUpdateOffset=Math.max(telegramUpdateOffset,update.update_id+1);
      await handleTelegramUpdate(update);
    }
  }catch(error){console.error("Telegram commands:",error.message);}finally{telegramPolling=false;}
}
async function registerTelegramCommands(){
  if(!telegramToken)return;
  try{await fetch(`https://api.telegram.org/bot${telegramToken}/setMyCommands`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({commands:[{command:"status",description:"Check monitor health"},{command:"depth",description:"Show ±2% depth totals"},{command:"price",description:"Show DEX and orderbook mid prices"},{command:"orderbook",description:"Show buy and sell orders"},{command:"buybook",description:"Show buy-side orders"},{command:"sellbook",description:"Show sell-side orders"},{command:"setdepth",description:"Change depth targets"},{command:"setbuy",description:"Set buy minimum"},{command:"setsell",description:"Set sell minimum"},{command:"settotal",description:"Set total minimum"},{command:"mute",description:"Mute or resume alerts"},{command:"settings",description:"Show alert settings"}]}),signal:AbortSignal.timeout(10000)});}catch(error){console.error("Telegram command setup:",error.message);}
}
async function configureTelegramWebhook(){
  if(!telegramToken)return false;
  const host=process.env.RENDER_EXTERNAL_HOSTNAME||"lf-orderbook1.onrender.com",url=`https://${host}/api/telegram-webhook`;
  try{const upstream=await fetch(`https://api.telegram.org/bot${telegramToken}/setWebhook`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url,secret_token:telegramWebhookSecret,allowed_updates:["message"],drop_pending_updates:false}),signal:AbortSignal.timeout(10000)}),result=await upstream.json();if(!upstream.ok||!result.ok)throw new Error(result.description||"Webhook setup failed");console.log("Telegram webhook active");return true;}catch(error){console.error("Telegram webhook:",error.message);return false;}
}
async function monitorDepth(){
  if(!telegramToken)return;
  try{const depths=await getDepthSnapshot(),limits={buy:telegramBuyThreshold,sell:telegramSellThreshold,total:telegramTotalThreshold};
    for(const side of ["buy","sell","total"]){const low=depths[side]<limits[side],now=Date.now();if(low&&!telegramLowSince.has(side))telegramLowSince.set(side,now);if(!low)telegramLowSince.delete(side);if(low&&now-(telegramLowSince.get(side)||now)>=CONFIRM_LOW_MS)await sendTelegramMessage(`🚨 LF/USDT ${side.toUpperCase()} depth alert\nCurrent: ${depths[side].toFixed(2)} USDT\nMinimum: ${limits[side].toFixed(2)} USDT\nLow continuously for 60 seconds · Range: 2% from last trade price`,side);}
  }catch(error){console.error("Telegram monitor:",error.message);}
}

async function orderbook(res) {
  try {
    const book=await getRawOrderbook();
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    });
    res.end(JSON.stringify(book));
  } catch {
    res.writeHead(502, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ message: "Could not connect to Gate.io" }));
  }
}
async function dexPriceApi(res){try{return json(res,200,await getDexPrice());}catch(error){return json(res,502,{message:error.message||"DEX price unavailable"});}}
async function lastTradeApi(res){try{return json(res,200,await getLastTrade());}catch(error){return json(res,502,{message:error.message||"Last trade unavailable"});}}
async function exchangeVolumeApi(res){try{return json(res,200,await getExchangeVolume());}catch(error){return json(res,502,{message:error.message||"Exchange volume unavailable"});}}
async function marketApi(res){try{const [book,lastTrade]=await Promise.all([getRawOrderbook(),getLastTrade()]);return json(res,200,{book,lastTrade,serverTime:Date.now()});}catch(error){return json(res,502,{message:error.message||"Market data unavailable"});}}

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname === "/api/orderbook") return orderbook(res);
  if (pathname === "/api/dex-price") return dexPriceApi(res);
  if (pathname === "/api/last-trade") return lastTradeApi(res);
  if (pathname === "/api/exchange-volume") return exchangeVolumeApi(res);
  if (pathname === "/api/market") return marketApi(res);
  if (pathname === "/api/telegram") return telegram(req, res);
  if (pathname === "/api/settings") return settingsApi(req, res);
  if (pathname === "/api/telegram-webhook") return telegramWebhook(req, res);
  const entry = files[pathname];
  if (!entry) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Not found");
  }
  fs.readFile(path.join(publicDir, entry[0]), (error, data) => {
    if (error) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Server error");
    }
    res.writeHead(200, { "Content-Type": entry[1], "Cache-Control": pathname === "/" ? "no-cache" : "public, max-age=3600" });
    res.end(data);
  });
});

server.listen(port, "0.0.0.0", async () => {console.log(`LF Orderbook running on port ${port}`);getRawOrderbook().catch(()=>{});getLastTrade().catch(()=>{});setInterval(()=>refreshOrderbook().catch(()=>{}),750);setInterval(()=>getLastTrade().catch(()=>{}),1000);const restored=await loadTelegramState();if(!restored)await saveTelegramState().catch(error=>console.error("Telegram state:",error.message));await registerTelegramCommands();const webhookActive=await configureTelegramWebhook();monitorDepth();if(!webhookActive){pollTelegramCommands();setInterval(pollTelegramCommands,3000);}setInterval(monitorDepth,15000);});
