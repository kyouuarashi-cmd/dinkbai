// State
const queues = {
    beginner: [],
    intermediate: [],
    advanced: []
};

let courts = [];
let playerIdCounter = 1;

// DOM Elements
const courtCountInput = document.getElementById('courtCount');
const setCourtsBtn = document.getElementById('setCourtsBtn');
const addPlayerForm = document.getElementById('addPlayerForm');
const courtsContainer = document.getElementById('courtsContainer');

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
                players: null // null means empty, array of 4 means full
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

// Add Player to Queue
function handleAddPlayer(e) {
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
}

// Check if we can form a group of 4 and assign to a court
function checkQueuesAndAssign() {
    // Find empty courts
    const emptyCourts = courts.filter(c => c.players === null);
    
    if (emptyCourts.length === 0) return; // No courts available

    for (let emptyCourt of emptyCourts) {
        let possibleGroups = [];
        
        // 1. Check for single-skill groups
        ['beginner', 'intermediate', 'advanced'].forEach(skill => {
            if (queues[skill].length >= 4) {
                possibleGroups.push({
                    type: 'single',
                    skill: skill,
                    oldestWaitTime: queues[skill][0].queuedAt
                });
            }
        });
        
        // 2. Check for mixed group
        if (queues.advanced.length >= 2 && queues.intermediate.length >= 2) {
            // Oldest among the 4 players that would be pulled
            const oldestWaitTime = Math.min(queues.advanced[0].queuedAt, queues.intermediate[0].queuedAt);
            possibleGroups.push({
                type: 'mixed',
                oldestWaitTime: oldestWaitTime
            });
        }
        // 3. Fallback mixed group (Advanced/Blue & Beginner/Black) ONLY if no other options
        if (possibleGroups.length === 0) {
            if (queues.advanced.length >= 2 && queues.beginner.length >= 2) {
                const oldestWaitTime = Math.min(queues.advanced[0].queuedAt, queues.beginner[0].queuedAt);
                possibleGroups.push({
                    type: 'mixed_adv_beg',
                    oldestWaitTime: oldestWaitTime
                });
            }
        }
        
        if (possibleGroups.length === 0) {
            break; // No groups can be formed
        }
        
        // Pick the group with the absolute oldest waiting player
        possibleGroups.sort((a, b) => a.oldestWaitTime - b.oldestWaitTime);
        const bestGroup = possibleGroups[0];
        
        let group = [];
        
        if (bestGroup.type === 'single') {
            group = queues[bestGroup.skill].splice(0, 4);
            // Shuffle to set up random balanced partners
            for (let i = group.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [group[i], group[j]] = [group[j], group[i]];
            }
        } else if (bestGroup.type === 'mixed') {
            const advGroup = queues.advanced.splice(0, 2);
            const intGroup = queues.intermediate.splice(0, 2);
            
            // Randomize which advanced/int player goes to which team
            if (Math.random() > 0.5) advGroup.reverse();
            if (Math.random() > 0.5) intGroup.reverse();
            
            // Construct balanced group: Team 1 (adv 0, int 0) vs Team 2 (adv 1, int 1)
            group = [
                advGroup[0], intGroup[0],
                advGroup[1], intGroup[1]
            ];
        } else if (bestGroup.type === 'mixed_adv_beg') {
            const advGroup = queues.advanced.splice(0, 2);
            const begGroup = queues.beginner.splice(0, 2);
            
            // Randomize which advanced/beginner player goes to which team
            if (Math.random() > 0.5) advGroup.reverse();
            if (Math.random() > 0.5) begGroup.reverse();
            
            // Construct balanced group: Team 1 (adv 0, beg 0) vs Team 2 (adv 1, beg 1)
            group = [
                advGroup[0], begGroup[0],
                advGroup[1], begGroup[1]
            ];
        }
        
        // Assign to court
        const courtIndex = courts.findIndex(c => c.id == emptyCourt.id);
        if (courtIndex !== -1) {
            courts[courtIndex].players = group;
        }
        
        renderQueues();
        renderCourts();
    }
}

// Free up a court
function freeCourt(courtId) {
    const courtIndex = courts.findIndex(c => c.id == courtId);
    if (courtIndex !== -1) {
        // Clear players from the court (they must manually re-queue if they want to play again)
        courts[courtIndex].players = null;
        renderQueues();
        renderCourts();
        checkQueuesAndAssign(); // Immediately check if someone else is waiting in the queue
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
function renderQueues() {
    renderStack(stackBeginner, queues.beginner, 'beginner');
    renderStack(stackIntermediate, queues.intermediate, 'intermediate');
    renderStack(stackAdvanced, queues.advanced, 'advanced');
}

function renderStack(container, queue, skillClass) {
    container.innerHTML = '';
    
    if (queue.length === 0) {
        container.innerHTML = '<div style="color: #64748b; font-size: 0.9rem; text-align: center; margin-top: 1rem;">No players waiting</div>';
        return;
    }

    queue.forEach((player, index) => {
        const paddleEl = document.createElement('div');
        paddleEl.className = `paddle ${skillClass}`;
        
        paddleEl.innerHTML = `
            <span class="player-name">${player.name}</span>
            <span class="paddle-number">#${index + 1}</span>
        `;
        
        container.appendChild(paddleEl);
    });
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
        
        courtEl.innerHTML = `
            <div class="court-header">
                <span class="court-title" onclick="editCourtNumber('${court.id}')" style="cursor: pointer;" title="Click to rename court">Court ${court.id} <span style="font-size:0.8em; opacity:0.5;">✎</span></span>
                <span class="court-status ${statusClass}">${statusText}</span>
            </div>
            <div class="court-players">
                ${playersHTML}
            </div>
            ${isPlaying ? `<button class="free-court-btn" onclick="freeCourt('${court.id}')">End Game</button>` : ''}
        `;
        
        courtsContainer.appendChild(courtEl);
    });
}

// Run init on load
document.addEventListener('DOMContentLoaded', init);
