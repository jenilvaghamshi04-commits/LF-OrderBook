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
  $("soundSelect").onchange=()=>{soundTone=$("soundSelect").value;localStorage.setItem(keys.tone,soundTone);};
  $("previewSound").onclick=async()=>{soundTone=$("soundSelect").value;localStorage.setItem(keys.tone,soundTone);const ctx=getAudio();if(ctx.state==="suspended")await ctx.resume().catch(()=>{});ring();};
  $("saveSettings").onclick=async event=>{
    event.preventDefault();
    const buy=num($("buyInput").value),sell=num($("sellInput").value),total=num($("totalInput").value),button=$("saveSettings");
    if(buy<=0||sell<=0||total<=0)return;
    soundTone=$("soundSelect").value;localStorage.setItem(keys.tone,soundTone);
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
