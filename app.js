const queues = {
    manual: [],
    beginner: [],
    intermediate: [],
    advanced: [],
    standby: []
};

let courts = [];
let playerIdCounter = 1;

// DOM Elements
const courtCountInput = document.getElementById('courtCount');
const setCourtsBtn = document.getElementById('setCourtsBtn');
const addPlayerForm = document.getElementById('addPlayerForm');
const courtsContainer = document.getElementById('courtsContainer');
const nextMatchupsContainer = document.getElementById('nextMatchupsContainer');

const stackBeginner = document.getElementById('stack-beginner');
const stackIntermediate = document.getElementById('stack-intermediate');
const stackAdvanced = document.getElementById('stack-advanced');

// Initialization
function init() {
    setupCourts();
    setCourtsBtn.addEventListener('click', setupCourts);
    addPlayerForm.addEventListener('submit', handleAddPlayer);
}

// Setup Courts
function setupCourts() {
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
addPlayerForm.addEventListener('submit', function(e) {
    e.preventDefault();
    
    const nameInput = document.getElementById('playerName');
    const skillInput = document.getElementById('playerSkill');
    
    const name = nameInput.value.trim();
    const skill = skillInput.value;
    
    if (name && skill) {
        const player = {
            id: playerIdCounter++,
            name: name,
            skill: skill,
            queuedAt: Date.now()
        };
        
        queues[skill].push(player);
        
        // Reset form
        nameInput.value = '';
        skillInput.value = '';
        
        renderQueues();
        checkQueuesAndAssign();
    }
});

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
            possibleGroups.push({
                type: 'single',
                skill: skill,
                groupCompleteTime: q[skill][3].queuedAt
            });
        }
    });
    
    // 2. Check for mixed group
    if (q.advanced.length >= 2 && q.intermediate.length >= 2) {
        const groupCompleteTime = Math.max(q.advanced[1].queuedAt, q.intermediate[1].queuedAt);
        possibleGroups.push({
            type: 'mixed',
            groupCompleteTime: groupCompleteTime
        });
    }
    
    // 3. Fallback mixed group (Intermediate/Blue & Beginner/Black)
    if (q.intermediate.length >= 2 && q.beginner.length >= 2) {
        const groupCompleteTime = Math.max(q.intermediate[1].queuedAt, q.beginner[1].queuedAt);
        possibleGroups.push({
            type: 'mixed_int_beg',
            groupCompleteTime: groupCompleteTime
        });
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
        group = q[bestGroup.skill].splice(0, 4);
    } else if (bestGroup.type === 'mixed') {
        const advGroup = q.advanced.splice(0, 2);
        const intGroup = q.intermediate.splice(0, 2);
        group = [advGroup[0], intGroup[0], advGroup[1], intGroup[1]];
    } else if (bestGroup.type === 'mixed_int_beg') {
        const intGroup = q.intermediate.splice(0, 2);
        const begGroup = q.beginner.splice(0, 2);
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
    let tempQueues = {
        manual: [...queues.manual],
        beginner: [...queues.beginner],
        intermediate: [...queues.intermediate],
        advanced: [...queues.advanced]
    };
    
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
            // Requeue players with a fresh timestamp so they go to the back of the line
            players.forEach(p => {
                p.queuedAt = Date.now();
                if (queues[p.skill]) {
                    queues[p.skill].push(p);
                }
            });
        }
        
        if (court.isLastGame) {
            courts.splice(courtIndex, 1);
            courtCountInput.value = courts.length;
        } else {
            court.players = null;
        }
        
        renderQueues();
        renderCourts();
        checkQueuesAndAssign(); // Immediately check if someone else is waiting in the queue
    }
}

function toggleLastGame(courtId) {
    const courtIndex = courts.findIndex(c => c.id == courtId);
    if (courtIndex !== -1) {
        courts[courtIndex].isLastGame = !courts[courtIndex].isLastGame;
        renderCourts();
    }
}

function removeEmptyCourt(courtId) {
    const courtIndex = courts.findIndex(c => c.id == courtId);
    if (courtIndex !== -1 && courts[courtIndex].players === null) {
        courts.splice(courtIndex, 1);
        courtCountInput.value = courts.length;
        renderCourts();
    }
}

function editCourtNumber(oldId) {
    const newId = prompt(`Enter new name/number for Court ${oldId}:`, oldId);
    if (newId !== null && newId.trim() !== '') {
        const courtIndex = courts.findIndex(c => c.id == oldId);
        if (courtIndex !== -1) {
            courts[courtIndex].id = newId.trim();
            renderCourts();
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
                    <div class="matchup-player ${group[0].skill}">${group[0].name}</div>
                    <div class="matchup-player ${group[1].skill}">${group[1].name}</div>
                </div>
                <div class="matchup-vs">VS</div>
                <div class="matchup-team">
                    <div class="matchup-player ${group[2].skill}">${group[2].name}</div>
                    <div class="matchup-player ${group[3].skill}">${group[3].name}</div>
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
            <span>${p.name} <span style="font-size: 0.7rem; opacity: 0.7;">(${p.skill})</span></span>
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
    
    let names = group.players.map(p => p.name).join(', ');
    paddleEl.innerHTML = `
        <div style="display: flex; flex-direction: column; padding-right: 90px;">
            <span class="player-name" style="font-size: 0.8rem; line-height: 1.2;">${names}</span>
            <span style="font-size: 0.7rem; color: rgba(255,255,255,0.7);">${group.size} players - ${group.skill}</span>
        </div>
        <span class="paddle-number">#${index + 1}</span>
        <div class="paddle-actions">
            ${queueName === 'standby' ? 
                `<button class="paddle-btn" title="Rejoin Queue" onclick="rejoinQueue(${group.id})">▶</button>` : 
                `<button class="paddle-btn" title="Move to Standby" onclick="moveToStandby('${queueName}', ${group.id})">⏸</button>`
            }
            <button class="paddle-btn remove" title="Remove" onclick="removeFromSystem('${queueName}', ${group.id})">✖</button>
        </div>
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
        <span class="player-name" style="padding-right: 90px;">${player.name}</span>
        <span class="paddle-number">#${index + 1}</span>
        <div class="paddle-actions">
            ${skillClass === 'standby' ? 
                `<button class="paddle-btn" title="Rejoin Queue" onclick="rejoinQueue(${player.id})">▶</button>` : 
                `<button class="paddle-btn" title="Move to Standby" onclick="moveToStandby('${skillClass}', ${player.id})">⏸</button>`
            }
            <button class="paddle-btn remove" title="Remove" onclick="removeFromSystem('${skillClass}', ${player.id})">✖</button>
        </div>
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
                    <span>${p[0].name}</span>
                    <span style="font-size: 0.8em; opacity: 0.7; text-transform: capitalize;">${p[0].skill}</span>
                </div>
                <div class="court-player ${p[1].skill}">
                    <span>${p[1].name}</span>
                    <span style="font-size: 0.8em; opacity: 0.7; text-transform: capitalize;">${p[1].skill}</span>
                </div>
                <div class="vs-divider">VS</div>
                <div class="team-label">Team 2</div>
                <div class="court-player ${p[2].skill}">
                    <span>${p[2].name}</span>
                    <span style="font-size: 0.8em; opacity: 0.7; text-transform: capitalize;">${p[2].skill}</span>
                </div>
                <div class="court-player ${p[3].skill}">
                    <span>${p[3].name}</span>
                    <span style="font-size: 0.8em; opacity: 0.7; text-transform: capitalize;">${p[3].skill}</span>
                </div>
            `;
        }
        
        let actionButtons = '';
        if (isPlaying) {
            actionButtons = `
                <div style="display: flex; gap: 0.5rem; margin-top: 1rem;">
                    <button class="free-court-btn" style="margin-top: 0; flex: 2;" onclick="freeCourt('${court.id}')">End Game</button>
                    <button class="last-game-btn ${court.isLastGame ? 'active' : ''}" style="margin-top: 0; flex: 1;" onclick="toggleLastGame('${court.id}')" title="Mark as last game. Court will be removed after game ends.">
                        ${court.isLastGame ? 'Cancel Last' : 'Last Game'}
                    </button>
                </div>
            `;
        } else {
            actionButtons = `
                <button class="last-game-btn" style="margin-top: 1rem; width: 100%;" onclick="removeEmptyCourt('${court.id}')">Remove Court</button>
            `;
        }

        courtEl.innerHTML = `
            <div class="court-header">
                <span class="court-title" onclick="editCourtNumber('${court.id}')" style="cursor: pointer;" title="Click to rename court">Court ${court.id} <span style="font-size:0.8em; opacity:0.5;">✎</span></span>
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

// Run init on load
document.addEventListener('DOMContentLoaded', init);
