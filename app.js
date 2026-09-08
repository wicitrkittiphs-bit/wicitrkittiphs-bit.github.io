const socket=io(); let state=null, swap=false;
const $=id=>document.getElementById(id);
function msg(t){$("msg").textContent=t}
function createRoom(){socket.emit("createRoom",{name:$("name").value.trim()||"Player"})}
function joinRoom(){socket.emit("joinRoom",{name:$("name").value.trim()||"Player",code:$("code").value.trim()})}
function startGame(){socket.emit("startGame")}
function copyCode(){navigator.clipboard?.writeText(state.code); alert("คัดลอกรหัสห้องแล้ว")}
socket.on("errorMsg",msg);
socket.on("state",s=>{state=s; render()});
function render(){
 $("lobby").hidden=state.started; $("game").hidden=!state.started;
 $("roomInfo").textContent=state.code?`ห้อง ${state.code} • ${state.players.length}/6 คน`:"ยังไม่ได้เข้าห้อง";
 $("playersLobby").innerHTML=state.players.map((p,i)=>`<div class="player ${p.id===state.turn?'active':''}">👤 ${esc(p.name)}<small>${p.count} ใบ</small></div>`).join("");
 $("startBtn").style.display=(!state.started && state.players.length>=2)?"block":"none";
 if(!state.started)return;
 $("codeView").textContent=state.code;
 const me=state.players.find(p=>p.isMe), turn=state.players.find(p=>p.id===state.turn);
 $("status").innerHTML=turn?`ตาของ: <b>${esc(turn.name)}</b> • คุณมี ${me.count} ใบ`:"เกมจบแล้ว";
 $("players").innerHTML=state.players.map(p=>`<div class="player ${p.id===state.turn?'active':''}">👤 ${esc(p.name)}<small>${p.count} ใบ${p.id===state.turn?' • ถึงตา':''}</small></div>`).join("");
 $("direction").textContent=state.direction===1?"↻":"↺";
 $("topCard").innerHTML=cardHTML(state.top);
 $("hand").innerHTML=state.myHand.map((c,i)=>cardHTML(c,i)).join("");
 document.querySelectorAll("#hand .card").forEach((el,i)=>el.onclick=()=>play(i));
}
function cardHTML(c,i){let icon={skip:"⊘",reverse:"↻",draw2:"+2",wild:"★",wild4:"+4"}[c.type]||c.type;return `<div class="card ${c.color}" data-i="${i}"><div class="oval">${icon}</div></div>`}
function play(i){
 const c=state.myHand[i]; if(c.color==="black"){let color=prompt("เลือกสี: red / yellow / green / blue","red"); if(!["red","yellow","green","blue"].includes(color))return; socket.emit("playCard",{index:i,color})}else socket.emit("playCard",{index:i});
}
function draw(){socket.emit("draw")}
function swapMode(){swap=!swap;$("swapPanel").hidden=!swap;if(swap)$("swapButtons").innerHTML=state.players.filter(p=>!p.isMe).map(p=>`<button onclick="swapWith('${p.id}')">สลับกับ ${esc(p.name)} (${p.count} ใบ)</button>`).join("")}
function swapWith(id){socket.emit("swapHands",{targetId:id});swap=false;$("swapPanel").hidden=true}
function esc(s){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
