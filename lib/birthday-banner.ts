// One-off strip above the marketing nav: countdown to 6 Nov 2026 (IST), then "Happy Birthday" for the day.
// It hides itself after 6 Nov ends, so this file can be deleted any time after that.
const BIRTHDAY_START = Date.parse("2026-11-06T00:00:00+05:30");
const BIRTHDAY_END = Date.parse("2026-11-07T00:00:00+05:30");

export function birthdayBanner(now = Date.now()) {
  if (now >= BIRTHDAY_END) return "";
  return `<div id="bday" class="bday" role="status">
  <span id="bday-text">Birthday is coming, Anekio ke Malik 👑</span>
  <span id="bday-clock" class="bday-clock"></span>
</div>
<style>
.bday{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:6px 12px;padding:10px 16px;background:linear-gradient(90deg,#2855f6,#7c3aed,#ec4899);color:#fff;font-weight:700;font-size:15px;text-align:center;position:relative;overflow:hidden}
.bday-clock{font-variant-numeric:tabular-nums;background:rgba(255,255,255,.18);border-radius:999px;padding:3px 12px;letter-spacing:.02em}
.bday-clock:empty{display:none}
.bday-confetti{position:absolute;top:-10px;width:7px;height:11px;border-radius:2px;animation:bday-fall linear forwards;pointer-events:none}
@keyframes bday-fall{to{transform:translateY(80px) rotate(540deg);opacity:0}}
@media(prefers-reduced-motion:reduce){.bday-confetti{display:none}}
</style>
<script>
(function(){
  var start=${BIRTHDAY_START},end=${BIRTHDAY_END};
  var box=document.getElementById("bday"),text=document.getElementById("bday-text"),clock=document.getElementById("bday-clock");
  var party=false;
  function pad(n){return n<10?"0"+n:""+n}
  function confetti(){
    var colors=["#f5b93f","#fff","#14b889","#21b6e8","#fde68a"];
    for(var i=0;i<40;i++){
      var c=document.createElement("i");c.className="bday-confetti";
      c.style.left=Math.random()*100+"%";c.style.background=colors[i%colors.length];
      c.style.animationDuration=(1.5+Math.random()*2)+"s";c.style.animationDelay=(Math.random()*1.5)+"s";
      box.appendChild(c);
    }
  }
  function tick(){
    var now=Date.now();
    if(now>=end){box.remove();return}
    if(now>=start){
      if(!party){party=true;text.textContent="Happy Birthday, Anekio ke Malik 🎂";clock.textContent="";confetti()}
      return;
    }
    var s=Math.floor((start-now)/1000);
    var d=Math.floor(s/86400),h=Math.floor(s%86400/3600),m=Math.floor(s%3600/60);
    clock.textContent=(d?d+"d ":"")+pad(h)+"h "+pad(m)+"m "+pad(s%60)+"s";
  }
  tick();setInterval(tick,1000);
})();
</script>`;
}
