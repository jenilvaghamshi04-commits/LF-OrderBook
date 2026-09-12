const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const port = Number(process.env.PORT) || 3000;
const publicDir = path.join(__dirname, "public");
const files = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/styles.css": ["styles.css", "text/css; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/favicon.svg": ["favicon.svg", "image/svg+xml"],
  "/manifest.webmanifest": ["manifest.webmanifest", "application/manifest+json"],
  "/sw.js": ["sw.js", "text/javascript; charset=utf-8"]
};

const telegramToken = process.env.TELEGRAM_BOT_TOKEN || "";
const telegramChatId = process.env.TELEGRAM_CHAT_ID || "6489634984";
const telegramBuyThreshold = Number(process.env.TELEGRAM_BUY_THRESHOLD) || 400;
const telegramSellThreshold = Number(process.env.TELEGRAM_SELL_THRESHOLD) || 400;
const telegramCooldown = new Map();
function json(res,status,body){res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});res.end(JSON.stringify(body));}
function readJson(req){return new Promise((resolve,reject)=>{let body="";req.on("data",chunk=>{body+=chunk;if(body.length>10000)req.destroy();});req.on("end",()=>{try{resolve(JSON.parse(body||"{}"));}catch(error){reject(error);}});req.on("error",reject);});}
async function telegram(req,res){
  if(!telegramToken||!telegramChatId)return json(res,503,{configured:false,message:"Telegram is not configured on Render"});
  if(req.method==="GET")return json(res,200,{configured:true});
  if(req.method!=="POST")return json(res,405,{message:"Method not allowed"});
  try{const data=await readJson(req),side=data.side==="sell"?"sell":data.side==="buy"?"buy":"test",value=Number(data.value),threshold=Number(data.threshold);
    if(side!=="test"&&Date.now()-(telegramCooldown.get(side)||0)<55000)return json(res,200,{sent:false,cooldown:true});
    const message=side==="test"?"✅ LF Orderbook Telegram alerts are working.":`🚨 LF/USDT ${side.toUpperCase()} depth alert\nCurrent: ${value.toFixed(2)} USDT\nMinimum: ${threshold.toFixed(2)} USDT\nRange: 2% from mid-price`;
    const upstream=await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:telegramChatId,text:message}),signal:AbortSignal.timeout(10000)}),result=await upstream.json();
    if(!upstream.ok||!result.ok)throw new Error(result.description||"Telegram request failed");if(side!=="test")telegramCooldown.set(side,Date.now());return json(res,200,{sent:true});
  }catch(error){return json(res,502,{message:error.message||"Could not send Telegram alert"});}
}

async function sendTelegramMessage(message,side){
  if(!telegramToken||!telegramChatId)return;
  if(Date.now()-(telegramCooldown.get(side)||0)<55000)return;
  const upstream=await fetch(`https://api.telegram.org/bot${telegramToken}/sendMessage`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:telegramChatId,text:message}),signal:AbortSignal.timeout(10000)});
  if(upstream.ok)telegramCooldown.set(side,Date.now());
}
async function monitorDepth(){
  if(!telegramToken)return;
  try{const upstream=await fetch("https://api.gateio.ws/api/v4/spot/order_book?currency_pair=LF_USDT&limit=100",{signal:AbortSignal.timeout(10000)}),book=await upstream.json();if(!upstream.ok)return;
    const ask=Number(book.asks?.[0]?.[0]),bid=Number(book.bids?.[0]?.[0]),mid=ask&&bid?(ask+bid)/2:0;if(!mid)return;
    const total=(levels,side)=>levels.reduce((sum,[p,a])=>{p=Number(p);a=Number(a);const inside=side==="buy"?p>=mid*.98&&p<=mid:p>=mid&&p<=mid*1.02;return inside?sum+p*a:sum;},0);
    const depths={buy:total(book.bids||[],"buy"),sell:total(book.asks||[],"sell")},limits={buy:telegramBuyThreshold,sell:telegramSellThreshold};
    for(const side of ["buy","sell"])if(depths[side]<limits[side])await sendTelegramMessage(`🚨 LF/USDT ${side.toUpperCase()} depth alert\nCurrent: ${depths[side].toFixed(2)} USDT\nMinimum: ${limits[side].toFixed(2)} USDT\nRange: 2% from mid-price`,side);
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

server.listen(port, "0.0.0.0", () => {console.log(`LF Orderbook running on port ${port}`);monitorDepth();setInterval(monitorDepth,15000);});
