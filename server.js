const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();
const COLORS = ["red","yellow","green","blue"];
const TYPES = ["0","1","2","3","4","5","6","7","8","9","skip","reverse","draw2"];
const SPECIAL = ["wild","wild4"];

function makeDeck() {
  const d=[];
  for (const c of COLORS) {
    d.push({color:c,type:"0"});
    for (const t of TYPES.slice(1)) {
      d.push({color:c,type:t},{color:c,type:t});
    }
  }
  for(let i=0;i<4;i++){ d.push({color:"black",type:"wild"},{color:"black",type:"wild4"}); }
  return d;
}
function shuffle(a){ for(let i=a.length-1;i>0;i--){let j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }

function newGame(room){
  room.deck=shuffle(makeDeck());
  room.discard=[];
  room.turn=0;
  room.direction=1;
  room.currentColor=null;
  for(const p of room.players) p.hand=[];
  for(let n=0;n<7;n++) for(const p of room.players) p.hand.push(room.deck.pop());
  let top;
  do { top=room.deck.pop(); if(top.type==="wild4") room.deck.unshift(top); } while(top.type==="wild4");
  room.discard.push(top); room.currentColor=top.color;
  if(top.type==="reverse") room.direction = -1;
  if(top.type==="skip") room.turn = 1 % room.players.length;
  if(top.type==="draw2"){
    const p=room.players[room.turn]; p.hand.push(room.deck.pop(),room.deck.pop());
    room.turn=(room.turn+room.direction+room.players.length)%room.players.length;
  }
}
function roomState(room, socketId){
  return {
    code:room.code,
    started:room.started,
    players:room.players.map((p,i)=>({
      id:p.id,name:p.name,count:p.hand.length,ready:p.ready,
      isMe:p.id===socketId
    })),
    top:room.discard.at(-1),
    currentColor:room.currentColor,
    turn:room.players[room.turn]?.id,
    direction:room.direction,
    myHand:room.players.find(p=>p.id===socketId)?.hand || []
  };
}
function emitRoom(room){ for(const p of room.players) io.to(p.id).emit("state",roomState(room,p.id)); }
function getPlayer(room,id){ return room.players.find(p=>p.id===id); }
function nextTurn(room, steps=1){ room.turn=(room.turn + room.direction*steps + room.players.length*10)%room.players.length; }

function drawCards(room,p,n){
  for(let i=0;i<n;i++){
    if(room.deck.length===0){
      const top=room.discard.pop();
      const recycle=room.discard.splice(0);
      room.discard.push(top);
      room.deck=shuffle(recycle);
    }
    if(room.deck.length) p.hand.push(room.deck.pop());
  }
}
function canPlay(card,room){
  const top=room.discard.at(-1);
  return card.color==="black" || card.color===room.currentColor || card.type===top.type;
}

io.on("connection", socket=>{
  socket.on("createRoom", ({name})=>{
    let code;
    do code=Math.random().toString(36).slice(2,7).toUpperCase(); while(rooms.has(code));
    const room={code,players:[{id:socket.id,name:(name||"Player").slice(0,18),hand:[],ready:false}],started:false};
    rooms.set(code,room); socket.join(code); emitRoom(room);
  });
  socket.on("joinRoom", ({code,name})=>{
    const room=rooms.get((code||"").toUpperCase());
    if(!room) return socket.emit("errorMsg","ไม่พบห้องนี้");
    if(room.started) return socket.emit("errorMsg","เกมเริ่มแล้ว");
    if(room.players.length>=6) return socket.emit("errorMsg","ห้องเต็ม (สูงสุด 6 คน)");
    if(room.players.some(p=>p.name===name)) return socket.emit("errorMsg","ชื่อนี้ถูกใช้แล้ว");
    room.players.push({id:socket.id,name:(name||"Player").slice(0,18),hand:[],ready:false});
    socket.join(room.code); emitRoom(room);
  });
  socket.on("startGame", ()=>{
    const room=[...rooms.values()].find(r=>r.players.some(p=>p.id===socket.id));
    if(!room || room.players[0].id!==socket.id) return;
    if(room.players.length<2) return socket.emit("errorMsg","ต้องมีผู้เล่นอย่างน้อย 2 คน");
    room.started=true; newGame(room); emitRoom(room);
  });
  socket.on("playCard", ({index,color})=>{
    const room=[...rooms.values()].find(r=>r.players.some(p=>p.id===socket.id));
    if(!room||!room.started) return;
    const p=getPlayer(room,socket.id);
    if(room.players[room.turn].id!==socket.id) return;
    const card=p.hand[index];
    if(!card || !canPlay(card,room)) return;
    if(card.type==="wild4" && p.hand.some(c=>c.color!=="black" && c.color===room.currentColor)) return socket.emit("errorMsg","Wild +4 ใช้ได้เมื่อไม่มีการ์ดสีปัจจุบัน");
    p.hand.splice(index,1); room.discard.push(card);
    room.currentColor=card.color==="black" ? (color||COLORS[Math.floor(Math.random()*4)]) : card.color;
    if(p.hand.length===0){ room.started=false; room.winner=p.name; emitRoom(room); return; }
    if(card.type==="skip") nextTurn(room,2);
    else if(card.type==="reverse"){
      if(room.players.length===2) nextTurn(room,2); else {room.direction*=-1; nextTurn(room,1);}
    } else if(card.type==="draw2"){ nextTurn(room,1); drawCards(room,room.players[room.turn],2); nextTurn(room,1); }
    else if(card.type==="wild4"){ nextTurn(room,1); drawCards(room,room.players[room.turn],4); nextTurn(room,1); }
    else nextTurn(room,1);
    emitRoom(room);
  });
  socket.on("draw", ()=>{
    const room=[...rooms.values()].find(r=>r.players.some(p=>p.id===socket.id));
    if(!room||!room.started||room.players[room.turn].id!==socket.id) return;
    const p=getPlayer(room,socket.id); drawCards(room,p,1);
    const drawn=p.hand.at(-1);
    if(!drawn || !canPlay(drawn,room)) nextTurn(room,1);
    emitRoom(room);
  });
  socket.on("swapHands", ({targetId})=>{
    const room=[...rooms.values()].find(r=>r.players.some(p=>p.id===socket.id));
    if(!room||!room.started||room.players[room.turn].id!==socket.id) return;
    const a=getPlayer(room,socket.id), b=getPlayer(room,targetId);
    if(!b || b.id===a.id) return;
    [a.hand,b.hand]=[b.hand,a.hand];
    nextTurn(room,1); emitRoom(room);
  });
  socket.on("disconnect", ()=>{
    for(const [code,room] of rooms){
      const i=room.players.findIndex(p=>p.id===socket.id);
      if(i>=0){ room.players.splice(i,1); if(room.players.length===0) rooms.delete(code); else { if(room.started && room.turn>=room.players.length) room.turn=0; emitRoom(room); } }
    }
  });
});

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log(`UNO server running on http://localhost:${PORT}`));
