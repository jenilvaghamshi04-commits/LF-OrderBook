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
const telegramChatId = process.env.TELEGRAM_CHAT_ID || "6489634984";
let telegramBuyThreshold = Number(process.env.TELEGRAM_BUY_THRESHOLD) || 500;
let telegramSellThreshold = Number(process.env.TELEGRAM_SELL_THRESHOLD) || 300;
let telegramTotalThreshold = Number(process.env.TELEGRAM_TOTAL_THRESHOLD) || 1000;
const telegramCooldown = new Map();
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
  const upstream=await fetch("https://api.gateio.ws/api/v4/spot/order_book?currency_pair=LF_USDT&limit=100",{signal:AbortSignal.timeout(10000)}),book=await upstream.json();
  if(!upstream.ok)throw new Error("Gate.io order book is unavailable");
  const ask=Number(book.asks?.[0]?.[0]),bid=Number(book.bids?.[0]?.[0]),mid=ask&&bid?(ask+bid)/2:0;
  if(!mid)throw new Error("No valid LF/USDT market data");
  const sum=(levels,side)=>levels.reduce((total,[price,amount])=>{price=Number(price);amount=Number(amount);const inside=side==="buy"?price>=mid*.98&&price<=mid:price>=mid&&price<=mid*1.02;return inside?total+price*amount:total;},0);
  const buy=sum(book.bids||[],"buy"),sell=sum(book.asks||[],"sell");
  return {buy,sell,total:buy+sell,bid,ask,mid};
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
  if(command==="/settings")return `⚙️ LF/USDT alert settings\nBuy minimum: ${telegramBuyThreshold.toFixed(2)} USDT\nSell minimum: ${telegramSellThreshold.toFixed(2)} USDT\nTotal minimum: ${telegramTotalThreshold.toFixed(2)} USDT\nDepth range: ±2% from mid-price\nRepeat interval: 1 minute\nAlerts: ${telegramMuted?"Muted":"Active"}`;
  if(command==="/status"||command==="/depth"){
    const depth=await getDepthSnapshot();
    if(command==="/depth")return `📊 LF/USDT depth (±2%)\nBuy: ${depth.buy.toFixed(2)} USDT\nSell: ${depth.sell.toFixed(2)} USDT\nTotal: ${depth.total.toFixed(2)} USDT\nMid-price: ${depth.mid.toFixed(10)} USDT`;
    const low=[];if(depth.buy<telegramBuyThreshold)low.push("buy");if(depth.sell<telegramSellThreshold)low.push("sell");if(depth.total<telegramTotalThreshold)low.push("total");
    return `${low.length?"🔴 ATTENTION":"🟢 HEALTHY"} — LF/USDT monitor\nConnection: Live · Gate.io\nAlerts: ${telegramMuted?"Muted":"Active"}\nDepth status: ${low.length?`${low.join(", ")} below target`:"All targets met"}\nBuy: ${depth.buy.toFixed(2)} USDT\nSell: ${depth.sell.toFixed(2)} USDT\nTotal: ${depth.total.toFixed(2)} USDT`;
  }
  return null;
}
async function handleTelegramUpdate(update){
  const message=update?.message,text=message?.text||"";
  if(String(message?.chat?.id)!==String(telegramChatId)||!text.startsWith("/"))return;
  try{const reply=await handleTelegramCommand(text);if(reply)await replyTelegram(reply);}catch(error){await replyTelegram(`⚠️ ${error.message||"Command failed"}`).catch(()=>{});}
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
  try{await fetch(`https://api.telegram.org/bot${telegramToken}/setMyCommands`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({commands:[{command:"status",description:"Check monitor health"},{command:"depth",description:"Show live buy and sell depth"},{command:"setdepth",description:"Change depth targets"},{command:"setbuy",description:"Set buy minimum"},{command:"setsell",description:"Set sell minimum"},{command:"settotal",description:"Set total minimum"},{command:"mute",description:"Mute or resume alerts"},{command:"settings",description:"Show alert settings"}]}),signal:AbortSignal.timeout(10000)});}catch(error){console.error("Telegram command setup:",error.message);}
}
async function configureTelegramWebhook(){
  if(!telegramToken)return false;
  const host=process.env.RENDER_EXTERNAL_HOSTNAME||"lf-orderbook1.onrender.com",url=`https://${host}/api/telegram-webhook`;
  try{const upstream=await fetch(`https://api.telegram.org/bot${telegramToken}/setWebhook`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url,secret_token:telegramWebhookSecret,allowed_updates:["message"],drop_pending_updates:false}),signal:AbortSignal.timeout(10000)}),result=await upstream.json();if(!upstream.ok||!result.ok)throw new Error(result.description||"Webhook setup failed");console.log("Telegram webhook active");return true;}catch(error){console.error("Telegram webhook:",error.message);return false;}
}
async function monitorDepth(){
  if(!telegramToken)return;
  try{const depths=await getDepthSnapshot(),limits={buy:telegramBuyThreshold,sell:telegramSellThreshold,total:telegramTotalThreshold};
    for(const side of ["buy","sell","total"])if(depths[side]<limits[side])await sendTelegramMessage(`🚨 LF/USDT ${side.toUpperCase()} depth alert\nCurrent: ${depths[side].toFixed(2)} USDT\nMinimum: ${limits[side].toFixed(2)} USDT\nRange: 2% from mid-price`,side);
  }catch(error){console.error("Telegram monitor:",error.message);}
}

async function orderbook(res) {
  try {
    const upstream = await fetch("https://api.gateio.ws/api/v4/spot/order_book?currency_pair=LF_USDT&limit=100&with_id=true", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10000)
    });
    const body = await upstream.text();
    res.writeHead(upstream.status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    });
    res.end(body);
  } catch {
    res.writeHead(502, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    res.end(JSON.stringify({ message: "Could not connect to Gate.io" }));
  }
}

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname === "/api/orderbook") return orderbook(res);
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

server.listen(port, "0.0.0.0", async () => {console.log(`LF Orderbook running on port ${port}`);const restored=await loadTelegramState();if(!restored)await saveTelegramState().catch(error=>console.error("Telegram state:",error.message));await registerTelegramCommands();const webhookActive=await configureTelegramWebhook();monitorDepth();if(!webhookActive){pollTelegramCommands();setInterval(pollTelegramCommands,3000);}setInterval(monitorDepth,15000);});
