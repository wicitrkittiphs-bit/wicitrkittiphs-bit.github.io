const COLORS = ['red', 'blue', 'green', 'yellow'];
const COLOR_NAMES_TH = { red: 'สีแดง', blue: 'สีฟ้า', green: 'สีเขียว', yellow: 'สีเหลือง', wild: 'อิสระ' };

let gameState = {
    roomCode: '',
    isHost: false,
    players: [],
    myPlayerId: 'p_' + Math.random().toString(36).substring(2, 7),
    myName: 'ผู้เล่น',
    turnIndex: 0,
    direction: 1,
    deck: [],
    discardPile: [],
    activeColor: 'red',
    activeValue: null,
    gameActive: false,
    pendingWildCard: null,
    hasDrawnThisTurn: false,
    saidUnoPlayers: {}
};

let peer = null;
let conn = null;
let connections = []; // เก็บการเชื่อมต่อของเพื่อนทุกคน (กรณีเป็น Host)

function showAlert(msg, duration = 3000) {
    const banner = document.getElementById('game-alert-banner');
    banner.textContent = msg;
    banner.style.opacity = '1';
    banner.style.transform = 'translate(-50%, 10px)';
    setTimeout(() => {
        banner.style.opacity = '0';
        banner.style.transform = 'translate(-50%, 0)';
    }, duration);
}

function switchScreen(screenId) {
    document.getElementById('screen-lobby').classList.add('hidden');
    document.getElementById('screen-room').classList.add('hidden');
    document.getElementById('screen-game').classList.add('hidden');
    document.getElementById('header-actions').classList.add('hidden');

    document.getElementById(screenId).classList.remove('hidden');
    if (screenId !== 'screen-lobby') {
        document.getElementById('header-actions').classList.remove('hidden');
    }
}

function closeModals() {
    document.getElementById('modal-create-room').classList.add('hidden');
    document.getElementById('modal-join-room').classList.add('hidden');
    document.getElementById('modal-color-picker').classList.add('hidden');
    document.getElementById('modal-card-trade').classList.add('hidden');
    document.getElementById('modal-game-over').classList.add('hidden');
}

function showCreateRoomModal() {
    document.getElementById('input-create-code').value = Math.floor(1000 + Math.random() * 9000).toString();
    document.getElementById('modal-create-room').classList.remove('hidden');
}

function showJoinRoomModal() {
    document.getElementById('modal-join-room').classList.remove('hidden');
}

function confirmCreateRoom() {
    const code = document.getElementById('input-create-code').value.trim() || '1234';
    gameState.myName = document.getElementById('input-username').value.trim() || 'ผู้เล่น';
    
    gameState.roomCode = code;
    gameState.isHost = true;
    gameState.players = [{
        id: gameState.myPlayerId,
        name: gameState.myName,
        isBot: false,
        hand: []
    }];

    initHostPeer(code);
    closeModals();
    updateRoomUI();
    switchScreen('screen-room');
    showAlert('สร้างห้องสำเร็จ! รหัสห้องคือ: ' + code);
}

function confirmJoinRoom() {
    const code = document.getElementById('input-join-code').value.trim().toUpperCase();
    gameState.myName = document.getElementById('input-username').value.trim() || 'ผู้เล่น';
    
    if (!code) {
        showAlert('กรุณากรอกรหัสห้อง');
        return;
    }

    gameState.roomCode = code;
    gameState.isHost = false;

    initGuestPeer(code);
}

// ระบบ Host เชื่อมต่อ PeerJS
function initHostPeer(roomCode) {
    if (peer) peer.destroy();
    // ใช้ Prefix ชัดเจนเพื่อให้หากันเจอ
    peer = new Peer('uno_monochrome_room_' + roomCode);

    peer.on('open', (id) => {
        console.log('Host เปิดห้องสำเร็จ ID:', id);
    });

    peer.on('connection', (connection) => {
        connections.push(connection);
        
        connection.on('data', (data) => {
            if (data.type === 'JOIN_ROOM') {
                if (gameState.players.length >= 6) {
                    connection.send({ type: 'ROOM_FULL' });
                    return;
                }
                let newPlayer = data.player;
                newPlayer.connectionId = connection.peer;
                
                // ตรวจสอบว่ามีผู้เล่นนี้ในห้องหรือยัง
                if (!gameState.players.some(p => p.id === newPlayer.id)) {
                    gameState.players.push(newPlayer);
                }
                updateRoomUI();
                broadcastRoomState();
            } else if (data.type === 'PLAYER_ACTION') {
                // รองรับการกระทำของผู้เล่นคนอื่นในอนาคต
            }
        });

        connection.on('close', () => {
            connections = connections.filter(c => c !== connection);
            gameState.players = gameState.players.filter(p => p.connectionId !== connection.peer);
            updateRoomUI();
            broadcastRoomState();
        });
    });

    peer.on('error', (err) => {
        console.error(err);
        showAlert('รหัสห้องนี้ถูกใช้งานแล้ว กรุณาใช้รหัสอื่น');
    });
}

// ระบบ Guest เข้าร่วมห้องผ่าน PeerJS
function initGuestPeer(roomCode) {
    if (peer) peer.destroy();
    peer = new Peer();

    peer.on('open', (id) => {
        const hostPeerId = 'uno_monochrome_room_' + roomCode;
        conn = peer.connect(hostPeerId);

        conn.on('open', () => {
            closeModals();
            switchScreen('screen-room');
            showAlert('เชื่อมต่อเข้าห้องสำเร็จ!');
            
            // ส่งข้อมูลขอเข้าร่วมห้องไปยัง Host
            conn.send({
                type: 'JOIN_ROOM',
                player: {
                    id: gameState.myPlayerId,
                    name: gameState.myName,
                    isBot: false,
                    hand: []
                },
                peerId: id
            });
        });

        conn.on('data', (data) => {
            if (data.type === 'ROOM_STATE_UPDATE') {
                gameState.players = data.players;
                updateRoomUI();
                if (data.gameStarted) {
                    gameState.gameActive = true;
                    switchScreen('screen-game');
                    updateGameUI();
                }
            } else if (data.type === 'ROOM_FULL') {
                showAlert('ห้องเต็มแล้ว (สูงสุด 6 คน)');
                leaveRoom();
            }
        });

        conn.on('error', (err) => {
            console.error(err);
            showAlert('ไม่พบห้องที่มีรหัสนี้ หรือโฮสต์ยังไม่เปิดห้อง');
        });
    });

    peer.on('error', (err) => {
        showAlert('การเชื่อมต่อล้มเหลว กรุณาลองใหม่อีกครั้ง');
    });
}

function broadcastRoomState(gameStarted = false) {
    if (!gameState.isHost) return;
    connections.forEach(c => {
        if (c && c.open) {
            c.send({
                type: 'ROOM_STATE_UPDATE',
                players: gameState.players,
                gameStarted: gameStarted
            });
        }
    });
}

function addBotPlayer() {
    if (!gameState.isHost) return;
    if (gameState.players.length >= 6) {
        showAlert('ห้องเต็มแล้ว (สูงสุด 6 คน)');
        return;
    }
    const botNames = ['บอทสมชาย', 'บอทสุดสวย', 'บอทโปรแกรมเมอร์', 'บอทนักซิ่ง', 'บอทอัจฉริยะ'];
    const existingNames = gameState.players.map(p => p.name);
    const availableNames = botNames.filter(n => !existingNames.includes(n));
    const botName = availableNames[Math.floor(Math.random() * availableNames.length)] || ('บอท ' + (gameState.players.length + 1));

    gameState.players.push({
        id: 'bot_' + Math.random().toString(36).substring(2, 7),
        name: botName,
        isBot: true,
        hand: []
    });

    updateRoomUI();
    broadcastRoomState();
}

function removePlayer(id) {
    if (!gameState.isHost) return;
    gameState.players = gameState.players.filter(p => p.id !== id);
    updateRoomUI();
    broadcastRoomState();
}

function updateRoomUI() {
    document.getElementById('display-room-code').textContent = gameState.roomCode;
    document.getElementById('room-badge').textContent = 'ห้อง: ' + gameState.roomCode;
    document.getElementById('player-count').textContent = gameState.players.length;

    const listContainer = document.getElementById('room-players-list');
    listContainer.innerHTML = '';

    gameState.players.forEach((p, idx) => {
        const isMe = p.id === gameState.myPlayerId;
        const div = document.createElement('div');
        div.className = "flex items-center justify-between p-3 bg-zinc-950 border border-zinc-800 rounded-xl";
        
        let playerInfoHtml = '<div class="flex items-center space-x-3">';
        playerInfoHtml += '<div class="w-8 h-8 rounded-lg bg-zinc-800 flex items-center justify-center font-bold text-xs">' + (idx + 1) + '</div>';
        playerInfoHtml += '<div>';
        playerInfoHtml += '<span class="text-sm font-medium ' + (isMe ? 'text-white font-bold' : 'text-zinc-300') + '">' + p.name + (isMe ? ' (คุณ)' : '') + '</span>';
        playerInfoHtml += '<span class="block text-[10px] text-zinc-500">' + (p.isBot ? 'บอท AI' : 'ผู้เล่นจริง') + '</span>';
        playerInfoHtml += '</div></div>';
        
        if (gameState.isHost && !isMe) {
            playerInfoHtml += '<button onclick="removePlayer(\'' + p.id + '\')" class="text-xs text-red-400 hover:text-red-300 px-2 py-1">เตะออก</button>';
        }
        
        div.innerHTML = playerInfoHtml;
        listContainer.appendChild(div);
    });

    const startBtn = document.getElementById('btn-start-game');
    if (gameState.isHost) {
        startBtn.style.display = 'block';
        if (gameState.players.length >= 2) {
            startBtn.removeAttribute('disabled');
            startBtn.textContent = 'เริ่มเกม (' + gameState.players.length + ' คน)';
        } else {
            startBtn.setAttribute('disabled', 'true');
            startBtn.textContent = 'ต้องการผู้เล่นอย่างน้อย 2 คน';
        }
    } else {
        startBtn.style.display = 'none';
    }
}

function copyRoomCode() {
    const code = gameState.roomCode;
    const textarea = document.createElement('textarea');
    textarea.value = code;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    showAlert('คัดลอกรหัสห้องเรียบร้อย!');
}

function leaveRoom() {
    gameState.gameActive = false;
    gameState.roomCode = '';
    gameState.players = [];
    if (peer) {
        peer.destroy();
        peer = null;
    }
    switchScreen('screen-lobby');
    showAlert('ออกจากห้องแล้ว');
}

function createDeck() {
    let deck = [];
    COLORS.forEach(color => {
        deck.push({ type: 'number', color: color, value: 0, id: Math.random() });
        for (let v = 1; v <= 9; v++) {
            deck.push({ type: 'number', color: color, value: v, id: Math.random() });
            deck.push({ type: 'number', color: color, value: v, id: Math.random() });
        }
        for (let i = 0; i < 2; i++) {
            deck.push({ type: 'action', action: 'skip', color: color, id: Math.random() });
            deck.push({ type: 'action', action: 'reverse', color: color, id: Math.random() });
            deck.push({ type: 'action', action: 'draw2', color: color, id: Math.random() });
        }
    });

    for (let i = 0; i < 4; i++) {
        deck.push({ type: 'wild', action: 'wild', color: 'wild', id: Math.random() });
        deck.push({ type: 'wild', action: 'wild4', color: 'wild', id: Math.random() });
        deck.push({ type: 'special', action: 'trade', color: 'wild', id: Math.random() });
        deck.push({ type: 'special', action: 'spin', color: 'wild', id: Math.random() });
    }

    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

function startGame() {
    if (!gameState.isHost || gameState.players.length < 2) return;

    gameState.deck = createDeck();
    gameState.discardPile = [];
    gameState.turnIndex = 0;
    gameState.direction = 1;
    gameState.gameActive = true;
    gameState.saidUnoPlayers = {};

    gameState.players.forEach(p => {
        p.hand = [];
        for (let i = 0; i < 7; i++) {
            p.hand.push(gameState.deck.pop());
        }
    });

    let firstCard = gameState.deck.pop();
    while (firstCard.type !== 'number') {
        gameState.deck.unshift(firstCard);
        firstCard = gameState.deck.pop();
    }

    gameState.discardPile.push(firstCard);
    gameState.activeColor = firstCard.color;
    gameState.activeValue = firstCard.value;

    broadcastRoomState(true);
    switchScreen('screen-game');
    updateGameUI();
    showAlert('เกมเริ่มต้นขึ้นแล้ว!');
    checkBotTurn();
}

function updateGameUI() {
    if (!gameState.gameActive) return;

    document.getElementById('deck-count').textContent = gameState.deck.length;

    const dirIndicator = document.getElementById('turn-direction-indicator');
    dirIndicator.textContent = gameState.direction === 1 ? '↻' : '↺';
    dirIndicator.style.transform = gameState.direction === 1 ? 'rotate(0deg)' : 'rotate(180deg)';

    const currentTurnPlayer = gameState.players[gameState.turnIndex];
    const isMyTurn = currentTurnPlayer.id === gameState.myPlayerId;
    document.getElementById('game-status-text').textContent = isMyTurn ? 'ตาของคุณเล่น!' : 'ตาของ: ' + currentTurnPlayer.name;

    const colorBadge = document.getElementById('active-color-badge');
    colorBadge.textContent = 'สีปัจจุบัน: ' + (COLOR_NAMES_TH[gameState.activeColor] || gameState.activeColor);
    colorBadge.className = 'mt-1 px-2.5 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider border ' + getColorClass(gameState.activeColor);

    const topCard = gameState.discardPile[gameState.discardPile.length - 1];
    const discardContainer = document.getElementById('discard-pile');
    discardContainer.innerHTML = getCardVisualHTML(topCard);

    const opponentsContainer = document.getElementById('opponents-container');
    opponentsContainer.innerHTML = '';
    gameState.players.forEach((p, idx) => {
        if (p.id === gameState.myPlayerId) return;

        const isCurrent = idx === gameState.turnIndex;
        const div = document.createElement('div');
        div.className = 'flex flex-col items-center p-3 rounded-xl border transition ' + (isCurrent ? 'bg-zinc-900 border-white shadow-lg' : 'bg-zinc-950/80 border-zinc-800');
        
        div.innerHTML = '<div class="text-xs font-semibold mb-1 text-zinc-300 truncate max-w-[100px]">' + p.name + '</div>' +
                        '<div class="flex items-center space-x-1 my-1">' +
                        '<div class="w-8 h-11 uno-card-back rounded flex items-center justify-center text-[9px] font-mono text-zinc-400 shadow">UNO</div>' +
                        '<span class="text-xs font-bold text-white">x' + p.hand.length + '</span></div>' +
                        '<span class="text-[10px] text-zinc-500">' + (p.isBot ? 'บอท' : 'ผู้เล่น') + '</span>';
        opponentsContainer.appendChild(div);
    });

    const myPlayer = gameState.players.find(p => p.id === gameState.myPlayerId);
    document.getElementById('my-card-count').textContent = myPlayer.hand.length;
    
    const myHandContainer = document.getElementById('my-hand-container');
    myHandContainer.innerHTML = '';
    
    myPlayer.hand.forEach((card, cardIndex) => {
        const playable = isMyTurn && isValidPlay(card, topCard, gameState.activeColor);
        const cardEl = document.createElement('div');
        cardEl.className = 'uno-card cursor-pointer shrink-0 w-24 h-36 border ' + (playable ? 'border-white hover:-translate-y-3 shadow-xl' : 'border-zinc-800 opacity-60');
        cardEl.innerHTML = getCardVisualHTML(card);
        
        if (playable) {
            cardEl.onclick = () => playCard(cardIndex);
        }
        myHandContainer.appendChild(cardEl);
    });

    const passBtn = document.getElementById('btn-pass');
    if (isMyTurn && gameState.hasDrawnThisTurn) {
        passBtn.classList.remove('hidden');
    } else {
        passBtn.classList.add('hidden');
    }
}

function getColorClass(color) {
    switch(color) {
        case 'red': return 'bg-red-950/40 text-red-400 border-red-700';
        case 'blue': return 'bg-blue-950/40 text-blue-400 border-blue-700';
        case 'green': return 'bg-green-950/40 text-green-400 border-green-700';
        case 'yellow': return 'bg-yellow-950/40 text-yellow-400 border-yellow-700';
        default: return 'bg-zinc-800 text-white border-zinc-600';
    }
}

function getCardVisualHTML(card) {
    let label = '';
    let borderCol = '';
    let bgInner = 'bg-zinc-950/80';

    if (card.color === 'red') {
        borderCol = 'border-red-500 text-red-500';
        bgInner = 'bg-red-950/20';
    } else if (card.color === 'blue') {
        borderCol = 'border-blue-500 text-blue-400';
        bgInner = 'bg-blue-950/20';
    } else if (card.color === 'green') {
        borderCol = 'border-green-500 text-green-400';
        bgInner = 'bg-green-950/20';
    } else if (card.color === 'yellow') {
        borderCol = 'border-yellow-500 text-yellow-400';
        bgInner = 'bg-yellow-950/20';
    } else {
        borderCol = 'border-white text-white';
        bgInner = 'bg-zinc-900';
    }

    if (card.type === 'number') {
        label = card.value;
    } else if (card.type === 'action') {
        if (card.action === 'skip') label = '🚫';
        else if (card.action === 'reverse') label = '🔄';
        else if (card.action === 'draw2') label = '+2';
    } else if (card.type === 'wild') {
        label = card.action === 'wild' ? '🌈' : '🔥+4';
    } else if (card.type === 'special') {
        if (card.action === 'trade') label = '🔄แลก';
        if (card.action === 'spin') label = '🔀หมุด';
    }

    return '<div class="w-full h-full p-2.5 flex flex-col justify-between border-2 ' + borderCol + ' ' + bgInner + ' rounded-xl relative select-none">' +
           '<div class="flex flex-col leading-none font-mono font-bold text-xs"><span>' + label + '</span></div>' +
           '<div class="absolute inset-0 m-auto w-14 h-20 rounded-full border border-current opacity-20 pointer-events-none flex items-center justify-center"></div>' +
           '<div class="flex items-center justify-center my-auto z-10"><span class="text-2xl font-black tracking-tighter drop-shadow">' + label + '</span></div>' +
           '<div class="flex flex-col leading-none font-mono font-bold text-xs text-right rotate-180"><span>' + label + '</span></div>' +
           '</div>';
}

function isValidPlay(card, topCard, activeColor) {
    if (card.color === 'wild' || card.type === 'wild' || card.type === 'special') return true;
    if (card.color === activeColor) return true;
    if (card.type === 'number' && topCard.type === 'number' && card.value === topCard.value) return true;
    if (card.type === 'action' && topCard.type === 'action' && card.action === topCard.action) return true;
    return false;
}

function drawCard() {
    const currentTurnPlayer = gameState.players[gameState.turnIndex];
    if (currentTurnPlayer.id !== gameState.myPlayerId) return;

    if (gameState.hasDrawnThisTurn) {
        showAlert('คุณได้จั่วการ์ดไปแล้วในตานี้');
        return;
    }

    if (gameState.deck.length === 0) {
        const top = gameState.discardPile.pop();
        gameState.deck = gameState.discardPile;
        gameState.discardPile = [top];
        for (let i = gameState.deck.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [gameState.deck[i], gameState.deck[j]] = [gameState.deck[j], gameState.deck[i]];
        }
    }

    const drawn = gameState.deck.pop();
    currentTurnPlayer.hand.push(drawn);
    gameState.hasDrawnThisTurn = true;
    updateGameUI();
    showAlert('คุณจั่วได้การ์ด 1 ใบ');
}

function passTurn() {
    const currentTurnPlayer = gameState.players[gameState.turnIndex];
    if (currentTurnPlayer.id !== gameState.myPlayerId) return;
    endTurn();
}

function playCard(cardIndex) {
    const player = gameState.players[gameState.turnIndex];
    const card = player.hand[cardIndex];
    const topCard = gameState.discardPile[gameState.discardPile.length - 1];

    if (!isValidPlay(card, topCard, gameState.activeColor)) {
        showAlert('ไม่สามารถเล่นการ์ดใบนี้ได้');
        return;
    }

    player.hand.splice(cardIndex, 1);
    gameState.discardPile.push(card);
    gameState.hasDrawnThisTurn = false;

    if (player.hand.length === 0) {
        triggerGameOver(player);
        return;
    }

    handleCardEffect(card, player);
}

function handleCardEffect(card, player) {
    let nextStep = gameState.direction;

    if (card.type === 'number') {
        gameState.activeColor = card.color;
        gameState.activeValue = card.value;
        endTurn();
    } else if (card.type === 'action') {
        gameState.activeColor = card.color;
        if (card.action === 'skip') {
            showAlert(player.name + ' ใช้การ์ดข้ามตา!');
            nextStep *= 2;
            advanceTurnCustom(nextStep);
        } else if (card.action === 'reverse') {
            gameState.direction *= -1;
            showAlert(player.name + ' ใช้การ์ดสลับทิศทาง!');
            endTurn();
        } else if (card.action === 'draw2') {
            showAlert(player.name + ' ใช้การ์ด +2!');
            const targetIdx = getNextPlayerIndex(gameState.direction);
            giveCardsToPlayer(targetIdx, 2);
            nextStep *= 2;
            advanceTurnCustom(nextStep);
        }
    } else if (card.type === 'wild') {
        if (card.action === 'wild') {
            if (player.id === gameState.myPlayerId) {
                gameState.pendingWildCard = card;
                document.getElementById('modal-color-picker').classList.remove('hidden');
            } else {
                const randColor = COLORS[Math.floor(Math.random() * COLORS.length)];
                gameState.activeColor = randColor;
                showAlert(player.name + ' เปลี่ยนสีเป็น ' + COLOR_NAMES_TH[randColor]);
                endTurn();
            }
        } else if (card.action === 'wild4') {
            if (player.id === gameState.myPlayerId) {
                gameState.pendingWildCard = card;
                document.getElementById('modal-color-picker').classList.remove('hidden');
            } else {
                const randColor = COLORS[Math.floor(Math.random() * COLORS.length)];
                gameState.activeColor = randColor;
                const targetIdx = getNextPlayerIndex(gameState.direction);
                giveCardsToPlayer(targetIdx, 4);
                showAlert(player.name + ' ใช้การ์ด +4');
                advanceTurnCustom(gameState.direction * 2);
            }
        }
    } else if (card.type === 'special') {
        gameState.activeColor = COLORS[Math.floor(Math.random() * COLORS.length)];
        if (card.action === 'trade') {
            if (player.id === gameState.myPlayerId) {
                openTradeModal();
            } else {
                executeBotTrade(player);
            }
        } else if (card.action === 'spin') {
            gameState.direction *= -1;
            showAlert(player.name + ' ใช้การ์ดหมุดทิศทาง สลับทิศเกมฉับพลัน!');
            endTurn();
        }
    }
}

function selectWildColor(color) {
    gameState.activeColor = color;
    closeModals();
    showAlert('เปลี่ยนสีเป็น ' + COLOR_NAMES_TH[color] + ' เรียบร้อย');
    
    if (gameState.pendingWildCard && gameState.pendingWildCard.action === 'wild4') {
        const targetIdx = getNextPlayerIndex(gameState.direction);
        giveCardsToPlayer(targetIdx, 4);
        advanceTurnCustom(gameState.direction * 2);
    } else {
        endTurn();
    }
    gameState.pendingWildCard = null;
}

function openTradeModal() {
    const container = document.getElementById('trade-players-list');
    container.innerHTML = '';
    
    gameState.players.forEach((p, idx) => {
        if (p.id === gameState.myPlayerId) return;
        const btn = document.createElement('button');
        btn.className = "w-full p-3 bg-zinc-950 border border-zinc-800 hover:border-white rounded-xl flex items-center justify-between text-left transition";
        btn.innerHTML = '<div><span class="text-sm font-bold text-white">' + p.name + '</span>' +
                      '<span class="block text-xs text-zinc-400">มีการ์ด ' + p.hand.length + ' ใบ</span></div>' +
                      '<span class="text-xs px-3 py-1.5 bg-white text-black font-semibold rounded-lg">เลือกแลก</span>';
        btn.onclick = () => performTrade(p.id);
        container.appendChild(btn);
    });

    document.getElementById('modal-card-trade').classList.remove('hidden');
}

function performTrade(targetPlayerId) {
    closeModals();
    const me = gameState.players.find(p => p.id === gameState.myPlayerId);
    const target = gameState.players.find(p => p.id === targetPlayerId);

    const tempHand = [...me.hand];
    me.hand = [...target.hand];
    target.hand = tempHand;

    showAlert('แลกการ์ดกับผู้เล่น ' + target.name + ' สำเร็จ!');
    endTurn();
}

function executeBotTrade(botPlayer) {
    const opponents = gameState.players.filter(p => p.id !== botPlayer.id);
    const target = opponents[Math.floor(Math.random() * opponents.length)];
    
    const temp = [...botPlayer.hand];
    botPlayer.hand = [...target.hand];
    target.hand = temp;

    showAlert(botPlayer.name + ' ใช้การ์ดแลกการ์ดกับ ' + target.name + '!');
    endTurn();
}

function giveCardsToPlayer(playerIndex, count) {
    const targetPlayer = gameState.players[playerIndex];
    for (let i = 0; i < count; i++) {
        if (gameState.deck.length === 0) {
            const top = gameState.discardPile.pop();
            gameState.deck = gameState.discardPile;
            gameState.discardPile = [top];
        }
        targetPlayer.hand.push(gameState.deck.pop());
    }
}

function getNextPlayerIndex(step) {
    let next = (gameState.turnIndex + step) % gameState.players.length;
    if (next < 0) next += gameState.players.length;
    return next;
}

function advanceTurnCustom(step) {
    gameState.turnIndex = getNextPlayerIndex(step);
    updateGameUI();
    checkBotTurn();
}

function endTurn() {
    gameState.turnIndex = getNextPlayerIndex(gameState.direction);
    updateGameUI();
    checkBotTurn();
}

function sayUno() {
    const me = gameState.players.find(p => p.id === gameState.myPlayerId);
    if (me.hand.length <= 2) {
        gameState.saidUnoPlayers[me.id] = true;
        showAlert('คุณประกาศ "อูโน่!" เรียบร้อยแล้ว');
    } else {
        showAlert('คุณยังมีการ์ดเยอะเกินกว่าจะประกาศอูโน่');
    }
}

function checkBotTurn() {
    if (!gameState.gameActive) return;
    const currentTurnPlayer = gameState.players[gameState.turnIndex];

    if (currentTurnPlayer.isBot) {
        setTimeout(() => {
            if (!gameState.gameActive) return;
            executeBotPlay(currentTurnPlayer);
        }, 1000 + Math.random() * 800);
    }
}

function executeBotPlay(bot) {
    const topCard = gameState.discardPile[gameState.discardPile.length - 1];
    const playableIndex = bot.hand.findIndex(card => isValidPlay(card, topCard, gameState.activeColor));

    if (playableIndex !== -1) {
        const card = bot.hand.splice(playableIndex, 1)[0];
        gameState.discardPile.push(card);

        if (bot.hand.length === 0) {
            triggerGameOver(bot);
            return;
        }

        if (card.color === 'wild' || card.type === 'wild' || card.type === 'special') {
            const randColor = COLORS[Math.floor(Math.random() * COLORS.length)];
            gameState.activeColor = randColor;
            showAlert('บอท ' + bot.name + ' เปลี่ยนสีเป็น ' + COLOR_NAMES_TH[randColor]);
            
            if (card.action === 'trade') {
                executeBotTrade(bot);
                return;
            } else if (card.action === 'spin') {
                gameState.direction *= -1;
                endTurn();
                return;
            } else if (card.action === 'wild4') {
                const targetIdx = getNextPlayerIndex(gameState.direction);
                giveCardsToPlayer(targetIdx, 4);
                advanceTurnCustom(gameState.direction * 2);
                return;
            }
        }

        if (card.type === 'action') {
            gameState.activeColor = card.color;
            if (card.action === 'skip') {
                advanceTurnCustom(gameState.direction * 2);
                return;
            } else if (card.action === 'reverse') {
                gameState.direction *= -1;
                endTurn();
                return;
            } else if (card.action === 'draw2') {
                const targetIdx = getNextPlayerIndex(gameState.direction);
                giveCardsToPlayer(targetIdx, 2);
                advanceTurnCustom(gameState.direction * 2);
                return;
            }
        }

        gameState.activeColor = card.color;
        gameState.activeValue = card.value;
        endTurn();
    } else {
        if (gameState.deck.length === 0) {
            const top = gameState.discardPile.pop();
            gameState.deck = gameState.discardPile;
            gameState.discardPile = [top];
        }
        const drawn = gameState.deck.pop();
        bot.hand.push(drawn);
        showAlert('บอท ' + bot.name + ' จั่วการ์ด 1 ใบ');

        if (isValidPlay(drawn, topCard, gameState.activeColor)) {
            bot.hand.pop();
            gameState.discardPile.push(drawn);
            gameState.activeColor = drawn.color;
            if (bot.hand.length === 0) {
                triggerGameOver(bot);
                return;
            }
        }
        endTurn();
    }
}

function triggerGameOver(winner) {
    gameState.gameActive = false;
    document.getElementById('winner-title').textContent = 'ผู้ชนะคือ ' + winner.name + '! 🎉';
    document.getElementById('winner-subtitle').textContent = winner.isBot ? 'บอท AI คว้าชัยชนะไปได้ในรอบนี้' : 'ยอดเยี่ยมมาก คุณคือแชมป์ UNO ขาวดำ!';
    document.getElementById('modal-game-over').classList.remove('hidden');
}

function returnToRoom() {
    closeModals();
    switchScreen('screen-room');
    updateRoomUI();
}
