// Audio Context Engine (Synthesized, NO external URLs)
const SoundFx = {
  ctx: null,
  init() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  },
  playTone(freq, type, duration, delay = 0) {
    try {
      this.init();
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime + delay);
      gain.gain.setValueAtTime(0.12, this.ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + delay + duration);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(this.ctx.currentTime + delay);
      osc.stop(this.ctx.currentTime + delay + duration);
    } catch (e) {}
  },
  cardPlay() {
    this.playTone(480, 'triangle', 0.1);
    this.playTone(720, 'sine', 0.15, 0.04);
  },
  cardDraw() {
    this.playTone(280, 'sine', 0.12);
  },
  reverseSwoosh() {
    this.playTone(320, 'sawtooth', 0.15);
    this.playTone(640, 'triangle', 0.25, 0.08);
  },
  swapMagic() {
    [523.25, 659.25, 783.99, 1046.50].forEach((f, i) => {
      this.playTone(f, 'sine', 0.2, i * 0.06);
    });
  },
  unoAlert() {
    this.playTone(880, 'square', 0.18);
    this.playTone(1174.66, 'square', 0.28, 0.12);
  },
  winFanfare() {
    [440, 554.37, 659.25, 880, 1108.73].forEach((f, i) => {
      this.playTone(f, 'triangle', 0.35, i * 0.1);
    });
  }
};

// Constants & Configuration
const CARD_COLORS = ['red', 'blue', 'green', 'yellow'];
const NUMBER_VALUES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
const ACTION_VALUES = ['skip', 'reverse', 'draw2'];

// Player & Game Network State
let myPlayerId = 'p_' + Math.random().toString(36).substring(2, 9);
let myPlayerName = 'Player';
let isHost = false;
let currentRoomCode = '';
let broadcastChannel = null;

// Authoritative Host State
let gameState = {
  started: false,
  players: [], // { id, name, isBot, hand: [], cardCount: 0, unoCalled: false }
  deck: [],
  discardPile: [],
  topCard: null,
  currentColor: null,
  turnIndex: 0,
  direction: 1,
  drewThisTurn: false,
  winner: null
};

// Client Local State
let localMyHand = [];
let pendingSpecialCard = null;
let pendingCardIndex = -1;
let pendingTargetPlayerId = null;

// Show Custom UI Toast Notifications
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  const colors = {
    info: 'bg-slate-900/90 text-white border-white/20',
    warning: 'bg-amber-600/95 text-white border-amber-400',
    success: 'bg-emerald-600/95 text-white border-emerald-400',
    danger: 'bg-rose-600/95 text-white border-rose-400'
  };
  toast.className = `px-4 py-2 rounded-xl border text-xs sm:text-sm font-semibold shadow-2xl flex items-center gap-2 pointer-events-auto transition-all duration-300 transform translate-y-2 opacity-0 ${colors[type] || colors.info}`;
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  });

  setTimeout(() => {
    toast.classList.add('opacity-0', '-translate-y-2');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function toggleModal(id, show) {
  const modal = document.getElementById(id);
  if (modal) {
    modal.classList.toggle('hidden', !show);
  }
}

function switchLobbyTab(tab) {
  const isCreate = tab === 'create';
  document.getElementById('panel-create').classList.toggle('hidden', !isCreate);
  document.getElementById('panel-join').classList.toggle('hidden', isCreate);
  
  const btnCreate = document.getElementById('tab-btn-create');
  const btnJoin = document.getElementById('tab-btn-join');
  if (isCreate) {
    btnCreate.className = 'py-2.5 px-4 rounded-xl font-bold text-sm bg-gradient-to-r from-red-600 to-amber-600 shadow-lg text-white transition';
    btnJoin.className = 'py-2.5 px-4 rounded-xl font-bold text-sm bg-white/10 hover:bg-white/15 text-slate-300 transition';
  } else {
    btnJoin.className = 'py-2.5 px-4 rounded-xl font-bold text-sm bg-gradient-to-r from-blue-600 to-cyan-600 shadow-lg text-white transition';
    btnCreate.className = 'py-2.5 px-4 rounded-xl font-bold text-sm bg-white/10 hover:bg-white/15 text-slate-300 transition';
  }
}

// Generates complete UNO deck
function generateUnoDeck() {
  const deck = [];
  let uid = 1;

  CARD_COLORS.forEach(color => {
    deck.push({ id: `c_${uid++}`, color, value: '0', symbol: '0', type: 'number' });
    
    for (let i = 0; i < 2; i++) {
      for (let n = 1; n <= 9; n++) {
        deck.push({ id: `c_${uid++}`, color, value: n.toString(), symbol: n.toString(), type: 'number' });
      }
      deck.push({ id: `c_${uid++}`, color, value: 'skip', symbol: '⊘', type: 'action' });
      deck.push({ id: `c_${uid++}`, color, value: 'reverse', symbol: '⇄', type: 'action' });
      deck.push({ id: `c_${uid++}`, color, value: 'draw2', symbol: '+2', type: 'action' });
    }
  });

  for (let i = 0; i < 4; i++) {
    deck.push({ id: `c_${uid++}`, color: 'wild', value: 'wild', symbol: '★', type: 'wild' });
    deck.push({ id: `c_${uid++}`, color: 'wild', value: 'wild_draw4', symbol: '+4', type: 'wild' });
  }

  for (let i = 0; i < 2; i++) {
    deck.push({ id: `c_${uid++}`, color: 'wild', value: 'swap_hands', symbol: '🤝', type: 'swap' });
  }

  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  return deck;
}

// Cross-Tab Broadcast Channel
function setupChannel(roomCode) {
  if (broadcastChannel) {
    broadcastChannel.close();
  }
  currentRoomCode = roomCode;
  try {
    broadcastChannel = new BroadcastChannel('uno_room_' + roomCode);
    broadcastChannel.onmessage = (event) => {
      handleIncomingChannelMessage(event.data);
    };
  } catch (e) {
    window.addEventListener('storage', (e) => {
      if (e.key === 'uno_msg_' + roomCode && e.newValue) {
        try {
          const msg = JSON.parse(e.newValue);
          handleIncomingChannelMessage(msg);
        } catch (err) {}
      }
    });
  }
}

function sendChannelMessage(payload) {
  payload.senderId = myPlayerId;
  if (broadcastChannel) {
    try {
      broadcastChannel.postMessage(payload);
    } catch (e) {}
  }
  try {
    localStorage.setItem('uno_msg_' + currentRoomCode, JSON.stringify(payload));
  } catch (e) {}
}

function handleIncomingChannelMessage(data) {
  if (!data || data.senderId === myPlayerId) return;

  if (isHost) {
    handleHostReceivedData(data);
  } else {
    handleClientReceivedData(data);
  }
}

// Auto-check URL
window.addEventListener('load', () => {
  const urlParams = new URLSearchParams(window.location.search);
  const roomParam = urlParams.get('room');
  if (roomParam) {
    document.getElementById('input-room-code').value = roomParam;
    switchLobbyTab('join');
    showToast('พบรหัสห้องจาก URL! กดเข้าร่วมได้เลย', 'info');
  }
});

// Host: Create Room
function createRoom() {
  SoundFx.init();
  myPlayerName = document.getElementById('input-username').value.trim() || 'Host';
  isHost = true;

  const shortId = 'UNO-' + Math.floor(1000 + Math.random() * 9000);
  setupChannel(shortId);
  setupLobbyUIForRoom(shortId);

  gameState.players = [{
    id: myPlayerId,
    name: myPlayerName,
    isBot: false,
    hand: [],
    cardCount: 0,
    unoCalled: false
  }];
  updateLobbyPlayerSlots();
  showToast(`สร้างห้องสำเร็จ! รหัส: ${shortId}`, 'success');
}

// Client: Join Existing Room
function joinRoom() {
  SoundFx.init();
  myPlayerName = document.getElementById('input-username').value.trim() || 'Guest';
  const targetRoomId = document.getElementById('input-room-code').value.trim().toUpperCase();

  if (!targetRoomId) {
    showToast('กรุณากรอกรหัสห้อง (Room Code)', 'warning');
    return;
  }

  isHost = false;
  setupChannel(targetRoomId);
  setupLobbyUIForRoom(targetRoomId);

  sendChannelMessage({
    type: 'REQUEST_JOIN',
    id: myPlayerId,
    name: myPlayerName
  });

  showToast(`กำลังเข้าร่วมห้อง ${targetRoomId}...`, 'info');
}

function openPlayerTab() {
  const roomId = currentRoomCode || document.getElementById('room-code-display').innerText.trim();
  if (!roomId || roomId === '---') return;
  const url = window.location.origin + window.location.pathname + '?room=' + roomId;
  window.open(url, '_blank');
  showToast('เปิดแท็บใหม่แล้ว! ตั้งชื่อแล้วกด "เข้าเล่นห้องเพื่อน"', 'info');
}

function removePlayerFromGame(playerId) {
  const idx = gameState.players.findIndex(p => p.id === playerId);
  if (idx !== -1) {
    const pName = gameState.players[idx].name;
    gameState.players.splice(idx, 1);
    showToast(`${pName} ออกจากเกม`, 'info');

    if (gameState.started) {
      if (gameState.players.length < 2) {
        showToast('ผู้เล่นเหลือน้อยกว่า 2 คน เกมสิ้นสุด', 'warning');
        gameState.started = false;
        location.reload();
        return;
      }
      if (gameState.turnIndex >= gameState.players.length) {
        gameState.turnIndex = 0;
      }
    }
    updateLobbyPlayerSlots();
    broadcastGameState();
  }
}

function copyInviteLink() {
  const roomId = currentRoomCode || document.getElementById('room-code-display').innerText.trim();
  const el = document.createElement('textarea');
  el.value = roomId;
  document.body.appendChild(el);
  el.select();
  document.execCommand('copy');
  document.body.removeChild(el);

  showToast(`คัดลอกรหัสห้อง ${roomId} แล้ว!`, 'success');
}

function setupLobbyUIForRoom(roomId) {
  document.getElementById('lobby-action-tabs').classList.add('hidden');
  document.getElementById('panel-create').classList.add('hidden');
  document.getElementById('panel-join').classList.add('hidden');
  document.getElementById('panel-room-lobby').classList.remove('hidden');
  document.getElementById('room-code-display').innerText = roomId;
  document.getElementById('btn-copy-link').classList.remove('hidden');
  document.getElementById('btn-leave-room').classList.remove('hidden');

  if (isHost) {
    document.getElementById('host-start-container').classList.remove('hidden');
    document.getElementById('host-add-bot-controls').classList.remove('hidden');
    document.getElementById('client-waiting-message').classList.add('hidden');
  } else {
    document.getElementById('host-start-container').classList.add('hidden');
    document.getElementById('host-add-bot-controls').classList.add('hidden');
    document.getElementById('client-waiting-message').classList.remove('hidden');
  }
}

function updateLobbyPlayerSlots() {
  const listEl = document.getElementById('lobby-player-list');
  const countEl = document.getElementById('label-player-count');
  if (!listEl) return;

  countEl.innerText = `${gameState.players.length} / 6 คน`;
  listEl.innerHTML = '';

  for (let i = 0; i < 6; i++) {
    const player = gameState.players[i];
    const slot = document.createElement('div');
    if (player) {
      const isMe = player.id === myPlayerId;
      slot.className = 'p-2.5 rounded-xl bg-white/10 border border-white/20 flex items-center justify-between shadow-sm';
      slot.innerHTML = `
        <div class="flex items-center gap-2 min-w-0">
          <span class="w-2.5 h-2.5 rounded-full ${player.isBot ? 'bg-indigo-400' : 'bg-emerald-400'}"></span>
          <span class="text-xs font-bold truncate text-white">${player.name} ${isMe ? '<span class="text-yellow-400">(คุณ)</span>' : ''}</span>
        </div>
        <span class="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-slate-300 font-medium">${player.isBot ? 'AI บอท' : (i === 0 ? '👑 หัวหน้า' : 'ผู้เล่น')}</span>
      `;
    } else {
      slot.className = 'p-2.5 rounded-xl border border-dashed border-white/10 flex items-center justify-center text-slate-500 text-xs font-medium';
      slot.innerText = `ว่าง (ช่องที่ ${i + 1})`;
    }
    listEl.appendChild(slot);
  }
}

function addBotPlayer() {
  if (!isHost) return;
  if (gameState.players.length >= 6) {
    showToast('ห้องเต็มแล้ว (สูงสุด 6 คน)', 'warning');
    return;
  }
  const botNames = ['บอทโซเดียม 🤖', 'บอทมีมี่ 🐱', 'บอทกัปตัน ⚓', 'บอทลักกี้ 🍀', 'บอทนินจา 🥷'];
  const botName = botNames[(gameState.players.length - 1) % botNames.length];
  
  gameState.players.push({
    id: 'bot_' + Math.random().toString(36).substr(2, 6),
    name: botName,
    isBot: true,
    hand: [],
    cardCount: 0,
    unoCalled: false
  });

  updateLobbyPlayerSlots();
  broadcastGameState();
  showToast(`เพิ่ม ${botName} สำเร็จ`, 'info');
}

function leaveRoom() {
  if (broadcastChannel) {
    try { broadcastChannel.close(); } catch(e) {}
  }
  window.location.href = window.location.origin + window.location.pathname;
}

function handleHostReceivedData(data) {
  if (data.type === 'REQUEST_JOIN') {
    if (gameState.players.length < 6 && !gameState.started) {
      if (!gameState.players.some(p => p.id === data.id)) {
        gameState.players.push({
          id: data.id,
          name: data.name,
          isBot: false,
          hand: [],
          cardCount: 0,
          unoCalled: false
        });
        updateLobbyPlayerSlots();
        broadcastGameState();
        showToast(`${data.name} เข้าร่วมห้องแล้ว!`, 'success');
      }
    } else {
      sendChannelMessage({
        type: 'ERROR_MSG',
        targetId: data.id,
        message: 'ห้องเต็มแล้ว (สูงสุด 6 คน) หรือเกมเริ่มแล้ว'
      });
    }
  } else if (data.type === 'ACTION_PLAY_CARD') {
    executePlayCard(data.playerId, data.cardIndex, data.chosenColor, data.targetPlayerId);
  } else if (data.type === 'ACTION_DRAW_CARD') {
    executeDrawCard(data.playerId);
  } else if (data.type === 'ACTION_PASS_TURN') {
    executePassTurn(data.playerId);
  } else if (data.type === 'ACTION_SHOUT_UNO') {
    executeUnoShout(data.playerId);
  }
}

function handleClientReceivedData(data) {
  if (data.targetId && data.targetId !== myPlayerId) return;

  if (data.type === 'SYNC_STATE') {
    gameState.started = data.state.started;
    gameState.topCard = data.state.topCard;
    gameState.currentColor = data.state.currentColor;
    gameState.turnIndex = data.state.turnIndex;
    gameState.direction = data.state.direction;
    gameState.players = data.state.players;
    gameState.winner = data.state.winner;
    
    if (data.hands && data.hands[myPlayerId]) {
      localMyHand = data.hands[myPlayerId];
    }

    if (gameState.started) {
      document.getElementById('lobby-screen').classList.add('hidden');
      document.getElementById('game-screen').classList.remove('hidden');
      renderGameArena();
    } else {
      updateLobbyPlayerSlots();
    }

    if (gameState.winner) {
      handleWinnerAnnouncement(gameState.winner);
    }
  } else if (data.type === 'ERROR_MSG') {
    showToast(data.message, 'danger');
  } else if (data.type === 'SOUND_EVENT') {
    if (SoundFx[data.sound]) SoundFx[data.sound]();
  }
}

function broadcastGameState(soundTrigger = null) {
  if (!isHost) return;

  if (soundTrigger && SoundFx[soundTrigger]) {
    SoundFx[soundTrigger]();
  }

  const handsMap = {};
  gameState.players.forEach(p => {
    handsMap[p.id] = p.hand || [];
  });

  sendChannelMessage({
    type: 'SYNC_STATE',
    state: sanitizeGameState(),
    hands: handsMap,
    soundEvent: soundTrigger
  });

  const hostPlayer = gameState.players.find(p => p.id === myPlayerId);
  if (hostPlayer) {
    localMyHand = hostPlayer.hand;
  }

  if (gameState.started) {
    document.getElementById('lobby-screen').classList.add('hidden');
    document.getElementById('game-screen').classList.remove('hidden');
    renderGameArena();
  } else {
    updateLobbyPlayerSlots();
  }

  if (gameState.winner) {
    handleWinnerAnnouncement(gameState.winner);
  }

  checkAndTriggerBotTurn();
}

function sanitizeGameState() {
  return {
    started: gameState.started,
    topCard: gameState.topCard,
    currentColor: gameState.currentColor,
    turnIndex: gameState.turnIndex,
    direction: gameState.direction,
    winner: gameState.winner,
    players: gameState.players.map(p => ({
      id: p.id,
      name: p.name,
      isBot: p.isBot,
      cardCount: p.hand ? p.hand.length : p.cardCount,
      unoCalled: p.unoCalled
    }))
  };
}

function requestStartGame() {
  if (!isHost) return;
  if (gameState.players.length < 2) {
    showToast('ต้องการผู้เล่นอย่างน้อย 2 คน (กด "เพิ่มบอท AI" เพื่อลองเล่นได้)', 'warning');
    return;
  }

  gameState.started = true;
  gameState.deck = generateUnoDeck();
  gameState.discardPile = [];
  gameState.turnIndex = 0;
  gameState.direction = 1;
  gameState.drewThisTurn = false;
  gameState.winner = null;

  gameState.players.forEach(p => {
    p.hand = gameState.deck.splice(0, 7);
    p.cardCount = p.hand.length;
    p.unoCalled = false;
  });

  let initialTop = gameState.deck.pop();
  while (initialTop.color === 'wild') {
    gameState.deck.unshift(initialTop);
    initialTop = gameState.deck.pop();
  }

  gameState.topCard = initialTop;
  gameState.currentColor = initialTop.color;
  gameState.discardPile.push(initialTop);

  broadcastGameState('cardPlay');
  showToast('เริ่มเกมแล้ว! ขอให้ทุกคนโชคดี 🎉', 'success');
}

function isCardPlayable(card, topCard, activeColor) {
  if (!card || !topCard) return false;
  if (card.color === 'wild') return true;
  if (card.color === activeColor) return true;
  if (card.value === topCard.value) return true;
  return false;
}

function executePlayCard(playerId, cardIndex, chosenColor, targetPlayerId) {
  const currentPlayer = gameState.players[gameState.turnIndex];
  if (!currentPlayer || currentPlayer.id !== playerId) return;

  const card = currentPlayer.hand[cardIndex];
  if (!card) return;

  if (!isCardPlayable(card, gameState.topCard, gameState.currentColor)) {
    return;
  }

  currentPlayer.hand.splice(cardIndex, 1);
  currentPlayer.cardCount = currentPlayer.hand.length;
  gameState.discardPile.push(card);
  gameState.topCard = card;
  gameState.drewThisTurn = false;

  let soundToPlay = 'cardPlay';

  if (card.color === 'wild') {
    gameState.currentColor = chosenColor || 'red';
  } else {
    gameState.currentColor = card.color;
  }

  if (card.value === 'reverse') {
    soundToPlay = 'reverseSwoosh';
    if (gameState.players.length === 2) {
      advanceTurnIndex(false);
    } else {
      gameState.direction *= -1;
    }
    showToast(`สลับทิศทางการเล่น! ⇄`, 'warning');
  }

  if (card.value === 'swap_hands') {
    soundToPlay = 'swapMagic';
    const target = gameState.players.find(p => p.id === targetPlayerId);
    if (target && target.id !== currentPlayer.id) {
      const tempHand = [...currentPlayer.hand];
      currentPlayer.hand = [...target.hand];
      target.hand = tempHand;
      currentPlayer.cardCount = currentPlayer.hand.length;
      target.cardCount = target.hand.length;
      showToast(`🤝 ${currentPlayer.name} ได้สลับการ์ดทั้งหมดกับ ${target.name}!`, 'warning');
    }
  }

  let skipNext = false;
  if (card.value === 'skip') {
    skipNext = true;
    showToast(`ผู้เล่นคนถัดไปถูกข้ามตา! ⊘`, 'warning');
  }

  let forcedDrawCount = 0;
  if (card.value === 'draw2') {
    forcedDrawCount = 2;
    skipNext = true;
  }

  if (card.value === 'wild_draw4') {
    forcedDrawCount = 4;
    skipNext = true;
  }

  if (currentPlayer.hand.length === 0) {
    gameState.winner = currentPlayer.name;
    broadcastGameState('winFanfare');
    return;
  }

  if (currentPlayer.hand.length === 1 && !currentPlayer.unoCalled) {
    showToast(`${currentPlayer.name} ลืมกดอูโน่! โดนปรับจั่ว 2 ใบ ⚠️`, 'danger');
    drawCardsForPlayer(currentPlayer, 2);
  }
  currentPlayer.unoCalled = false;

  advanceTurnIndex(skipNext, forcedDrawCount);
  broadcastGameState(soundToPlay);
}

function drawCardsForPlayer(player, count) {
  for (let i = 0; i < count; i++) {
    if (gameState.deck.length === 0) {
      const top = gameState.discardPile.pop();
      gameState.deck = gameState.discardPile;
      gameState.discardPile = [top];
      for (let k = gameState.deck.length - 1; k > 0; k--) {
        const j = Math.floor(Math.random() * (k + 1));
        [gameState.deck[k], gameState.deck[j]] = [gameState.deck[j], gameState.deck[k]];
      }
    }
    if (gameState.deck.length > 0) {
      player.hand.push(gameState.deck.pop());
    }
  }
  player.cardCount = player.hand.length;
}

function executeDrawCard(playerId) {
  const currentPlayer = gameState.players[gameState.turnIndex];
  if (!currentPlayer || currentPlayer.id !== playerId || gameState.drewThisTurn) return;

  drawCardsForPlayer(currentPlayer, 1);
  gameState.drewThisTurn = true;

  showToast(`${currentPlayer.name} จั่วการ์ด 1 ใบ`, 'info');
  broadcastGameState('cardDraw');
}

function executePassTurn(playerId) {
  const currentPlayer = gameState.players[gameState.turnIndex];
  if (!currentPlayer || currentPlayer.id !== playerId || !gameState.drewThisTurn) return;

  gameState.drewThisTurn = false;
  advanceTurnIndex(false);
  broadcastGameState('cardPlay');
}

function executeUnoShout(playerId) {
  const player = gameState.players.find(p => p.id === playerId);
  if (player) {
    player.unoCalled = true;
    showToast(`⚡ ${player.name} กดอูโน่ (UNO)! เหลือการ์ด 1 ใบ!`, 'warning');
    broadcastGameState('unoAlert');
  }
}

function advanceTurnIndex(skipNext = false, forcedDraw = 0) {
  const count = gameState.players.length;
  let nextIndex = (gameState.turnIndex + gameState.direction + count) % count;

  if (forcedDraw > 0) {
    const victim = gameState.players[nextIndex];
    drawCardsForPlayer(victim, forcedDraw);
    showToast(`${victim.name} โดนจั่ว +${forcedDraw} ใบ และถูกข้ามตา!`, 'danger');
  }

  if (skipNext) {
    nextIndex = (nextIndex + gameState.direction + count) % count;
  }

  gameState.turnIndex = nextIndex;
  gameState.drewThisTurn = false;
}

function checkAndTriggerBotTurn() {
  if (!isHost || !gameState.started || gameState.winner) return;
  const current = gameState.players[gameState.turnIndex];
  if (!current || !current.isBot) return;

  setTimeout(() => {
    if (!gameState.started || gameState.winner) return;

    if (current.hand.length === 2) {
      current.unoCalled = true;
      showToast(`⚡ ${current.name} กดอูโน่ (UNO)!`, 'warning');
    }

    const playableIndices = [];
    current.hand.forEach((c, idx) => {
      if (isCardPlayable(c, gameState.topCard, gameState.currentColor)) {
        playableIndices.push(idx);
      }
    });

    if (playableIndices.length > 0) {
      const chosenIdx = playableIndices[Math.floor(Math.random() * playableIndices.length)];
      const card = current.hand[chosenIdx];
      
      let pickedColor = null;
      if (card.color === 'wild') {
        pickedColor = CARD_COLORS[Math.floor(Math.random() * CARD_COLORS.length)];
      }

      let swapTargetId = null;
      if (card.value === 'swap_hands') {
        const rivals = gameState.players.filter(p => p.id !== current.id);
        rivals.sort((a, b) => a.cardCount - b.cardCount);
        swapTargetId = rivals[0]?.id;
      }

      executePlayCard(current.id, chosenIdx, pickedColor, swapTargetId);
    } else {
      executeDrawCard(current.id);
      setTimeout(() => {
        executePassTurn(current.id);
      }, 600);
    }
  }, 1000);
}

function renderGameArena() {
  const dirIcon = document.getElementById('direction-icon');
  const dirText = document.getElementById('direction-text');
  if (gameState.direction === 1) {
    dirIcon.innerText = '↻';
    dirIcon.style.transform = 'rotate(0deg)';
    dirText.innerText = 'ทิศทาง: ตามเข็มนาฬิกา';
  } else {
    dirIcon.innerText = '↺';
    dirIcon.style.transform = 'rotate(-180deg)';
    dirText.innerText = 'ทิศทาง: ทวนเข็มนาฬิกา';
  }

  const oppContainer = document.getElementById('opponents-container');
  oppContainer.innerHTML = '';

  gameState.players.forEach((player, idx) => {
    if (player.id === myPlayerId) return;

    const isCurrentTurn = idx === gameState.turnIndex;
    const cardBox = document.createElement('div');
    cardBox.className = `flex flex-col items-center bg-black/40 backdrop-blur-md px-3 py-2 rounded-2xl border transition-all duration-300 ${
      isCurrentTurn ? 'active-turn-ring border-yellow-400 bg-black/60' : 'border-white/10'
    }`;

    let miniCardsHtml = '';
    const displayCount = Math.min(player.cardCount, 5);
    for (let c = 0; c < displayCount; c++) {
      const rot = (c - (displayCount - 1) / 2) * 8;
      miniCardsHtml += `<div class="w-3 h-5 bg-red-600 rounded-[3px] border border-white -ml-1.5 shadow-sm" style="transform: rotate(${rot}deg);"></div>`;
    }

    cardBox.innerHTML = `
      <div class="flex items-center gap-1.5 mb-1">
        <span class="w-2 h-2 rounded-full ${player.isBot ? 'bg-indigo-400' : 'bg-emerald-400'}"></span>
        <span class="text-xs font-bold text-white max-w-[80px] truncate">${player.name}</span>
        ${player.unoCalled ? '<span class="text-[9px] px-1 bg-red-500 text-white font-black rounded-sm animate-bounce">UNO</span>' : ''}
      </div>
      <div class="flex items-center pl-1.5 mb-1.5 h-6">
        ${miniCardsHtml}
      </div>
      <div class="px-2 py-0.5 rounded-full ${isCurrentTurn ? 'bg-yellow-400 text-slate-950 font-black' : 'bg-white/10 text-yellow-300 font-bold'} text-[11px] flex items-center gap-1">
        <span>🃏 ${player.cardCount} ใบ</span>
      </div>
    `;
    oppContainer.appendChild(cardBox);
  });

  const discardEl = document.getElementById('table-discard-pile');
  if (gameState.topCard) {
    discardEl.innerHTML = createCardHTML(gameState.topCard, false);
  }

  const colorHalo = document.getElementById('active-color-indicator');
  const haloColors = {
    red: '#D7263D',
    blue: '#0077B6',
    green: '#2EC4B6',
    yellow: '#FFB703'
  };
  colorHalo.style.backgroundColor = haloColors[gameState.currentColor] || '#ffffff';

  const currentActivePlayer = gameState.players[gameState.turnIndex];
  const isMyTurn = currentActivePlayer && currentActivePlayer.id === myPlayerId;
  const turnTitle = document.getElementById('turn-announcement');
  const passBtn = document.getElementById('btn-pass-turn');

  if (isMyTurn) {
    turnTitle.innerText = `👉 ตาของคุณแล้ว (${myPlayerName})!`;
    turnTitle.className = 'text-base sm:text-lg font-black text-yellow-400 drop-shadow-md animate-pulse';
    passBtn.classList.toggle('hidden', !gameState.drewThisTurn);
  } else {
    turnTitle.innerText = `⏳ ตาของ: ${currentActivePlayer ? currentActivePlayer.name : '...'}`;
    turnTitle.className = 'text-base sm:text-lg font-bold text-slate-300 drop-shadow-md';
    passBtn.classList.add('hidden');
  }

  const handContainer = document.getElementById('my-hand-cards');
  const countBadge = document.getElementById('my-card-count-badge');
  handContainer.innerHTML = '';
  countBadge.innerText = localMyHand.length;

  localMyHand.forEach((card, index) => {
    const playable = isMyTurn && isCardPlayable(card, gameState.topCard, gameState.currentColor);
    const cardEl = document.createElement('div');
    cardEl.className = 'transition-transform';
    cardEl.innerHTML = createCardHTML(card, playable);
    
    cardEl.firstElementChild.onclick = () => {
      onPlayerCardClicked(index, card);
    };
    handContainer.appendChild(cardEl);
  });
}

function createCardHTML(card, isPlayable = false) {
  const colorClass = `bg-uno-${card.color}`;
  let textClass = `card-text-${card.color}`;
  if (card.color === 'yellow') textClass = 'card-text-yellow';
  
  const isWild = card.color === 'wild';
  const playableClass = isPlayable ? 'playable' : '';

  return `
    <div class="uno-card ${playableClass}">
      <div class="card-body ${colorClass}">
        <div class="corner-symbol corner-top-left uno-font">${card.symbol}</div>
        <div class="card-oval">
          ${isWild ? '<div class="wild-quadrant"></div>' : ''}
          <div class="card-center-symbol uno-font ${textClass}">
            ${card.symbol}
          </div>
        </div>
        <div class="corner-symbol corner-bottom-right uno-font">${card.symbol}</div>
      </div>
    </div>
  `;
}

function onPlayerCardClicked(index, card) {
  const currentActive = gameState.players[gameState.turnIndex];
  if (!currentActive || currentActive.id !== myPlayerId) {
    showToast('ยังไม่ถึงตาของคุณ!', 'warning');
    return;
  }

  if (!isCardPlayable(card, gameState.topCard, gameState.currentColor)) {
    showToast('ไม่สามารถวางการ์ดใบนี้ได้ (ต้องเป็นสีเดียวกัน ตัวเลขเดียวกัน หรือการ์ดเปลี่ยนสี)', 'danger');
    return;
  }

  pendingCardIndex = index;
  pendingSpecialCard = card;

  if (card.value === 'swap_hands') {
    showSwapHandsModal();
  } else if (card.color === 'wild') {
    toggleModal('color-picker-modal', true);
  } else {
    sendCardPlayAction(index, null, null);
  }
}

function showSwapHandsModal() {
  const list = document.getElementById('swap-target-list');
  list.innerHTML = '';

  gameState.players.forEach(p => {
    if (p.id !== myPlayerId) {
      const btn = document.createElement('button');
      btn.className = 'w-full p-3 bg-white/10 hover:bg-amber-500/20 hover:border-amber-400 border border-white/10 rounded-2xl flex items-center justify-between transition text-left';
      btn.innerHTML = `
        <div class="flex items-center gap-2">
          <span class="w-2.5 h-2.5 rounded-full ${p.isBot ? 'bg-indigo-400' : 'bg-emerald-400'}"></span>
          <span class="font-bold text-sm text-white">${p.name}</span>
        </div>
        <span class="text-xs px-2.5 py-1 bg-amber-400 text-slate-950 font-black rounded-full">
          🃏 เหลือ ${p.cardCount} ใบ
        </span>
      `;
      btn.onclick = () => {
        toggleModal('swap-hands-modal', false);
        pendingTargetPlayerId = p.id;
        toggleModal('color-picker-modal', true);
      };
      list.appendChild(btn);
    }
  });

  toggleModal('swap-hands-modal', true);
}

function confirmColorPick(color) {
  toggleModal('color-picker-modal', false);
  sendCardPlayAction(pendingCardIndex, color, pendingTargetPlayerId);
  pendingTargetPlayerId = null;
}

function sendCardPlayAction(cardIndex, chosenColor, targetPlayerId) {
  if (isHost) {
    executePlayCard(myPlayerId, cardIndex, chosenColor, targetPlayerId);
  } else {
    sendChannelMessage({
      type: 'ACTION_PLAY_CARD',
      playerId: myPlayerId,
      cardIndex,
      chosenColor,
      targetPlayerId
    });
  }
}

function onPlayerDrawClick() {
  const currentActive = gameState.players[gameState.turnIndex];
  if (!currentActive || currentActive.id !== myPlayerId) {
    showToast('ยังไม่ถึงตาของคุณ!', 'warning');
    return;
  }

  if (isHost) {
    executeDrawCard(myPlayerId);
  } else {
    sendChannelMessage({
      type: 'ACTION_DRAW_CARD',
      playerId: myPlayerId
    });
  }
}

function onPlayerPassTurn() {
  if (isHost) {
    executePassTurn(myPlayerId);
  } else {
    sendChannelMessage({
      type: 'ACTION_PASS_TURN',
      playerId: myPlayerId
    });
  }
}

function shoutUno() {
  if (isHost) {
    executeUnoShout(myPlayerId);
  } else {
    sendChannelMessage({
      type: 'ACTION_SHOUT_UNO',
      playerId: myPlayerId
    });
  }
}

function handleWinnerAnnouncement(winnerName) {
  document.getElementById('winner-name-text').innerText = `ผู้เล่น ${winnerName} เป็นผู้ชนะ! 🎉`;
  toggleModal('winner-modal', true);
  document.getElementById('btn-play-again').classList.toggle('hidden', !isHost);
}

function requestPlayAgain() {
  if (isHost) {
    toggleModal('winner-modal', false);
    requestStartGame();
  }
}
