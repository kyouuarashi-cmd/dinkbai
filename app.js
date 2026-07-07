let queues = {
    manual: [],
    beginner: [],
    intermediate: [],
    advanced: [],
    standby: []
};

let courts = [];
let playerIdCounter = 1;
let allPlayers = {}; // Track all players globally for MVP stats
let isOpenPlayActive = false; // Tracks if Open Play has started
let previousCourtIds = []; // Track which courts had matches in previous state for chime
let recentMatches = []; // Track last 5 matches
let pastSeasons = {}; // Archived seasonal leaderboards
let pendingClaims = {}; // Track pending player claims


// Audio Context for chime (initialized on first click/interaction)
let audioCtx = null;
let audioEnabled = false;

// =========================================
// TOAST NOTIFICATION SYSTEM
// =========================================
window.showToast = function(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    
    const icons = {
        success: '✓',
        error: '✕',
        warning: '⚠',
        info: 'ℹ'
    };
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <span class="toast-icon">${icons[type] || icons.info}</span>
        <span class="toast-message">${message}</span>
    `;
    
    container.appendChild(toast);
    
    // Auto-dismiss
    setTimeout(() => {
        toast.classList.add('toast-exit');
        toast.addEventListener('animationend', () => toast.remove());
    }, duration);
};

// =========================================
// LOADING OVERLAY
// =========================================
window.hideLoadingOverlay = function() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.classList.add('hidden');
};

// Fallback: dismiss loading overlay after 5 seconds even if Firebase hasn't responded
setTimeout(() => window.hideLoadingOverlay(), 5000);


// DOM Elements
const courtCountInput = document.getElementById('courtCount');
const setCourtsBtn = document.getElementById('setCourtsBtn');
const addPlayerForm = document.getElementById('addPlayerForm');
const courtsContainer = document.getElementById('courtsContainer');
const nextMatchupsContainer = document.getElementById('nextMatchupsContainer');

const stackBeginner = document.getElementById('stack-beginner');
const stackIntermediate = document.getElementById('stack-intermediate');
const stackAdvanced = document.getElementById('stack-advanced');

const isAdmin = !!addPlayerForm; // If the add form exists, we are in Admin View

// Firebase Syncing Logic
let syncTimeout = null;
function syncToFirebase() {
    if (!isAdmin) return; // Only Admin pushes to Firebase
    if (syncTimeout) clearTimeout(syncTimeout);
    syncTimeout = setTimeout(() => {
        if (window.updatePlayerRankBorders && allPlayers) {
            Object.values(allPlayers).forEach(p => window.updatePlayerRankBorders(p));
        }
        if (window.firebaseSet && window.firebaseDb && window.isFirebaseReady) {
            const dbRef = window.firebaseRef(window.firebaseDb, 'gameState');
            window.firebaseSet(dbRef, {
                isOpenPlayActive,
                allPlayers,
                queues,
                courts,
                playerIdCounter,
                recentMatches,
                pastSeasons,
                pendingClaims
            }).catch(e => console.error("Firebase save error:", e));
        }
    }, 100);
}

window.addEventListener('firebase-ready', () => {
    window.isFirebaseReady = true;
    const dbRef = window.firebaseRef(window.firebaseDb, 'gameState');

    window.firebaseOnValue(dbRef, (snapshot) => {
        if (snapshot.exists()) {
            const data = snapshot.val();

            // Check for new court assignments to play chime and TTS
            if (data.courts && Array.isArray(data.courts)) {
                let currentCourtIds = data.courts.filter(c => c.players !== null).map(c => c.id);
                // If there's a court ID in current that wasn't in previous, a new match started
                if (previousCourtIds.length > 0) {
                    let newMatches = data.courts.filter(c => c.players !== null && !previousCourtIds.includes(c.id));
                    if (newMatches.length > 0) {
                        playChime();

                        // Text-to-speech announcement
                        if (audioEnabled && 'speechSynthesis' in window) {
                            newMatches.forEach(c => {
                                const names = c.players.map(p => p.name).join(', ');
                                const msg = new SpeechSynthesisUtterance(`Court ${c.id}. ${names}.`);
                                window.speechSynthesis.speak(msg);
                            });
                        }
                    }
                }
                previousCourtIds = currentCourtIds;
            }

            // Helper to clean up allPlayers data from Firebase
            const cleanPlayers = (players) => {
                Object.keys(players).forEach(k => {
                    if(!players[k]) {
                        delete players[k];
                    } else {
                        if (players[k].matchHistory) {
                            // Firebase converts arrays to objects. Convert back to array.
                            players[k].matchHistory = Object.values(players[k].matchHistory).filter(Boolean);
                            // Sort by date descending
                            players[k].matchHistory.sort((a, b) => new Date(b.date) - new Date(a.date));
                        }
                        if (players[k].unlockedCosmetics) {
                            players[k].unlockedCosmetics = Object.values(players[k].unlockedCosmetics).filter(Boolean);
                        }
                        if (window.updatePlayerRankBorders) {
                            window.updatePlayerRankBorders(players[k]);
                        }
                    }
                });
            };

            // If we're Admin and we already loaded, we shouldn't re-render the queues and courts
            // to avoid interrupting drag-and-drop operations.
            // HOWEVER, we MUST update our local `allPlayers` state so that purchases and profile 
            // edits made in store.html (or other tabs) are synced and not overwritten when a match finishes.
            if (isAdmin && window.hasLoadedInitialState) {
                if (data.allPlayers) {
                    allPlayers = data.allPlayers;
                    cleanPlayers(allPlayers);
                }
                return;
            }

            isOpenPlayActive = data.isOpenPlayActive || false;
            allPlayers = data.allPlayers || {};
            cleanPlayers(allPlayers);
            
            recentMatches = data.recentMatches ? Object.values(data.recentMatches).filter(Boolean) : [];
            pastSeasons = data.pastSeasons || {};
            
            pendingClaims = data.pendingClaims || {};
            Object.keys(pendingClaims).forEach(k => { if(!pendingClaims[k]) delete pendingClaims[k]; });


            // Firebase Realtime DB drops empty arrays/objects, so we must recreate them
            queues = data.queues || {};
            ['beginner', 'intermediate', 'advanced', 'manual', 'standby'].forEach(q => {
                queues[q] = queues[q] ? Object.values(queues[q]).filter(Boolean) : [];
            });

            courts = data.courts ? Object.values(data.courts).filter(Boolean) : [];
            courts.forEach(c => {
                if (c.players === undefined) c.players = null;
            });
            playerIdCounter = data.playerIdCounter || 1;

            // If admin is restoring, update the court count input
            if (isAdmin && courtCountInput) {
                courtCountInput.value = courts.length > 0 ? courts.length : 4;
            }

            renderAppState();
            renderQueues();
            renderCourts();
            renderLeaderboard();
            updateNextMatchups();
            if (typeof renderRankings === 'function') {
                renderRankings();
            }
            if (typeof renderMatchHistory === 'function') {
                renderMatchHistory();
            }
            if (typeof renderPlayerManagement === 'function') {
                renderPlayerManagement();
            }
            if (typeof updatePlayerDatalist === 'function') {
                updatePlayerDatalist();
            }
            if (typeof renderAdminDashboards === 'function') {
                renderAdminDashboards();
            }
            if (typeof renderProfileUI === 'function') {
                renderProfileUI();
            }

            window.hasLoadedInitialState = true;
            window.hideLoadingOverlay();
        }
    });
});

// UI Helper
function getInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) {
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
}

function renderAvatar(player) {
    if (!player) return '';
    const actualPlayer = (typeof allPlayers !== 'undefined' && allPlayers[player.id]) ? allPlayers[player.id] : player;
    
    const equipped = actualPlayer.equippedBorder;
    const borderClass = equipped && equipped !== 'none' ? ` cosmetic-border ${equipped}` : '';
    
    if (actualPlayer.profilePic) {
        const styleStr = borderClass ? `background-image: url('${actualPlayer.profilePic}'); background-size: cover; background-position: center; border: none;` : `background-image: url('${actualPlayer.profilePic}'); background-size: cover; background-position: center; border: 2px solid var(--skill-${actualPlayer.skill});`;
        return `<div class="avatar ${actualPlayer.skill}${borderClass}" style="${styleStr}"></div>`;
    }
    const initials = getInitials(actualPlayer.name || player.name);
    const styleStr = borderClass ? `border: none;` : '';
    return `<div class="avatar ${actualPlayer.skill || player.skill}${borderClass}" style="${styleStr}">${initials}</div>`;
}

window.renderClickableName = function(player) {
    if (!player) return '';
    const actualPlayer = (typeof allPlayers !== 'undefined' && allPlayers[player.id]) ? allPlayers[player.id] : player;
    let cls = "clickable-name";
    if (actualPlayer.equippedNameDesign && actualPlayer.equippedNameDesign !== 'none') {
        cls += ' ' + actualPlayer.equippedNameDesign;
    }
    return `<span class="${cls}" onclick="showPlayerProfile('${actualPlayer.id}')" data-text="${actualPlayer.name}">${actualPlayer.name}</span>`;
};

// Initialization
function init() {
    renderAppState();
    setupCourts();
    if (addPlayerForm) {
        addPlayerForm.addEventListener('submit', handleAddPlayer);
    }
    if (typeof renderMatchHistory === 'function') {
        renderMatchHistory();
    }

    // Start Live Stopwatch for courts
    setInterval(() => {
        document.querySelectorAll('.court-timer').forEach(el => {
            const start = parseInt(el.getAttribute('data-start'), 10);
            if (!start) return;
            const diff = Math.floor((Date.now() - start) / 1000);
            if (diff < 0) return;
            const m = String(Math.floor(diff / 60)).padStart(2, '0');
            const s = String(diff % 60).padStart(2, '0');
            el.textContent = `${m}:${s}`;
        });
    }, 1000);

    const nameInput = document.getElementById('playerName');
    if (nameInput) {
        nameInput.addEventListener('input', (e) => {
            const val = e.target.value.trim().toLowerCase();
            const player = Object.values(allPlayers).find(p => p.name.toLowerCase() === val);
            if (player) {
                const skillInput = document.getElementById('playerSkill');
                if (skillInput) skillInput.value = player.skill;
            }
        });
    }

    if (setCourtsBtn) {
        setCourtsBtn.addEventListener('click', () => {
            const newCount = parseInt(courtCountInput.value);
            if (newCount < 1 || newCount > 20) {
                alert('Please enter a valid number of courts (1-20).');
                return;
            }
            // Add new courts
            while (courts.length < newCount) {
                courts.push({ id: (courts.length + 1).toString(), players: null, isLastGame: false });
            }
            // Remove empty courts from end
            while (courts.length > newCount) {
                if (courts[courts.length - 1].players === null) {
                    courts.pop();
                } else {
                    break;
                }
            }
            courtCountInput.value = courts.length;
            renderCourts();
            syncToFirebase();
        });
    }
    renderLeaderboard();
}

// Setup Courts
function setupCourts() {
    if (!isAdmin) return; // Player view gets courts from Firebase
    let numCourts = parseInt(courtCountInput.value);
    if (isNaN(numCourts) || numCourts < 1) {
        numCourts = 4; // default
        courtCountInput.value = 4;
    }

    // Adjust courts array size
    if (numCourts > courts.length) {
        // Add courts
        let maxId = 0;
        courts.forEach(c => {
            let num = parseInt(c.id);
            if (!isNaN(num) && num > maxId) maxId = num;
        });

        for (let i = courts.length; i < numCourts; i++) {
            maxId++;
            courts.push({
                id: maxId.toString(),
                players: null, // null means empty, array of 4 means full
                isLastGame: false
            });
        }
    } else if (numCourts < courts.length) {
        // We can only remove empty courts to prevent interrupting games
        let newCourts = courts.filter(c => c.players !== null);
        let emptyCourtsNeeded = numCourts - newCourts.length;

        if (emptyCourtsNeeded > 0) {
            let emptyOnes = courts.filter(c => c.players === null).slice(0, emptyCourtsNeeded);
            newCourts = [...newCourts, ...emptyOnes];
        } else {
            // If we have more active courts than requested, we just keep them until they finish
            console.log("Cannot remove active courts immediately.");
        }

        courts = newCourts;
    }

    renderCourts();
    checkQueuesAndAssign();
}

// Add player to appropriate queue
function handleAddPlayer(e) {
    e.preventDefault();

    const nameInput = document.getElementById('playerName');
    const skillInput = document.getElementById('playerSkill');
    const genderInput = document.getElementById('playerGender');
    const isHostInput = document.getElementById('playerIsHost');

    const name = nameInput.value.trim();
    const skill = skillInput.value;
    const gender = genderInput ? genderInput.value : 'M';
    const isHost = isHostInput ? isHostInput.checked : false;

    if (name && skill) {
        // Check if player is already in a queue or court
        const isQueued = ['beginner', 'intermediate', 'advanced', 'manual', 'standby'].some(q =>
            queues[q].some(p => p.name.toLowerCase() === name.toLowerCase())
        );
        const isPlaying = courts.some(c =>
            c.players && c.players.some(p => p.name.toLowerCase() === name.toLowerCase())
        );

        if (isQueued || isPlaying) {
            alert(`${name} is already checked in and waiting or playing!`);
            return;
        }

        let player = Object.values(allPlayers).find(p => p.name.toLowerCase() === name.toLowerCase());

        if (player) {
            // Reuse existing player
            player.skill = skill;
            player.gender = gender;
            player.isHost = isHost;
            player.queuedAt = Date.now();
        } else {
            // New player
            let startingRating = 1500;
            if (skill === 'beginner') startingRating = 1000;
            else if (skill === 'advanced') startingRating = 1800;

            player = {
                id: playerIdCounter++,
                name: name,
                skill: skill,
                gender: gender,
                isHost: isHost,
                queuedAt: Date.now(),
                matchesPlayed: 0,
                wins: 0,
                rating: startingRating,
                rd: 250,
                sessionMatchesPlayed: 0,
                sessionWins: 0
            };
        }

        allPlayers[player.id] = player;

        queues[skill].push(player);

        // Reset form
        nameInput.value = '';
        skillInput.value = '';
        if (genderInput) genderInput.value = '';
        if (isHostInput) isHostInput.checked = false;

        renderQueues();
        checkQueuesAndAssign();
        syncToFirebase();
    }
}

window.updatePlayerDatalist = function () {
    const dataList = document.getElementById('existingPlayersList');
    if (!dataList) return;

    dataList.innerHTML = '';
    const sortedPlayers = Object.values(allPlayers).sort((a, b) => a.name.localeCompare(b.name));
    sortedPlayers.forEach(p => {
        const option = document.createElement('option');
        option.value = p.name;
        dataList.appendChild(option);
    });
};

function createManualGroup() {
    const container = document.getElementById('manualPlayerList');
    const checkedBoxes = Array.from(container.querySelectorAll('input[type="checkbox"]:checked'));

    if (checkedBoxes.length !== 2 && checkedBoxes.length !== 4) {
        alert('Please select exactly 2 or 4 players.');
        return;
    }

    let selectedPlayers = [];

    checkedBoxes.forEach(box => {
        const id = parseInt(box.value);
        const qName = box.getAttribute('data-queue');

        const queue = queues[qName];
        if (queue) {
            const idx = queue.findIndex(p => p.id === id);
            if (idx !== -1) {
                selectedPlayers.push(queue.splice(idx, 1)[0]);
            }
        }
    });

    if (selectedPlayers.length > 0) {
        const newQueuedAt = Date.now();
        selectedPlayers.forEach(p => p.queuedAt = newQueuedAt);

        const groupObj = {
            id: playerIdCounter++,
            isGroup: true,
            size: selectedPlayers.length,
            skill: 'mixed',
            queuedAt: newQueuedAt,
            players: selectedPlayers
        };

        queues.manual.push(groupObj);

        renderQueues();
        checkQueuesAndAssign();
        syncToFirebase();
    }
}

function getBestGroupType(q) {
    let possibleGroups = [];

    // 0. Manual Queue (Priority by default if they are the oldest)
    const manual4 = q.manual.find(g => g.size === 4);
    if (manual4) {
        possibleGroups.push({
            type: 'manual_4',
            groupRef: manual4,
            groupCompleteTime: manual4.queuedAt
        });
    }

    const manual2 = q.manual.find(g => g.size === 2);
    if (manual2) {
        // Find 2 solo players from queues matching the skill level of the manual group
        const groupSkills = manual2.players.map(p => p.skill);
        let targetSkills = [...new Set(groupSkills)];

        // Find another manual pair of 2 with matching skill levels
        const otherManual2 = q.manual.find(g => {
            if (g.size !== 2 || g === manual2) return false;
            const otherSkills = g.players.map(p => p.skill);
            return targetSkills.some(s => otherSkills.includes(s));
        });
        
        if (otherManual2) {
            possibleGroups.push({
                type: 'manual_2_manual_2',
                groupRef1: manual2,
                groupRef2: otherManual2,
                groupCompleteTime: Math.max(manual2.queuedAt, otherManual2.queuedAt)
            });
        }

        let oldestSoloPairQueue = null;
        let oldestSoloPairWait = Infinity;

        targetSkills.forEach(skill => {
            if (q[skill] && q[skill].length >= 2) {
                const waitTime = Math.max(manual2.queuedAt, q[skill][1].queuedAt);
                if (waitTime < oldestSoloPairWait) {
                    oldestSoloPairWait = waitTime;
                    oldestSoloPairQueue = skill;
                }
            }
        });

        if (oldestSoloPairQueue) {
            possibleGroups.push({
                type: 'manual_2_solo',
                groupRef: manual2,
                soloSkill: oldestSoloPairQueue,
                groupCompleteTime: oldestSoloPairWait
            });
        }
    }

    // 1. Check for single-skill groups
    ['beginner', 'intermediate', 'advanced'].forEach(skill => {
        if (q[skill].length >= 4) {
            const first4 = [q[skill][0], q[skill][1], q[skill][2], q[skill][3]];
            const ids = first4.map(p => p.id).sort().join(',');
            if (first4.every(p => p.lastGameGroupIds === ids)) {
                if (q[skill].length >= 5) {
                    possibleGroups.push({
                        type: 'single',
                        skill: skill,
                        groupCompleteTime: q[skill][4].queuedAt,
                        skipIndex: 3
                    });
                }
            } else {
                possibleGroups.push({
                    type: 'single',
                    skill: skill,
                    groupCompleteTime: q[skill][3].queuedAt
                });
            }
        }
    });

    // 2. Check for mixed group
    if (q.advanced.length >= 2 && q.intermediate.length >= 2) {
        const group4 = [q.advanced[0], q.advanced[1], q.intermediate[0], q.intermediate[1]];
        const ids = group4.map(p => p.id).sort().join(',');

        if (group4.every(p => p.lastGameGroupIds === ids)) {
            if (q.intermediate.length >= 3) {
                possibleGroups.push({
                    type: 'mixed',
                    groupCompleteTime: Math.max(q.advanced[1].queuedAt, q.intermediate[2].queuedAt),
                    skipIntIndex: 1
                });
            } else if (q.advanced.length >= 3) {
                possibleGroups.push({
                    type: 'mixed',
                    groupCompleteTime: Math.max(q.advanced[2].queuedAt, q.intermediate[1].queuedAt),
                    skipAdvIndex: 1
                });
            }
        } else {
            possibleGroups.push({
                type: 'mixed',
                groupCompleteTime: Math.max(q.advanced[1].queuedAt, q.intermediate[1].queuedAt)
            });
        }
    }

    // 3. Fallback mixed group (Intermediate/Blue & Beginner/Black)
    if (q.intermediate.length >= 2 && q.beginner.length >= 2) {
        const group4 = [q.intermediate[0], q.intermediate[1], q.beginner[0], q.beginner[1]];
        const ids = group4.map(p => p.id).sort().join(',');

        if (group4.every(p => p.lastGameGroupIds === ids)) {
            if (q.beginner.length >= 3) {
                possibleGroups.push({
                    type: 'mixed_int_beg',
                    groupCompleteTime: Math.max(q.intermediate[1].queuedAt, q.beginner[2].queuedAt),
                    skipBegIndex: 1
                });
            } else if (q.intermediate.length >= 3) {
                possibleGroups.push({
                    type: 'mixed_int_beg',
                    groupCompleteTime: Math.max(q.intermediate[2].queuedAt, q.beginner[1].queuedAt),
                    skipIntIndex: 1
                });
            }
        } else {
            possibleGroups.push({
                type: 'mixed_int_beg',
                groupCompleteTime: Math.max(q.intermediate[1].queuedAt, q.beginner[1].queuedAt)
            });
        }
    }

    if (possibleGroups.length === 0) return null;

    possibleGroups.sort((a, b) => a.groupCompleteTime - b.groupCompleteTime);
    return possibleGroups[0];
}

function pullGroup(q, bestGroup) {
    let group = [];

    if (bestGroup.type === 'manual_4') {
        const g = q.manual.splice(q.manual.indexOf(bestGroup.groupRef), 1)[0];
        group = [...g.players];
    } else if (bestGroup.type === 'manual_2_manual_2') {
        const g1 = q.manual.splice(q.manual.indexOf(bestGroup.groupRef1), 1)[0];
        const g2 = q.manual.splice(q.manual.indexOf(bestGroup.groupRef2), 1)[0];
        group = [...g1.players, ...g2.players];
    } else if (bestGroup.type === 'manual_2_solo') {
        const g1 = q.manual.splice(q.manual.indexOf(bestGroup.groupRef), 1)[0];
        const soloPair = q[bestGroup.soloSkill].splice(0, 2);
        group = [...g1.players, ...soloPair];
    } else if (bestGroup.type === 'single') {
        if (bestGroup.skipIndex === 3) {
            group = [
                q[bestGroup.skill].splice(0, 1)[0],
                q[bestGroup.skill].splice(0, 1)[0],
                q[bestGroup.skill].splice(0, 1)[0],
                q[bestGroup.skill].splice(1, 1)[0]
            ];
        } else {
            group = q[bestGroup.skill].splice(0, 4);
        }
    } else if (bestGroup.type === 'mixed') {
        const advGroup = [];
        if (bestGroup.skipAdvIndex === 1) {
            advGroup.push(q.advanced.splice(0, 1)[0], q.advanced.splice(1, 1)[0]);
        } else {
            advGroup.push(...q.advanced.splice(0, 2));
        }

        const intGroup = [];
        if (bestGroup.skipIntIndex === 1) {
            intGroup.push(q.intermediate.splice(0, 1)[0], q.intermediate.splice(1, 1)[0]);
        } else {
            intGroup.push(...q.intermediate.splice(0, 2));
        }
        group = [advGroup[0], intGroup[0], advGroup[1], intGroup[1]];
    } else if (bestGroup.type === 'mixed_int_beg') {
        const intGroup = [];
        if (bestGroup.skipIntIndex === 1) {
            intGroup.push(q.intermediate.splice(0, 1)[0], q.intermediate.splice(1, 1)[0]);
        } else {
            intGroup.push(...q.intermediate.splice(0, 2));
        }

        const begGroup = [];
        if (bestGroup.skipBegIndex === 1) {
            begGroup.push(q.beginner.splice(0, 1)[0], q.beginner.splice(1, 1)[0]);
        } else {
            begGroup.push(...q.beginner.splice(0, 2));
        }
        group = [intGroup[0], begGroup[0], intGroup[1], begGroup[1]];
    }
    return balanceGroupByGender(group, bestGroup.type);
}

function balanceGroupByGender(group, type) {
    if (group.length !== 4) return group;
    if (type.startsWith('manual')) return group;

    let m = [];
    let f = [];

    group.forEach(p => {
        if (p.gender === 'M') m.push(p);
        else if (p.gender === 'F') f.push(p);
    });

    if (m.length === 2 && f.length === 2) {
        if (type === 'single') {
            return [m[0], f[0], m[1], f[1]];
        } else if (type === 'mixed' || type === 'mixed_int_beg') {
            let high = [group[0], group[2]];
            let low = [group[1], group[3]];

            let highM = high.filter(p => p.gender === 'M');
            let highF = high.filter(p => p.gender === 'F');
            let lowM = low.filter(p => p.gender === 'M');
            let lowF = low.filter(p => p.gender === 'F');

            if (highM.length === 1 && highF.length === 1 && lowM.length === 1 && lowF.length === 1) {
                return [highM[0], lowF[0], highF[0], lowM[0]];
            } else if (highM.length === 2 && lowF.length === 2) {
                return [highM[0], lowF[0], highM[1], lowF[1]];
            } else if (highF.length === 2 && lowM.length === 2) {
                return [highF[0], lowM[0], highF[1], lowM[1]];
            }
        }
    }
    return group;
}

// Check if we can form a group of 4 and assign to a court
function checkQueuesAndAssign() {
    if (!isOpenPlayActive) return;

    const emptyCourts = courts.filter(c => c.players === null);

    if (emptyCourts.length === 0) {
        updateNextMatchups();
        return;
    }

    for (let emptyCourt of emptyCourts) {
        const bestGroup = getBestGroupType(queues);
        if (!bestGroup) break;

        const group = pullGroup(queues, bestGroup);
        const courtIndex = courts.findIndex(c => c.id == emptyCourt.id);
        if (courtIndex !== -1) {
            courts[courtIndex].players = group;
            courts[courtIndex].matchType = bestGroup.type;
            courts[courtIndex].startedAt = Date.now();
        }

        renderQueues();
        renderCourts();
    }
    updateNextMatchups();
}

function updateNextMatchups() {
    // Deep clone the queues
    let tempQueues = JSON.parse(JSON.stringify(queues));

    let matchups = [];
    for (let i = 0; i < 5; i++) {
        const bestGroup = getBestGroupType(tempQueues);
        if (!bestGroup) break;
        const group = pullGroup(tempQueues, bestGroup);
        matchups.push(group);
    }

    renderNextMatchups(matchups);
}

// Free up a court
function freeCourt(courtId) {
    const courtIndex = courts.findIndex(c => c.id == courtId);
    if (courtIndex !== -1) {
        const court = courts[courtIndex];
        const players = court.players;
        if (players) {
            const playerIds = players.map(p => p.id).sort().join(',');
            players.forEach(p => {
                p.queuedAt = Date.now();
                p.lastGameGroupIds = playerIds;
                if (queues[p.skill]) {
                    queues[p.skill].push(p);
                }
            });
        }

        if (court.isLastGame) {
            courts.splice(courtIndex, 1);
            if (courtCountInput) courtCountInput.value = courts.length;
        } else {
            court.players = null;
        }

        renderQueues();
        renderCourts();
        checkQueuesAndAssign();
        syncToFirebase();
    }
}

function toggleLastGame(courtId) {
    const courtIndex = courts.findIndex(c => c.id == courtId);
    if (courtIndex !== -1) {
        courts[courtIndex].isLastGame = !courts[courtIndex].isLastGame;
        renderCourts();
        syncToFirebase();
    }
}

function removeEmptyCourt(courtId) {
    const courtIndex = courts.findIndex(c => c.id == courtId);
    if (courtIndex !== -1 && courts[courtIndex].players === null) {
        courts.splice(courtIndex, 1);
        if (courtCountInput) courtCountInput.value = courts.length;
        renderCourts();
        syncToFirebase();
    }
}

function editCourtNumber(oldId) {
    const newId = prompt(`Enter new name/number for Court ${oldId}:`, oldId);
    if (newId !== null && newId.trim() !== '') {
        const courtIndex = courts.findIndex(c => c.id == oldId);
        if (courtIndex !== -1) {
            courts[courtIndex].id = newId.trim();
            renderCourts();
            syncToFirebase();
        }
    }
}

// Audio Logic
function playChime() {
    if (!audioCtx) {
        try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            return;
        }
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }

    // Play a pleasant "Ding-Dong" sound
    const osc1 = audioCtx.createOscillator();
    const osc2 = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    osc1.type = 'sine';
    osc2.type = 'sine';

    osc1.frequency.setValueAtTime(523.25, audioCtx.currentTime); // C5
    osc2.frequency.setValueAtTime(415.30, audioCtx.currentTime + 0.15); // G#4

    gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.5, audioCtx.currentTime + 0.05);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 1);

    osc1.connect(gainNode);
    osc2.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    osc1.start(audioCtx.currentTime);
    osc1.stop(audioCtx.currentTime + 0.15);

    osc2.start(audioCtx.currentTime + 0.15);
    osc2.stop(audioCtx.currentTime + 1);
}

// Ensure audio context can start on first click
document.body.addEventListener('click', () => {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
}, { once: true });


// Modal Logic
function injectPlayerProfileModal() {
    if (document.getElementById('playerProfileModal')) return;
    const modalHTML = `
    <!-- Player Profile Modal -->
    <div id="playerProfileModal" class="side-menu-overlay" style="display: none; align-items: center; justify-content: center; opacity: 1; pointer-events: auto; z-index: 10000; transition: opacity 0.3s ease;">
        <div class="glass-panel player-profile-content" style="width: 90%; max-width: 400px; padding: 2.5rem; position: relative; background: var(--bg-color); text-align: center; transform: scale(0.9); transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); overflow: hidden;">
            <div id="profileBanner" class="profile-banner"></div>
            <button class="icon-btn" onclick="closePlayerProfile()" style="position: absolute; top: 15px; right: 15px; font-size: 1.5rem; line-height: 1; z-index: 10;">&times;</button>
            <div style="margin: 0 auto 1.5rem auto; display: flex; justify-content: center; align-items: center; width: 100px; height: 100px; position: relative; z-index: 1;">
                <div id="profileAvatarContainer" style="transform: scale(3.5); transform-origin: center;"></div>
            </div>
            <h2 id="profileName" style="margin-bottom: 0.5rem; font-size: 1.8rem; text-shadow: 0 2px 4px rgba(0,0,0,0.3); position: relative; z-index: 1; transition: color 0.3s;">Player Name</h2>
            <div style="display: flex; align-items: center; justify-content: center; gap: 0.5rem; margin-bottom: 1.5rem; position: relative; z-index: 1;">
                <div id="profileBadge" class="rank-badge" style="width: 24px; height: 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.4);"></div>
                <div id="profileRankText" style="font-size: 1rem; color: var(--glass-text); text-transform: uppercase; letter-spacing: 1px; font-weight: 700;">Rank</div>
            </div>
            
            <div style="display: flex; justify-content: space-around; background: rgba(0,0,0,0.15); border-radius: 16px; padding: 1.5rem; border: 1px inset rgba(255,255,255,0.05); position: relative; z-index: 1;">
                <div style="display: flex; flex-direction: column;">
                    <span style="font-size: 0.8rem; color: #94a3b8; text-transform: uppercase; font-weight: 600;">Win Rate</span>
                    <span id="profileWinRate" style="font-size: 1.5rem; font-weight: 800; color: #4ade80;">--%</span>
                </div>
                <div style="display: flex; flex-direction: column;">
                    <span style="font-size: 0.8rem; color: #94a3b8; text-transform: uppercase; font-weight: 600;">Matches</span>
                    <span id="profileMatches" style="font-size: 1.5rem; font-weight: 800;">0</span>
                </div>
                <div style="display: flex; flex-direction: column;">
                    <span style="font-size: 0.8rem; color: #94a3b8; text-transform: uppercase; font-weight: 600;">MMR</span>
                    <span id="profileMmr" style="font-size: 1.5rem; font-weight: 800; color: #3b82f6;">1000</span>
                </div>
            </div>
            
            <div id="profileMatchHistoryContainer" style="margin-top: 1.5rem; text-align: left; position: relative; z-index: 1;">
                <h4 style="font-size: 0.9rem; color: #a1a1aa; margin-bottom: 0.5rem; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 0.25rem;">Match History</h4>
                <div id="profileMatchHistoryList" style="max-height: 150px; overflow-y: auto; display: flex; flex-direction: column; gap: 0.5rem; padding-right: 0.5rem;">
                    <p style="font-size: 0.8rem; color: #71717a; text-align: center; margin-top: 1rem;">No recent matches</p>
                </div>
            </div>
        </div>
    </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);
}

window.showPlayerProfile = function (playerId) {
    const player = allPlayers[playerId];
    if (!player) return;

    injectPlayerProfileModal();

    const matches = player.matchesPlayed || 0;
    const wins = player.wins || 0;
    const winRate = matches > 0 ? Math.round((wins / matches) * 100) : 0;
    const mmr = Math.round(player.mmr || 1000);
    const badge = window.getRankBadge ? window.getRankBadge(player) : { name: 'Bronze', class: 'rank-bronze' };

    const nameEl = document.getElementById('profileName');
    nameEl.textContent = player.name;
    nameEl.className = player.equippedNameDesign || '';
    nameEl.setAttribute('data-text', player.name);

    const bannerEl = document.getElementById('profileBanner');
    if (bannerEl) bannerEl.className = 'profile-banner ' + (player.equippedBanner || '');
    document.getElementById('profileRankText').textContent = badge.name + " (" + player.skill + ")";
    document.getElementById('profileAvatarContainer').innerHTML = window.renderAvatar ? renderAvatar(player) : '';

    const badgeEl = document.getElementById('profileBadge');
    badgeEl.className = 'rank-badge ' + badge.class;
    if (badge.division) {
        badgeEl.setAttribute('data-division', badge.division);
    } else {
        badgeEl.removeAttribute('data-division');
    }

    document.getElementById('profileWinRate').textContent = matches > 0 ? winRate + '%' : '--%';
    document.getElementById('profileMatches').textContent = matches;
    document.getElementById('profileMmr').textContent = matches < 10 ? 'TBD' : mmr;

    const historyList = document.getElementById('profileMatchHistoryList');
    if (historyList) {
        if (!player.matchHistory || player.matchHistory.length === 0) {
            historyList.innerHTML = '<p style="font-size: 0.8rem; color: #71717a; text-align: center; margin-top: 1rem;">No recent matches</p>';
        } else {
            historyList.innerHTML = player.matchHistory.map(m => {
                const dateStr = new Date(m.date).toLocaleDateString();
                const color = m.result === 'WIN' ? '#4ade80' : (m.result === 'LOSS' ? '#ef4444' : '#a1a1aa');
                const sign = m.mmrChange >= 0 ? '+' : '';
                const changeDisplay = matches < 10 ? '?' : (sign + m.mmrChange);
                return `
                    <div style="background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.05); border-radius: 8px; padding: 0.5rem 0.75rem; display: flex; justify-content: space-between; align-items: center;">
                        <div style="display: flex; flex-direction: column;">
                            <span style="font-size: 0.75rem; color: ${color}; font-weight: 700;">${m.result}</span>
                            <span style="font-size: 0.65rem; color: #71717a;">${dateStr}</span>
                        </div>
                        <div style="display: flex; flex-direction: column; align-items: center; max-width: 50%;">
                            <span style="font-size: 0.7rem; color: #a1a1aa; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;">vs ${(Array.isArray(m.opponents) ? m.opponents : Object.values(m.opponents || {})).join(', ')}</span>
                            <span style="font-size: 0.65rem; color: #71717a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;">w/ ${m.teammate}</span>
                        </div>
                        <span style="font-size: 0.85rem; font-weight: 700; color: ${color};">${changeDisplay}</span>
                    </div>
                `;
            }).join('');
        }
    }

    const modal = document.getElementById('playerProfileModal');
    modal.style.display = 'flex';
    // Trigger animation
    setTimeout(() => {
        modal.querySelector('.player-profile-content').style.transform = 'scale(1)';
    }, 10);
};

window.closePlayerProfile = function () {
    const modal = document.getElementById('playerProfileModal');
    if (modal) {
        modal.querySelector('.player-profile-content').style.transform = 'scale(0.9)';
        setTimeout(() => {
            modal.style.display = 'none';
        }, 300);
    }
};

// Render logic
function renderNextMatchups(matchups) {
    if (!nextMatchupsContainer) return;
    nextMatchupsContainer.innerHTML = '';

    if (matchups.length === 0) {
        nextMatchupsContainer.innerHTML = '<div style="color: #64748b; font-size: 0.9rem; text-align: center; margin-top: 1rem; padding-bottom: 1rem;">Not enough players for a match</div>';
        return;
    }

    matchups.forEach((group, index) => {
        const row = document.createElement('div');
        row.className = 'matchup-row';

        const pIds = JSON.stringify(group.map(p => p.id));

        row.innerHTML = `
            <div class="matchup-number">#${index + 1}</div>
            <div class="matchup-teams">
                <div class="matchup-team">
                    <div class="matchup-player ${group[0].skill}">${window.renderClickableName(group[0])}${group[0].gender === 'M' ? ' ♂️' : group[0].gender === 'F' ? ' ♀️' : ''}${group[0].isHost ? ' <span title="Host">&#x1F3C5;</span>' : ''}</div>
                    <div class="matchup-player ${group[1].skill}">${window.renderClickableName(group[1])}${group[1].gender === 'M' ? ' ♂️' : group[1].gender === 'F' ? ' ♀️' : ''}${group[1].isHost ? ' <span title="Host">&#x1F3C5;</span>' : ''}</div>
                </div>
                <div class="matchup-vs">VS</div>
                <div class="matchup-team">
                    <div class="matchup-player ${group[2].skill}">${window.renderClickableName(group[2])}${group[2].gender === 'M' ? ' ♂️' : group[2].gender === 'F' ? ' ♀️' : ''}${group[2].isHost ? ' <span title="Host">&#x1F3C5;</span>' : ''}</div>
                    <div class="matchup-player ${group[3].skill}">${window.renderClickableName(group[3])}${group[3].gender === 'M' ? ' ♂️' : group[3].gender === 'F' ? ' ♀️' : ''}${group[3].isHost ? ' <span title="Host">&#x1F3C5;</span>' : ''}</div>
                </div>
            </div>
        `;

        nextMatchupsContainer.appendChild(row);
    });
}

function renderQueues() {
    renderManualPlayerList();
    renderManualStack(document.getElementById('stack-manual'), queues.manual, 'manual');
    renderStack(document.getElementById('stack-beginner'), queues.beginner, 'beginner');
    renderStack(document.getElementById('stack-intermediate'), queues.intermediate, 'intermediate');
    renderStack(document.getElementById('stack-advanced'), queues.advanced, 'advanced');
    renderStandbyStack(document.getElementById('stack-standby'), queues.standby);
    syncToFirebase();
}


function renderManualPlayerList() {
    const container = document.getElementById('manualPlayerList');
    if (!container) return;

    container.innerHTML = '';

    let allSoloPlayers = [];
    ['beginner', 'intermediate', 'advanced', 'standby'].forEach(qName => {
        queues[qName].forEach(item => {
            if (!item.isGroup) {
                allSoloPlayers.push({ ...item, currentQueue: qName });
            }
        });
    });

    if (allSoloPlayers.length === 0) {
        container.innerHTML = '<div style="color: #64748b; font-size: 0.9rem;">No solo players available.</div>';
        return;
    }

    allSoloPlayers.forEach(p => {
        const label = document.createElement('label');
        label.className = 'manual-player-item';
        label.innerHTML = `
            <input type="checkbox" value="${p.id}" data-queue="${p.currentQueue}">
            <span class="name">${p.name}${p.isHost ? ' <span title="Host">&#x1F3C5;</span>' : ''}</span>
            <span class="skill ${p.skill}">${p.skill}</span>
        `;
        container.appendChild(label);
    });
}

function renderStandbyStack(container, queue) {
    if (!container) return;
    container.innerHTML = '';

    if (queue.length === 0) {
        container.innerHTML = '<div style="color: #64748b; font-size: 0.9rem; margin-top: 0.5rem;">No players on standby</div>';
        return;
    }

    queue.forEach((item, index) => {
        if (item.isGroup) {
            renderSingleManualPaddle(container, item, index, 'standby');
        } else {
            renderSinglePaddle(container, item, index, 'standby');
        }
    });
}

function renderManualStack(container, queue, queueName) {
    if (!container) return;
    container.innerHTML = '';

    if (queue.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                    <circle cx="9" cy="7" r="4"></circle>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                </svg>
                No groups waiting
            </div>`;
        return;
    }

    queue.forEach((group, index) => {
        renderSingleManualPaddle(container, group, index, queueName);
    });
}

function renderSingleManualPaddle(container, group, index, queueName) {
    const paddleEl = document.createElement('div');
    paddleEl.className = `paddle manual animate-entry`;

    let namesHtml = group.players.map(p => {
        const initials = getInitials(p.name);
        const avatar = `<div class="avatar ${p.skill}" style="width: 20px; height: 20px; font-size: 0.5rem; margin-right: 4px;">${initials}</div>`;
        const streakHtml = (allPlayers[p.id] && allPlayers[p.id].currentStreak >= 3) ? ' 🔥' : '';
        return `<div class="player-name-wrapper">${avatar}${window.renderClickableName(p)}${p.gender === 'M' ? ' ♂️' : p.gender === 'F' ? ' ♀️' : ''}${p.isHost ? ' <span title="Host">&#x1F3C5;</span>' : ''}${streakHtml}</div>`;
    }).join('');

    paddleEl.innerHTML = `
        <div style="display: flex; flex-direction: column; padding-right: 90px; gap: 4px;">
            <span class="player-name" style="font-size: 0.8rem; line-height: 1.2;">${namesHtml}</span>
        </div>
        <span class="paddle-number">#${index + 1}</span>
        ${isAdmin ? `
        <div class="paddle-actions">
            <button class="icon-btn standby-btn" onclick="moveToStandby('${queueName}', '${group.id}')" title="Move to Standby">⏸️</button>
            <button class="icon-btn remove-btn" onclick="removeFromSystem('${queueName}', '${group.id}')" title="Remove">❌</button>
        </div>
        ` : ''}
    `;

    container.appendChild(paddleEl);
}

function renderStack(container, queue, skillClass) {
    if (!container) return;
    container.innerHTML = '';

    if (queue.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                    <circle cx="12" cy="7" r="4"></circle>
                </svg>
                No players waiting
            </div>`;
        return;
    }

    queue.forEach((player, index) => {
        renderSinglePaddle(container, player, index, skillClass);
    });
}

function renderSinglePaddle(container, player, index, skillClass) {
    const paddleEl = document.createElement('div');
    paddleEl.className = `paddle ${player.skill} animate-entry`;

    const streakHtml = (allPlayers[player.id] && allPlayers[player.id].currentStreak >= 3) ? ' <span title="On a Win Streak!">🔥</span>' : '';
    paddleEl.innerHTML = `
        <span class="player-name player-name-wrapper" style="padding-right: 90px;">
            ${renderAvatar(player)}
            ${window.renderClickableName(player)}${player.gender === 'M' ? ' ♂️' : player.gender === 'F' ? ' ♀️' : ''}${player.isHost ? ' <span title="Host">&#x1F3C5;</span>' : ''}${streakHtml}
        </span>
        <span class="paddle-number">#${index + 1}</span>
        ${isAdmin ? `
        <div class="paddle-actions">
            ${skillClass === 'standby' ?
                `<button class="icon-btn rejoin-btn" onclick="rejoinQueue('${player.id}')" title="Rejoin Queue">▶️</button>` :
                `<button class="icon-btn standby-btn" onclick="moveToStandby('${skillClass}', '${player.id}')" title="Move to Standby">⏸️</button>`
            }
            <button class="icon-btn remove-btn" onclick="removeFromSystem('${skillClass}', '${player.id}')" title="Remove">❌</button>
        </div>
        ` : ''}
    `;

    container.appendChild(paddleEl);
}

function moveToStandby(queueName, id) {
    const queue = queues[queueName];
    if (!queue) return;

    const index = queue.findIndex(item => item.id == id);
    if (index !== -1) {
        const item = queue.splice(index, 1)[0];
        item.originalQueue = queueName;
        queues.standby.push(item);
        renderQueues();
    }
}

function removeFromSystem(queueName, id) {
    const queue = queues[queueName];
    if (!queue) return;

    const index = queue.findIndex(item => item.id == id);
    if (index !== -1) {
        queue.splice(index, 1);
        renderQueues();
    }
}

function rejoinQueue(id) {
    const index = queues.standby.findIndex(item => item.id == id);
    if (index !== -1) {
        const item = queues.standby.splice(index, 1)[0];

        // Reset wait time as requested
        item.queuedAt = Date.now();
        if (item.isGroup) {
            item.players.forEach(p => p.queuedAt = Date.now());
        }

        const targetQueue = item.originalQueue || (item.isGroup ? 'manual' : item.skill);
        queues[targetQueue].push(item);

        renderQueues();
        checkQueuesAndAssign();
    }
}

function renderCourts() {
    if (!courtsContainer) return;
    courtsContainer.innerHTML = '';

    let needsSync = false;
    courts.forEach(court => {
        if (court.players !== null && !court.startedAt) {
            court.startedAt = Date.now();
            needsSync = true;
        }

        const courtEl = document.createElement('div');
        courtEl.className = 'court';

        const isPlaying = court.players !== null;
        const statusClass = isPlaying ? 'status-playing' : 'status-empty';
        const statusHTML = isPlaying ? `PLAYING <span class="court-timer" data-start="${court.startedAt}">00:00</span>` : 'OPEN';

        let playersHTML = `
            <div class="empty-state" style="padding: 1rem 0;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="3" y1="12" x2="21" y2="12"></line>
                </svg>
                Waiting for players...
            </div>`;

        if (isPlaying) {
            const p = court.players;
            const getStreakHtml = (id) => (allPlayers[id] && allPlayers[id].currentStreak >= 3) ? ' <span title="On a Win Streak!">🔥</span>' : '';
            playersHTML = `
                <div class="team-label">Team 1</div>
                <div class="court-player ${p[0].skill}">
                    <span class="player-name-wrapper">${renderAvatar(p[0])}${window.renderClickableName(p[0])}${p[0].isHost ? ' <span title="Host">&#x1F3C5;</span>' : ''}${getStreakHtml(p[0].id)}</span>
                    <span style="font-size: 0.8em; opacity: 0.7; text-transform: capitalize;">${p[0].skill}</span>
                </div>
                <div class="court-player ${p[1].skill}">
                    <span class="player-name-wrapper">${renderAvatar(p[1])}${window.renderClickableName(p[1])}${p[1].isHost ? ' <span title="Host">&#x1F3C5;</span>' : ''}${getStreakHtml(p[1].id)}</span>
                    <span style="font-size: 0.8em; opacity: 0.7; text-transform: capitalize;">${p[1].skill}</span>
                </div>
                <div class="vs-divider glow-vs">VS</div>
                <div class="team-label">Team 2</div>
                <div class="court-player ${p[2].skill}">
                    <span class="player-name-wrapper">${renderAvatar(p[2])}${window.renderClickableName(p[2])}${p[2].isHost ? ' <span title="Host">&#x1F3C5;</span>' : ''}${getStreakHtml(p[2].id)}</span>
                    <span style="font-size: 0.8em; opacity: 0.7; text-transform: capitalize;">${p[2].skill}</span>
                </div>
                <div class="court-player ${p[3].skill}">
                    <span class="player-name-wrapper">${renderAvatar(p[3])}${window.renderClickableName(p[3])}${p[3].isHost ? ' <span title="Host">&#x1F3C5;</span>' : ''}${getStreakHtml(p[3].id)}</span>
                    <span style="font-size: 0.8em; opacity: 0.7; text-transform: capitalize;">${p[3].skill}</span>
                </div>
            `;
        }

        let actionButtons = '';
        if (isAdmin) {
            if (isPlaying) {
                actionButtons = `
                    <div style="display: flex; gap: 0.5rem; margin-top: 1rem; flex-wrap: wrap;">
                        <button class="win-btn team1" onclick="endGameWithResult('${court.id}', 1)" style="flex: 1;">T1 Won</button>
                        <button class="win-btn team2" onclick="endGameWithResult('${court.id}', 2)" style="flex: 1;">T2 Won</button>
                        <button class="last-game-btn ${court.isLastGame ? 'active' : ''}" style="flex: 1; min-width: 100%; margin-top: 0.2rem;" onclick="toggleLastGame('${court.id}')" title="Mark as last game. Court will be removed after game ends.">
                            ${court.isLastGame ? 'Cancel Last' : 'Last Game'}
                        </button>
                    </div>
                `;
            } else {
                actionButtons = `
                    <button class="remove-court-btn" onclick="removeEmptyCourt('${court.id}')">
                        <span style="font-size: 1.1em;">&#10006;</span> Remove Court
                    </button>
                `;
            }
        }

        const courtTitleHTML = isAdmin
            ? `<span class="court-title" onclick="editCourtNumber('${court.id}')" style="cursor: pointer;" title="Click to rename court">Court ${court.id} <span style="font-size:0.8em; opacity:0.5;">&#x270F;&#xFE0F;</span></span>`
            : `<span class="court-title">Court ${court.id}</span>`;

        courtEl.innerHTML = `
            <div class="court-header">
                <h3>Court ${court.id} ${court.isLastGame ? '<span style="color: #ef4444; font-size: 0.8rem; margin-left: 0.5rem;">(Last Game)</span>' : ''}</h3>
                <span class="court-status ${statusClass}">${statusHTML}</span>
            </div>
            <div class="court-players">
                ${playersHTML}
            </div>
            ${actionButtons}
        `;

        courtsContainer.appendChild(courtEl);
    });

    if (needsSync && isAdmin) {
        syncToFirebase();
    }
}


// ----------------------------------------------------
// MVP Leaderboard & Result Logic
// ----------------------------------------------------

function recordHeadToHead(playerId, opponentId, won) {
    if (!playerId || !opponentId) return;
    if (!allPlayers[playerId] || allPlayers[playerId].isHost) return;

    if (!allPlayers[playerId].headToHead) {
        allPlayers[playerId].headToHead = {};
    }

    if (!allPlayers[playerId].headToHead[opponentId]) {
        allPlayers[playerId].headToHead[opponentId] = { matches: 0, wins: 0 };
    }

    allPlayers[playerId].headToHead[opponentId].matches++;
    if (won) {
        allPlayers[playerId].headToHead[opponentId].wins++;
    }
}

// --- Glicko-1 Math Helpers ---
const GLICKO_Q = Math.log(10) / 400;

function getGlickoG(rd) {
    return 1 / Math.sqrt(1 + 3 * Math.pow(GLICKO_Q * rd, 2) / Math.pow(Math.PI, 2));
}

function getGlickoE(rating, oppRating, oppRD) {
    const g = getGlickoG(oppRD);
    return 1 / (1 + Math.pow(10, -g * (rating - oppRating) / 400));
}

function getGlickoD2(rating, oppRating, oppRD) {
    const g = getGlickoG(oppRD);
    const E = getGlickoE(rating, oppRating, oppRD);
    return 1 / (Math.pow(GLICKO_Q, 2) * Math.pow(g, 2) * E * (1 - E));
}

function updateGlicko(rating, rd, oppRating, oppRD, actualScore, skill = 'intermediate') {
    // 1. Calculate Expected Win Probability (0.0 to 1.0)
    // Standard logistic curve, using 400 as the scaling factor.
    const E = 1 / (1 + Math.pow(10, (oppRating - rating) / 400));
    
    // 2. Rank Confidence (RD) Multiplier
    // Scales MMR adjustments based on Rank Confidence (like Dota 2).
    // Minimum RD = 95 (stable rating, ~25 MMR per game)
    // Maximum RD = 250 (calibration, ~60-70 MMR per game)
    // Map RD linearly to a K-factor between 50 and 150.
    const normalizedRD = Math.max(0, Math.min(1, (rd - 95) / (250 - 95)));
    let K = 50 + (100 * normalizedRD); // K ranges from 50 (stable) to 150 (calibration)
    
    // 3. Skill Level Modifier (Balanced Progression)
    // Beginners gain/lose MMR faster to quickly find their true rank.
    // Advanced players have more stable ratings, preventing massive swings at the top.
    if (skill === 'beginner') {
        K *= 1.25; // 25% more volatile
    } else if (skill === 'advanced') {
        K *= 0.75; // 25% less volatile
    }
    
    // 4. Match Result & Underdog Multiplier
    // actualScore is 1 for win, 0 for loss.
    // If you are underdog (rating < oppRating), E is < 0.5.
    // Winning gives K * (1 - E), which is a larger boost!
    const mmrChange = K * (actualScore - E);
    const newRating = rating + mmrChange;
    
    // 5. Update Rank Confidence (RD)
    // RD decreases as you play more matches, representing increased confidence.
    // We decrease it by 5 per match until it hits the floor of 95.
    const newRD = Math.max(95, rd - 5);
    
    return { rating: newRating, rd: newRD };
}

function migratePlayerToGlicko(player) {
    if (typeof player.rating === 'undefined') {
        let startingRating = 1500;
        if (player.skill === 'beginner') startingRating = 1000;
        else if (player.skill === 'advanced') startingRating = 1800;
        
        player.rating = player.mmr || startingRating;
        // Start RD at 250 for calibration, reducing down to 95 over time
        player.rd = Math.max(95, 250 - (player.matchesPlayed || 0) * 5);
    }
}

function endGameWithResult(courtId, result) {
    const court = courts.find(c => c.id == courtId);
    if (!court || !court.players) return;

    const p = court.players;
    const res = parseInt(result, 10);

    // Check if it was a manual match
    const isManualMatch = court.matchType && court.matchType.startsWith('manual');

    // Record match history
    if (res === 1 || res === 2) {
        const matchObj = {
            id: Date.now().toString(),
            courtId: courtId,
            timestamp: Date.now(),
            winningTeam: res,
            isManual: !!isManualMatch,
            team1: [p[0], p[1]].filter(Boolean).map(x => ({ id: x.id, name: x.name, skill: x.skill })),
            team2: [p[2], p[3]].filter(Boolean).map(x => ({ id: x.id, name: x.name, skill: x.skill }))
        };
        recentMatches.unshift(matchObj);
        if (recentMatches.length > 5) recentMatches.pop();
    }

    // Determine if a specific player index is eligible for stat updates
    const getIsEligible = (idx) => {
        // Manual group of 4 does not get MMR/Stats
        if (court.matchType === 'manual_4') return false; 
        
        // Manual groups of 2 (manual_2_manual_2 and manual_2_solo), single, and mixed all get MMR/Stats
        return true; 
    };

    // Increment matches played for all eligible players
    p.forEach((player, idx) => {
        if (getIsEligible(idx) && player && player.id && allPlayers[player.id]) {
            if (!allPlayers[player.id].isHost) {
                allPlayers[player.id].matchesPlayed++;
                allPlayers[player.id].sessionMatchesPlayed = (allPlayers[player.id].sessionMatchesPlayed || 0) + 1;
                allPlayers[player.id].tokens = (allPlayers[player.id].tokens || 0) + 10;
            }
        }
    });

    // Increment wins for the winning team and track streaks
    if (res === 1) {
        if (getIsEligible(0) && p[0] && allPlayers[p[0].id] && !allPlayers[p[0].id].isHost) {
            allPlayers[p[0].id].wins++;
            allPlayers[p[0].id].sessionWins = (allPlayers[p[0].id].sessionWins || 0) + 1;
            allPlayers[p[0].id].currentStreak = (allPlayers[p[0].id].currentStreak || 0) + 1;
            allPlayers[p[0].id].tokens = (allPlayers[p[0].id].tokens || 0) + 20;
        }
        if (getIsEligible(1) && p[1] && allPlayers[p[1].id] && !allPlayers[p[1].id].isHost) {
            allPlayers[p[1].id].wins++;
            allPlayers[p[1].id].sessionWins = (allPlayers[p[1].id].sessionWins || 0) + 1;
            allPlayers[p[1].id].currentStreak = (allPlayers[p[1].id].currentStreak || 0) + 1;
            allPlayers[p[1].id].tokens = (allPlayers[p[1].id].tokens || 0) + 20;
        }
        if (getIsEligible(2) && p[2] && allPlayers[p[2].id] && !allPlayers[p[2].id].isHost) allPlayers[p[2].id].currentStreak = 0;
        if (getIsEligible(3) && p[3] && allPlayers[p[3].id] && !allPlayers[p[3].id].isHost) allPlayers[p[3].id].currentStreak = 0;
    } else if (res === 2) {
        if (getIsEligible(2) && p[2] && allPlayers[p[2].id] && !allPlayers[p[2].id].isHost) {
            allPlayers[p[2].id].wins++;
            allPlayers[p[2].id].sessionWins = (allPlayers[p[2].id].sessionWins || 0) + 1;
            allPlayers[p[2].id].currentStreak = (allPlayers[p[2].id].currentStreak || 0) + 1;
            allPlayers[p[2].id].tokens = (allPlayers[p[2].id].tokens || 0) + 20;
        }
        if (getIsEligible(3) && p[3] && allPlayers[p[3].id] && !allPlayers[p[3].id].isHost) {
            allPlayers[p[3].id].wins++;
            allPlayers[p[3].id].sessionWins = (allPlayers[p[3].id].sessionWins || 0) + 1;
            allPlayers[p[3].id].currentStreak = (allPlayers[p[3].id].currentStreak || 0) + 1;
            allPlayers[p[3].id].tokens = (allPlayers[p[3].id].tokens || 0) + 20;
        }
        if (getIsEligible(0) && p[0] && allPlayers[p[0].id] && !allPlayers[p[0].id].isHost) allPlayers[p[0].id].currentStreak = 0;
        if (getIsEligible(1) && p[1] && allPlayers[p[1].id] && !allPlayers[p[1].id].isHost) allPlayers[p[1].id].currentStreak = 0;
    }

    // Calculate Glicko Rating
    const preparePlayer = (pObj, idx) => {
        if (!pObj || !getIsEligible(idx)) return null;
        const player = allPlayers[pObj.id];
        if (!player || player.isHost) return null;
        migratePlayerToGlicko(player);
        return player;
    };

    let t1Players = [preparePlayer(p[0], 0), preparePlayer(p[1], 1)].filter(Boolean);
    let t2Players = [preparePlayer(p[2], 2), preparePlayer(p[3], 3)].filter(Boolean);

    if (t1Players.length > 0 && t2Players.length > 0) {
        const getComposite = (team) => {
            const sumRating = team.reduce((sum, pl) => sum + pl.rating, 0);
            const sumRD = team.reduce((sum, pl) => sum + pl.rd, 0);
            return { rating: sumRating / team.length, rd: sumRD / team.length };
        };

        const t1Composite = getComposite(t1Players);
        const t2Composite = getComposite(t2Players);

        let t1Score = res === 1 ? 1 : 0;
        let t2Score = res === 2 ? 1 : 0;

        const updateTeam = (team, isT1) => {
            team.forEach(player => {
                const oppComposite = isT1 ? t2Composite : t1Composite;
                const score = isT1 ? t1Score : t2Score;
                
                const originalRating = player.rating;
                const newGlicko = updateGlicko(player.rating, player.rd, oppComposite.rating, oppComposite.rd, score, player.skill);
                
                player.rating = newGlicko.rating;
                player.rd = newGlicko.rd;
                player.mmr = player.rating; // Keep backwards compatibility field if needed elsewhere
                
                // Auto-adjust skill based on current MMR
                if (player.rating < 1400) {
                    player.skill = 'beginner';
                } else if (player.rating < 1700) {
                    player.skill = 'intermediate';
                } else {
                    player.skill = 'advanced';
                }
                
                const mmrChange = Math.round(newGlicko.rating - originalRating);

                // Record Match History
                if (!player.matchHistory) player.matchHistory = [];
                
                const matchDate = new Date().toISOString();
                const isWin = score === 1;
                const isDraw = res === 0;
                
                let idx = p.findIndex(x => x && x.id === player.id);
                let teammateName = 'None';
                let opponentNames = [];
                if (idx !== -1) {
                    if (idx < 2) {
                        teammateName = (idx === 0) ? p[1]?.name : p[0]?.name;
                        opponentNames = [p[2]?.name, p[3]?.name].filter(Boolean);
                    } else {
                        teammateName = (idx === 2) ? p[3]?.name : p[2]?.name;
                        opponentNames = [p[0]?.name, p[1]?.name].filter(Boolean);
                    }
                }
                
                player.matchHistory.unshift({
                    date: matchDate,
                    result: isDraw ? 'DRAW' : (isWin ? 'WIN' : 'LOSS'),
                    mmrChange: mmrChange,
                    teammate: teammateName || 'None',
                    opponents: opponentNames
                });
                
                if (player.matchHistory.length > 10) player.matchHistory.pop();
            });
        };

        updateTeam(t1Players, true);
        updateTeam(t2Players, false);
    }

    // Track Head-to-Head
    const team1Ids = [p[0], p[1]].filter(Boolean).map(x => x.id);
    const team2Ids = [p[2], p[3]].filter(Boolean).map(x => x.id);

    team1Ids.forEach(id1 => {
        team2Ids.forEach(id2 => {
            const idx1 = p.findIndex(x => x && x.id === id1);
            const idx2 = p.findIndex(x => x && x.id === id2);
            if (getIsEligible(idx1)) recordHeadToHead(id1, id2, res === 1);
            if (getIsEligible(idx2)) recordHeadToHead(id2, id1, res === 2);
        });
    });

    // Re-render leaderboard
    renderLeaderboard();
    if (typeof renderRankings === 'function') {
        renderRankings(); // If we are on ranking.html
    }

    // Complete the standard end game logic
    freeCourt(courtId);
}

window.getRankBadge = function (player) {
    if (!player) return { name: 'Bronze I', baseName: 'Bronze', class: 'rank-bronze', division: 1 };
    const matches = player.matchesPlayed || 0;
    if (matches < 10) {
        return { name: `Unranked (${matches}/10)`, baseName: 'Unranked', class: 'rank-unranked', division: 0 };
    }

    let mmr = typeof player.rating !== 'undefined' ? player.rating : (player.mmr || 1500);
    
    function getDivision(baseMmr, currentMmr) {
        const diff = Math.max(0, currentMmr - baseMmr);
        const div = Math.floor(diff / 30) + 1;
        return div > 5 ? 5 : div;
    }
    
    const numerals = ['I', 'II', 'III', 'IV', 'V'];
    
    if (mmr < 1400) {
        let div = 1;
        if (mmr >= 1250) div = getDivision(1250, mmr);
        return { name: `Bronze ${numerals[div-1]}`, baseName: 'Bronze', class: 'rank-bronze', division: div };
    }
    if (mmr < 1550) {
        const div = getDivision(1400, mmr);
        return { name: `Silver ${numerals[div-1]}`, baseName: 'Silver', class: 'rank-silver', division: div };
    }
    if (mmr < 1700) {
        const div = getDivision(1550, mmr);
        return { name: `Gold ${numerals[div-1]}`, baseName: 'Gold', class: 'rank-gold', division: div };
    }
    if (mmr < 1850) {
        const div = getDivision(1700, mmr);
        return { name: `Platinum ${numerals[div-1]}`, baseName: 'Platinum', class: 'rank-platinum', division: div };
    }
    if (mmr < 2000) {
        const div = getDivision(1850, mmr);
        return { name: `Diamond ${numerals[div-1]}`, baseName: 'Diamond', class: 'rank-diamond', division: div };
    }
    return { name: 'Master', baseName: 'Master', class: 'rank-master', division: 0 };
};

window.updatePlayerRankBorders = function (player) {
    if (!player) return false;
    
    const badge = window.getRankBadge(player);
    let correctBorderId = null;
    
    if (player.matchesPlayed >= 10 && badge.baseName && badge.baseName !== 'Unranked') {
        correctBorderId = 'rank-border-' + badge.baseName.toLowerCase();
    }
    
    const allRankBorders = [
        'rank-border-bronze', 'rank-border-silver', 'rank-border-gold',
        'rank-border-platinum', 'rank-border-diamond', 'rank-border-master'
    ];
    
    if (!player.unlockedCosmetics) player.unlockedCosmetics = [];
    
    let modified = false;
    allRankBorders.forEach(borderId => {
        if (borderId === correctBorderId) {
            if (!player.unlockedCosmetics.includes(borderId)) {
                player.unlockedCosmetics.push(borderId);
                modified = true;
            }
        } else {
            const idx = player.unlockedCosmetics.indexOf(borderId);
            if (idx > -1) {
                player.unlockedCosmetics.splice(idx, 1);
                modified = true;
                
                if (player.equippedBorder === borderId) {
                    player.equippedBorder = 'none';
                }
            }
        }
    });
    
    return modified;
};

function renderLeaderboard() {
    const container = document.getElementById('mvpContainer');

    // Filter out players with 0 matches played
    const eligiblePlayers = Object.values(allPlayers).filter(p => (p.sessionMatchesPlayed || 0) > 0);

    if (eligiblePlayers.length === 0) {
        container.innerHTML = '<p style="text-align: center; opacity: 0.6; padding: 2rem 0;">No games completed yet.</p>';
        return;
    }

    // Helper for Wilson Score Interval (balances win % and number of games)
    function getWilsonScore(wins, n) {
        if (n === 0) return 0;
        const z = 1.96; // 95% confidence interval
        const p = wins / n;
        const denominator = 1 + z * z / n;
        const centreAdjustedProbability = p + z * z / (2 * n);
        const adjustedStandardDeviation = Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n);
        return (centreAdjustedProbability - z * adjustedStandardDeviation) / denominator;
    }

    // Sort by Wilson Score, then matches played
    eligiblePlayers.sort((a, b) => {
        const scoreA = getWilsonScore(a.sessionWins || 0, a.sessionMatchesPlayed || 0);
        const scoreB = getWilsonScore(b.sessionWins || 0, b.sessionMatchesPlayed || 0);
        if (scoreA !== scoreB) return scoreB - scoreA;
        return (b.sessionMatchesPlayed || 0) - (a.sessionMatchesPlayed || 0);
    });

    let html = '';
    // Display Top 10 MVPs
    const topLimit = Math.min(10, eligiblePlayers.length);
    for (let i = 0; i < topLimit; i++) {
        const player = eligiblePlayers[i];
        const playerMatches = player.sessionMatchesPlayed || 0;
        const playerWins = player.sessionWins || 0;
        const winRate = playerMatches > 0 ? Math.round((playerWins / playerMatches) * 100) : 0;

        const playerMmr = typeof player.mmr !== 'undefined' ? player.mmr : 1000;
        const badge = window.getRankBadge(player);

        let rankClass = '';
        if (i === 0) rankClass = 'top-1';
        else if (i === 1) rankClass = 'top-2';
        else if (i === 2) rankClass = 'top-3';

        const streakHtml = (player.currentStreak >= 3) ? ' <span title="On a Win Streak!">🔥</span>' : '';
        html += `
            <div class="mvp-row ${rankClass}">
                <div class="mvp-rank">#${i + 1}</div>
                <div class="mvp-name badge-wrapper">
                    <div class="rank-badge small ${badge.class}" title="${badge.name}" data-division="${badge.division || ''}"></div>
                    <div class="player-name-wrapper" style="margin-left: 8px;">
                        ${renderAvatar(player)}
                        ${renderClickableName(player)}${streakHtml}
                    </div>
                </div>
                <div class="mvp-stats">
                    <div class="mvp-winrate">${winRate}%</div>
                    <div style="font-size: 0.75rem; opacity: 0.6;">${playerWins}W - ${playerMatches - playerWins}L</div>
                </div>
            </div>
        `;
    }

    container.innerHTML = html;
}

// ==========================================
// App State Rendering
// ==========================================

function renderAppState() {
    const mainContent = document.querySelector('.main-content');
    let overlay = document.getElementById('openPlayOverlay');

    const startBtn = document.getElementById('startOpenPlayBtn');
    const endBtn = document.getElementById('endOpenPlayBtn');
    const isRankingPage = !!document.getElementById('rankingTable');

    if (isAdmin || isRankingPage) {
        if (mainContent) mainContent.style.display = '';
        if (overlay) overlay.style.display = 'none';

        if (isAdmin) {
            if (isOpenPlayActive) {
                if (startBtn) startBtn.style.display = 'none';
                if (endBtn) endBtn.style.display = 'block';
            } else {
                if (startBtn) startBtn.style.display = 'block';
                if (endBtn) endBtn.style.display = 'none';
            }
        }
    } else {
        if (!isOpenPlayActive) {
            if (mainContent) mainContent.style.display = 'none';

            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'openPlayOverlay';
                overlay.style.textAlign = 'center';
                overlay.style.padding = '4rem 2rem';

                overlay.innerHTML = `
                    <h2 style="color: #64748b; font-style: italic;">Open play hasn't started yet. Check back soon!</h2>
                `;
                const container = document.querySelector('.app-container');
                if (container) container.appendChild(overlay);
            } else {
                overlay.style.display = 'block';
            }
        } else {
            if (mainContent) mainContent.style.display = '';
            if (overlay) overlay.style.display = 'none';
        }
    }
}

window.startOpenPlay = function () {
    isOpenPlayActive = true;
    syncToFirebase();
    renderAppState();
    checkQueuesAndAssign();
}

window.endOpenPlay = function () {
    if (confirm("Are you sure you want to end Open Play? This will wipe all current queues and active courts. (Club Rankings will NOT be deleted).")) {
        isOpenPlayActive = false;
        queues = { beginner: [], intermediate: [], advanced: [], manual: [], standby: [] };
        courts = [];

        Object.values(allPlayers).forEach(p => {
            p.sessionMatchesPlayed = 0;
            p.sessionWins = 0;
            p.queuedAt = Date.now();
        });

        syncToFirebase();
        renderAppState();
        renderQueues();
        renderCourts();
        renderLeaderboard();
        updateNextMatchups();
    }
}

window.deletePlayerFromRankings = function (playerId) {
    if (confirm("Are you sure you want to permanently delete this player from the rankings? This cannot be undone.")) {
        // Remove from allPlayers
        if (allPlayers[playerId]) {
            delete allPlayers[playerId];
        }

        // Remove from headToHead records of all other players
        Object.values(allPlayers).forEach(p => {
            if (p.headToHead && p.headToHead[playerId]) {
                delete p.headToHead[playerId];
            }
        });

        syncToFirebase();
        if (typeof renderAdminDashboards === 'function') renderAdminDashboards();
        if (typeof renderPlayerManagement === 'function') renderPlayerManagement();
        if (typeof renderRankings === 'function') {
            renderRankings();
        }
        if (typeof renderMatchHistory === 'function') {
            renderMatchHistory();
        }
    }
}

window.renderMatchHistory = function () {
    const container = document.getElementById('matchHistoryContainer');
    if (!container) return;

    if (!recentMatches || recentMatches.length === 0) {
        container.innerHTML = '<p style="opacity: 0.6; text-align: center; padding: 2rem;">No matches played yet.</p>';
        return;
    }

    let html = '<div class="match-history-list" style="display: flex; flex-direction: column; gap: 1rem;">';

    recentMatches.forEach(match => {
        const timeStr = new Date(match.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        const t1Class = match.winningTeam === 1 ? 'winner' : 'loser';
        const t2Class = match.winningTeam === 2 ? 'winner' : 'loser';

        const renderTeam = (team, resultClass) => {
            const names = team.map(p => {
                const streakHtml = (allPlayers[p.id] && allPlayers[p.id].currentStreak >= 3) ? ' 🔥' : '';
                return `<div class="player-name-wrapper" style="display:inline-flex;">${renderAvatar(p)}${p.name}${streakHtml}</div>`;
            }).join(' &amp; ');
            const icon = resultClass === 'winner' ? '🏆' : '';
            const style = resultClass === 'winner' ? 'font-weight: 800; color: #10b981; display: flex; align-items: center; gap: 4px;' : 'opacity: 0.6; display: flex; align-items: center; gap: 4px;';
            return `<div class="team ${resultClass}" style="${style}">${names} ${icon}</div>`;
        };

        html += `
            <div class="match-card" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 1rem;">
                <div style="display: flex; justify-content: space-between; font-size: 0.8rem; opacity: 0.5; margin-bottom: 0.5rem; text-transform: uppercase;">
                    <span>Court ${match.courtId} ${match.isManual ? '(Manual)' : ''}</span>
                    <span>${timeStr}</span>
                </div>
                <div style="display: flex; flex-direction: column; gap: 0.5rem;">
                    ${renderTeam(match.team1, t1Class)}
                    <div style="font-size: 0.8rem; opacity: 0.4;">VS</div>
                    ${renderTeam(match.team2, t2Class)}
                </div>
            </div>
        `;
    });

    html += '</div>';
    container.innerHTML = html;
};

window.startNewSeason = function () {
    const seasonName = prompt('Enter a name for the current season to archive it (e.g., "Season 1"):');
    if (!seasonName) return;

    if (pastSeasons[seasonName]) {
        alert('A season with this name already exists! Choose a different name.');
        return;
    }

    if (confirm(`Are you sure you want to archive "${seasonName}" and reset all players' MMR and Wins? This cannot be undone.`)) {
        // Archive
        pastSeasons[seasonName] = JSON.parse(JSON.stringify(allPlayers));

        // Reset
        Object.keys(allPlayers).forEach(id => {
            allPlayers[id].mmr = 1000;
            allPlayers[id].wins = 0;
            allPlayers[id].matchesPlayed = 0;
            allPlayers[id].sessionWins = 0;
            allPlayers[id].sessionMatchesPlayed = 0;
            allPlayers[id].currentStreak = 0;
            allPlayers[id].headToHead = {};
        });

        recentMatches = []; // clear match history for the new season

        syncToFirebase();
        renderAppState();
        renderLeaderboard();
        if (typeof renderRankings === 'function') renderRankings();
        if (typeof renderMatchHistory === 'function') renderMatchHistory();
        if (typeof renderPlayerManagement === 'function') renderPlayerManagement();

        alert('Season successfully archived and stats reset!');
    }
};

// ==========================================
// Initialization
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    // Move modals out of main-content so they don't get hidden when Open Play is inactive
    const modalsToMove = ['loginModal', 'claimModal', 'myProfileModal'];
    modalsToMove.forEach(id => {
        const modal = document.getElementById(id);
        if (modal) document.body.appendChild(modal);
    });
    init();
});

// --- Auth UI and Logic ---

window.openClaimModal = function() {
    const select = document.getElementById('claimProfileSelect');
    if(select) {
        select.innerHTML = '<option value="" disabled selected>Select your profile...</option>';
        Object.values(allPlayers).forEach(p => {
            if(p && p.claimStatus !== 'claimed' && p.claimStatus !== 'pending') {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.name;
                select.appendChild(opt);
            }
        });
    }
    document.getElementById('claimModal').style.display = 'flex';
};

window.openLoginModal = function() {
    const select = document.getElementById('loginProfileSelect');
    if(select) {
        select.innerHTML = '<option value="" disabled selected>Select your profile...</option>';
        Object.values(allPlayers).forEach(p => {
            if(p && p.claimStatus === 'claimed') {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.name;
                select.appendChild(opt);
            }
        });
    }
    document.getElementById('loginModal').style.display = 'flex';
};

window.closeAuthModals = function() {
    if(document.getElementById('claimModal')) document.getElementById('claimModal').style.display = 'none';
    if(document.getElementById('loginModal')) document.getElementById('loginModal').style.display = 'none';
    if(document.getElementById('myProfileModal')) document.getElementById('myProfileModal').style.display = 'none';
};

window.submitClaim = function() {
    const select = document.getElementById('claimProfileSelect');
    const pin = document.getElementById('claimPin').value;
    if(!select.value || !pin) {
        showToast('Please select a profile and enter a password.', 'warning');
        return;
    }
    
    const playerId = select.value;
    allPlayers[playerId].claimStatus = 'pending';
    allPlayers[playerId].pin = pin;
    
    pendingClaims[playerId] = {
        playerId: playerId,
        name: allPlayers[playerId].name,
        timestamp: Date.now()
    };
    
    // Use an explicit set to Firebase to bypass admin check for players
    if (window.firebaseSet && window.firebaseDb) {
        const dbRef = window.firebaseRef(window.firebaseDb, 'gameState');
        window.firebaseGet(dbRef).then((snapshot) => {
            if (snapshot.exists()) {
                let data = snapshot.val();
                data.allPlayers = data.allPlayers || {};
                data.allPlayers[playerId] = allPlayers[playerId];
                data.pendingClaims = data.pendingClaims || {};
                data.pendingClaims[playerId] = pendingClaims[playerId];
                window.firebaseSet(dbRef, data).then(() => {
                    closeAuthModals();
                    setTimeout(() => alert("Claim submitted! Please wait for admin approval."), 50);
                }).catch(e => {
                    console.error("Error submitting claim: " + e.message);
                });
            }
        });
    } else {
        syncToFirebase();
        closeAuthModals();
        setTimeout(() => alert("Claim submitted! Please wait for admin approval."), 50);
    }
};

window.submitLogin = function() {
    const select = document.getElementById('loginProfileSelect');
    const pin = document.getElementById('loginPin').value;
    if(!select.value || !pin) return;
    
    const playerId = select.value;
    if(allPlayers[playerId] && allPlayers[playerId].pin === pin) {
        localStorage.setItem('loggedInPlayerId', playerId);
        closeAuthModals();
        renderProfileUI();
        showToast(`Welcome back, ${allPlayers[playerId].name}!`, 'success');
    } else {
        showToast('Incorrect password', 'error');
    }
};

window.logoutPlayer = function() {
    localStorage.removeItem('loggedInPlayerId');
    renderProfileUI();
    showToast('You have been logged out.', 'info');
};

window.openMyProfileModal = function() {
    const loggedInId = localStorage.getItem('loggedInPlayerId');
    if(!loggedInId || !allPlayers[loggedInId]) return;
    const player = allPlayers[loggedInId];
    
    const nameEl = document.getElementById('myProfileName');
    const playerName = player.name || 'Player';
    nameEl.textContent = playerName;
    nameEl.className = player.equippedNameDesign || '';
    nameEl.setAttribute('data-text', playerName);
    
    const rankObj = getRankBadge(player);
    const rankIcon = document.getElementById('myProfileRankIcon');
    const rankText = document.getElementById('myProfileRankText');
    const rankStars = document.getElementById('myProfileRankStars');
    if (rankIcon) rankIcon.src = `graphics/medals/${rankObj.baseName || rankObj.name}.png`;
    if (rankText) rankText.textContent = `${rankObj.name.toUpperCase()}`;
    if (rankStars) rankStars.textContent = rankObj.division ? '★'.repeat(rankObj.division) : '';
    
    const matches = player.matchesPlayed || 0;
    const winRate = matches > 0 ? Math.round((player.wins || 0) / matches * 100) : 0;
    
    const winRateEl = document.getElementById('myProfileWinRate');
    const matchesEl = document.getElementById('myProfileMatches');
    const mmrEl = document.getElementById('myProfileMMR');
    if (winRateEl) winRateEl.textContent = `${winRate}%`;
    if (matchesEl) matchesEl.textContent = matches;
    if (mmrEl) mmrEl.textContent = Math.round(typeof player.rating !== 'undefined' ? player.rating : (player.mmr || 1000));
    
    // MMR Progress Bar
    const progressContainer = document.getElementById('myProfileMMRProgress');
    if (progressContainer && matches >= 10) {
        progressContainer.style.display = 'block';
        const mmr = typeof player.rating !== 'undefined' ? player.rating : (player.mmr || 1000);
        
        // Tier thresholds matching getRankBadge
        const tiers = [
            { name: 'Bronze', base: 0, next: 1400 },
            { name: 'Silver', base: 1400, next: 1550 },
            { name: 'Gold', base: 1550, next: 1700 },
            { name: 'Platinum', base: 1700, next: 1850 },
            { name: 'Diamond', base: 1850, next: 2000 },
            { name: 'Master', base: 2000, next: null }
        ];
        
        let currentTier = tiers[0];
        for (let i = tiers.length - 1; i >= 0; i--) {
            if (mmr >= tiers[i].base) { currentTier = tiers[i]; break; }
        }
        
        const currentLabel = document.getElementById('mmrProgressCurrentTier');
        const nextLabel = document.getElementById('mmrProgressNextTier');
        const fillBar = document.getElementById('mmrProgressFill');
        const valueText = document.getElementById('mmrProgressValue');
        
        if (currentTier.next === null) {
            // Master tier - show full bar
            if (currentLabel) currentLabel.textContent = 'Master';
            if (nextLabel) nextLabel.textContent = '∞';
            if (fillBar) fillBar.style.width = '100%';
            if (valueText) valueText.innerHTML = `<span>${Math.round(mmr)}</span> MMR — Peak Rank Achieved!`;
        } else {
            const range = currentTier.next - currentTier.base;
            const progress = Math.max(0, Math.min(1, (mmr - currentTier.base) / range));
            const nextTierIdx = tiers.indexOf(currentTier) + 1;
            const nextTierName = nextTierIdx < tiers.length ? tiers[nextTierIdx].name : 'Master';
            
            if (currentLabel) currentLabel.textContent = currentTier.name;
            if (nextLabel) nextLabel.textContent = nextTierName;
            if (fillBar) fillBar.style.width = `${Math.round(progress * 100)}%`;
            if (valueText) valueText.innerHTML = `<span>${Math.round(mmr)}</span> / ${currentTier.next} MMR`;
        }
    } else if (progressContainer) {
        progressContainer.style.display = 'none';
    }
    
    const avatarContainer = document.getElementById('myProfileAvatarContainer');
    if (avatarContainer) avatarContainer.innerHTML = window.renderAvatar ? renderAvatar(player) : '';
    
    const bannerEl = document.getElementById('myProfileBanner');
    if (bannerEl) bannerEl.className = 'profile-banner ' + (player.equippedBanner || '');
    
    const historyList = document.getElementById('myProfileMatchHistoryList');
    if (historyList) {
        if (!player.matchHistory || player.matchHistory.length === 0) {
            historyList.innerHTML = '<p style="font-size: 0.8rem; color: #71717a; text-align: center; margin-top: 1rem;">No recent matches</p>';
        } else {
            historyList.innerHTML = player.matchHistory.map(m => {
                const dateStr = new Date(m.date).toLocaleDateString();
                const color = m.result === 'WIN' ? '#4ade80' : (m.result === 'LOSS' ? '#ef4444' : '#a1a1aa');
                const sign = m.mmrChange >= 0 ? '+' : '';
                return `
                    <div style="background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.05); border-radius: 8px; padding: 0.5rem 0.75rem; display: flex; justify-content: space-between; align-items: center;">
                        <div style="display: flex; flex-direction: column;">
                            <span style="font-size: 0.75rem; color: ${color}; font-weight: 700;">${m.result}</span>
                            <span style="font-size: 0.65rem; color: #71717a;">${dateStr}</span>
                        </div>
                        <div style="display: flex; flex-direction: column; align-items: center; max-width: 50%;">
                            <span style="font-size: 0.7rem; color: #a1a1aa; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;">vs ${(Array.isArray(m.opponents) ? m.opponents : Object.values(m.opponents || {})).join(', ')}</span>
                            <span style="font-size: 0.65rem; color: #71717a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%;">w/ ${m.teammate}</span>
                        </div>
                        <span style="font-size: 0.85rem; font-weight: 700; color: ${color};">${sign}${m.mmrChange}</span>
                    </div>
                `;
            }).join('');
        }
    }
    
    document.getElementById('myProfileModal').style.display = 'flex';
};

window.renderProfileUI = function() {
    const authUI = document.getElementById('authUIContainer');
    const loggedInUI = document.getElementById('loggedInUIContainer');
    const userInfo = document.getElementById('loggedInUserInfo');
    
    if(!authUI || !loggedInUI || !userInfo) return;
    
    const loggedInId = localStorage.getItem('loggedInPlayerId');
    
    if (loggedInId && allPlayers[loggedInId]) {
        const player = allPlayers[loggedInId];
        authUI.style.display = 'none';
        loggedInUI.style.display = 'flex';
        const playerName = player.name || 'Player';
        let nameClass = player.equippedNameDesign && player.equippedNameDesign !== 'none' ? player.equippedNameDesign : '';
        userInfo.innerHTML = `${renderAvatar(player)} <span class="${nameClass}" data-text="${playerName}" style="font-weight:600; margin-left:8px;">${playerName}</span>`;
    } else {
        authUI.style.display = 'flex';
        loggedInUI.style.display = 'none';
    }
};

window.handleProfilePicSelect = function(event) {
    const file = event.target.files[0];
    if(!file) return;
    
    const loggedInId = localStorage.getItem('loggedInPlayerId');
    if(!loggedInId || !allPlayers[loggedInId]) return;
    
    const statusText = document.getElementById('uploadStatus');
    statusText.style.display = 'block';
    statusText.textContent = 'Compressing...';
    
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas');
            const MAX_WIDTH = 150;
            const MAX_HEIGHT = 150;
            let width = img.width;
            let height = img.height;
            
            if (width > height) {
                if (width > MAX_WIDTH) {
                    height *= MAX_WIDTH / width;
                    width = MAX_WIDTH;
                }
            } else {
                if (height > MAX_HEIGHT) {
                    width *= MAX_HEIGHT / height;
                    height = MAX_HEIGHT;
                }
            }
            
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            
            const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
            statusText.textContent = 'Uploading...';
            
            if (window.firebaseStorage && window.firebaseStorageRef && window.firebaseUploadString && window.firebaseGetDownloadURL) {
                const storageRef = window.firebaseStorageRef(window.firebaseStorage, `profilePics/${loggedInId}_${Date.now()}.jpg`);
                window.firebaseUploadString(storageRef, dataUrl, 'data_url').then((snapshot) => {
                    window.firebaseGetDownloadURL(snapshot.ref).then((downloadURL) => {
                        const dbRef = window.firebaseRef(window.firebaseDb, `gameState/allPlayers/${loggedInId}`);
                        window.firebaseUpdate(dbRef, { profilePic: downloadURL }).then(() => {
                            allPlayers[loggedInId].profilePic = downloadURL;
                            statusText.textContent = 'Success!';
                            setTimeout(() => statusText.style.display = 'none', 2000);
                            renderProfileUI();
                            openMyProfileModal();
                        });
                    });
                }).catch((error) => {
                    console.error('Upload failed', error);
                    statusText.textContent = 'Upload failed';
                    setTimeout(() => statusText.style.display = 'none', 2000);
                    statusText.style.color = '#ef4444';
                });
            } else {
                statusText.textContent = 'Storage unavailable.';
                statusText.style.color = '#ef4444';
            }
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
};

window.renderAdminDashboards = function() {
    const claimsContainer = document.getElementById('pendingClaimsContainer');
    if (claimsContainer) {
        if (Object.keys(pendingClaims).length === 0) {
            claimsContainer.innerHTML = '<p style="text-align: center; opacity: 0.6; padding: 1rem;">No pending claims.</p>';
        } else {
            let html = '';
            Object.values(pendingClaims).forEach(claim => {
                html += `
                    <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.2); padding: 0.75rem; border-radius: 8px; border: 1px solid rgba(255,255,255,0.05);">
                        <span style="font-weight: 600;">${claim.name}</span>
                        <div style="display: flex; gap: 0.5rem;">
                            <button class="btn" style="background: #10b981; padding: 0.4rem 0.8rem; font-size: 0.8rem;" onclick="approveClaim('${claim.playerId}')">Approve</button>
                            <button class="btn" style="background: #ef4444; padding: 0.4rem 0.8rem; font-size: 0.8rem;" onclick="rejectClaim('${claim.playerId}')">Reject</button>
                        </div>
                    </div>
                `;
            });
            claimsContainer.innerHTML = html;
        }
    }


};

window.approveClaim = function(playerId) {
    if(allPlayers[playerId]) {
        allPlayers[playerId].claimStatus = 'claimed';
    }
    delete pendingClaims[playerId];
    syncToFirebase();
    if (typeof renderAdminDashboards === 'function') renderAdminDashboards();
    if (typeof renderPlayerManagement === 'function') renderPlayerManagement();
};

window.rejectClaim = function(playerId) {
    if(allPlayers[playerId]) {
        allPlayers[playerId].claimStatus = 'unclaimed';
        delete allPlayers[playerId].pin;
    }
    delete pendingClaims[playerId];
    syncToFirebase();
    if (typeof renderAdminDashboards === 'function') renderAdminDashboards();
    if (typeof renderPlayerManagement === 'function') renderPlayerManagement();
};


// --- Theme Switcher Logic ---
window.setTheme = function(themeName) {
    document.body.className = document.body.className.replace(/theme-\w+/g, '').trim();
    if (themeName !== 'default') {
        document.body.classList.add('theme-' + themeName);
    }
    localStorage.setItem('dinkbai-theme', themeName);
    
    // Update active state of buttons
    document.querySelectorAll('.theme-btn').forEach(btn => {
        if (btn.dataset.theme === themeName) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
};

document.addEventListener('DOMContentLoaded', () => {
    const savedTheme = localStorage.getItem('dinkbai-theme') || 'default';
    setTheme(savedTheme);
});


// --- Cosmetic & Coin System ---
window.addCoins = function(playerId, amount) {
    if(!allPlayers[playerId]) return;
    const current = allPlayers[playerId].coins || 0;
    allPlayers[playerId].coins = current + amount;
    syncToFirebase();
    if (typeof renderPlayerManagement === 'function') renderPlayerManagement();
};

window.addTokens = function(playerId, amount) {
    if(!allPlayers[playerId]) return;
    const current = allPlayers[playerId].tokens || 0;
    allPlayers[playerId].tokens = current + amount;
    syncToFirebase();
    if (typeof renderPlayerManagement === 'function') renderPlayerManagement();
};

window.buyCosmetic = function(playerId, cosmeticId, cost, currencyType = 'coins', itemType = 'border') {
    if(!allPlayers[playerId]) return false;
    
    let currentBalance = 0;
    if (currencyType === 'tokens') {
        currentBalance = allPlayers[playerId].tokens || 0;
    } else {
        currentBalance = allPlayers[playerId].coins || 0;
    }

    if(currentBalance >= cost) {
        if (currencyType === 'tokens') {
            allPlayers[playerId].tokens = currentBalance - cost;
        } else {
            allPlayers[playerId].coins = currentBalance - cost;
        }
        
        allPlayers[playerId].unlockedCosmetics = allPlayers[playerId].unlockedCosmetics || [];
        if(!allPlayers[playerId].unlockedCosmetics.includes(cosmeticId)) {
            allPlayers[playerId].unlockedCosmetics.push(cosmeticId);
        }
        
        if (itemType === 'banner') {
            allPlayers[playerId].equippedBanner = cosmeticId;
        } else if (itemType === 'name_design') {
            allPlayers[playerId].equippedNameDesign = cosmeticId;
        } else {
            allPlayers[playerId].equippedBorder = cosmeticId;
        }
        
        if (window.firebaseSet && window.firebaseDb && window.isFirebaseReady) {
            const playerRef = window.firebaseRef(window.firebaseDb, 'gameState/allPlayers/' + playerId);
            window.firebaseSet(playerRef, allPlayers[playerId]).catch(e => console.error("Firebase save error:", e));
        }
        
        syncToFirebase();
        return true;
    }
    return false;
};

window.equipCosmetic = function(playerId, cosmeticId, itemType = 'border') {
    if(!allPlayers[playerId]) return;
    
    if (itemType === 'banner') {
        allPlayers[playerId].equippedBanner = cosmeticId;
    } else if (itemType === 'name_design') {
        allPlayers[playerId].equippedNameDesign = cosmeticId;
    } else {
        allPlayers[playerId].equippedBorder = cosmeticId;
    }
    
    if (window.firebaseSet && window.firebaseDb && window.isFirebaseReady) {
        const playerRef = window.firebaseRef(window.firebaseDb, 'gameState/allPlayers/' + playerId);
        window.firebaseSet(playerRef, allPlayers[playerId]).catch(e => console.error("Firebase save error:", e));
    }
    
    syncToFirebase();
};

