const $=id=>document.getElementById(id);
const key="lf-liquidity-bot-test-v1";
let timer=null,count=0,running=false,nextAt=0,checking=false,records=[];
const number=value=>Number.isFinite(Number(value))?Number(value):0;
const price=value=>number(value).toLocaleString(undefined,{minimumFractionDigits:6,maximumFractionDigits:10});
const amount=value=>number(value).toLocaleString(undefined,{maximumFractionDigits:2});
const money=value=>number(value).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
function values(){return {buyAmount:number($("buyAmount").value),sellAmount:number($("sellAmount").value),buyPercent:number($("buyPercent").value),sellPercent:number($("sellPercent").value),intervalSeconds:number($("intervalSeconds").value)};}
function valid(s){return s.buyAmount>0&&s.sellAmount>0&&s.buyPercent>0&&s.buyPercent<=20&&s.sellPercent>0&&s.sellPercent<=20&&s.intervalSeconds>=1&&s.intervalSeconds<=300;}
function save(){localStorage.setItem(key,JSON.stringify(values()));}
function load(){try{const saved=JSON.parse(localStorage.getItem(key)||"{}");for(const id of ["buyAmount","sellAmount","buyPercent","sellPercent","intervalSeconds"])if(number(saved[id])>0)$(id).value=saved[id];}catch{}}
function syncInputs(){const s=values();$("buyPercentView").textContent=s.buyPercent.toFixed(2);$("sellPercentView").textContent=s.sellPercent.toFixed(2);$("buyValue").textContent=`${money(s.buyAmount)} USDT`;$("sellValue").textContent=`${money(s.sellAmount)} USDT`;save();}
function renderLog(){$("activity").innerHTML=records.length?records.map(item=>`<div class="log-row"><time>${item.time}</time><b>${item.pool}</b><span><i class="buy-dot"></i>${item.buy}<small>${item.buyQty} LF</small></span><span><i class="sell-dot"></i>${item.sell}<small>${item.sellQty} LF</small></span><em>SIMULATED</em></div>`).join(""):'<div class="empty">Start testing to record simulated order calculations.</div>';}
function updateCountdown(){if(!running){$("nextCheck").textContent="—";return;}$("nextCheck").textContent=`${Math.max(0,Math.ceil((nextAt-Date.now())/1000))}s`;}
function schedule(){clearInterval(timer);const delay=values().intervalSeconds*1000;nextAt=Date.now()+delay;timer=setInterval(()=>{nextAt=Date.now()+delay;check();},delay);updateCountdown();}
async function check(){if(checking)return;const s=values();if(!valid(s)){setStatus("Check settings","error");return;}checking=true;$("checkBtn").disabled=true;setStatus("Checking…","working");try{const response=await fetch(`/api/dex-price?t=${Date.now()}`,{cache:"no-store",signal:AbortSignal.timeout(9000)}),data=await response.json();if(!response.ok||!number(data.price))throw new Error(data.message||"Pool price unavailable");const pool=number(data.price),buy=pool*(1-s.buyPercent/100),sell=pool*(1+s.sellPercent/100),buyQty=s.buyAmount/buy,sellQty=s.sellAmount/sell;$("poolPrice").textContent=price(pool);$("poolSource").textContent=`${data.source||"Live DEX pool"} · updated ${new Date(data.updatedAt||Date.now()).toLocaleTimeString()}`;$("buyPrice").textContent=`${price(buy)} USDT`;$("sellPrice").textContent=`${price(sell)} USDT`;$("buyQuantity").textContent=`${amount(buyQty)} LF`;$("sellQuantity").textContent=`${amount(sellQty)} LF`;$("lastCheck").textContent=new Date().toLocaleTimeString();$("checkCount").textContent=++count;records.unshift({time:new Date().toLocaleTimeString(),pool:price(pool),buy:price(buy),buyQty:amount(buyQty),sell:price(sell),sellQty:amount(sellQty)});records=records.slice(0,50);renderLog();setStatus("Calculation ready","ok");}catch(error){setStatus(error.message||"Check failed","error");}finally{checking=false;$("checkBtn").disabled=false;}}
function setStatus(text,tone=""){$("status").textContent=text;$("status").className=tone;}
function start(event){event?.preventDefault();const s=values();if(!valid(s)){setStatus("Enter valid settings","error");return;}running=true;syncInputs();$("botState").textContent="Testing";$("modeBadge").classList.add("active");$("startBtn").disabled=true;$("pauseBtn").disabled=false;check();schedule();}
function pause(){running=false;clearInterval(timer);timer=null;$("botState").textContent="Paused";$("nextCheck").textContent="—";$("modeBadge").classList.remove("active");$("startBtn").disabled=false;$("pauseBtn").disabled=true;setStatus("Paused");}
load();syncInputs();renderLog();
$("settings").addEventListener("submit",start);
$("pauseBtn").addEventListener("click",pause);
$("checkBtn").addEventListener("click",()=>{syncInputs();check();if(running)schedule();});
$("clearBtn").addEventListener("click",()=>{records=[];count=0;$("checkCount").textContent="0";renderLog();});
for(const id of ["buyAmount","sellAmount","buyPercent","sellPercent","intervalSeconds"])$(id).addEventListener("input",syncInputs);
setInterval(updateCountdown,250);
check();
