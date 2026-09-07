import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, getDoc, updateDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

let app, db, auth, currentUser;
const appId = typeof __app_id !== 'undefined' ? __app_id : 'monochrome-uno-default-app';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;

let gameState = {
    roomCode: null,
    isHost: false,
    playerName: '',
    playerId: '',
    players: [],
    hands: {},
    discardPile: [],
    drawPile: [],
    currentTurnIndex: 0,
    direction: 1, 
    currentColor: 'RED',
    winner: null,
    status: 'WAITING'
};
let unsubscribeRoom = null;
let pendingCardToPlay = null;

window.onload = async function() {
    if (firebaseConfig) {
        try {
            app = initializeApp(firebaseConfig);
            db = getFirestore(app);
            auth = getAuth(app);
            if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                await signInWithCustomToken(auth, __initial_auth_token);
            } else {
                await signInAnonymously(auth);
            }
            currentUser = auth.currentUser;
        } catch (e) {
            console.error("Firebase init error:", e);
        }
    }
    gameState.playerId = currentUser ? currentUser.uid : 'user_' + Math.random().toString(36).substring(2, 9);
};

window.showCreateRoomModal = function() {
    const name = document.getElementById('input-username').value.trim();
    if (!name) {
        showModal("กรุณากรอกชื่อผู้เล่นก่อน", "แจ้งเตือน");
        return;
    }
    gameState.playerName = name;
    document.getElementById('view-lobby').classList.add('hidden');
    document.getElementById('box-create-room').classList.remove('hidden');
};

window.showJoinRoomModal = function() {
    const name = document.getElementById('input-username').value.trim();
    if (!name) {
        showModal("กรุณากรอกชื่อผู้เล่นก่อน", "แจ้งเตือน");
        return;
    }
    gameState.playerName = name;
    document.getElementById('view-lobby').classList.add('hidden');
    document.getElementById('box-join-room').classList.remove('hidden');
};

window.backToLobbyMain = function() {
    document.getElementById('box-create-room').classList.add('hidden');
    document.getElementById('box-join-room').classList.add('hidden');
    document.getElementById('view-lobby').classList.remove('hidden');
};

window.returnToLobby = function() {
    if (unsubscribeRoom) {
        unsubscribeRoom();
        unsubscribeRoom = null;
    }
    gameState.roomCode = null;
    gameState.isHost = false;
    gameState.players = [];
    gameState.hands = {};
    
    document.getElementById('view-room').classList.add('hidden');
    document.getElementById('view-game').classList.add('hidden');
    document.getElementById('box-create-room').classList.add('hidden');
    document.getElementById('box-join-room').classList.add('hidden');
    document.getElementById('view-lobby').classList.remove('hidden');
    document.getElementById('header-user-info').classList.add('hidden');
};

window.showModal = function(message, title = "แจ้งเตือน") {
    document.getElementById('modal-title').innerText = title;
    document.getElementById('modal-message').innerText = message;
    document.getElementById('modal-container').classList.remove('hidden');
};

window.closeModal = function() {
    document.getElementById('modal-container').classList.add('hidden');
};

window.createRoom = async function() {
    const roomCode = document.getElementById('input-room-code').value.trim().toUpperCase();
    if (!roomCode) {
        showModal("กรุณากรอกรหัสห้อง", "แจ้งเตือน");
        return;
    }

    gameState.roomCode = roomCode;
    gameState.isHost = true;

    const initialPlayers = [{
        id: gameState.playerId,
        name: gameState.playerName,
        isBot: false,
        isHost: true,
        cardCount: 0
    }];

    const initialRoomData = {
        code: roomCode,
        status: 'WAITING',
        players: initialPlayers,
        hands: {},
        discardPile: [],
        drawPile: [],
        currentTurnIndex: 0,
        direction: 1,
        currentColor: 'RED',
        winner: null
    };

    if (db) {
        try {
            const roomsColRef = collection(db, 'artifacts', appId, 'public_rooms');
            const roomRef = doc(roomsColRef, 'uno_rooms_' + roomCode);
            const docSnap = await getDoc(roomRef);
            if (docSnap.exists()) {
                showModal("รหัสห้องนี้มีอยู่แล้ว กรุณาใช้รหัสอื่น", "ข้อผิดพลาด");
                return;
            }
            await setDoc(roomRef, initialRoomData);
            listenToRoom(roomCode);
        } catch (e) {
            console.error("Error creating room in Firestore:", e);
            startLocalRoom(initialRoomData);
        }
    } else {
        startLocalRoom(initialRoomData);
    }

    transitionToRoomView();
};

window.joinRoom = async function() {
    const roomCode = document.getElementById('input-join-code').value.trim().toUpperCase();
    if (!roomCode) {
        showModal("กรุณากรอกรหัสห้อง", "แจ้งเตือน");
        return;
    }

    gameState.roomCode = roomCode;
    gameState.isHost = false;

    if (db) {
        try {
            const roomsColRef = collection(db, 'artifacts', appId, 'public_rooms');
            const roomRef = doc(roomsColRef, 'uno_rooms_' + roomCode);
            const docSnap = await getDoc(roomRef);
            if (!docSnap.exists()) {
                showModal("ไม่พบห้องที่มีรหัสนี้", "ข้อผิดพลาด");
                return;
            }
            const data = docSnap.data();
            if (data.status !== 'WAITING') {
                showModal("ห้องนี้กำลังเล่นอยู่แล้ว ไม่สามารถเข้าร่วมได้", "ข้อผิดพลาด");
                return;
            }
            if (data.players.length >= 6) {
                showModal("ห้องเต็มแล้ว (สูงสุด 6 คน)", "ข้อผิดพลาด");
                return;
            }
            
            let players = data.players;
            if (!players.some(p => p.id === gameState.playerId)) {
                players.push({
                    id: gameState.playerId,
                    name: gameState.playerName,
                    isBot: false,
                    isHost: false,
                    cardCount: 0
                });
                await updateDoc(roomRef, { players });
            }
            listenToRoom(roomCode);
            transitionToRoomView();
        } catch (e) {
            console.error("Error joining room:", e);
            showModal("ไม่สามารถเข้าร่วมห้องได้", "ข้อผิดพลาด");
        }
    } else {
        showModal("โหมดออฟไลน์ไม่รองรับการเชื่อมต่อข้ามเครื่อง", "แจ้งเตือน");
    }
};

function startLocalRoom(initialData) {
    gameState.players = initialData.players;
    gameState.status = 'WAITING';
    updateRoomUI();
}

function listenToRoom(roomCode) {
    if (!db) return;
    const roomsColRef = collection(db, 'artifacts', appId, 'public_rooms');
    const roomRef = doc(roomsColRef, 'uno_rooms_' + roomCode);
    unsubscribeRoom = onSnapshot(roomRef, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            gameState.players = data.players;
            gameState.hands = data.hands || {};
            gameState.discardPile = data.discardPile || [];
            gameState.drawPile = data.drawPile || [];
            gameState.currentTurnIndex = data.currentTurnIndex || 0;
            gameState.direction = data.direction || 1;
            gameState.currentColor = data.currentColor || 'RED';
            gameState.winner = data.winner || null;
            gameState.status = data.status;

            if (gameState.status === 'WAITING') {
                transitionToRoomView();
            } else if (gameState.status === 'PLAYING') {
                transitionToGameView();
            }
        }
    }, (error) => {
        console.error("Room snapshot error:", error);
    });
}

function transitionToRoomView() {
    document.getElementById('view-lobby').classList.add('hidden');
    document.getElementById('box-create-room').classList.add('hidden');
    document.getElementById('box-join-room').classList.add('hidden');
    document.getElementById('view-game').classList.add('hidden');
    document.getElementById('view-room').classList.remove('hidden');
    document.getElementById('header-user-info').classList.remove('hidden');
    document.getElementById('header-player-name').innerText = gameState.playerName;
    document.getElementById('room-display-code').innerText = gameState.roomCode;

    const isHost = gameState.isHost || (gameState.players[0] && gameState.players[0].id === gameState.playerId);
    gameState.isHost = isHost;

    if (isHost) {
        document.getElementById('host-bot-controls').classList.remove('hidden');
        document.getElementById('host-start-container').classList.remove('hidden');
        document.getElementById('guest-wait-container').classList.add('hidden');
    } else {
        document.getElementById('host-bot-controls').classList.add('hidden');
        document.getElementById('host-start-container').classList.add('hidden');
        document.getElementById('guest-wait-container').classList.remove('hidden');
    }

    updateRoomUI();
}

function updateRoomUI() {
    document.getElementById('player-count').innerText = gameState.players.length;
    const listEl = document.getElementById('room-players-list');
    listEl.innerHTML = '';
    gameState.players.forEach((p, idx) => {
        const div = document.createElement('div');
        div.className = "flex items-center justify-between p-3 bg-mono-950 border border-mono-800 rounded-xl";
        div.innerHTML = `
            <div class="flex items-center space-x-3">
                <div class="w-8 h-8 rounded-lg bg-mono-800 flex items-center justify-center font-bold text-white text-xs">${idx + 1}</div>
                <div>
                    <p class="font-semibold text-white text-sm">${p.name} ${p.isBot ? '<span class="text-xs bg-mono-700 px-1.5 py-0.5 rounded text-mono-300">บอท</span>' : ''}</p>
                    <p class="text-xs text-mono-500">${p.isHost ? 'หัวหน้าห้อง' : 'ผู้เล่น'}</p>
                </div>
            </div>
            ${gameState.isHost && !p.isHost ? `<button onclick="kickPlayer('${p.id}')" class="text-xs text-red-400 hover:text-red-300">เตะออก</button>` : ''}
        `;
        listEl.appendChild(div);
    });
}

window.addBot = async function() {
    if (gameState.players.length >= 6) {
        showModal("ห้องเต็มแล้ว (สูงสุด 6 คน)", "แจ้งเตือน");
        return;
    }
    const botNum = gameState.players.filter(p => p.isBot).length + 1;
    const botPlayer = {
        id: 'bot_' + Math.random().toString(36).substring(2, 7),
        name: `บอท AI ${botNum}`,
        isBot: true,
        isHost: false,
        cardCount: 0
    };
    gameState.players.push(botPlayer);
    if (db && gameState.roomCode) {
        const roomsColRef = collection(db, 'artifacts', appId, 'public_rooms');
        const roomRef = doc(roomsColRef, 'uno_rooms_' + gameState.roomCode);
        await updateDoc(roomRef, { players: gameState.players });
    }
    updateRoomUI();
};

window.kickPlayer = async function(id) {
    gameState.players = gameState.players.filter(p => p.id !== id);
    if (db && gameState.roomCode) {
        const roomsColRef = collection(db, 'artifacts', appId, 'public_rooms');
        const roomRef = doc(roomsColRef, 'uno_rooms_' + gameState.roomCode);
        await updateDoc(roomRef, { players: gameState.players });
    }
    updateRoomUI();
};

const COLORS = ['RED', 'BLUE', 'GREEN', 'YELLOW'];
const VALUES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'SKIP', 'REVERSE', 'DRAW2'];

function generateDeck() {
    let deck = [];
    COLORS.forEach(color => {
        VALUES.forEach(val => {
            deck.push({ id: Math.random().toString(36).substring(2,9), color, value: val });
            if (val !== '0') {
                deck.push({ id: Math.random().toString(36).substring(2,9), color, value: val });
            }
        });
    });
    for (let i = 0; i < 4; i++) {
        deck.push({ id: Math.random().toString(36).substring(2,9), color: 'WILD', value: 'WILD' });
        deck.push({ id: Math.random().toString(36).substring(2,9), color: 'WILD', value: 'WILD_DRAW4' });
        deck.push({ id: Math.random().toString(36).substring(2,9), color: 'WILD', value: 'SWAP' });
        deck.push({ id: Math.random().toString(36).substring(2,9), color: 'WILD', value: 'COMPASS' });
    }
    return deck.sort(() => Math.random() - 0.5);
}

window.startGame = async function() {
    if (gameState.players.length < 2) {
        showModal("ต้องการผู้เล่นอย่างน้อย 2 คนเพื่อเริ่มเกม", "แจ้งเตือน");
        return;
    }

    let deck = generateDeck();
    let hands = {};
    gameState.players.forEach(p => {
        hands[p.id] = [];
        for (let i = 0; i < 7; i++) {
            hands[p.id].push(deck.pop());
        }
    });

    let topCard = deck.pop();
    while (topCard.color === 'WILD') {
        deck.unshift(topCard);
        topCard = deck.pop();
    }

    gameState.drawPile = deck;
    gameState.discardPile = [topCard];
    gameState.hands = hands;
    gameState.currentTurnIndex = 0;
    gameState.direction = 1;
    gameState.currentColor = topCard.color;
    gameState.status = 'PLAYING';
    gameState.winner = null;

    if (db && gameState.roomCode) {
        const roomsColRef = collection(db, 'artifacts', appId, 'public_rooms');
        const roomRef = doc(roomsColRef, 'uno_rooms_' + gameState.roomCode);
        await updateDoc(roomRef, {
            status: 'PLAYING',
            hands: gameState.hands,
            drawPile: gameState.drawPile,
            discardPile: gameState.discardPile,
            currentTurnIndex: gameState.currentTurnIndex,
            direction: gameState.direction,
            currentColor: gameState.currentColor,
            winner: null,
            players: gameState.players
        });
    }

    transitionToGameView();
};

function transitionToGameView() {
    document.getElementById('view-room').classList.add('hidden');
    document.getElementById('view-game').classList.remove('hidden');
    renderGame();
}

function renderGame() {
    const oppContainer = document.getElementById('opponents-container');
    oppContainer.innerHTML = '';
    
    gameState.players.forEach((p, idx) => {
        if (p.id === gameState.playerId) return;
        const handCount = gameState.hands[p.id] ? gameState.hands[p.id].length : 0;
        const isCurrentTurn = gameState.currentTurnIndex === idx;

        const div = document.createElement('div');
        div.className = `p-3 rounded-2xl border ${isCurrentTurn ? 'border-white bg-mono-800' : 'border-mono-800 bg-mono-900'} flex items-center justify-between shadow transition`;
        div.innerHTML = `
            <div class="flex items-center space-x-2 truncate">
                <div class="w-7 h-7 rounded-lg bg-mono-800 flex items-center justify-center text-xs font-bold">${p.name.charAt(0)}</div>
                <div class="truncate">
                    <p class="text-xs font-bold text-white truncate">${p.name} ${p.isBot ? '(Bot)' : ''}</p>
                    <p class="text-[10px] text-mono-400">การ์ด: <span class="font-bold text-white">${handCount}</span> ใบ</p>
                </div>
            </div>
            <div class="uno-card-back w-8 h-12 rounded border border-mono-600 shadow-inner flex items-center justify-center">
                <span class="text-[10px] font-black text-mono-400">${handCount}</span>
            </div>
        `;
        oppContainer.appendChild(div);
    });

    const topCardEl = document.getElementById('discard-pile');
    const topCard = gameState.discardPile[gameState.discardPile.length - 1];
    if (topCard) {
        topCardEl.innerHTML = `
            <div class="text-xs font-semibold text-mono-600 uppercase tracking-widest">${topCard.color}</div>
            <div class="text-xl font-black my-1">${getCardDisplayLabel(topCard.value)}</div>
            <div class="text-[10px] text-mono-500">${topCard.color}</div>
        `;
    }

    const isMyTurn = gameState.players[gameState.currentTurnIndex] && gameState.players[gameState.currentTurnIndex].id === gameState.playerId;
    const currentTurnPlayer = gameState.players[gameState.currentTurnIndex];
    
    document.getElementById('turn-status-text').innerText = isMyTurn ? "ตาของคุณเล่น!" : `ตาของ: ${currentTurnPlayer ? currentTurnPlayer.name : '-'}`;
    document.getElementById('game-info-sub').innerText = `สีปัจจุบัน: ${gameState.currentColor}`;
    document.getElementById('turn-direction-indicator').className = `w-3 h-3 rounded-full ${gameState.direction === 1 ? 'bg-white' : 'bg-mono-400'} animate-pulse`;

    const myHand = gameState.hands[gameState.playerId] || [];
    document.getElementById('my-card-count').innerText = myHand.length;
    const handContainer = document.getElementById('my-hand-container');
    handContainer.innerHTML = '';

    myHand.forEach(card => {
        const cardEl = document.createElement('div');
        cardEl.className = "uno-card flex-shrink-0 w-24 h-36 bg-white text-black rounded-2xl border-2 border-mono-300 shadow-xl flex flex-col justify-between p-3 cursor-pointer hover:-translate-y-3 transition";
        cardEl.innerHTML = `
            <div class="text-[10px] font-bold uppercase">${card.color}</div>
            <div class="text-center font-black text-lg">${getCardDisplayLabel(card.value)}</div>
            <div class="text-[10px] font-bold uppercase text-right">${card.color}</div>
        `;
        cardEl.onclick = () => playCard(card);
        handContainer.appendChild(cardEl);
    });

    if (gameState.winner) {
        showModal(`ผู้ชนะเกมนี้คือ ${gameState.winner} 🎉`, "จบเกม!");
    }

    if (gameState.isHost && currentTurnPlayer && currentTurnPlayer.isBot && !gameState.winner) {
        setTimeout(runBotTurn, 1200);
    }
}

function getCardDisplayLabel(val) {
    switch(val) {
        case 'SKIP': return 'ข้าม';
        case 'REVERSE': return 'กลับด้าน';
        case 'DRAW2': return '+2';
        case 'WILD': return 'WILD';
        case 'WILD_DRAW4': return '+4';
        case 'SWAP': return 'แลกการ์ด';
        case 'COMPASS': return 'หมุดสลับ';
        default: return val;
    }
}

window.drawCard = async function() {
    const currentTurnPlayer = gameState.players[gameState.currentTurnIndex];
    if (!currentTurnPlayer || currentTurnPlayer.id !== gameState.playerId) {
        showModal("ยังไม่ใช่ตาของคุณ", "แจ้งเตือน");
        return;
    }

    if (gameState.drawPile.length === 0) {
        let top = gameState.discardPile.pop();
        gameState.drawPile = gameState.discardPile.sort(() => Math.random() - 0.5);
        gameState.discardPile = [top];
    }

    if (gameState.drawPile.length > 0) {
        let drawn = gameState.drawPile.pop();
        if (!gameState.hands[gameState.playerId]) gameState.hands[gameState.playerId] = [];
        gameState.hands[gameState.playerId].push(drawn);
        
        advanceTurn();
        await syncGameState();
    }
};

window.playCard = async function(card) {
    const currentTurnPlayer = gameState.players[gameState.currentTurnIndex];
    if (!currentTurnPlayer || currentTurnPlayer.id !== gameState.playerId) {
        showModal("ยังไม่ใช่ตาของคุณ", "แจ้งเตือน");
        return;
    }

    const topCard = gameState.discardPile[gameState.discardPile.length - 1];

    let isValid = false;
    if (card.color === 'WILD') {
        isValid = true;
    } else if (card.color === gameState.currentColor || card.value === topCard.value) {
        isValid = true;
    }

    if (!isValid) {
        showModal("คุณไม่สามารถเล่นการ์ดใบนี้ได้", "ผิดกติกา");
        return;
    }

    if (card.value === 'WILD' || card.value === 'WILD_DRAW4') {
        pendingCardToPlay = card;
        document.getElementById('color-picker-modal').classList.remove('hidden');
        return;
    }

    if (card.value === 'SWAP') {
        pendingCardToPlay = card;
        openSwapModalForPlayer();
        return;
    }

    executeCardPlay(card, gameState.currentColor);
};

window.selectWildColor = function(color) {
    document.getElementById('color-picker-modal').classList.add('hidden');
    if (pendingCardToPlay) {
        let card = pendingCardToPlay;
        pendingCardToPlay = null;
        executeCardPlay(card, color);
    }
};

function openSwapModalForPlayer() {
    const listEl = document.getElementById('swap-targets-list');
    listEl.innerHTML = '';
    gameState.players.forEach(p => {
        if (p.id !== gameState.playerId) {
            const btn = document.createElement('button');
            btn.className = "w-full py-3 bg-mono-800 hover:bg-mono-700 text-white font-semibold rounded-xl text-sm border border-mono-700 transition flex justify-between px-4 items-center";
            btn.innerHTML = `<span>${p.name}</span> <span class="text-xs text-mono-400">การ์ด ${gameState.hands[p.id] ? gameState.hands[p.id].length : 0} ใบ</span>`;
            btn.onclick = () => executeSwapCard(p.id);
            listEl.appendChild(btn);
        }
    });
    document.getElementById('swap-target-modal').classList.remove('hidden');
}

window.closeSwapModal = function() {
    document.getElementById('swap-target-modal').classList.add('hidden');
    pendingCardToPlay = null;
};

async function executeSwapCard(targetPlayerId) {
    document.getElementById('swap-target-modal').classList.add('hidden');
    let card = pendingCardToPlay;
    pendingCardToPlay = null;

    let myHand = gameState.hands[gameState.playerId] || [];
    myHand = myHand.filter(c => c.id !== card.id);
    gameState.hands[gameState.playerId] = myHand;

    let targetHand = gameState.hands[targetPlayerId] || [];
    let myCurrentHand = [...gameState.hands[gameState.playerId]];
    
    gameState.hands[gameState.playerId] = targetHand;
    gameState.hands[targetPlayerId] = myCurrentHand;

    gameState.discardPile.push(card);
    gameState.currentColor = card.color !== 'WILD' ? card.color : gameState.currentColor;

    checkWinOrAdvance(card);
}

async function executeCardPlay(card, chosenColor) {
    let myHand = gameState.hands[gameState.playerId] || [];
    myHand = myHand.filter(c => c.id !== card.id);
    gameState.hands[gameState.playerId] = myHand;

    gameState.discardPile.push(card);
    gameState.currentColor = chosenColor;

    if (card.value === 'SKIP') {
        advanceTurn();
    } else if (card.value === 'REVERSE' || card.value === 'COMPASS') {
        gameState.direction *= -1;
    } else if (card.value === 'DRAW2') {
        advanceTurn();
        let nextPlayer = gameState.players[gameState.currentTurnIndex];
        for(let i=0; i<2; i++) {
            if(gameState.drawPile.length > 0) gameState.hands[nextPlayer.id].push(gameState.drawPile.pop());
        }
    } else if (card.value === 'WILD_DRAW4') {
        advanceTurn();
        let nextPlayer = gameState.players[gameState.currentTurnIndex];
        for(let i=0; i<4; i++) {
            if(gameState.drawPile.length > 0) gameState.hands[nextPlayer.id].push(gameState.drawPile.pop());
        }
    }

    checkWinOrAdvance(card);
}

async function checkWinOrAdvance(card) {
    if (gameState.hands[gameState.playerId].length === 0) {
        gameState.winner = gameState.playerName;
    } else {
        advanceTurn();
    }
    await syncGameState();
}

function advanceTurn() {
    let numPlayers = gameState.players.length;
    gameState.currentTurnIndex = (gameState.currentTurnIndex + gameState.direction + numPlayers) % numPlayers;
}

window.shoutUno = function() {
    showModal(`${gameState.playerName} ตะโกน UNO! เสียงดังฟังชัด!`, "UNO!");
};

async function runBotTurn() {
    if (gameState.winner) return;
    let bot = gameState.players[gameState.currentTurnIndex];
    if (!bot || !bot.isBot) return;

    let hand = gameState.hands[bot.id] || [];
    let topCard = gameState.discardPile[gameState.discardPile.length - 1];

    let playableCard = hand.find(c => c.color === 'WILD' || c.color === gameState.currentColor || c.value === topCard.value);

    if (playableCard) {
        gameState.hands[bot.id] = hand.filter(c => c.id !== playableCard.id);
        gameState.discardPile.push(playableCard);
        
        /*************************************************
         * Generated files:
         * - index.html [file-tag: code-generated-file-68c1af80-fea0-405d-aca9-9fc079a183e4]
         * - style.css [file-tag: code-generated-file-147f77a6-5374-4728-b2ac-1427d1877656]
         * - script.js [file-tag: code-generated-file-bb7873be-d57a-4ca9-bfc1-6dc34a88d847]
         *************************************************/
        if (playableCard.color === 'WILD') {
            gameState.currentColor = COLORS[Math.floor(Math.random() * COLORS.length)];
        } else {
            gameState.currentColor = playableCard.color;
        }

        if (playableCard.value === 'SKIP' || playableCard.value === 'DRAW2' || playableCard.value === 'WILD_DRAW4') {
            advanceTurn();
        } else if (playableCard.value === 'REVERSE' || playableCard.value === 'COMPASS') {
            gameState.direction *= -1;
        }

        if (gameState.hands[bot.id].length === 0) {
            gameState.winner = bot.name;
        } else {
            advanceTurn();
        }
    } else {
        if (gameState.drawPile.length > 0) {
            let drawn = gameState.drawPile.pop();
            gameState.hands[bot.id].push(drawn);
        }
        advanceTurn();
    }

    await syncGameState();
}

async function syncGameState() {
    if (db && gameState.roomCode) {
        const roomsColRef = collection(db, 'artifacts', appId, 'public_rooms');
        const roomRef = doc(roomsColRef, 'uno_rooms_' + gameState.roomCode);
        await updateDoc(roomRef, {
            hands: gameState.hands,
            drawPile: gameState.drawPile,
            discardPile: gameState.discardPile,
            currentTurnIndex: gameState.currentTurnIndex,
            direction: gameState.direction,
            currentColor: gameState.currentColor,
            winner: gameState.winner
        });
    }
    renderGame();
}
