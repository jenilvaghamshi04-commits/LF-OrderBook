const $ = (id) => document.getElementById(id);
const DEFAULT = 500, TOTAL_DEFAULT = 1000, RANGE = 2, REPEAT = 60000, ROWS = 18, LARGE_BUY_DEFAULT = 50, LARGE_BUY_LEVELS_DEFAULT = 5, LOW_CONFIRMATIONS = 2, CONFIRM_LOW_MS = 5000, MEDIAN_SAMPLES = 5;
const keys = { buy: "lf-orderbook-buy-depth-threshold", sell: "lf-orderbook-sell-depth-threshold", total: "lf-orderbook-total-depth-threshold", largeBuy: "lf-orderbook-large-buy-threshold", largeBuyLevels: "lf-orderbook-large-buy-levels", legacy: "lf-orderbook-depth-threshold", sound: "lf-orderbook-sound", tone: "lf-orderbook-sound-tone", popups: "lf-orderbook-popups", telegram: "lf-orderbook-telegram", history: "lf-orderbook-depth-history", theme: "lf-orderbook-theme" };
let thresholds = { buy: DEFAULT, sell: DEFAULT, total: TOTAL_DEFAULT }, soundEnabled = false, soundTone = "chime", audio, alarmTimer, alarmStopTimer;
let popupsEnabled=true;
let largeBuySettings={amount:LARGE_BUY_DEFAULT,levels:LARGE_BUY_LEVELS_DEFAULT}, activeLargeBuys=new Set(), largeBuySeen=new Map();
let latest = { buy: 0, sell: 0, total: 0, mid: 0, ready: false }, latestDex = null, previousLow = { buy: false, sell: false, total: false, ready: false }, lastAlert = { buy: 0, sell: 0, total: 0 };
let depthSamples=[], lowSince={buy:0,sell:0,total:0};
let telegramEnabled=false, telegramConfigured=false, history=[], historyLowState={buy:false,sell:false,total:false}, deferredInstall;
let orderbookLoading=false,dexLoading=false,exchangeVolumeLoading=false;
let tradeLoading=false,latestTrade=null;
let streamSocket=null,streamBook=null,streamId=0,streamReady=false,streamUpdates=[],streamReconnect=null,lastStreamRender=0,lastStreamMessage=0,streamOpenedAt=0,streamRenderTimer=null,lastStreamAnalysis=0;

const num = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
const money = (v) => Number.isFinite(v) ? v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
const price = (v) => { const n=num(v); return n >= 1 ? n.toLocaleString(undefined,{maximumFractionDigits:6}) : n.toLocaleString(undefined,{minimumFractionDigits:6,maximumFractionDigits:10}); };
const amount = (v) => num(v).toLocaleString(undefined,{maximumFractionDigits:2});
const marketAmount = (v) => num(v).toLocaleString(undefined,{maximumFractionDigits:2});

function calculate(book,referencePrice) {
  const reference=num(referencePrice);
  if (!reference) return { mid:0,buy:0,sell:0 };
  const total=(levels,side)=>levels.reduce((sum,[p,a])=>{p=num(p);a=num(a);const inside=side==="buy"?p>=reference*.98&&p<=reference:p>=reference&&p<=reference*1.02;return inside?sum+p*a:sum;},0);
  const buy=total(book.bids||[],"buy"),sell=total(book.asks||[],"sell");
  return { mid:reference, buy, sell, total:buy+sell };
}

function stabilize(raw){
  depthSamples.push({buy:raw.buy,sell:raw.sell});
  depthSamples=depthSamples.slice(-MEDIAN_SAMPLES);
  const median=side=>{const values=depthSamples.map(item=>item[side]).sort((a,b)=>a-b),middle=Math.floor(values.length/2);return values.length%2?values[middle]:(values[middle-1]+values[middle])/2;};
  const buy=median("buy"),sell=median("sell");
  return {mid:raw.mid,buy,sell,total:buy+sell};
}

function getAudio() { audio ||= new (window.AudioContext||window.webkitAudioContext)(); return audio; }
function toneNote(ctx,frequency,delay,duration=.45,gain=.2,type="sine"){const start=ctx.currentTime+delay,o=ctx.createOscillator(),g=ctx.createGain();o.type=type;o.frequency.setValueAtTime(frequency,start);g.gain.setValueAtTime(.0001,start);g.gain.exponentialRampToValueAtTime(gain,start+.025);g.gain.exponentialRampToValueAtTime(.0001,start+duration);o.connect(g);g.connect(ctx.destination);o.start(start);o.stop(start+duration+.03);}
function ring(){const ctx=getAudio();if(ctx.state!=="running")return;const sounds={chime:[[523.25,0,.6,.18,"sine"],[659.25,.13,.65,.16,"sine"],[783.99,.27,.75,.14,"sine"]],bell:[[880,0,.9,.2,"sine"],[1174.66,.18,1,.13,"sine"]],pulse:[[440,0,.38,.16,"triangle"],[554.37,.34,.48,.15,"triangle"],[659.25,.68,.55,.14,"triangle"]],digital:[[659.25,0,.22,.12,"sine"],[880,.18,.22,.12,"sine"],[987.77,.36,.38,.13,"sine"]],urgent:[[740,0,.2,.22,"square"],[980,.25,.2,.22,"square"],[740,.5,.2,.22,"square"]]};(sounds[soundTone]||sounds.chime).forEach(args=>toneNote(ctx,...args));}
function stopAlarm(){clearInterval(alarmTimer);clearTimeout(alarmStopTimer);alarmTimer=null;alarmStopTimer=null;if(navigator.vibrate)navigator.vibrate(0);}
async function playAlert(){if(!soundEnabled)return;const ctx=getAudio();if(ctx.state==="suspended")await ctx.resume().catch(()=>{});stopAlarm();ring();alarmTimer=setInterval(ring,1800);alarmStopTimer=setTimeout(stopAlarm,30000);if(navigator.vibrate)navigator.vibrate([120,60,120]);}

function showAlert(side,value,threshold){if(!popupsEnabled)return;const label=side==="buy"?"Buy":side==="sell"?"Sell":"Total";const box=document.createElement("div");box.className=`order-alert ${side}`;box.innerHTML=`<i class="alert-dot"></i><div><strong>${label} depth is below ${money(threshold)} USDT</strong><small>Repeats in 1 minute if depth stays low</small><b>${money(value)} / ${money(threshold)} USDT</b></div><button>× Close</button>`;box.querySelector("button").onclick=()=>{stopAlarm();box.remove();};$("alertStack").prepend(box);while($("alertStack").children.length>5)$("alertStack").lastElementChild.remove();}
function showLargeBuyAlert(order){if(!popupsEnabled)return;const box=document.createElement("div");box.className="order-alert large-buy";box.innerHTML=`<i class="alert-dot"></i><div><strong>Large buy order detected</strong><small>Top ${largeBuySettings.levels} highest-price buy levels</small><b>${money(order.value)} USDT at ${price(order.price)}</b></div><button>× Close</button>`;box.querySelector("button").onclick=()=>{stopAlarm();box.remove();};$("alertStack").prepend(box);while($("alertStack").children.length>5)$("alertStack").lastElementChild.remove();}
function findLargeBuys(book){return (book.bids||[]).slice(0,largeBuySettings.levels).map(([p,a])=>{const orderPrice=num(p),quantity=num(a);return {price:orderPrice,quantity,value:orderPrice*quantity,key:String(p)};}).filter(order=>order.value>=largeBuySettings.amount);}

async function sendTelegram(side,value,threshold){if(!telegramEnabled||!telegramConfigured)return;try{const r=await fetch("/api/telegram",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({side,value,threshold})});if(!r.ok)throw new Error((await r.json()).message);}catch(e){$("telegramStatus").textContent=`Telegram error: ${e.message}`;}}
function addHistory(depth){const now=Date.now(),buyLow=depth.buy<thresholds.buy,sellLow=depth.sell<thresholds.sell,totalLow=depth.total<thresholds.total,newBuy=buyLow&&!historyLowState.buy,newSell=sellLow&&!historyLowState.sell,newTotal=totalLow&&!historyLowState.total;historyLowState={buy:buyLow,sell:sellLow,total:totalLow};if(!newBuy&&!newSell&&!newTotal)return;history.push({t:now,b:depth.buy,s:depth.sell,v:depth.total,lb:newBuy,ls:newSell,lt:newTotal,tb:thresholds.buy,ts:thresholds.sell,tt:thresholds.total});history=history.filter(x=>x.t>=now-3600000).slice(-200);localStorage.setItem(keys.history,JSON.stringify(history));drawChart();}
function sideHistoryData(side,cut){const key=side==="buy"?"b":"s",flagKey=side==="buy"?"lb":"ls",targetKey=side==="buy"?"tb":"ts",target=thresholds[side],events=[];let wasLow=false;for(const item of history){if(typeof item[flagKey]==="boolean"){if(item.t>=cut&&item[flagKey])events.push(item);continue;}const low=num(item[key])<num(item[targetKey]||target);if(item.t>=cut&&low&&!wasLow)events.push(item);wasLow=low;}return events;}
function drawSideChart(side,mins,cut){const key=side==="buy"?"b":"s",target=thresholds[side],canvas=$(side+"DepthChart"),empty=$(side+"ChartEmpty"),data=sideHistoryData(side,cut),ctx=canvas.getContext("2d"),box=canvas.getBoundingClientRect(),ratio=devicePixelRatio||1;canvas.width=Math.max(1,box.width*ratio);canvas.height=Math.max(1,box.height*ratio);ctx.scale(ratio,ratio);const w=box.width,h=box.height,p={l:45,r:12,t:14,b:24};ctx.clearRect(0,0,w,h);empty.classList.toggle("hidden",data.length>0);if(!data.length)return;const max=Math.max(target,...data.map(item=>num(item[key])),1)*1.12,x=t=>p.l+(t-cut)/(Date.now()-cut)*(w-p.l-p.r),y=v=>p.t+(1-v/max)*(h-p.t-p.b),color=side==="buy"?"#22c55e":"#ef4444";ctx.font="9px system-ui";ctx.fillStyle="#77857d";ctx.strokeStyle="#1a211d";ctx.lineWidth=1;for(let i=0;i<=3;i++){const yy=p.t+i*(h-p.t-p.b)/3,value=max*(1-i/3);ctx.beginPath();ctx.moveTo(p.l,yy);ctx.lineTo(w-p.r,yy);ctx.stroke();ctx.fillText(value>=1000?`${(value/1000).toFixed(1)}k`:value.toFixed(0),3,yy+3);}ctx.save();ctx.setLineDash([5,4]);ctx.strokeStyle="#f59e0b";ctx.beginPath();ctx.moveTo(p.l,y(target));ctx.lineTo(w-p.r,y(target));ctx.stroke();ctx.restore();ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();data.forEach((item,index)=>index?ctx.lineTo(x(item.t),y(num(item[key]))):ctx.moveTo(x(item.t),y(num(item[key]))));if(data.length>1)ctx.stroke();for(const item of data){ctx.beginPath();ctx.arc(x(item.t),y(num(item[key])),3,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();}ctx.fillStyle="#77857d";ctx.fillText(`−${mins}m`,p.l,h-6);ctx.fillText("now",w-p.r-20,h-6);}
function timedHistoryData(cut){const events=[];let oldState={buy:false,sell:false,total:false};for(const item of history){if(item.t<cut)continue;const total=num(item.v)||num(item.b)+num(item.s);if(typeof item.lb==="boolean"||typeof item.ls==="boolean"||typeof item.lt==="boolean"){const normalized={...item,v:total,lt:typeof item.lt==="boolean"?item.lt:total<num(item.tt||thresholds.total),tt:num(item.tt)||thresholds.total};if(normalized.lb||normalized.ls||normalized.lt)events.push(normalized);continue;}const low={buy:num(item.b)<thresholds.buy,sell:num(item.s)<thresholds.sell,total:total<thresholds.total},derived={...item,v:total,lb:low.buy&&!oldState.buy,ls:low.sell&&!oldState.sell,lt:low.total&&!oldState.total,tb:thresholds.buy,ts:thresholds.sell,tt:thresholds.total};oldState=low;if(derived.lb||derived.ls||derived.lt)events.push(derived);}return events;}
function renderTimedHistory(data){const html=[...data].reverse().slice(0,40).map(item=>{const date=new Date(item.t),badges=[item.lb?'<b class="buy-low">BUY LOW</b>':'',item.ls?'<b class="sell-low">SELL LOW</b>':'',item.lt?'<b class="total-low">TOTAL LOW</b>':''].join(''),details=[item.lb?`Buy ${money(item.b)} / ${money(num(item.tb)||thresholds.buy)}`:'',item.ls?`Sell ${money(item.s)} / ${money(num(item.ts)||thresholds.sell)}`:'',item.lt?`Total ${money(num(item.v)||num(item.b)+num(item.s))} / ${money(num(item.tt)||thresholds.total)}`:''].filter(Boolean).join(' · ');return `<div class="timed-history-row"><time><b>${date.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",second:"2-digit"})}</b><small>${date.toLocaleDateString()}</small></time><div class="low-type-badges">${badges}</div><strong>${details} USDT</strong></div>`;}).join('')||'<div class="history-empty">No below-target depth event in this time range.</div>';$("timedHistoryList").innerHTML=html;$("buyHistoryTarget").textContent=`Below ${money(thresholds.buy)} USDT setting`;$("sellHistoryTarget").textContent=`Below ${money(thresholds.sell)} USDT setting`;}
function drawChart(){const mins=num($("chartRange")?.value)||60,cut=Date.now()-mins*60000;renderTimedHistory(timedHistoryData(cut));drawSideChart("buy",mins,cut);drawSideChart("sell",mins,cut);}

function rowsHtml(rows,side,mid){let cumulativeQty=0,cumulativeValue=0;const levels=rows.map(([p,a],priority)=>{const quantity=num(a),value=num(p)*quantity;cumulativeQty+=quantity;cumulativeValue+=value;return {p,a,value,priority,cumulativeQty,cumulativeValue};}),max=Math.max(...levels.map(x=>x.value),1),visible=side==="ask"?[...levels].reverse():levels;return visible.map(x=>{const distance=mid?Math.abs((num(x.p)-mid)/mid)*100:100,cls=distance<2?"near":distance<=5?"medium":"far",large=side==="bid"&&x.priority<largeBuySettings.levels&&x.value>=largeBuySettings.amount?" large-order":"",label=side==="ask"?"Sell total through this price":"Buy total through this price";return `<div class="book-row ${side} ${cls}${large}" tabindex="0" aria-label="${label} at ${price(x.p)} USDT: ${amount(x.cumulativeQty)} LF, ${money(x.cumulativeValue)} USDT"><i style="width:${Math.max(2,x.value/max*100)}%"></i><span>${price(x.p)}</span><span>${amount(x.a)}</span><span>${money(x.value)}</span><div class="book-cumulative"><small>${label}</small><span><em>Price</em><b>${price(x.p)} USDT</b></span><span><em>Total qty</em><b>${amount(x.cumulativeQty)} LF</b></span><span><em>Total value</em><b>${money(x.cumulativeValue)} USDT</b></span></div></div>`;}).join("");}

function renderPressure(depth){const total=num(depth.buy)+num(depth.sell),buy=total?num(depth.buy)/total*100:50,sell=100-buy;$("buyPressure").textContent=`${buy.toFixed(2)}%`;$("sellPressure").textContent=`${sell.toFixed(2)}%`;$("buyPressureBar").style.width=`${buy}%`;$("sellPressureBar").style.width=`${sell}%`;$("pressureMeter").setAttribute("aria-valuenow",buy.toFixed(2));$("pressureMeter").setAttribute("aria-valuetext",`Buy ${buy.toFixed(2)} percent, sell ${sell.toFixed(2)} percent`);}

function render(book,depth){const ask=num(book.asks?.[0]?.[0]),bid=num(book.bids?.[0]?.[0]),spread=ask-bid,pct=depth.mid?spread/depth.mid*100:0;$("bestBid").textContent=price(bid);$("bestAsk").textContent=price(ask);$("spread").textContent=`${price(spread)} · ${pct.toFixed(3)}%`;$("centerSpread").textContent=`Spread ${pct.toFixed(3)}%`;$("asks").classList.remove("loading");$("asks").innerHTML=rowsHtml([...(book.asks||[])].slice(0,ROWS),"ask",depth.mid);$("bids").innerHTML=rowsHtml((book.bids||[]).slice(0,ROWS),"bid",depth.mid);$("buyDepth").textContent=`${money(depth.buy)} / ${money(thresholds.buy)} USDT`;$("sellDepth").textContent=`${money(depth.sell)} / ${money(thresholds.sell)} USDT`;$("totalDepth").textContent=`${money(depth.total)} USDT`;renderPressure(depth);$("buyCard").className=depth.buy<thresholds.buy?"low":"ok";$("sellCard").className=depth.sell<thresholds.sell?"low":"ok";$("totalCard").className=depth.total<thresholds.total?"low":"ok";$("targets").textContent=`Targets: Buy ${money(thresholds.buy)} · Sell ${money(thresholds.sell)} · Total ${money(thresholds.total)} USDT · repeats every 1 min while low`;$("updated").textContent=`Updated ${new Date().toLocaleTimeString()}`;}

function renderDex(){if(!latestDex)return;$("dexPrice").textContent=price(latestDex.price);$("dexCenterPrice").textContent=price(latestDex.price);const eth=latestDex.ethUsd?` · ETH $${money(latestDex.ethUsd)}`:"";$("dexSource").textContent=`${latestDex.source}${eth} · 24h ${latestDex.change24h>=0?"+":""}${latestDex.change24h.toFixed(2)}%`;if(latestTrade?.price){const difference=(latestDex.price-latestTrade.price)/latestTrade.price*100;$("dexDifference").textContent=`Pool ${difference>=0?"+":""}${difference.toFixed(2)}% vs last trade`;}}
async function loadDexPrice(){if(dexLoading)return;dexLoading=true;try{const response=await fetch("/api/dex-price",{cache:"no-store"}),data=await response.json();if(!response.ok)throw new Error(data.message||"DEX price unavailable");latestDex=data;renderDex();if(typeof renderArbitrage==="function")renderArbitrage();}catch(error){$("dexSource").textContent=error.message;}finally{dexLoading=false;}}
async function loadExchangeVolume(){if(exchangeVolumeLoading)return;exchangeVolumeLoading=true;try{const response=await fetch("/api/exchange-volume",{cache:"no-store"}),data=await response.json();if(!response.ok)throw new Error(data.message||"Exchange volume unavailable");$("exchangeVolume").textContent=`${marketAmount(data.quoteVolume)} USDT`;$("exchangeVolumeQty").textContent=`${marketAmount(data.baseVolume)} LF · ${data.source}`;}catch(error){$("exchangeVolume").textContent="—";$("exchangeVolumeQty").textContent=error.message;}finally{exchangeVolumeLoading=false;}}
async function loadLastTrade(){if(tradeLoading)return;tradeLoading=true;try{const response=await fetch("/api/last-trade",{cache:"no-store"}),data=await response.json();if(!response.ok)throw new Error(data.message||"Last trade unavailable");latestTrade=data;$("lastTradePrice").textContent=price(data.price);$("centerTradePrice").textContent=price(data.price);const time=data.timestamp?new Date(data.timestamp).toLocaleTimeString():"live";$("lastTradeMeta").textContent=`${data.side?data.side.toUpperCase()+" · ":""}${time}`;renderDex();}catch(error){$("lastTradeMeta").textContent=error.message;}finally{tradeLoading=false;}}

async function fetchFastMarket(){
  const direct=async()=>{const [bookResponse,tradeResponse]=await Promise.all([fetch("https://api.gateio.ws/api/v4/spot/order_book?currency_pair=LF_USDT&limit=1000&with_id=true",{cache:"no-store"}),fetch("https://api.gateio.ws/api/v4/spot/trades?currency_pair=LF_USDT&limit=1",{cache:"no-store"})]),book=await bookResponse.json(),trades=await tradeResponse.json(),trade=trades?.[0];if(!bookResponse.ok||!tradeResponse.ok||!Array.isArray(book.bids)||!Array.isArray(book.asks)||!num(trade?.price))throw new Error("Direct Gate.io feed unavailable");return {book,lastTrade:{price:num(trade.price),amount:num(trade.amount),side:trade.side||"",tradeId:String(trade.id||""),timestamp:num(trade.create_time_ms)||num(trade.create_time)*1000||Date.now(),source:"Gate.io direct"},feed:"direct"};};
  const server=async()=>{const response=await fetch("/api/market",{cache:"no-store"}),market=await response.json();if(!response.ok)throw new Error(market.message||"Market data unavailable");return {...market,feed:"server"};};
  return Promise.any([direct(),server()]);
}

function applyStreamLevels(levels,changes,descending){const map=new Map((levels||[]).map(level=>[String(level[0]),String(level[1])]));for(const [p,a] of changes||[]){if(num(a)===0)map.delete(String(p));else map.set(String(p),String(a));}return [...map.entries()].sort((a,b)=>descending?num(b[0])-num(a[0]):num(a[0])-num(b[0])).slice(0,1000);}
function applyStreamUpdate(update){if(!streamBook)return false;const next=streamId+1;if(num(update.u)<next)return true;if(num(update.U)>next)return false;if(update.full){const bidFloor=Math.min(...(update.b||[]).map(level=>num(level[0])).filter(Boolean)),askCeiling=Math.max(...(update.a||[]).map(level=>num(level[0])).filter(Boolean));if(Number.isFinite(bidFloor))streamBook.bids=streamBook.bids.filter(level=>num(level[0])<bidFloor);if(Number.isFinite(askCeiling))streamBook.asks=streamBook.asks.filter(level=>num(level[0])>askCeiling);}streamBook.bids=applyStreamLevels(streamBook.bids,update.b,true);streamBook.asks=applyStreamLevels(streamBook.asks,update.a,false);streamBook.id=num(update.u);streamBook.update=num(update.t)||Date.now();streamId=num(update.u);return true;}
function seedStreamBook(book){streamBook={...book,bids:(book.bids||[]).map(level=>[...level]),asks:(book.asks||[]).map(level=>[...level])};streamId=num(book.id);const pending=streamUpdates.sort((a,b)=>num(a.u)-num(b.u));streamUpdates=[];streamReady=true;for(const update of pending){if(!applyStreamUpdate(update)){streamReady=false;break;}}}
function analyzeMarket(book,rawDepth){const alertDepth=stabilize(rawDepth);addHistory(alertDepth);const low={buy:alertDepth.buy<thresholds.buy,sell:alertDepth.sell<thresholds.sell,total:alertDepth.total<thresholds.total},now=Date.now(),detected=[];for(const side of ["buy","sell","total"]){if(low[side]&&!lowSince[side])lowSince[side]=now;if(!low[side])lowSince[side]=0;const confirmed=low[side]&&now-lowSince[side]>=CONFIRM_LOW_MS,due=!previousLow.ready||!previousLow[side]||now-lastAlert[side]>=REPEAT;if(confirmed&&due){detected.push(side);lastAlert[side]=now;}if(!low[side])lastAlert[side]=0;previousLow[side]=confirmed;}previousLow.ready=true;detected.forEach(side=>{showAlert(side,alertDepth[side],thresholds[side]);sendTelegram(side,alertDepth[side],thresholds[side]);});const largeBuys=findLargeBuys(book),currentLargeBuys=new Set(largeBuys.map(order=>order.key)),newLargeBuys=[];for(const order of largeBuys){const count=(largeBuySeen.get(order.key)||0)+1;largeBuySeen.set(order.key,count);if(count>=LOW_CONFIRMATIONS&&!activeLargeBuys.has(order.key)){activeLargeBuys.add(order.key);newLargeBuys.push(order);}}for(const key of [...largeBuySeen.keys()])if(!currentLargeBuys.has(key)){largeBuySeen.delete(key);activeLargeBuys.delete(key);}newLargeBuys.forEach(showLargeBuyAlert);if(detected.length||newLargeBuys.length)playAlert();}
function paintMarket(market,runAnalysis=true){const book=market.book;latestTrade=market.lastTrade;$("lastTradePrice").textContent=price(latestTrade.price);$("centerTradePrice").textContent=price(latestTrade.price);$("lastTradeMeta").textContent=`${latestTrade.side?latestTrade.side.toUpperCase()+" · ":""}${new Date(latestTrade.timestamp).toLocaleTimeString()}`;const rawDepth=calculate(book,latestTrade.price);if(!rawDepth.mid)throw new Error("Invalid last trade reference");latest={buy:rawDepth.buy,sell:rawDepth.sell,total:rawDepth.total,mid:rawDepth.mid,ready:true};if(runAnalysis)analyzeMarket(book,rawDepth);render(book,rawDepth);renderDex();if(typeof updateIntelligence==="function")updateIntelligence(book,rawDepth);$("connection").textContent=`Live · Gate.io ${market.feed==="WebSocket"?"WebSocket":market.feed==="direct"?"direct":"fallback"} · fastest 100ms feed`;$("liveDot").classList.remove("offline");}
function queueStreamRender(){if(streamRenderTimer!==null)return;const run=()=>{streamRenderTimer=null;lastStreamRender=performance.now();if(!streamReady||!streamBook||!latestTrade)return;try{const now=Date.now(),runAnalysis=now-lastStreamAnalysis>=250;if(runAnalysis)lastStreamAnalysis=now;paintMarket({book:streamBook,lastTrade:latestTrade,feed:"WebSocket"},runAnalysis);}catch(error){$("updated").textContent=error.message;}};streamRenderTimer=document.hidden?setTimeout(run,100):requestAnimationFrame(run);}
function connectMarketStream(){
  clearTimeout(streamReconnect);
  const previous=streamSocket;
  streamSocket=null;
  if(previous)previous.close();
  try{
    const ws=new WebSocket("wss://api.gateio.ws/ws/v4/");
    streamSocket=ws;
    streamOpenedAt=Date.now();
    ws.onopen=()=>{
      if(streamSocket!==ws)return;
      lastStreamMessage=Date.now();
      const time=Math.floor(Date.now()/1000);
      ws.send(JSON.stringify({time,channel:"spot.order_book_update",event:"subscribe",payload:["LF_USDT","100ms"]}));
      ws.send(JSON.stringify({time,channel:"spot.trades",event:"subscribe",payload:["LF_USDT"]}));
      if(!streamReady)load();
    };
    ws.onmessage=event=>{
      if(streamSocket!==ws)return;
      lastStreamMessage=Date.now();
      try{
        const message=JSON.parse(event.data);
        if(message.event!=="update"||!message.result)return;
        if(message.channel==="spot.trades"){
          const trade=message.result;
          if(!num(trade.price))return;
          latestTrade={price:num(trade.price),amount:num(trade.amount),side:trade.side||"",tradeId:String(trade.id||""),timestamp:num(trade.create_time_ms)||num(trade.create_time)*1000||Date.now(),source:"Gate.io WebSocket"};
          if(typeof recordFeedLatency==="function")recordFeedLatency(latestTrade.timestamp);
          if(typeof addTapeTrade==="function")addTapeTrade(latestTrade);
          queueStreamRender();
          return;
        }
        if(message.channel==="spot.order_book_update"){
          const update=message.result;
          if(typeof recordFeedLatency==="function")recordFeedLatency(update.t);
          if(!streamReady){streamUpdates.push(update);streamUpdates=streamUpdates.slice(-500);return;}
          if(!applyStreamUpdate(update)){streamReady=false;streamUpdates=[update];load();return;}
          queueStreamRender();
        }
      }catch(error){console.warn("Gate stream update:",error);}
    };
    ws.onerror=()=>ws.close();
    ws.onclose=()=>{
      if(streamSocket!==ws)return;
      streamReady=false;
      streamBook=null;
      streamUpdates=[];
      streamSocket=null;
      $("connection").textContent="Reconnecting to Gate.io…";
      $("liveDot").classList.add("offline");
      streamReconnect=setTimeout(connectMarketStream,1000);
      if(!document.hidden)load();
    };
  }catch{
    streamSocket=null;
    streamReady=false;
    streamReconnect=setTimeout(connectMarketStream,1000);
  }
}

async function load(){
  if(orderbookLoading)return;
  orderbookLoading=true;
  try{
    const market=streamReady&&streamBook&&latestTrade?{book:streamBook,lastTrade:latestTrade,feed:"WebSocket"}:await fetchFastMarket();
    if(streamSocket?.readyState===WebSocket.OPEN&&!streamReady){seedStreamBook(market.book);if(streamReady)market.book=streamBook;}
    paintMarket(market,true);
  }catch(e){$("connection").textContent="Connection issue";$("liveDot").classList.add("offline");$("updated").textContent=e.message;}finally{orderbookLoading=false;}
}

async function init(){const legacy=num(localStorage.getItem(keys.legacy)),fallback=legacy>0?legacy:DEFAULT;thresholds.buy=num(localStorage.getItem(keys.buy))||fallback;thresholds.sell=num(localStorage.getItem(keys.sell))||fallback;thresholds.total=num(localStorage.getItem(keys.total))||TOTAL_DEFAULT;soundEnabled=localStorage.getItem(keys.sound)==="enabled";popupsEnabled=localStorage.getItem(keys.popups)!=="disabled";telegramEnabled=localStorage.getItem(keys.telegram)==="enabled";try{history=JSON.parse(localStorage.getItem(keys.history)||"[]").filter(x=>x&&x.t&&x.b>=0&&x.s>=0);}catch{history=[];}applyTheme(localStorage.getItem(keys.theme)||"dark");$("themeBtn").onclick=()=>applyTheme(document.documentElement.dataset.theme==="light"?"dark":"light");updateSoundButton();$("soundBtn").onclick=async()=>{soundEnabled=!soundEnabled;if(soundEnabled){localStorage.setItem(keys.sound,"enabled");await getAudio().resume();if(latest.ready&&(latest.buy<thresholds.buy||latest.sell<thresholds.sell||latest.total<thresholds.total))playAlert();else ring();}else{localStorage.removeItem(keys.sound);stopAlarm();}updateSoundButton();};$("testBtn").onclick=()=>ring();$("refreshBtn").onclick=load;$("chartRange").onchange=drawChart;window.addEventListener("resize",drawChart);$("settingsBtn").onclick=()=>{fillSettings();$("settingsDialog").showModal();};$("saveSettings").onclick=(e)=>{const buy=num($("buyInput").value),sell=num($("sellInput").value),total=num($("totalInput").value);if(buy<=0||sell<=0||total<=0){e.preventDefault();return;}thresholds={buy,sell,total};telegramEnabled=$("telegramEnabled").checked&&telegramConfigured;localStorage.setItem(keys.buy,String(buy));localStorage.setItem(keys.sell,String(sell));localStorage.setItem(keys.total,String(total));telegramEnabled?localStorage.setItem(keys.telegram,"enabled"):localStorage.removeItem(keys.telegram);localStorage.removeItem(keys.legacy);previousLow={buy:false,sell:false,total:false,ready:false};lastAlert={buy:0,sell:0,total:0};stopAlarm();if(latest.ready){$("buyDepth").textContent=`${money(latest.buy)} / ${money(buy)} USDT`;$("sellDepth").textContent=`${money(latest.sell)} / ${money(sell)} USDT`;$("totalDepth").textContent=`${money(latest.total)} USDT`;}load();};$("telegramTest").onclick=async()=>{const b=$("telegramTest");b.disabled=true;b.textContent="Sending…";try{const r=await fetch("/api/telegram",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({side:"test"})}),j=await r.json();if(!r.ok)throw new Error(j.message);b.textContent="Sent ✓";}catch(e){b.textContent="Failed";$("telegramStatus").textContent=e.message;}setTimeout(()=>{b.textContent="Send test";b.disabled=!telegramConfigured;},2000);};try{const r=await fetch("/api/telegram"),j=await r.json();telegramConfigured=!!j.configured;}catch{}$("telegramStatus").textContent=telegramConfigured?"Configured on server":"Add bot token and chat ID on the server";$("telegramEnabled").disabled=!telegramConfigured;$("telegramEnabled").checked=telegramEnabled&&telegramConfigured;$("telegramTest").disabled=!telegramConfigured;fillSettings();if("serviceWorker" in navigator)navigator.serviceWorker.register("/sw.js");window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredInstall=e;$("installBtn").classList.remove("hidden");});$("installBtn").onclick=async()=>{if(!deferredInstall)return;deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;$("installBtn").classList.add("hidden");};drawChart();load();setInterval(()=>{if(!streamReady)load();},1000);}
function fillSettings(){if(!largeBuySettings.loaded){largeBuySettings.amount=num(localStorage.getItem(keys.largeBuy))||LARGE_BUY_DEFAULT;largeBuySettings.levels=Math.max(1,Math.min(18,Math.round(num(localStorage.getItem(keys.largeBuyLevels))||LARGE_BUY_LEVELS_DEFAULT)));largeBuySettings.loaded=true;}$("buyInput").value=thresholds.buy;$("sellInput").value=thresholds.sell;$("totalInput").value=thresholds.total;$("largeBuyInput").value=largeBuySettings.amount;$("largeBuyLevelsInput").value=largeBuySettings.levels;$("popupEnabled").checked=popupsEnabled;$("buyCurrent").textContent=`Current buy setting: ${money(thresholds.buy)} USDT`;$("sellCurrent").textContent=`Current sell setting: ${money(thresholds.sell)} USDT`;$("totalCurrent").textContent=`Current total setting: ${money(thresholds.total)} USDT`;$("largeBuyCurrent").textContent=`Alert at ${money(largeBuySettings.amount)} USDT or more`;$("largeBuyLevelsCurrent").textContent=`Watching top ${largeBuySettings.levels} highest-price buy orders`;}
function updateSoundButton(){$("soundBtn").innerHTML=soundEnabled?"🔊 <b>Sound on</b>":"🔇 <b>Sound off</b>";$("soundBtn").classList.toggle("enabled",soundEnabled);$("testBtn").disabled=!soundEnabled;if($("soundEnabledInput"))$("soundEnabledInput").checked=soundEnabled;}
function applyTheme(theme){document.documentElement.dataset.theme=theme;localStorage.setItem(keys.theme,theme);const light=theme==="light";$("themeBtn").innerHTML=light?"🌙 <b>Dark</b>":"☀️ <b>Light</b>";$("themeBtn").title=light?"Switch to dark theme":"Switch to light theme";$("themeBtn").setAttribute("aria-label",$("themeBtn").title);document.querySelector('meta[name="theme-color"]').content=light?"#f4f7f5":"#060806";drawChart();}
document.addEventListener("DOMContentLoaded",init);
document.addEventListener("DOMContentLoaded",()=>{loadDexPrice();setInterval(loadDexPrice,10000);});
document.addEventListener("DOMContentLoaded",()=>{loadExchangeVolume();setInterval(loadExchangeVolume,15000);});
document.addEventListener("DOMContentLoaded",()=>{$("clearHistory").onclick=()=>{history=[];historyLowState={buy:latest.ready&&latest.buy<thresholds.buy,sell:latest.ready&&latest.sell<thresholds.sell,total:latest.ready&&latest.total<thresholds.total};localStorage.removeItem(keys.history);drawChart();};});
document.addEventListener("DOMContentLoaded",()=>{$("saveSettings").addEventListener("click",()=>{historyLowState={buy:false,sell:false,total:false};});});
document.addEventListener("DOMContentLoaded",()=>{
  connectMarketStream();
  setInterval(()=>{
    const ws=streamSocket;
    if(!ws)return;
    const now=Date.now();
    if(ws.readyState===WebSocket.OPEN){
      if(now-lastStreamMessage>20000){ws.close();return;}
      try{ws.send(JSON.stringify({time:Math.floor(now/1000),channel:"spot.ping"}));}catch{ws.close();}
    }else if(ws.readyState===WebSocket.CONNECTING&&now-streamOpenedAt>12000)ws.close();
  },5000);
  document.addEventListener("visibilitychange",()=>{
    if(document.hidden)return;
    if(!streamSocket||Date.now()-lastStreamMessage>10000){
      streamReady=false;
      streamBook=null;
      connectMarketStream();
      load();
    }
  });
  document.addEventListener("pointerdown",()=>{if(soundEnabled)getAudio().resume().catch(()=>{});},{passive:true});
});
