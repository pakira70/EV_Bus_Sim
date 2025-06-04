// Wait for the HTML DOM to be fully loaded before running the script
document.addEventListener('DOMContentLoaded', () => {

    // --- Constants ---
    const NUM_TIME_SLOTS = 96; 
    const SLOT_DURATION_MINUTES = 15;
    const EDITOR_LAST_STATE_KEY = 'editor_lastState'; 
    const RUN_CUT_PREFIX = 'runCut_'; // Now prefix for Schedule
    // const BUS_PARAMS_KEY = 'busParameters'; // <<--- NO LONGER NEEDED/USED THIS WAY

    const COLOR_WARNING_LOW = 'darkorange'; 
    const COLOR_WARNING_CRITICAL = 'red'; 
    const COLOR_WARNING_STRANDED = 'red';

    // --- DOM Element References ---
    const runCutNameInput = document.getElementById('run-cut-name');
    const saveRunCutBtn = document.getElementById('save-run-cut-btn');
    const loadRunCutBtn = document.getElementById('load-run-cut-btn');
    const clearRunCutBtn = document.getElementById('clear-run-cut-btn');
    const addBusBtn = document.getElementById('add-bus-btn');
    const runCutStatus = document.getElementById('run-cut-status');
    const gridTable = document.getElementById('schedule-grid');
    const gridTableBody = document.getElementById('schedule-grid-body');
    const runSimulationBtn = document.getElementById('run-simulation-btn');
    const resultsContainer = document.getElementById('simulation-results-container');
    const resultsOutput = document.getElementById('simulation-output');
    const closeResultsBtn = document.getElementById('close-results-btn');
    const activityPopover = document.getElementById('activity-popover');
    const popoverCellInfo = document.getElementById('popover-cell-info');
    const chargeOptionsDiv = document.getElementById('charge-options');
    const chargerSelect = document.getElementById('charger-select');
    const popoverCancelBtn = document.getElementById('popover-cancel');
    const activityButtons = activityPopover.querySelectorAll('.activity-btn');
    const loadModal = document.getElementById('load-modal');
    const modalCloseBtn = document.getElementById('modal-close-btn');
    const modalRunCutList = document.getElementById('modal-run-cut-list');

    // --- State Variables ---
    let runCutData = { 
        name: '',
        buses: [] 
    };
    let availableChargers = [];
    let currentBusParameters = null; // This will store the loaded parameters as an object
    let currentEditingCell = null; 
    let currentBusId = null; 
    let currentBusIndex = -1;
    let rangeStartTimeSlot = -1; 
    let rangeEndTimeSlot = -1;
    let isDragging = false; 
    let dragStartCell = null; 
    let dragStartBusId = null; 
    let dragStartTimeslot = -1; 
    let dragCurrentEndTimeslot = -1;


    // --- Initialization ---
    function initializeEditor() { 
        console.log("Initializing Schedule Editor..."); 
        loadChargerData(); // Load chargers first as they might be needed by other things
        // loadBusParameters(); // This will be called by handleRunSimulation now
        generateGridHeader(); 
        loadLastEditorState(); 
        renderAllBusRows(); 
        setupEventListeners(); 
    }

    // --- Event Listeners Setup ---
    function setupEventListeners() {
        addBusBtn.addEventListener('click', () => addBusRow());
        saveRunCutBtn.addEventListener('click', handleSaveSchedule);
        loadRunCutBtn.addEventListener('click', showLoadScheduleModal);
        clearRunCutBtn.addEventListener('click', handleClearSchedule);
        modalCloseBtn.addEventListener('click', hideLoadScheduleModal);
        loadModal.addEventListener('click', (event) => { if (event.target === loadModal) hideLoadScheduleModal(); });
        runSimulationBtn.addEventListener('click', handleRunSimulation);
        closeResultsBtn.addEventListener('click', hideResults);
        gridTableBody.addEventListener('mousedown', handleGridMouseDown);
        gridTableBody.addEventListener('mouseover', handleGridMouseOver);
        document.addEventListener('mouseup', handleGridMouseUp); 
        gridTableBody.addEventListener('blur', handleGridBlur, true); 
        gridTableBody.addEventListener('change', handleGridChange); 
        activityButtons.forEach(btn => btn.addEventListener('click', handleActivitySelection));
        popoverCancelBtn.addEventListener('click', hidePopover);
        chargerSelect.addEventListener('change', handleChargerSelection);
        gridTableBody.addEventListener('dragstart', (e) => e.preventDefault());
        runCutNameInput.addEventListener('input', saveCurrentEditorState);
    }

    // --- Grid Generation ---
    function generateGridHeader() { 
        const thead = gridTable.querySelector('thead') || gridTable.createTHead();
        thead.innerHTML = '';
        const headerRow = thead.insertRow();
        headerRow.innerHTML = '<th>Bus Name</th><th>Type</th><th>Start SOC (%)</th>';
        for (let i = 0; i < NUM_TIME_SLOTS; i++) { 
            const th = document.createElement('th'); 
            const timeStringWithBreak = minutesToTime(i * SLOT_DURATION_MINUTES); 
            th.innerHTML = timeStringWithBreak; 
            th.title = `Time Slot ${i} (${timeStringWithBreak.replace('<br>', ':')})`; 
            headerRow.appendChild(th); 
        }
        headerRow.insertCell().outerHTML = '<th>Actions</th>';
    }
    function minutesToTime(totalMinutes) { 
        const hours = Math.floor(totalMinutes / 60).toString().padStart(2, '0'); 
        const minutes = (totalMinutes % 60).toString().padStart(2, '0'); 
        return `${hours}<br>${minutes}`; 
    }

    function addBusRow(busData = null) { 
        const isNewBus = !busData;
        if (isNewBus) {
            const uniqueId = `Bus-${Date.now().toString().slice(-5)}-${Math.random().toString(36).substr(2, 3)}`;
            let nextBusNum = 1;
            while (runCutData.buses.some(b => b.busName === `Bus ${nextBusNum}`)) { nextBusNum++; }
            const defaultName = `Bus ${nextBusNum}`;
            busData = { busId: uniqueId, busName: defaultName, busType: 'BEB', startSOC: 90, schedule: Array(NUM_TIME_SLOTS).fill(null) };
            runCutData.buses.push(busData);
        }
        const busIndex = runCutData.buses.findIndex(b => b.busId === busData.busId);
        if (busIndex === -1 && !isNewBus) { console.error("Render failed: Bus data not found for existing ID:", busData.busId); return; }
        const row = gridTableBody.insertRow(); 
        row.dataset.busId = busData.busId;
        if (busData.busType === 'Diesel') { row.classList.add('diesel-row'); }
        populateBusRow(row, busData);
        if (isNewBus) { console.log(`Added new bus row: ID=${busData.busId}, Name=${busData.busName}`); saveCurrentEditorState(); }
    }

    function populateBusRow(rowElement, busData) { 
        rowElement.innerHTML = '';
        const busId = busData.busId;
        const nameCell = rowElement.insertCell(); nameCell.contentEditable = true; nameCell.classList.add('bus-name-cell'); nameCell.dataset.busId = busId; nameCell.textContent = busData.busName || busId;
        const typeCell = rowElement.insertCell(); const typeSelect = document.createElement('select'); typeSelect.classList.add('bus-type-select'); typeSelect.dataset.busId = busId; const bebOption = document.createElement('option'); bebOption.value = 'BEB'; bebOption.textContent = 'BEB'; const dieselOption = document.createElement('option'); dieselOption.value = 'Diesel'; dieselOption.textContent = 'Diesel'; typeSelect.appendChild(bebOption); typeSelect.appendChild(dieselOption); typeSelect.value = busData.busType || 'BEB'; typeCell.appendChild(typeSelect);
        const socCell = rowElement.insertCell(); const socInput = document.createElement('input'); socInput.type = 'number'; socInput.value = busData.startSOC; socInput.min = 0; socInput.max = 100; socInput.classList.add('start-soc-input'); socInput.dataset.busId = busId; socInput.addEventListener('change', handleSocChange); if (busData.busType === 'Diesel') { socInput.disabled = true; socInput.style.backgroundColor = '#eee'; socInput.value = ''; } socCell.appendChild(socInput); socCell.appendChild(document.createTextNode(' %'));
        for (let i = 0; i < NUM_TIME_SLOTS; i++) {
            const cell = rowElement.insertCell(); cell.classList.add('time-slot'); cell.dataset.busId = busId; cell.dataset.timeSlot = i;
            const scheduleEntry = busData.schedule[i];
            updateCellVisual(cell, scheduleEntry);
        }
        const actionCell = rowElement.insertCell(); const removeBtn = document.createElement('button'); removeBtn.textContent = '🗑️ Remove'; removeBtn.classList.add('remove-bus-btn'); removeBtn.dataset.busId = busId; removeBtn.addEventListener('click', handleRemoveBus); actionCell.appendChild(removeBtn);
    }

    function renderAllBusRows() { 
        gridTableBody.innerHTML = ''; 
        if (runCutData.buses && runCutData.buses.length > 0) { 
            runCutData.buses.forEach(bus => { addBusRow(bus); }); 
            console.log("Rendered all bus rows from schedule data."); 
        } else { 
            console.log("No bus data to render. Grid is empty."); 
        } 
    }

    function handleGridMouseDown(event) {
        if (event.button !== 0 || event.target.tagName === 'INPUT' || event.target.tagName === 'BUTTON' || event.target.tagName === 'SELECT' || event.target.isContentEditable) return;
        const targetCell = event.target.closest('.time-slot');
        if (targetCell) {
            const targetBusId = targetCell.dataset.busId;
            event.preventDefault(); isDragging = true; dragStartCell = targetCell; dragStartBusId = targetBusId; dragStartTimeslot = parseInt(targetCell.dataset.timeSlot); dragCurrentEndTimeslot = dragStartTimeslot; console.log(`MouseDown: Target Bus ID: ${dragStartBusId}, Slot: ${dragStartTimeslot}`); clearRangeSelection(); targetCell.classList.add('range-selected');
        }
    }
    function handleGridMouseOver(event) { if (!isDragging || !dragStartCell) return; const targetCell = event.target.closest('.time-slot'); if (targetCell && targetCell.dataset.busId === dragStartBusId) { const currentTimeslot = parseInt(targetCell.dataset.timeSlot); if(currentTimeslot !== dragCurrentEndTimeslot) { dragCurrentEndTimeslot = currentTimeslot; highlightRange(); } } }
    function handleGridMouseUp(event) { if (!isDragging) return; isDragging = false; if (!dragStartCell) return; const startIndex = Math.min(dragStartTimeslot, dragCurrentEndTimeslot); const endIndex = Math.max(dragStartTimeslot, dragCurrentEndTimeslot); console.log(`MouseUp: Started on Bus ID ${dragStartBusId}, Final Range Slots ${startIndex}-${endIndex}`); currentBusId = dragStartBusId; currentBusIndex = runCutData.buses.findIndex(b => b.busId === currentBusId); console.log(`MouseUp: Set currentBusId: ${currentBusId}, Found currentBusIndex: ${currentBusIndex}`); if (currentBusIndex === -1) { console.error("!!! Bus data not found in runCutData.buses for ID:", currentBusId); resetDragState(); return; } rangeStartTimeSlot = startIndex; rangeEndTimeSlot = endIndex; const firstCellInSelection = gridTableBody.querySelector(`td.time-slot[data-bus-id="${currentBusId}"][data-time-slot="${startIndex}"]`); currentEditingCell = firstCellInSelection || dragStartCell; if (currentEditingCell) { showPopover(currentEditingCell); } else { console.error("Could not find cell to position popover."); } resetDragState(); }
    function resetDragState() { dragStartCell = null; dragStartBusId = null; dragStartTimeslot = -1; dragCurrentEndTimeslot = -1; }

    function handleGridBlur(event) { if (event.target.classList.contains('bus-name-cell') && event.target.isContentEditable) { const cell = event.target; const busId = cell.dataset.busId; const busIndex = runCutData.buses.findIndex(b => b.busId === busId); if (busIndex !== -1) { const newName = cell.textContent.trim(); const oldName = runCutData.buses[busIndex].busName; if (newName && oldName !== newName) { console.log(`Bus Name Changed: ID ${busId}, From "${oldName}" to "${newName}"`); runCutData.buses[busIndex].busName = newName; saveCurrentEditorState(); showStatusMessage(runCutStatus, `Bus "${newName}" name updated.`); if (activityPopover.style.display === 'block' && currentBusId === busId) { const popoverBusName = popoverCellInfo.textContent.split(',')[0].split(':')[1].trim(); if (popoverBusName === oldName) { popoverCellInfo.textContent = popoverCellInfo.textContent.replace(`Bus: ${oldName}`, `Bus: ${newName}`); } } } else if (!newName) { cell.textContent = oldName || busId; console.warn(`Bus Name cannot be empty for Bus ID ${busId}. Reverted.`); } } } }
    function handleGridChange(event) { const target = event.target; const busId = target.dataset.busId; const busIndex = runCutData.buses.findIndex(b => b.busId === busId); if (busIndex === -1) return; if (target.classList.contains('bus-type-select')) { const newType = target.value; if (runCutData.buses[busIndex].busType !== newType) { console.log(`Bus Type Changed: ID ${busId}, From "${runCutData.buses[busIndex].busType}" to "${newType}"`); runCutData.buses[busIndex].busType = newType; const busData = runCutData.buses[busIndex]; const rowElement = gridTableBody.querySelector(`tr[data-bus-id="${busId}"]`); if(rowElement) { populateBusRow(rowElement, busData); if (newType === 'Diesel') { rowElement.classList.add('diesel-row'); } else { rowElement.classList.remove('diesel-row'); } } saveCurrentEditorState(); showStatusMessage(runCutStatus, `Bus "${busData.busName || busId}" type set to ${newType}.`); } } else if (target.classList.contains('start-soc-input')) { handleSocChange(event); } }

    function handleSocChange(event) { const input = event.target; const busId = input.dataset.busId; const busIndex = runCutData.buses.findIndex(b => b.busId === busId); if (busIndex === -1) return; let newSoc = parseInt(input.value); if (isNaN(newSoc)) newSoc = 0; newSoc = Math.max(0, Math.min(100, newSoc)); input.value = newSoc; runCutData.buses[busIndex].startSOC = newSoc; console.log(`Bus ID ${busId} Start SOC updated to: ${newSoc}`); saveCurrentEditorState(); }
    function handleRemoveBus(event) { const button = event.target.closest('.remove-bus-btn'); const busId = button?.dataset.busId; if (!busId) return; const busToRemove = runCutData.buses.find(b => b.busId === busId); const nameForConfirm = busToRemove ? busToRemove.busName || busId : busId; if (confirm(`Are you sure you want to remove Bus "${nameForConfirm}" and its schedule?`)) { const busIndexToRemove = runCutData.buses.findIndex(b => b.busId === busId); if (busIndexToRemove > -1) { runCutData.buses.splice(busIndexToRemove, 1); const rowToRemove = gridTableBody.querySelector(`tr[data-bus-id="${busId}"]`); if (rowToRemove) rowToRemove.remove(); showStatusMessage(runCutStatus, `Bus "${nameForConfirm}" removed.`); saveCurrentEditorState(); } } }

    function showPopover(targetCell) { if (!targetCell) return; const rect = targetCell.getBoundingClientRect(); const scrollTop = window.pageYOffset || document.documentElement.scrollTop; const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft; activityPopover.style.top = `${rect.bottom + scrollTop + 5}px`; activityPopover.style.left = `${rect.left + scrollLeft}px`; activityPopover.style.display = 'block'; const startTime = minutesToTime(rangeStartTimeSlot * SLOT_DURATION_MINUTES).replace('<br>',':'); let timeRangeText = startTime; if (rangeStartTimeSlot !== rangeEndTimeSlot) { const endTimeMinutes = (rangeEndTimeSlot + 1) * SLOT_DURATION_MINUTES; const endTime = minutesToTime(endTimeMinutes - SLOT_DURATION_MINUTES).replace('<br>',':'); timeRangeText = `${startTime} - ${endTime}`; } const busData = runCutData.buses.find(b => b.busId === currentBusId); const displayName = busData ? busData.busName || busData.busId : currentBusId; popoverCellInfo.textContent = `Bus: ${displayName}, Time: ${timeRangeText}`; chargeOptionsDiv.style.display = 'none'; chargerSelect.value = ""; }
    function hidePopover() { activityPopover.style.display = 'none'; clearRangeSelection(); currentEditingCell = null; currentBusId = null; currentBusIndex = -1; rangeStartTimeSlot = -1; rangeEndTimeSlot = -1; }
    function handleActivitySelection(event) {
        const selectedActivity = event.target.dataset.activity;
        console.log("Selected Activity for range:", selectedActivity);
        if (currentBusIndex < 0 || rangeStartTimeSlot < 0 || rangeEndTimeSlot < 0) { console.error("Invalid state for activity selection."); hidePopover(); return; }
        const currentBus = runCutData.buses[currentBusIndex];
        if (currentBus.busType === 'Diesel' && selectedActivity === 'CHARGE') {
            alert("Diesel buses cannot be assigned a CHARGE activity.");
            return; 
        }
        if (selectedActivity === 'CHARGE') {
            populateChargerSelect();
            chargeOptionsDiv.style.display = 'block';
        } else {
            const scheduleEntry = { activity: selectedActivity, chargerId: null };
            updateScheduleRange(scheduleEntry);
        }
    }
    function handleChargerSelection() { const selectedChargerId = chargerSelect.value; if (currentBusIndex < 0 || rangeStartTimeSlot < 0 || rangeEndTimeSlot < 0 || !selectedChargerId) { console.log("Charger selection requires valid range and charger choice."); return; } const scheduleEntry = { activity: 'CHARGE', chargerId: selectedChargerId }; updateScheduleRange(scheduleEntry); }
    function populateChargerSelect() { chargerSelect.innerHTML = '<option value="">--Select Charger--</option>'; if (availableChargers.length === 0) { chargerSelect.innerHTML = '<option value="" disabled>No Chargers Configured</option>'; } else { availableChargers.forEach(charger => { const option = document.createElement('option'); option.value = charger.id; option.textContent = `${charger.name} (${charger.rate} kW)`; chargerSelect.appendChild(option); }); } }

    function updateScheduleRange(scheduleEntry) {
        if (currentBusIndex < 0 || rangeStartTimeSlot < 0 || rangeEndTimeSlot < 0 || !runCutData.buses[currentBusIndex]) { console.error("Invalid state for updating schedule range. Aborting."); hidePopover(); return; }
        const currentBus = runCutData.buses[currentBusIndex];
        if (currentBus.busType === 'Diesel' && scheduleEntry.activity === 'CHARGE') {
            console.warn(`Attempted to save CHARGE activity for Diesel bus ID ${currentBus.busId}. Skipping.`);
            hidePopover(); 
            return;
        }
        if (scheduleEntry.activity === 'CHARGE' && scheduleEntry.chargerId && currentBus.busType === 'BEB') {
            for (let i = rangeStartTimeSlot; i <= rangeEndTimeSlot; i++) {
                for (let busIdx = 0; busIdx < runCutData.buses.length; busIdx++) {
                    if (busIdx === currentBusIndex) continue;
                    const otherBus = runCutData.buses[busIdx];
                    if (otherBus.busType === 'Diesel') continue; 
                    const otherBusSchedule = otherBus.schedule[i];
                    if (otherBusSchedule && otherBusSchedule.activity === 'CHARGE' && otherBusSchedule.chargerId === scheduleEntry.chargerId) {
                        const conflictTime = minutesToTime(i * SLOT_DURATION_MINUTES).replace('<br>',':');
                        const conflictBusName = otherBus.busName || otherBus.busId;
                        const charger = availableChargers.find(ch => ch.id === scheduleEntry.chargerId);
                        const chargerName = charger ? charger.name : scheduleEntry.chargerId;
                        alert(`Conflict detected!\nCharger "${chargerName}" is already assigned to Bus "${conflictBusName}" at ${conflictTime}.`); return;
                    }
                }
            }
        }
        console.log(`updateScheduleRange: Attempting update for Bus ID: ${currentBusId}, Index: ${currentBusIndex}, Slots: ${rangeStartTimeSlot}-${rangeEndTimeSlot}`);
        const busRowElement = gridTableBody.querySelector(`tr[data-bus-id="${currentBusId}"]`);
        if (!busRowElement) { console.error(`!!! updateScheduleRange: Could not find bus row element for ID: ${currentBusId}`); hidePopover(); return; }
        for (let i = rangeStartTimeSlot; i <= rangeEndTimeSlot; i++) {
            runCutData.buses[currentBusIndex].schedule[i] = { ...scheduleEntry };
            const cellElement = busRowElement.querySelector(`td.time-slot[data-time-slot="${i}"]`);
            if(cellElement) { cellElement.classList.remove('range-selected'); updateCellVisual(cellElement, scheduleEntry); }
            else { console.warn(`!!! updateScheduleRange: Could not find cell element for Bus ${currentBusId}, Slot ${i}`); }
        }
        console.log(`Updated Bus ${currentBus.busName || currentBus.busId}, Slots ${rangeStartTimeSlot}-${rangeEndTimeSlot}:`, scheduleEntry);
        saveCurrentEditorState(); hidePopover();
    }

    function updateCellVisual(cellElement, scheduleEntry) {
        cellElement.innerHTML = ''; cellElement.style.backgroundColor = ''; cellElement.style.fontWeight = 'normal'; 
        const busId = cellElement.dataset.busId; const timeSlot = parseInt(cellElement.dataset.timeSlot);
        const time = minutesToTime(timeSlot * SLOT_DURATION_MINUTES).replace('<br>',':');
        const busData = runCutData.buses.find(b=>b.busId===busId);
        let baseTooltip = `Bus: ${busData?.busName || busId}, Time: ${time}`;

         if (busData?.busType === 'Diesel') {
             cellElement.style.backgroundColor = '#e9ecef'; 
             cellElement.title = baseTooltip + "\n(Diesel)";
         } else {
              cellElement.style.pointerEvents = 'auto';
         }

        if (!scheduleEntry) { cellElement.title = baseTooltip; return; } 

        let cellText = ''; let bgColor = ''; let tooltipText = `${baseTooltip}\nActivity: ${scheduleEntry.activity}`;
        switch (scheduleEntry.activity) {
            case 'RUN': cellText = 'R'; bgColor = '#add8e6'; break;
            case 'BREAK': cellText = 'B'; bgColor = '#fffacd'; break;
            case 'CHARGE':
                if (busData?.busType === 'Diesel') {
                     cellText = '-'; 
                     bgColor = '#e9ecef';
                     tooltipText += ' (Invalid for Diesel)';
                } else {
                    cellText = 'C'; bgColor = '#90ee90';
                    if (scheduleEntry.chargerId) { const charger = availableChargers.find(ch => ch.id === scheduleEntry.chargerId); const chargerName = charger ? charger.name : 'Unknown'; tooltipText += `\nCharger: ${chargerName} (${scheduleEntry.chargerId || 'None'})`; }
                    else { tooltipText += `\nCharger: None assigned`; }
                }
                break;
            case 'DEADHEAD': cellText = 'DH'; bgColor = '#cccccc'; break; 
            default: cellText = '?'; bgColor = '#eee'; break;
        }
        cellElement.style.backgroundColor = (busData?.busType === 'Diesel') ? '#e9ecef' : bgColor;
        cellElement.textContent = cellText;
        cellElement.title = tooltipText;
    }

    function loadChargerData() { 
        const storedChargers = localStorage.getItem('chargers'); 
        try { 
            availableChargers = storedChargers ? JSON.parse(storedChargers) : []; 
            console.log("Available chargers loaded:", availableChargers); 
        } catch (e) { 
            console.error("Error parsing available chargers:", e); 
            availableChargers = []; 
        } 
    }

    // --- MODIFIED loadBusParameters FUNCTION ---
    function loadBusParameters() {
        console.log("---- In run_cut_editor.js: Attempting to load parameters for simulation ----");
        currentBusParameters = null; // Reset or ensure it's null if loading fails

        const essCapacityStr = localStorage.getItem('busESSCapacity');
        const euRateStr = localStorage.getItem('euRate');
        const lowSOCStr = localStorage.getItem('lowSOCThreshold');
        const criticalSOCStr = localStorage.getItem('criticalSOCThreshold');
        // Note: Chargers are loaded separately into availableChargers by loadChargerData()

        console.log("Raw from localStorage - busESSCapacity:", essCapacityStr);
        console.log("Raw from localStorage - euRate:", euRateStr);
        console.log("Raw from localStorage - lowSOCThreshold:", lowSOCStr);
        console.log("Raw from localStorage - criticalSOCThreshold:", criticalSOCStr);

        const essCapacity = parseFloat(essCapacityStr);
        const euRate = parseFloat(euRateStr);
        const lowSOCThreshold = parseFloat(lowSOCStr);
        const criticalSOCThreshold = parseFloat(criticalSOCStr);

        console.log("Parsed - busESSCapacity:", essCapacity);
        console.log("Parsed - euRate:", euRate);
        console.log("Parsed - lowSOCThreshold:", lowSOCThreshold);
        console.log("Parsed - criticalSOCThreshold:", criticalSOCThreshold);

        // Validation (this is the part that triggers the alert)
        if (isNaN(essCapacity) || essCapacity <= 0 ||
            isNaN(euRate) || euRate < 0 || // Allow 0 for euRate
            isNaN(lowSOCThreshold) || lowSOCThreshold < 0 || lowSOCThreshold > 100 ||
            isNaN(criticalSOCThreshold) || criticalSOCThreshold < 0 || criticalSOCThreshold > 100) {
            
            console.error("Parameter validation failed in run_cut_editor.js:", {essCapacity, euRate, lowSOCThreshold, criticalSOCThreshold});
            alert("Error: Bus parameters have not been configured or saved correctly. Please go to the Configuration tab and save valid parameters.");
            return false; // Indicate failure
        }
        
        // Additional validation based on your config page logic
        if (lowSOCThreshold <= criticalSOCThreshold) {
            alert("Error: Low SOC warning threshold must be higher than Critical SOC threshold. Check Configuration.");
            return false;
        }
        if (criticalSOCThreshold < 5) { // Match constraint from config page
            alert("Error: Critical SOC warning threshold should be >= 5%. Check Configuration.");
            return false;
        }


        // If all checks pass, store them in currentBusParameters
        currentBusParameters = {
            essCapacity: essCapacity,
            euRate: euRate,
            warningThresholdLow: lowSOCThreshold,      // Ensure key names match what simulation.js expects
            warningThresholdCritical: criticalSOCThreshold // Ensure key names match what simulation.js expects
        };
        console.log("Bus parameters loaded successfully for simulation:", currentBusParameters);
        return true; // Indicate success
    }
    // ------------------------------------------

    function saveCurrentEditorState() { 
        runCutData.name = runCutNameInput.value.trim(); 
        try { 
            localStorage.setItem(EDITOR_LAST_STATE_KEY, JSON.stringify(runCutData)); 
        } catch (e) { 
            console.error("Error auto-saving editor state:", e); 
        } 
    }
    function loadLastEditorState() { 
        const savedState = localStorage.getItem(EDITOR_LAST_STATE_KEY); 
        if (savedState) { 
            try { 
                const loadedData = JSON.parse(savedState); 
                if (loadedData && typeof loadedData === 'object' && Array.isArray(loadedData.buses)) { 
                    loadedData.buses.forEach((bus, index) => { 
                        if (!bus.busId) bus.busId = `Loaded-${index}-${Date.now()}`; 
                        if (bus.busName === undefined) bus.busName = bus.busId; 
                        if (!bus.busType) bus.busType = 'BEB'; 
                    }); 
                    runCutData = loadedData; 
                    runCutNameInput.value = runCutData.name || ''; 
                    console.log("Loaded last editor state (processed):", runCutData); 
                    if (runCutData.buses.length === 0) { 
                        console.log("Loaded state has no buses, adding one default bus."); 
                        addBusRow(); 
                    } 
                } else { 
                    console.warn("Invalid data structure found in last editor state. Initializing fresh."); 
                    initializeEmptyScheduleDataAndAddDefaultBus(); 
                } 
            } catch (e) { 
                console.error("Error parsing last editor state:", e, ". Initializing fresh."); 
                initializeEmptyScheduleDataAndAddDefaultBus(); 
            } 
        } else { 
            console.log("No previous editor state found. Initializing fresh."); 
            initializeEmptyScheduleDataAndAddDefaultBus(); 
        } 
    }
    function initializeEmptyScheduleData() { 
        runCutData = { name: '', buses: [] }; 
        runCutNameInput.value = ''; 
        console.log("Initialized empty schedule data structure."); 
    }
    function initializeEmptyScheduleDataAndAddDefaultBus() { 
        initializeEmptyScheduleData(); 
        addBusRow(); 
    }

    function handleSaveSchedule() { 
        const name = runCutNameInput.value.trim(); 
        if (!name) { alert("Please enter a name for the schedule before saving."); runCutNameInput.focus(); return; } 
        runCutData.name = name; 
        try { 
            const storageKey = RUN_CUT_PREFIX + name; 
            localStorage.setItem(storageKey, JSON.stringify(runCutData)); 
            console.log("Schedule Saved:", runCutData); 
            showStatusMessage(runCutStatus, `Schedule "${name}" saved successfully!`); 
        } catch (e) { 
            console.error("Error saving schedule:", e); 
            showStatusMessage(runCutStatus, "Error saving schedule.", true); 
            alert("Error saving schedule."); 
        } 
    }
    function showLoadScheduleModal() { 
        console.log("Opening load schedule modal..."); 
        modalRunCutList.innerHTML = ''; 
        let savedScheduleNames = []; 
        try { 
            for (let i = 0; i < localStorage.length; i++) { 
                const key = localStorage.key(i); 
                if (key.startsWith(RUN_CUT_PREFIX)) { 
                    savedScheduleNames.push(key.substring(RUN_CUT_PREFIX.length)); 
                } 
            } 
        } catch (e) { 
            console.error("Error accessing localStorage:", e); 
            modalRunCutList.innerHTML = '<p style="color: red;">Error accessing saved schedules.</p>'; 
            loadModal.style.display = 'block'; return; 
        } 
        if (savedScheduleNames.length === 0) { 
            modalRunCutList.innerHTML = '<p>No saved schedules found.</p>'; 
        } else { 
            const list = document.createElement('ul'); 
            savedScheduleNames.sort().forEach(name => { 
                const listItem = document.createElement('li'); 
                const nameSpan = document.createElement('span'); 
                nameSpan.textContent = name; nameSpan.style.flexGrow = '1'; nameSpan.style.marginRight = '10px'; 
                const buttonGroup = document.createElement('div'); 
                const loadBtn = document.createElement('button'); 
                loadBtn.textContent = 'Load'; loadBtn.dataset.runCutName = name; loadBtn.addEventListener('click', handleModalLoadClick); 
                const deleteBtn = document.createElement('button'); 
                deleteBtn.textContent = 'Delete'; deleteBtn.classList.add('delete-btn'); deleteBtn.dataset.runCutName = name; deleteBtn.addEventListener('click', handleModalDeleteClick); 
                buttonGroup.appendChild(loadBtn); buttonGroup.appendChild(deleteBtn); 
                listItem.appendChild(nameSpan); listItem.appendChild(buttonGroup); 
                list.appendChild(listItem); 
            }); 
            modalRunCutList.appendChild(list); 
        } 
        loadModal.style.display = 'block'; 
    }
    function hideLoadScheduleModal() { loadModal.style.display = 'none'; }
    function handleModalLoadClick(event) { const button = event.target; const nameToLoad = button.dataset.runCutName; if (!nameToLoad) { console.error("Could not find schedule name on button:", button); return; } console.log(`Load button clicked for: ${nameToLoad}`); performLoad(nameToLoad); hideLoadScheduleModal(); }
    function performLoad(nameToLoad) { const storageKey = RUN_CUT_PREFIX + nameToLoad; const savedDataString = localStorage.getItem(storageKey); if (!savedDataString) { alert(`Schedule named "${nameToLoad}" not found.`); console.warn("Load failed: Schedule not found:", storageKey); return; } try { const loadedData = JSON.parse(savedDataString); if (loadedData && typeof loadedData === 'object' && Array.isArray(loadedData.buses)) { loadedData.buses.forEach((bus, index) => { if (!bus.busId) bus.busId = `Loaded-${index}-${Date.now()}`; if (bus.busName === undefined) bus.busName = bus.busId; if (!bus.busType) bus.busType = 'BEB'; }); runCutData = loadedData; runCutNameInput.value = runCutData.name || ''; console.log("Schedule Loaded (processed):", runCutData); clearSimulationColoring(); renderAllBusRows(); saveCurrentEditorState(); showStatusMessage(runCutStatus, `Schedule "${nameToLoad}" loaded successfully.`); } else { alert(`Error: Data for "${nameToLoad}" is invalid.`); console.error("Load failed: Invalid data structure.", loadedData); } } catch (e) { alert(`Error parsing data for "${nameToLoad}".`); console.error("Load failed: Error parsing JSON:", e); } }
    function handleModalDeleteClick(event) { const button = event.target; const nameToDelete = button.dataset.runCutName; if (!nameToDelete) { console.error("Could not find schedule name on delete button:", button); return; } if (confirm(`Are you sure you want to permanently delete the schedule named "${nameToDelete}"?`)) { console.log(`Delete button clicked for: ${nameToDelete}`); const storageKey = RUN_CUT_PREFIX + nameToDelete; try { localStorage.removeItem(storageKey); console.log(`Removed item: ${storageKey}`); const listItemToRemove = button.closest('li'); if (listItemToRemove) { listItemToRemove.remove(); } const remainingItems = modalRunCutList.querySelectorAll('li'); if (remainingItems.length === 0) { modalRunCutList.innerHTML = '<p>No saved schedules found.</p>'; } showStatusMessage(runCutStatus, `Schedule "${nameToDelete}" deleted.`); } catch (e) { console.error("Error removing item:", e); alert(`Could not delete schedule "${nameToDelete}".`); } } else { console.log(`Deletion cancelled for: ${nameToDelete}`); } }
    function handleClearSchedule() { if (confirm("Are you sure you want to clear the current schedule? Any unsaved changes will be lost.")) { console.log("Clearing current schedule..."); clearSimulationColoring(); initializeEmptyScheduleData(); addBusRow(); renderAllBusRows(); showStatusMessage(runCutStatus, "Schedule cleared."); } else { console.log("Clear cancelled by user."); } }

    function clearSimulationColoring() { console.log("Clearing simulation grid colors..."); const allTimeCells = gridTableBody.querySelectorAll('td.time-slot'); allTimeCells.forEach(cell => { const busId = cell.dataset.busId; const timeSlot = parseInt(cell.dataset.timeSlot); const busData = runCutData.buses.find(b => b.busId === busId); const scheduleEntry = busData?.schedule[timeSlot] || null; updateCellVisual(cell, scheduleEntry); }); }
    
    // --- MODIFIED handleRunSimulation to call the new loadBusParameters
    function handleRunSimulation() {
        console.log("Run Simulation button clicked.");
        resultsOutput.innerHTML = '<p>Running simulation...</p>';
        resultsContainer.style.display = 'block';
        clearSimulationColoring();

        if (!loadBusParameters()) { // Call loadBusParameters here and check its return value
            resultsOutput.innerHTML = '<p style="color: red;">Simulation cancelled: Bus parameters not configured or invalid. Please check the Configuration page.</p>';
            // No need for the alert here, as loadBusParameters already shows one.
            return; 
        }

        runCutData.name = runCutNameInput.value.trim(); 

        // Check if the global runSimulation function (from simulation.js) exists
        if (typeof window.runSimulation !== 'function') { 
            console.error("Simulation function 'window.runSimulation' not found or not a function.");
            resultsOutput.innerHTML = '<p style="color: red;">Critical Error: Simulation engine (simulation.js) not loaded correctly.</p>';
            return; 
        }
        
        // Ensure availableChargers is up-to-date (it's loaded in initializeEditor, but good to be sure)
        loadChargerData(); 

        console.log("Calling simulation engine with parameters:", currentBusParameters, "and chargers:", availableChargers);
        const simulationResults = window.runSimulation(runCutData, currentBusParameters, availableChargers); // Call the global one
        
        displaySimulationResults(simulationResults);
        applySimulationColoring(simulationResults);
    }
    // -------------------------------------------------------------------

    function applySimulationColoring(results) { console.log("Applying simulation grid colors..."); if (!results || !results.resultsPerBus) { console.warn("No bus results found to apply coloring."); return; } for (const busId in results.resultsPerBus) { const busResult = results.resultsPerBus[busId]; if (busResult.isDiesel) continue; const triggers = busResult.triggerTimes; const busRow = gridTableBody.querySelector(`tr[data-bus-id="${busId}"]`); if (!busRow || !triggers) { console.warn(`Skipping coloring for bus ${busId} - row or triggers not found.`); continue; } const timeCells = busRow.querySelectorAll('td.time-slot'); timeCells.forEach(cell => { const timeSlotIndex = parseInt(cell.dataset.timeSlot); const isStranded = triggers.stranded !== null && timeSlotIndex >= triggers.stranded; const isCritical = triggers.critical !== null && timeSlotIndex >= triggers.critical; const isLow = triggers.low !== null && timeSlotIndex >= triggers.low; if (isStranded) { cell.style.backgroundColor = COLOR_WARNING_STRANDED; cell.style.fontWeight = 'bold'; if (cell.textContent === 'R' || cell.textContent === 'DH') { cell.textContent = 'X'; } } else if (isCritical) { cell.style.backgroundColor = COLOR_WARNING_CRITICAL; cell.style.fontWeight = 'normal'; } else if (isLow) { cell.style.backgroundColor = COLOR_WARNING_LOW; cell.style.fontWeight = 'normal'; } }); } }
    function displaySimulationResults(results) { console.log("Displaying simulation results:", results); resultsOutput.innerHTML = ''; if (results.overallErrors && results.overallErrors.length > 0) { const errorList = document.createElement('ul'); results.overallErrors.forEach(err => { const item = document.createElement('li'); item.textContent = err; item.style.color = 'red'; errorList.appendChild(item); }); resultsOutput.appendChild(errorList); return; } if (!results.resultsPerBus || Object.keys(results.resultsPerBus).length === 0) { resultsOutput.innerHTML = '<p>Simulation ran, but no results were generated.</p>'; return; } for (const busId in results.resultsPerBus) { const busResult = results.resultsPerBus[busId]; const originalBusData = runCutData.buses.find(b => b.busId === busId); const busName = originalBusData?.busName || busId; const startSOC = originalBusData ? originalBusData.startSOC : 0; const busDiv = document.createElement('div'); busDiv.style.marginBottom = '15px'; busDiv.style.borderBottom = '1px solid #eee'; busDiv.style.paddingBottom = '10px'; const title = document.createElement('h4'); title.textContent = `Bus: ${busName}`; busDiv.appendChild(title); if (busResult.isDiesel) { const dieselMsg = document.createElement('p'); dieselMsg.textContent = "Diesel Bus - Simulation N/A."; dieselMsg.style.fontStyle = 'italic'; busDiv.appendChild(dieselMsg); resultsOutput.appendChild(busDiv); continue; } if (busResult.errors && busResult.errors.length > 0) { const issueTitle = document.createElement('p'); issueTitle.textContent = 'Potential Issues / Warnings:'; issueTitle.style.fontWeight = 'bold'; busDiv.appendChild(issueTitle); const issueList = document.createElement('ul'); busResult.errors.forEach(errText => { const item = document.createElement('li'); item.textContent = errText; const lowerErrText = errText.toLowerCase(); if (lowerErrText.includes('stranded')) { item.style.color = 'red'; item.style.fontWeight = 'bold'; } else if (lowerErrText.includes('critical soc')) { item.style.color = 'red'; } else if (lowerErrText.includes('low soc warning')) { item.style.color = 'darkorange'; } else if (lowerErrText.includes('error')) { item.style.color = 'purple'; } issueList.appendChild(item); }); busDiv.appendChild(issueList); } else { const noIssues = document.createElement('p'); noIssues.textContent = 'No SOC warnings or schedule/config errors detected.'; noIssues.style.color = 'green'; busDiv.appendChild(noIssues); } if (busResult.socTimeSeries && busResult.socTimeSeries.length > 0) { const finalSOC = busResult.socTimeSeries[busResult.socTimeSeries.length - 1]; const minSOC = Math.min(...busResult.socTimeSeries); const summaryP = document.createElement('p'); summaryP.innerHTML = `Ending SOC: <strong>${finalSOC.toFixed(1)}%</strong> / Minimum SOC: <strong>${minSOC.toFixed(1)}%</strong>`; if (minSOC < (currentBusParameters?.warningThresholdCritical ?? 10)) { summaryP.querySelector('strong:last-of-type').style.color = 'red'; } else if (minSOC < (currentBusParameters?.warningThresholdLow ?? 20)) { summaryP.querySelector('strong:last-of-type').style.color = 'darkorange'; } busDiv.appendChild(summaryP); } else { const noSocP = document.createElement('p'); noSocP.textContent = "No SOC data generated."; busDiv.appendChild(noSocP); } const energyP = document.createElement('p'); const internalConsumed = busResult.totalEnergyConsumedKWh ?? 0; const charged = busResult.totalEnergyChargedKWh ?? 0; const essCapacity = currentBusParameters?.essCapacity ?? 0; const initialEnergy = (startSOC / 100) * essCapacity; const maxPossibleConsumed = initialEnergy + charged; let displayConsumed = internalConsumed; if (essCapacity > 0 && internalConsumed > (maxPossibleConsumed + 0.01)) { console.warn(`Bus ${busName}: Capping displayed consumed energy. Internal value (${internalConsumed.toFixed(1)} kWh) exceeded max possible (${maxPossibleConsumed.toFixed(1)} kWh).`); displayConsumed = maxPossibleConsumed; } energyP.innerHTML = `Energy Consumed: <strong>${displayConsumed.toFixed(1)} kWh</strong> / Energy Charged: <strong>${charged.toFixed(1)} kWh</strong>`; busDiv.appendChild(energyP); resultsOutput.appendChild(busDiv); } }
    function hideResults() { resultsContainer.style.display = 'none'; resultsOutput.innerHTML = ''; clearSimulationColoring(); }

    function highlightRange() { clearRangeSelection(); const startIndex = Math.min(dragStartTimeslot, dragCurrentEndTimeslot); const endIndex = Math.max(dragStartTimeslot, dragCurrentEndTimeslot); const busRow = gridTableBody.querySelector(`tr[data-bus-id="${dragStartBusId}"]`); if (!busRow) return; for (let i = startIndex; i <= endIndex; i++) { const cell = busRow.querySelector(`td.time-slot[data-time-slot="${i}"]`); if (cell) cell.classList.add('range-selected'); } }
    function clearRangeSelection() { const selectedCells = gridTableBody.querySelectorAll('.time-slot.range-selected'); selectedCells.forEach(cell => cell.classList.remove('range-selected')); }

    function showStatusMessage(element, message, isError = false) { if (!element) return; element.textContent = message; element.style.color = isError ? 'red' : 'green'; setTimeout(() => { if (element.textContent === message) element.textContent = ''; }, 4000); }

    initializeEditor();
});