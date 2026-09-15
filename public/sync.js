async function syncSharedSettings(){
  try{
    const response=await fetch("/api/settings",{cache:"no-store"}),settings=await response.json();
    if(!response.ok)throw new Error(settings.message||"Settings unavailable");
    const changed=thresholds.buy!==settings.buy||thresholds.sell!==settings.sell||thresholds.total!==settings.total;
    thresholds={buy:num(settings.buy),sell:num(settings.sell),total:num(settings.total)};
    localStorage.setItem(keys.buy,String(thresholds.buy));localStorage.setItem(keys.sell,String(thresholds.sell));localStorage.setItem(keys.total,String(thresholds.total));
    if(changed){previousLow={buy:false,sell:false,total:false,ready:false};lastAlert={buy:0,sell:0,total:0};fillSettings();load();}
  }catch(error){console.error("Settings sync:",error.message);}
}

document.addEventListener("DOMContentLoaded",()=>{
  soundTone=localStorage.getItem(keys.tone)||"chime";$("soundSelect").value=soundTone;
  $("soundEnabledInput").checked=soundEnabled;
  $("soundSelect").onchange=()=>{soundTone=$("soundSelect").value;localStorage.setItem(keys.tone,soundTone);};
  $("previewSound").onclick=async()=>{soundTone=$("soundSelect").value;localStorage.setItem(keys.tone,soundTone);$("soundEnabledInput").checked=true;const ctx=getAudio();if(ctx.state==="suspended")await ctx.resume().catch(()=>{});ring();};
  $("saveSettings").onclick=async event=>{
    event.preventDefault();
    const buy=num($("buyInput").value),sell=num($("sellInput").value),total=num($("totalInput").value),largeBuy=num($("largeBuyInput").value),largeBuyLevels=Math.round(num($("largeBuyLevelsInput").value)),button=$("saveSettings");
    if(buy<=0||sell<=0||total<=0||largeBuy<=0||largeBuyLevels<1||largeBuyLevels>18)return;
    soundTone=$("soundSelect").value;localStorage.setItem(keys.tone,soundTone);
    soundEnabled=$("soundEnabledInput").checked;if(soundEnabled){localStorage.setItem(keys.sound,"enabled");await getAudio().resume().catch(()=>{});}else{localStorage.removeItem(keys.sound);stopAlarm();}updateSoundButton();
    largeBuySettings={amount:largeBuy,levels:largeBuyLevels,loaded:true};activeLargeBuys=new Set();localStorage.setItem(keys.largeBuy,String(largeBuy));localStorage.setItem(keys.largeBuyLevels,String(largeBuyLevels));
    button.disabled=true;button.textContent="Saving…";
    try{
      const response=await fetch("/api/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({buy,sell,total})}),result=await response.json();
      if(!response.ok)throw new Error(result.message||"Could not save settings");
      thresholds={buy:result.buy,sell:result.sell,total:result.total};
      localStorage.setItem(keys.buy,String(result.buy));localStorage.setItem(keys.sell,String(result.sell));localStorage.setItem(keys.total,String(result.total));
      previousLow={buy:false,sell:false,total:false,ready:false};lastAlert={buy:0,sell:0,total:0};stopAlarm();fillSettings();$("settingsDialog").close();load();
    }catch(error){$("telegramStatus").textContent=`Settings error: ${error.message}`;}
    finally{button.disabled=false;button.textContent="Save settings";}
  };
  syncSharedSettings();setInterval(syncSharedSettings,5000);
});
