import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, updateDoc, onSnapshot, deleteField } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// ⚠️ นำค่าจาก Firebase ของคุณมาใส่ตรงนี้
const firebaseConfig = {
    apiKey: "YOUR_API_KEY", // เปลี่ยนเป็น API Key ของคุณ
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
};

const appId = 'uno-thai-web-game';
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// แจ้งเตือนหากยังไม่ได้ใส่ Firebase Config
if (firebaseConfig.apiKey === "YOUR_API_KEY") {
    setTimeout(() => {
        alert("⚠️ เพื่อให้ระบบเล่นกับเพื่อนทำงานได้ คุณต้องไปสร้างโปรเจกต์ฟรีที่ firebase.google.com แล้วนำค่า Config มาใส่ในไฟล์ script.js บรรทัดที่ 6-12 ก่อนครับ");
    }, 1000);
}

let currentUser = null;
let currentRoomId = null;
let roomData = null;
let unsubscribeRoom = null;
let myName = localStorage.getItem('uno_name') || '';
let pendingWildCard = null;

const screens = {
    lobby: document.getElementById('screen-lobby'),
    waiting: document.getElementById('screen-waiting'),
    game: document.getElementById('screen-game')
};
const inputName = document.getElementById('player-name');
const inputCode = document.getElementById('join-room-code');

const COLORS = ['red', 'blue', 'green', 'yellow'];
const VALUES = ['0','1','2','3','4','5','6','7','8','9','skip','reverse','draw2'];
const WILD_VALUES = ['wild', 'draw4', 'swap', 'rotate'];
const THAI_COLORS = { red: 'แดง', blue: 'ฟ้า', green: 'เขียว', yellow: 'เหลือง', wild: 'ดำ' };
const THAI_VALUES = { skip: 'ข้าม', reverse: 'ย้อนกลับ', draw2: '+2', draw4: '+4', wild: 'เปลี่ยนสี', swap: 'แลกไพ่', rotate: 'หมุนไพ่' };

async function initAuth() {
    try {
        await signInAnonymously(auth);
    } catch (error) {
        console.error("Auth error:", error);
        showToast("เกิดข้อผิดพลาดในการยืนยันตัวตน (โปรดตรวจสอบ Firebase)", "error");
    }
}

onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        inputName.value = myName;
        checkExistingSession();
    }
});

function checkExistingSession() {
    const savedRoom = sessionStorage.getItem('uno_room_id');
    if (savedRoom) {
        joinRoom(savedRoom, true);
    }
}

window.showModal = function(title, msg, onOk = null) {
    document.getElementById('modal-title').innerText = title;
    document.getElementById('modal-msg').innerText = msg;
    const modal = document.getElementById('custom-modal');
    const btn = document.getElementById('modal-btn-ok');
    
    modal.classList.remove('hidden');
    
    btn.onclick = () => {
        modal.classList.add('hidden');
        if (onOk) onOk();
    };
};

window.showToast = function(msg, type='info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast border-l-4 ${type === 'error' ? 'border-red-500' : 'border-blue-500'}`;
    toast.innerText = msg;
    container.appendChild(toast);
    setTimeout(() => {
        if(toast.parentElement) toast.remove();
    }, 3000);
};

function switchScreen(screenName) {
    Object.values(screens).forEach(s => s.classList.add('hidden'));
    screens[screenName].classList.remove('hidden');
}

function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

function getRoomRef(roomId) {
    return doc(db, 'artifacts', appId, 'public', 'data', 'uno_rooms', roomId);
}

document.getElementById('btn-create-room').addEventListener('click', async () => {
    if (!currentUser) return showToast("รอระบบเชื่อมต่อสักครู่...", "error");
    const name = inputName.value.trim();
    if (!name) return showModal("แจ้งเตือน", "กรุณาใส่ชื่อของคุณก่อน");
    
    myName = name;
    localStorage.setItem('uno_name', myName);
    
    const roomId = generateRoomCode();
    const roomRef = getRoomRef(roomId);
    
    const initialData = {
        status: 'waiting',
        hostId: currentUser.uid,
        players: [{
            id: currentUser.uid,
            name: myName,
            isBot: false,
            cardCount: 0
        }],
        createdAt: new Date().toISOString()
    };

    try {
        await setDoc(roomRef, initialData);
        joinRoom(roomId);
    } catch (error) {
        console.error("Create room error:", error);
        showModal("ข้อผิดพลาด", "ไม่สามารถสร้างห้องได้ โปรดตรวจสอบการตั้งค่า Firestore");
    }
});

document.getElementById('btn-join-room').addEventListener('click', () => {
    const code = inputCode.value.trim().toUpperCase();
    if (code.length !== 6) return showModal("แจ้งเตือน", "รหัสห้องต้องมี 6 หลัก");
    
    const name = inputName.value.trim();
    if (!name) return showModal("แจ้งเตือน", "กรุณาใส่ชื่อของคุณก่อน");
    
    myName = name;
    localStorage.setItem('uno_name', myName);
    joinRoom(code);
});

async function joinRoom(roomId, isRejoin = false) {
    if (!currentUser) return;
    const roomRef = getRoomRef(roomId);
    
    try {
        const docSnap = await getDoc(roomRef);
        if (!docSnap.exists()) {
            if (isRejoin) sessionStorage.removeItem('uno_room_id');
            else showModal("ข้อผิดพลาด", "ไม่พบห้องนี้ หรือห้องถูกลบไปแล้ว");
            return;
        }

        const data = docSnap.data();
        const existingPlayer = data.players.find(p => p.id === currentUser.uid);
        
        if (!existingPlayer) {
            if (data.status !== 'waiting') {
                return showModal("ข้อผิดพลาด", "เกมเริ่มไปแล้ว ไม่สามารถเข้าร่วมได้");
            }
            if (data.players.length >= 6) {
                return showModal("ข้อผิดพลาด", "ห้องเต็มแล้ว (สูงสุด 6 คน)");
            }
            
            const updatedPlayers = [...data.players, {
                id: currentUser.uid,
                name: myName,
                isBot: false,
                cardCount: 0
            }];
            
            await updateDoc(roomRef, { players: updatedPlayers });
        }

        currentRoomId = roomId;
        sessionStorage.setItem('uno_room_id', roomId);
        
        if (unsubscribeRoom) unsubscribeRoom();
        unsubscribeRoom = onSnapshot(roomRef, (snapshot) => {
            if (!snapshot.exists()) {
                handleRoomClosed();
                return;
            }
            roomData = snapshot.data();
            updateUIBasedOnState();
        });
        
    } catch (error) {
        console.error("Join room error:", error);
    }
}

function handleRoomClosed() {
    showModal("ห้องถูกปิด", "หัวหน้าห้องได้ปิดห้องนี้แล้ว หรือไม่มีผู้เล่นเหลืออยู่");
    cleanupRoomSession();
}

function cleanupRoomSession() {
    if (unsubscribeRoom) unsubscribeRoom();
    currentRoomId = null;
    roomData = null;
    sessionStorage.removeItem('uno_room_id');
    switchScreen('lobby');
}

window.leaveRoom = async function() {
    if (!currentRoomId || !currentUser || !roomData) {
        cleanupRoomSession();
        return;
    }
    
    try {
        const roomRef = getRoomRef(currentRoomId);
        const updatedPlayers = roomData.players.filter(p => p.id !== currentUser.uid);
        
        if (updatedPlayers.length > 0) {
            let updateData = { players: updatedPlayers };
            if (roomData.hostId === currentUser.uid) {
                const nextHuman = updatedPlayers.find(p => !p.isBot);
                if (nextHuman) updateData.hostId = nextHuman.id;
            }
            await updateDoc(roomRef, updateData);
        }
    } catch (e) { console.error(e); }
    
    cleanupRoomSession();
};

window.copyRoomCode = function() {
    if(currentRoomId) {
        navigator.clipboard.writeText(currentRoomId).then(() => {
            showToast("คัดลอกรหัสแล้ว");
        });
    }
};

window.confirmLeaveGame = function() {
    showModal("ยืนยัน", "คุณต้องการออกจากเกมที่กำลังเล่นอยู่ใช่หรือไม่?", () => leaveRoom());
};

function updateUIBasedOnState() {
    if (!roomData) return;
    const isHost = roomData.hostId === currentUser.uid;

    if (roomData.status === 'waiting') {
        switchScreen('waiting');
        document.getElementById('display-room-code').innerText = currentRoomId;
        document.getElementById('player-count').innerText = roomData.players.length;
        
        const list = document.getElementById('players-list');
        list.innerHTML = '';
        roomData.players.forEach(p => {
            const isMe = p.id === currentUser.uid;
            const pIsHost = p.id === roomData.hostId;
            list.innerHTML += `
                <div class="flex items-center gap-3 bg-gray-700/50 p-2 rounded-lg border ${isMe ? 'border-blue-500' : 'border-transparent'}">
                    <div class="avatar">${p.name.charAt(0).toUpperCase()}</div>
                    <div class="flex flex-col overflow-hidden">
                        <span class="font-semibold text-white truncate">${p.name} ${isMe ? '(คุณ)' : ''}</span>
                        <span class="text-xs text-gray-400">${pIsHost ? '👑 หัวหน้าห้อง' : (p.isBot ? '🤖 บอท' : 'ผู้เล่น')}</span>
                    </div>
                    ${isHost && !isMe ? `<button onclick="kickPlayer('${p.id}')" class="ml-auto text-red-400 hover:text-red-300 px-2 py-1"><i class="fas fa-times"></i></button>` : ''}
                </div>
            `;
        });

        const btnStart = document.getElementById('btn-start-game');
        const btnAddBot = document.getElementById('btn-add-bot');
        const waitMsg = document.getElementById('waiting-msg');
        
        if (isHost) {
            btnStart.classList.remove('hidden');
            btnAddBot.classList.remove('hidden');
            waitMsg.classList.add('hidden');
            btnStart.disabled = roomData.players.length < 2;
        } else {
            btnStart.classList.add('hidden');
            btnAddBot.classList.add('hidden');
            waitMsg.classList.remove('hidden');
        }
    } 
    else if (roomData.status === 'playing') {
        switchScreen('game');
        document.getElementById('game-room-code').innerText = currentRoomId;
        renderGameUI();
        if (isHost) checkBotTurn();
    }
    else if (roomData.status === 'ended') {
        const winner = roomData.players.find(p => p.id === roomData.winner);
        const winnerName = winner ? (winner.id === currentUser.uid ? 'คุณ' : winner.name) : 'ไม่ทราบ';
        showModal("เกมจบแล้ว!", `ผู้ชนะคือ: ${winnerName}`, () => {
            if (isHost) resetToWaiting();
            else switchScreen('waiting');
        });
    }
}

window.kickPlayer = async function(id) {
     if (roomData.hostId !== currentUser.uid) return;
     const roomRef = getRoomRef(currentRoomId);
     const updated = roomData.players.filter(p => p.id !== id);
     await updateDoc(roomRef, { players: updated });
};

document.getElementById('btn-add-bot').addEventListener('click', async () => {
    if (roomData.players.length >= 6) return showToast("ห้องเต็มแล้ว", "error");
    const botId = 'bot-' + Date.now();
    const botNum = roomData.players.filter(p => p.isBot).length + 1;
    const newBot = { id: botId, name: `Bot ${botNum}`, isBot: true, cardCount: 0 };
    const roomRef = getRoomRef(currentRoomId);
    await updateDoc(roomRef, { players: [...roomData.players, newBot] });
});

document.getElementById('btn-start-game').addEventListener('click', async () => {
    if (roomData.players.length < 2) return;
    const deck = generateDeck();
    const hands = {};
    const players = [...roomData.players];
    
    players.forEach(p => {
        hands[p.id] = deck.splice(0, 7);
        p.cardCount = 7;
    });

    let topCard = null;
    let drawIndex = 0;
    while(drawIndex < deck.length) {
         const c = deck[drawIndex];
         if(!WILD_VALUES.includes(c.v) && !['skip','reverse','draw2'].includes(c.v)) {
             topCard = c;
             deck.splice(drawIndex, 1);
             break;
         }
         drawIndex++;
    }
    if(!topCard) { topCard = deck.splice(0,1)[0]; }

    const initialGameState = {
        status: 'playing',
        deck: deck,
        discardPile: [topCard],
        hands: hands,
        turnIndex: 0,
        direction: 1,
        currentColor: topCard.c !== 'wild' ? topCard.c : 'red',
        drawStack: 0,
        winner: null,
        unoCallers: [],
        logs: [`เกมเริ่มแล้ว! ใบแรกคือ ${getCardNameTh(topCard)}`],
        players: players,
        lastUpdate: Date.now()
    };

    const roomRef = getRoomRef(currentRoomId);
    await updateDoc(roomRef, initialGameState);
});

function generateDeck() {
    let deck = [];
    let idCounter = 1;
    
    COLORS.forEach(c => {
        deck.push({ id: `c_${idCounter++}`, c: c, v: '0' });
        for (let i = 0; i < 2; i++) {
            for (let v = 1; v <= 9; v++) deck.push({ id: `c_${idCounter++}`, c: c, v: v.toString() });
            deck.push({ id: `c_${idCounter++}`, c: c, v: 'skip' });
            deck.push({ id: `c_${idCounter++}`, c: c, v: 'reverse' });
            deck.push({ id: `c_${idCounter++}`, c: c, v: 'draw2' });
        }
    });
    
    for (let i = 0; i < 4; i++) {
        deck.push({ id: `c_${idCounter++}`, c: 'wild', v: 'wild' });
        deck.push({ id: `c_${idCounter++}`, c: 'wild', v: 'draw4' });
    }

    for (let i = 0; i < 2; i++) {
        deck.push({ id: `c_${idCounter++}`, c: 'wild', v: 'swap' }); // การ์ดพิเศษแลกไพ่
        deck.push({ id: `c_${idCounter++}`, c: 'wild', v: 'rotate' }); // การ์ดพิเศษหมุนไพ่
    }

    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

async function resetToWaiting() {
    const roomRef = getRoomRef(currentRoomId);
    const resetPlayers = roomData.players.map(p => ({...p, cardCount:0}));
    await updateDoc(roomRef, {
        status: 'waiting',
        players: resetPlayers,
        hands: deleteField(),
        deck: deleteField(),
        discardPile: deleteField(),
        turnIndex: deleteField(),
        direction: deleteField(),
        currentColor: deleteField(),
        drawStack: deleteField(),
        winner: deleteField(),
        unoCallers: deleteField(),
        logs: deleteField(),
        lastUpdate: deleteField()
    });
}

function getCardMarkup(card, isPlayable = false) {
    if (!card) return '';
    const cClass = card.c === 'wild' ? 'card-wild' : `card-${card.c}`;
    let displayVal = card.v;
    let icon = '';
    
    if (card.v === 'skip') { displayVal = ''; icon = '<i class="fas fa-ban"></i>'; }
    else if (card.v === 'reverse') { displayVal = ''; icon = '<i class="fas fa-sync-alt"></i>'; }
    else if (card.v === 'draw2') { displayVal = '+2'; }
    else if (card.v === 'draw4') { displayVal = '+4'; }
    else if (card.v === 'wild') { displayVal = ''; icon = '<i class="fas fa-palette"></i>'; }
    else if (card.v === 'swap') { displayVal = ''; icon = '<i class="fas fa-exchange-alt"></i>'; }
    else if (card.v === 'rotate') { displayVal = ''; icon = '<i class="fas fa-sync"></i>'; }

    const innerContent = displayVal ? displayVal : icon;
    const smallContent = displayVal ? displayVal : (card.v==='skip' ? '⊘' : (card.v==='reverse'?'⇌':(card.v==='swap'?'⇄':(card.v==='rotate'?'↻':'🌈'))));

    return `
        <div class="uno-card ${cClass} ${isPlayable ? 'playable' : 'uno-card-disabled'}" 
             data-id="${card.id}" 
             ${isPlayable ? `onclick="handleCardClick('${card.id}')"` : ''}>
            <div class="inner-oval"></div>
            <div class="card-value-small-top">${smallContent}</div>
            <div class="card-value">${innerContent}</div>
            <div class="card-value-small-bottom">${smallContent}</div>
        </div>
    `;
}

function getCardNameTh(card) {
    let n = THAI_VALUES[card.v] || card.v;
    let c = THAI_COLORS[card.c] || '';
    return `${n} ${c}`.trim();
}

function renderGameUI() {
    const discardPile = document.getElementById('discard-pile');
    const topCard = roomData.discardPile[roomData.discardPile.length - 1];
    discardPile.innerHTML = getCardMarkup(topCard, false);
    discardPile.firstElementChild.classList.remove('uno-card-disabled');
    discardPile.firstElementChild.classList.add('shadow-xl');

    document.getElementById('deck-count').innerText = roomData.deck.length;

    const colorInd = document.getElementById('current-color-indicator');
    if (roomData.currentColor) {
        colorInd.classList.remove('hidden');
        colorInd.className = `mt-4 px-4 py-2 rounded-full text-sm font-bold shadow-lg uppercase text-white bg-${getTailwindColor(roomData.currentColor)}`;
        colorInd.innerText = `สี: ${THAI_COLORS[roomData.currentColor] || roomData.currentColor}`;
    }

    const dirIcon = document.getElementById('direction-indicator').querySelector('i');
    dirIcon.className = roomData.direction === 1 ? 'fas fa-redo text-green-400' : 'fas fa-undo text-blue-400';
    
    const stackInd = document.getElementById('draw-stack-indicator');
    if (roomData.drawStack > 0) {
        stackInd.classList.remove('hidden');
        stackInd.innerText = `+${roomData.drawStack}`;
    } else {
        stackInd.classList.add('hidden');
    }

    const isMyTurn = roomData.players[roomData.turnIndex].id === currentUser.uid;
    const myTurnInd = document.getElementById('my-turn-indicator');
    if (isMyTurn) {
        myTurnInd.innerHTML = `<span class="px-6 py-2 rounded-full bg-green-500 text-white font-bold animate-pulse shadow-lg">ตาของคุณ!</span>`;
    } else {
        const turnName = roomData.players[roomData.turnIndex].name;
        myTurnInd.innerHTML = `<span class="px-4 py-1 rounded-full bg-gray-700 text-gray-300">ตากำลังเป็นของ: ${turnName}</span>`;
    }

    const myHandContainer = document.getElementById('my-hand');
    myHandContainer.innerHTML = '';
    const myHand = roomData.hands[currentUser.uid] || [];
    
    const btnUno = document.getElementById('btn-uno');
    if (myHand.length === 2 && isMyTurn && !(roomData.unoCallers || []).includes(currentUser.uid)) {
        btnUno.classList.remove('opacity-50', 'cursor-not-allowed');
        btnUno.classList.add('animate-bounce');
    } else {
        btnUno.classList.add('opacity-50', 'cursor-not-allowed');
        btnUno.classList.remove('animate-bounce');
    }

    myHand.sort((a,b) => {
        if(a.c !== b.c) return a.c.localeCompare(b.c);
        return a.v.localeCompare(b.v);
    });

    myHand.forEach(card => {
        const playable = isMyTurn && isCardPlayable(card, topCard, roomData.currentColor, roomData.drawStack);
        myHandContainer.innerHTML += getCardMarkup(card, playable);
    });

    renderOpponents();
    
    const logList = document.getElementById('log-list');
    logList.innerHTML = '';
    if (roomData.logs) {
        roomData.logs.slice(-10).reverse().forEach(l => {
            logList.innerHTML += `<li class="border-b border-gray-700 pb-1 mb-1">${l}</li>`;
        });
    }
}

function getTailwindColor(c) {
    if(c === 'red') return 'red-600';
    if(c === 'blue') return 'blue-600';
    if(c === 'green') return 'green-600';
    if(c === 'yellow') return 'yellow-500';
    return 'gray-800';
}

function renderOpponents() {
    const container = document.getElementById('opponents-container');
    container.innerHTML = '';
    
    let myIdx = roomData.players.findIndex(p => p.id === currentUser.uid);
    if(myIdx === -1) myIdx = 0;

    const numPlayers = roomData.players.length;
    for (let i = 1; i < numPlayers; i++) {
        const pIdx = (myIdx + i) % numPlayers;
        const p = roomData.players[pIdx];
        const isActive = roomData.turnIndex === pIdx;
        
        container.innerHTML += `
            <div class="flex flex-col items-center gap-2 ${isActive ? 'turn-active' : 'opacity-70'} transition-all duration-300 transform ${isActive ? 'scale-110' : ''}">
                <div class="avatar relative ${isActive && roomData.currentColor ? 'color-pulse-'+roomData.currentColor : ''}">
                    ${p.name.charAt(0).toUpperCase()}
                    ${p.isBot ? '<i class="fas fa-robot absolute -bottom-1 -right-1 text-xs bg-gray-800 rounded-full p-1 border border-gray-500"></i>' : ''}
                    ${(roomData.unoCallers||[]).includes(p.id) ? '<span class="absolute -top-3 px-2 py-0.5 bg-red-600 text-yellow-400 text-xs font-black rounded-full border border-yellow-400 shadow-md transform rotate-12">UNO!</span>' : ''}
                </div>
                <span class="text-xs font-bold max-w-[80px] truncate text-center bg-gray-800/80 px-2 py-1 rounded text-white">${p.name}</span>
                <div class="flex gap-1 justify-center max-w-[100px] flex-wrap mt-1">
                    ${Array(Math.min(p.cardCount, 15)).fill(0).map(() => 
                        '<div class="w-3 h-4 bg-gray-200 rounded border border-gray-400 -ml-2 first:ml-0 shadow-sm" style="background: linear-gradient(135deg, #eee, #aaa);"></div>'
                    ).join('')}
                    ${p.cardCount > 15 ? `<span class="text-xs ml-1">+${p.cardCount-15}</span>` : ''}
                </div>
                <span class="text-[10px] text-gray-400 mt-1 font-mono">${p.cardCount} ใบ</span>
            </div>
        `;
    }
}

function isCardPlayable(card, topCard, currentColor, drawStack) {
    if (drawStack > 0) {
        if (topCard.v === 'draw2' && card.v === 'draw2') return true;
        if (topCard.v === 'draw4' && card.v === 'draw4') return true;
        return false;
    }
    if (card.c === 'wild') return true;
    if (card.c === currentColor) return true;
    if (card.v === topCard.v) return true;
    return false;
}

window.handleCardClick = function(cardId) {
    if (roomData.players[roomData.turnIndex].id !== currentUser.uid) return;
    const myHand = roomData.hands[currentUser.uid];
    const card = myHand.find(c => c.id === cardId);
    if (!card) return;

    if (card.c === 'wild') {
        pendingWildCard = card;
        document.getElementById('color-picker-modal').classList.remove('hidden');
    } else {
        executeTurn(card, card.c);
    }
};

window.submitColorChoice = function(color) {
    document.getElementById('color-picker-modal').classList.add('hidden');
    if (pendingWildCard) {
        executeTurn(pendingWildCard, color);
        pendingWildCard = null;
    }
};

window.drawCard = async function() {
    if (roomData.players[roomData.turnIndex].id !== currentUser.uid) return;
    await executeTurn(null, null);
};

window.callUno = async function() {
    if (!currentRoomId || !currentUser || !roomData) return;
    const myHand = roomData.hands[currentUser.uid];
    if (myHand.length <= 2) {
        let callers = roomData.unoCallers || [];
        if (!callers.includes(currentUser.uid)) {
            callers.push(currentUser.uid);
            const roomRef = getRoomRef(currentRoomId);
            await updateDoc(roomRef, { 
                unoCallers: callers,
                logs: [...(roomData.logs||[]), `${myName} พูดว่า UNO!`] 
            });
        }
    }
};

async function executeTurn(playedCard, chosenColor) {
    let state = JSON.parse(JSON.stringify(roomData));
    let currentPlayer = state.players[state.turnIndex];
    let logs = state.logs || [];
    let hand = state.hands[currentPlayer.id];
    
    if (playedCard) {
        state.hands[currentPlayer.id] = hand.filter(c => c.id !== playedCard.id);
        currentPlayer.cardCount--;
        
        state.discardPile.push(playedCard);
        state.currentColor = chosenColor;
        
        logs.push(`${currentPlayer.name} ลงไพ่ ${getCardNameTh(playedCard)} ${playedCard.c === 'wild' ? `(เลือกสี${THAI_COLORS[chosenColor]})` : ''}`);

        if (currentPlayer.cardCount === 1) {
            const callers = state.unoCallers || [];
            if (!callers.includes(currentPlayer.id)) {
                logs.push(`${currentPlayer.name} ลืมพูด UNO! โดนปรับจั่ว 2 ใบ`);
                drawCardsForPlayer(state, currentPlayer.id, 2);
            }
        }

        if (playedCard.v === 'skip') {
            state.turnIndex = getNextIndex(state.turnIndex, state.direction, state.players.length);
            logs.push(`ข้ามตาของ ${state.players[state.turnIndex].name}!`);
        } 
        else if (playedCard.v === 'reverse') {
            if (state.players.length === 2) {
                state.turnIndex = getNextIndex(state.turnIndex, state.direction, state.players.length);
                logs.push(`ย้อนกลับ! ข้ามตาของ ${state.players[state.turnIndex].name}!`);
            } else {
                state.direction *= -1;
                logs.push(`เปลี่ยนทิศทางการเล่น!`);
            }
        }
        else if (playedCard.v === 'draw2') {
            state.drawStack += 2;
            logs.push(`สะสมจั่ว +${state.drawStack}`);
        }
        else if (playedCard.v === 'draw4') {
            state.drawStack += 4;
            logs.push(`สะสมจั่ว +${state.drawStack}`);
        }
        else if (playedCard.v === 'swap') {
            let nextIdx = getNextIndex(state.turnIndex, state.direction, state.players.length);
            let nextPlayer = state.players[nextIdx];
            let myHandTemp = [...state.hands[currentPlayer.id]];
            state.hands[currentPlayer.id] = [...state.hands[nextPlayer.id]];
            state.hands[nextPlayer.id] = myHandTemp;
            currentPlayer.cardCount = state.hands[currentPlayer.id].length;
            nextPlayer.cardCount = state.hands[nextPlayer.id].length;
            logs.push(`🔄 ${currentPlayer.name} ใช้การ์ดแลกไพ่กับ ${nextPlayer.name}!`);
        }
        else if (playedCard.v === 'rotate') {
            let newHands = {};
            for (let i = 0; i < state.players.length; i++) {
                let current = state.players[i];
                let nextIdx = getNextIndex(i, state.direction, state.players.length);
                let next = state.players[nextIdx];
                newHands[next.id] = [...state.hands[current.id]];
            }
            state.hands = newHands;
            state.players.forEach(p => { p.cardCount = state.hands[p.id].length; });
            logs.push(`🌪️ ${currentPlayer.name} ใช้การ์ดหมุนไพ่ทั้งวง!`);
        }

        let winningPlayer = state.players.find(p => p.cardCount === 0);
        if (winningPlayer) {
            state.status = 'ended';
            state.winner = winningPlayer.id;
            logs.push(`🎉 ${winningPlayer.name} ชนะเกม!`);
            await commitState(state);
            return;
        }

        state.turnIndex = getNextIndex(state.turnIndex, state.direction, state.players.length);
    } else {
        if (state.drawStack > 0) {
            drawCardsForPlayer(state, currentPlayer.id, state.drawStack);
            logs.push(`${currentPlayer.name} จั่วไพ่ ${state.drawStack} ใบจากบทลงโทษ`);
            state.drawStack = 0;
            state.turnIndex = getNextIndex(state.turnIndex, state.direction, state.players.length);
        } else {
            drawCardsForPlayer(state, currentPlayer.id, 1);
            logs.push(`${currentPlayer.name} จั่วไพ่ 1 ใบ`);
            state.turnIndex = getNextIndex(state.turnIndex, state.direction, state.players.length);
        }
    }

    state.unoCallers = (state.unoCallers || []).filter(uid => {
         let p = state.players.find(x => x.id === uid);
         return p && p.cardCount === 1;
    });

    state.logs = logs;
    state.lastUpdate = Date.now();
    await commitState(state);
}

function getNextIndex(currentIndex, direction, length) {
    let next = (currentIndex + direction) % length;
    if (next < 0) next += length;
    return next;
}

function drawCardsForPlayer(state, playerId, count) {
    for (let i = 0; i < count; i++) {
        if (state.deck.length === 0) {
            const top = state.discardPile.pop();
            state.deck = [...state.discardPile];
            for (let x = state.deck.length - 1; x > 0; x--) {
                const j = Math.floor(Math.random() * (x + 1));
                [state.deck[x], state.deck[j]] = [state.deck[j], state.deck[x]];
            }
            state.discardPile = [top];
            state.logs.push(`♻️ สับไพ่กองกลางใหม่`);
            if (state.deck.length === 0) break;
        }
        const card = state.deck.shift();
        state.hands[playerId].push(card);
        state.players.find(x => x.id === playerId).cardCount++;
    }
}

async function commitState(newState) {
    const roomRef = getRoomRef(currentRoomId);
    try {
        await updateDoc(roomRef, newState);
    } catch (err) {
        console.error("Error updating state", err);
    }
}

let botTimeout = null;
function checkBotTurn() {
    if (!roomData || roomData.status !== 'playing' || roomData.winner) return;
    const currentPlayer = roomData.players[roomData.turnIndex];
    if (currentPlayer.isBot && roomData.hostId === currentUser.uid) {
        if (botTimeout) clearTimeout(botTimeout);
        botTimeout = setTimeout(() => { executeBotTurn(currentPlayer); }, 1500); 
    }
}

async function executeBotTurn(botPlayer) {
    if (roomData.players[roomData.turnIndex].id !== botPlayer.id) return; 
    const hand = roomData.hands[botPlayer.id];
    const topCard = roomData.discardPile[roomData.discardPile.length - 1];
    let playableCards = hand.filter(c => isCardPlayable(c, topCard, roomData.currentColor, roomData.drawStack));
    
    if (playableCards.length > 0) {
        if (hand.length === 2) {
            let callers = roomData.unoCallers || [];
            if (!callers.includes(botPlayer.id)) {
                callers.push(botPlayer.id);
                roomData.unoCallers = callers;
                roomData.logs.push(`${botPlayer.name} พูดว่า UNO!`);
            }
        }

        let cardToPlay = playableCards.find(c => c.c === roomData.currentColor && c.c !== 'wild');
        if (!cardToPlay) cardToPlay = playableCards.find(c => c.c !== 'wild');
        if (!cardToPlay) cardToPlay = playableCards[0];
        
        let chosenColor = cardToPlay.c;
        if (chosenColor === 'wild') {
            const colorCounts = { red:0, blue:0, green:0, yellow:0 };
            hand.forEach(c => { if(c.c !== 'wild') colorCounts[c.c]++; });
            let maxCount = -1;
            for (const [col, count] of Object.entries(colorCounts)) {
                if (count > maxCount) { maxCount = count; chosenColor = col; }
            }
            if (chosenColor === 'wild') chosenColor = COLORS[Math.floor(Math.random()*COLORS.length)];
        }
        await executeTurn(cardToPlay, chosenColor);
    } else {
        await executeTurn(null, null);
    }
}

initAuth();
