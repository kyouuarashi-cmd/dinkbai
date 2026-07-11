// =========================================
// Firebase Initialization Module (Shared)
// =========================================
// This file is imported by all HTML pages to initialize Firebase services.
// It sets up: App, Realtime Database, Storage, and Authentication.

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { getDatabase, ref, onValue, set, get, update, remove } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-database.js";
import { getStorage, ref as storageRef, uploadString, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-storage.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence, browserPopupRedirectResolver } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyAwb_nYHoagATSmGy1TCoZLkt9a9kBfbvQ",
    authDomain: "dinkbai-queueing.firebaseapp.com",
    databaseURL: "https://dinkbai-queueing-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "dinkbai-queueing",
    storageBucket: "dinkbai-queueing.firebasestorage.app",
    messagingSenderId: "518522778086",
    appId: "1:518522778086:web:a43380de2a0eaccf3a2627",
    measurementId: "G-CRJRKKM37N"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const storage = getStorage(app);
const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch(console.error);
const googleProvider = new GoogleAuthProvider();

// --- Expose Database functions ---
window.firebaseDb = db;
window.firebaseRef = ref;
window.firebaseOnValue = onValue;
window.firebaseSet = set;
window.firebaseGet = get;
window.firebaseUpdate = update;
window.firebaseRemove = remove;

// --- Expose Storage functions ---
window.firebaseStorage = storage;
window.firebaseStorageRef = storageRef;
window.firebaseUploadString = uploadString;
window.firebaseUploadBytes = uploadBytes;
window.firebaseGetDownloadURL = getDownloadURL;

// --- Expose Auth functions ---
window.firebaseAuth = auth;
window.firebaseGoogleProvider = googleProvider;
window.firebaseSignInWithPopup = signInWithPopup;
window.firebaseBrowserPopupRedirectResolver = browserPopupRedirectResolver;
window.firebaseSignInWithRedirect = signInWithRedirect;
window.firebaseGetRedirectResult = getRedirectResult;
window.firebaseSignOut = signOut;
window.firebaseOnAuthStateChanged = onAuthStateChanged;

// --- Admin email list (loaded from Firebase) ---
window.adminEmails = [];

// --- Auth State Listener ---
// Track the current Firebase Auth user globally
window.firebaseCurrentUser = null;

if (localStorage.getItem('pendingRedirect') === 'true') {
    getRedirectResult(auth).then((result) => {
        localStorage.removeItem('pendingRedirect');
        if (result) console.log('Successfully signed in via redirect');
    }).catch((error) => {
        localStorage.removeItem('pendingRedirect');
        console.error('Redirect sign in error:', error);
    });
}

onAuthStateChanged(auth, (user) => {
    window.firebaseCurrentUser = user || null;
    
    if (user) {
        // First load admin emails to check privileges
        get(ref(db, 'config/adminEmails')).then(adminSnapshot => {
            if (adminSnapshot.exists()) {
                const data = adminSnapshot.val();
                let emails = [];
                if (typeof data === 'string') {
                    emails = data.split(',');
                } else if (Array.isArray(data)) {
                    emails = data;
                } else if (data && typeof data === 'object') {
                    emails = Object.values(data);
                }
                window.adminEmails = emails.map(e => typeof e === 'string' ? e.trim().toLowerCase() : String(e));
            }
            
            // Check if this user is an admin
            const userEmail = user.email ? user.email.trim().toLowerCase() : "";
            window.isFirebaseAdmin = window.adminEmails.includes(userEmail);
            
            // Find the player ID linked to this Google UID
            get(ref(db, 'gameState/allPlayers')).then(snapshot => {
                if (snapshot.exists()) {
                    const players = snapshot.val();
                    const linkedPlayer = Object.entries(players).find(([id, p]) => p && p.googleUid === user.uid && p.claimStatus === 'claimed');
                    if (linkedPlayer) {
                        localStorage.setItem('loggedInPlayerId', linkedPlayer[0]);
                    }
                }
                // Fire the ready event after we've resolved the player link
                window.dispatchEvent(new Event('firebase-ready'));
                window.dispatchEvent(new CustomEvent('auth-state-changed', { detail: { user } }));
            });
        }).catch(e => {
            console.warn('Could not load admin emails:', e);
            // Fallback: still load the rest of the app even if admin check fails
            window.isFirebaseAdmin = false;
            window.dispatchEvent(new Event('firebase-ready'));
            window.dispatchEvent(new CustomEvent('auth-state-changed', { detail: { user } }));
        });
    } else {
        window.isFirebaseAdmin = false;
        localStorage.removeItem('loggedInPlayerId');
        window.dispatchEvent(new Event('firebase-ready'));
        window.dispatchEvent(new CustomEvent('auth-state-changed', { detail: { user: null } }));
    }
});
