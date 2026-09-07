import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, updateDoc, onSnapshot, collection, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const appId = typeof __app_id !== 'undefined' ? __app_id : 'uno-multiplayer-thai';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {
    // Provide a dummy config for local testing if needed, but usually provided by environment
    apiKey: "dummy", authDomain: "dummy", projectId: "dummy"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

window.firebaseDeps = {
    auth, db, signInAnonymously, signInWithCustomToken, onAuthStateChanged,
    doc, setDoc, getDoc, updateDoc, onSnapshot, collection, arrayUnion, appId
};
