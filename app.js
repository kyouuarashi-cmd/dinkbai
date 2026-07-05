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
        if (window.firebaseSet && window.firebaseDb && window.isFirebaseReady) {
            const dbRef = window.firebaseRef(window.firebaseDb, 'gameState');
            window.firebaseSet(dbRef, {
                allPlayers,
                queues,
                courts,
                playerIdCounter
            }).catch(e => console.error("Firebase save error:", e));
        }
    }, 100);
}

window.addEventListener('firebase-ready', () => {
    window.isFirebaseReady = true;
    const dbRef = window.firebaseRef(window.firebaseDb, 'gameState');
    
    window.firebaseOnValue(dbRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
            // Admin only restores state on initial load. Player receives all live updates.
            if (isAdmin && window.hasLoadedInitialState) return;
            
            allPlayers = data.allPlayers || {};
            
            // Firebase Realtime DB drops empty arrays/objects, so we must recreate them
            queues = data.queues || {};
            queues.beginner = queues.beginner || [];
            queues.intermediate = queues.intermediate || [];
            queues.advanced = queues.advanced || [];
            queues.manual = queues.manual || [];
            queues.standby = queues.standby || [];
            
            courts = data.courts || [];
            playerIdCounter = data.playerIdCounter || 1;
            
            // If admin is restoring, update the court count input
            if (isAdmin && courtCountInput) {
                courtCountInput.value = courts.length > 0 ? courts.length : 4;
            }
            
            renderQueues();
            renderCourts();
            renderLeaderboard();
            updateNextMatchups();
            
            window.hasLoadedInitialState = true;
        }
    });
});

// Initialization
function init() {
    setupCourts();
    if (addPlayerForm) {
        addPlayerForm.addEventListener('submit', handleAddPlayer);
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
    const isHostInput = document.getElementById('playerIsHost');
    
    const name = nameInput.value.trim();
    const skill = skillInput.value;
    const isHost = isHostInput ? isHostInput.checked : false;
    
    if (name && skill) {
        const player = {
            id: playerIdCounter++,
            name: name,
            skill: skill,
            isHost: isHost,
            queuedAt: Date.now(),
            matchesPlayed: 0,
            wins: 0
        };
        allPlayers[player.id] = player;
        
        queues[skill].push(player);
        
        // Reset form
        nameInput.value = '';
        skillInput.value = '';
        if (isHostInput) isHostInput.checked = false;
        
        renderQueues();
        checkQueuesAndAssign();
        syncToFirebase();
    }
}

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
        const oldestWait = Math.min(...selectedPlayers.map(p => p.queuedAt));
        
        const groupObj = {
            id: playerIdCounter++,
            isGroup: true,
            size: selectedPlayers.length,
            skill: 'mixed',
            queuedAt: oldestWait,
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
        // Find another manual pair of 2
        const otherManual2 = q.manual.find(g => g.size === 2 && g !== manual2);
        if (otherManual2) {
            possibleGroups.push({
                type: 'manual_2_manual_2',
                groupRef1: manual2,
                groupRef2: otherManual2,
                groupCompleteTime: Math.max(manual2.queuedAt, otherManual2.queuedAt)
            });
        }
        
        // Find 2 solo players from ANY active queue
        let oldestSoloPairQueue = null;
        let oldestSoloPairWait = Infinity;
        
        ['beginner', 'intermediate', 'advanced'].forEach(skill => {
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
    return group;
}

// Check if we can form a group of 4 and assign to a court
function checkQueuesAndAssign() {
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
            // Requeue players with a fresh timestamp so they go to the back of the line
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
            if(courtCountInput) courtCountInput.value = courts.length;
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
        if(courtCountInput) courtCountInput.value = courts.length;
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

// Render logic
function renderNextMatchups(matchups) {
    nextMatchupsContainer.innerHTML = '';
    
    if (matchups.length === 0) {
        nextMatchupsContainer.innerHTML = '<div style="color: #64748b; font-size: 0.9rem; text-align: center; margin-top: 1rem; padding-bottom: 1rem;">Not enough players for a match</div>';
        return;
    }
    
    matchups.forEach((group, index) => {
        const row = document.createElement('div');
        row.className = 'matchup-row';
        
        row.innerHTML = `
            <div class="matchup-number">#${index + 1}</div>
            <div class="matchup-teams">
                <div class="matchup-team">
                    <div class="matchup-player ${group[0].skill}">${group[0].name}${group[0].isHost ? ' <span title="Host">&#x1F3C5;</span>' : ''}</div>
                    <div class="matchup-player ${group[1].skill}">${group[1].name}${group[1].isHost ? ' <span title="Host">&#x1F3C5;</span>' : ''}</div>
                </div>
                <div class="matchup-vs">VS</div>
                <div class="matchup-team">
                    <div class="matchup-player ${group[2].skill}">${group[2].name}${group[2].isHost ? ' <span title="Host">&#x1F3C5;</span>' : ''}</div>
                    <div class="matchup-player ${group[3].skill}">${group[3].name}${group[3].isHost ? ' <span title="Host">&#x1F3C5;</span>' : ''}</div>
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
    container.innerHTML = '';
    
    if (queue.length === 0) {
        container.innerHTML = '<div style="color: #64748b; font-size: 0.9rem; text-align: center; margin-top: 1rem;">No groups waiting</div>';
        return;
    }

    queue.forEach((group, index) => {
        renderSingleManualPaddle(container, group, index, queueName);
    });
}

function renderSingleManualPaddle(container, group, index, queueName) {
    const paddleEl = document.createElement('div');
    paddleEl.className = `paddle manual`;
    
    let names = group.players.map(p => p.name + (p.isHost ? ' <span title="Host">&#x1F3C5;</span>' : '')).join(', ');
    paddleEl.innerHTML = `
        <div style="display: flex; flex-direction: column; padding-right: 90px;">
            <span class="player-name" style="font-size: 0.8rem; line-height: 1.2;">${names}</span>
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
    container.innerHTML = '';
    
    if (queue.length === 0) {
        container.innerHTML = '<div style="color: #64748b; font-size: 0.9rem; text-align: center; margin-top: 1rem;">No players waiting</div>';
        return;
    }

    queue.forEach((player, index) => {
        renderSinglePaddle(container, player, index, skillClass);
    });
}

function renderSinglePaddle(container, player, index, skillClass) {
    const paddleEl = document.createElement('div');
    paddleEl.className = `paddle ${player.skill}`; // use player.skill for coloring even in standby
    
    paddleEl.innerHTML = `
        <span class="player-name" style="padding-right: 90px;">${player.name}${player.isHost ? ' <span title="Host">&#x1F3C5;</span>' : ''}</span>
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
    courtsContainer.innerHTML = '';
    
    courts.forEach(court => {
        const courtEl = document.createElement('div');
        courtEl.className = 'court';
        
        const isPlaying = court.players !== null;
        const statusClass = isPlaying ? 'status-playing' : 'status-empty';
        const statusText = isPlaying ? 'PLAYING' : 'OPEN';
        
        let playersHTML = '<div class="empty-court-placeholder">Waiting for 4 players...</div>';
        
        if (isPlaying) {
            const p = court.players;
            playersHTML = `
                <div class="team-label">Team 1</div>
                <div class="court-player ${p[0].skill}">
                    <span>${p[0].name}${p[0].isHost ? ' <span title="Host">&#x1F3C5;</span>' : ''}</span>
                    <span style="font-size: 0.8em; opacity: 0.7; text-transform: capitalize;">${p[0].skill}</span>
                </div>
                <div class="court-player ${p[1].skill}">
                    <span>${p[1].name}${p[1].isHost ? ' <span title="Host">&#x1F3C5;</span>' : ''}</span>
                    <span style="font-size: 0.8em; opacity: 0.7; text-transform: capitalize;">${p[1].skill}</span>
                </div>
                <div class="vs-divider">VS</div>
                <div class="team-label">Team 2</div>
                <div class="court-player ${p[2].skill}">
                    <span>${p[2].name}${p[2].isHost ? ' <span title="Host">&#x1F3C5;</span>' : ''}</span>
                    <span style="font-size: 0.8em; opacity: 0.7; text-transform: capitalize;">${p[2].skill}</span>
                </div>
                <div class="court-player ${p[3].skill}">
                    <span>${p[3].name}${p[3].isHost ? ' <span title="Host">&#x1F3C5;</span>' : ''}</span>
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
                    <button class="last-game-btn" style="margin-top: 1rem; width: 100%;" onclick="removeEmptyCourt('${court.id}')">Remove Court</button>
                `;
            }
        }

        const courtTitleHTML = isAdmin 
            ? `<span class="court-title" onclick="editCourtNumber('${court.id}')" style="cursor: pointer;" title="Click to rename court">Court ${court.id} <span style="font-size:0.8em; opacity:0.5;">&#x270F;&#xFE0F;</span></span>`
            : `<span class="court-title">Court ${court.id}</span>`;

        courtEl.innerHTML = `
            <div class="court-header">
                ${courtTitleHTML}
                <span class="court-status ${statusClass}">${statusText}</span>
            </div>
            <div class="court-players">
                ${playersHTML}
            </div>
            ${actionButtons}
        `;
        
        courtsContainer.appendChild(courtEl);
    });
}

// ----------------------------------------------------
// MVP Leaderboard & Result Logic
// ----------------------------------------------------

function endGameWithResult(courtId, result) {
    const court = courts.find(c => c.id == courtId);
    if (!court || !court.players) return;
    
    const p = court.players;
    const res = parseInt(result, 10);
    
    // Increment matches played for all 4 players
    p.forEach(player => {
        if (player && player.id && allPlayers[player.id]) {
            if (!allPlayers[player.id].isHost) {
                allPlayers[player.id].matchesPlayed++;
            }
        }
    });
    
    // Increment wins for the winning team
    if (res === 1) {
        if (p[0] && allPlayers[p[0].id] && !allPlayers[p[0].id].isHost) allPlayers[p[0].id].wins++;
        if (p[1] && allPlayers[p[1].id] && !allPlayers[p[1].id].isHost) allPlayers[p[1].id].wins++;
    } else if (res === 2) {
        if (p[2] && allPlayers[p[2].id] && !allPlayers[p[2].id].isHost) allPlayers[p[2].id].wins++;
        if (p[3] && allPlayers[p[3].id] && !allPlayers[p[3].id].isHost) allPlayers[p[3].id].wins++;
    }
    
    // Re-render leaderboard
    renderLeaderboard();
    
    // Complete the standard end game logic
    freeCourt(courtId);
}

function renderLeaderboard() {
    const container = document.getElementById('mvpContainer');
    
    // Filter out players with 0 matches played
    const eligiblePlayers = Object.values(allPlayers).filter(p => p.matchesPlayed > 0);
    
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
        const scoreA = getWilsonScore(a.wins, a.matchesPlayed);
        const scoreB = getWilsonScore(b.wins, b.matchesPlayed);
        if (scoreA !== scoreB) return scoreB - scoreA;
        return b.matchesPlayed - a.matchesPlayed;
    });
    
    let html = '';
    // Display Top 10 MVPs
    const topLimit = Math.min(10, eligiblePlayers.length);
    for (let i = 0; i < topLimit; i++) {
        const player = eligiblePlayers[i];
        const winRate = Math.round((player.wins / player.matchesPlayed) * 100);
        
        let rankClass = '';
        if (i === 0) rankClass = 'top-1';
        else if (i === 1) rankClass = 'top-2';
        else if (i === 2) rankClass = 'top-3';
        
        html += `
            <div class="mvp-row ${rankClass}">
                <div class="mvp-rank">#${i + 1}</div>
                <div class="mvp-name">${player.name}</div>
                <div class="mvp-stats">
                    <div class="mvp-winrate">${winRate}%</div>
                    <div style="font-size: 0.75rem; opacity: 0.6;">${player.wins}W - ${player.matchesPlayed - player.wins}L</div>
                </div>
            </div>
        `;
    }
    
    container.innerHTML = html;
}

function endOpenPlay() {
    if (!confirm('Are you sure you want to end open play? This will clear all players, queues, and stats.')) {
        return;
    }
    
    // Reset global state
    for (let key in allPlayers) delete allPlayers[key];
    playerIdCounter = 1;
    
    queues.manual = [];
    queues.beginner = [];
    queues.intermediate = [];
    queues.advanced = [];
    queues.standby = [];
    
    courts = [];
    courtCountInput.value = 4;
    setupCourts();
    
    renderQueues();
    renderCourts();
    renderLeaderboard();
    updateNextMatchups();
}

// Run init on load
document.addEventListener('DOMContentLoaded', init);
