// Wait for the HTML DOM to be fully loaded before running the script
document.addEventListener('DOMContentLoaded', () => {

    // --- Constants ---
    const NUM_TIME_SLOTS = 96; const SLOT_DURATION_MINUTES = 15;
    const EDITOR_LAST_STATE_KEY = 'editor_lastState'; const RUN_CUT_PREFIX = 'runCut_'; // Now prefix for Schedule
    const BUS_PARAMS_KEY = 'busParameters';
    const COLOR_WARNING_LOW = 'darkorange'; const COLOR_WARNING_CRITICAL = 'red'; const COLOR_WARNING_STRANDED = 'red';

    // --- DOM Element References ---
    const runCutNameInput = document.getElementById('run-cut-name'); // Name for the schedule
    const saveRunCutBtn = document.getElementById('save-run-cut-btn'); // Save Schedule button
    const loadRunCutBtn = document.getElementById('load-run-cut-btn'); // Load Schedule button
    const clearRunCutBtn = document.getElementById('clear-run-cut-btn');
    const addBusBtn = document.getElementById('add-bus-btn');
    const runCutStatus = document.getElementById('run-cut-status'); // Status messages
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
    const modalRunCutList = document.getElementById('modal-run-cut-list'); // List in Load modal

    // --- State Variables ---
    let runCutData = { // Structure holds schedule data
        name: '',
        buses: [] // Array of bus objects { busId (internal), busName (display), busType, startSOC, schedule }
    };
    let availableChargers = [];
    let currentBusParameters = null;
    let currentEditingCell = null; let currentBusId = null; let currentBusIndex = -1;
    let rangeStartTimeSlot = -1; let rangeEndTimeSlot = -1;
    let isDragging = false; let dragStartCell = null; let dragStartBusId = null; // Still use busId internally
    let dragStartTimeslot = -1; let dragCurrentEndTimeslot = -1;


    // --- Initialization ---
    function initializeEditor() { console.log("Initializing Schedule Editor..."); loadChargerData(); generateGridHeader(); loadLastEditorState(); renderAllBusRows(); setupEventListeners(); }

    // --- Event Listeners Setup ---
    function setupEventListeners() {
        addBusBtn.addEventListener('click', () => addBusRow()); // No args needed here anymore
        saveRunCutBtn.addEventListener('click', handleSaveSchedule); // Renamed handler
        loadRunCutBtn.addEventListener('click', showLoadScheduleModal); // Renamed handler
        clearRunCutBtn.addEventListener('click', handleClearSchedule); // Renamed handler
        modalCloseBtn.addEventListener('click', hideLoadScheduleModal); // Renamed handler
        loadModal.addEventListener('click', (event) => { if (event.target === loadModal) hideLoadScheduleModal(); });
        runSimulationBtn.addEventListener('click', handleRunSimulation);
        closeResultsBtn.addEventListener('click', hideResults);
        // Grid listeners delegate from tbody
        gridTableBody.addEventListener('mousedown', handleGridMouseDown);
        gridTableBody.addEventListener('mouseover', handleGridMouseOver);
        document.addEventListener('mouseup', handleGridMouseUp); // Needs document scope
        gridTableBody.addEventListener('blur', handleGridBlur, true); // Capture blur events on editable cells, useCapture=true
        gridTableBody.addEventListener('change', handleGridChange); // Listener for dropdowns/inputs in grid
        // Popover listeners
        activityButtons.forEach(btn => btn.addEventListener('click', handleActivitySelection));
        popoverCancelBtn.addEventListener('click', hidePopover);
        chargerSelect.addEventListener('change', handleChargerSelection);
        // Other listeners
        gridTableBody.addEventListener('dragstart', (e) => e.preventDefault());
        runCutNameInput.addEventListener('input', saveCurrentEditorState);
    }

    // --- Grid Generation ---
    function generateGridHeader() { /* ... Unchanged ... */
        const thead = gridTable.querySelector('thead') || gridTable.createTHead();
        thead.innerHTML = '';
        const headerRow = thead.insertRow();
        headerRow.innerHTML = '<th>Bus Name</th><th>Type</th><th>Start SOC (%)</th>';
        for (let i = 0; i < NUM_TIME_SLOTS; i++) { const th = document.createElement('th'); const timeStringWithBreak = minutesToTime(i * SLOT_DURATION_MINUTES); th.innerHTML = timeStringWithBreak; th.title = `Time Slot ${i} (${timeStringWithBreak.replace('<br>', ':')})`; headerRow.appendChild(th); }
        headerRow.insertCell().outerHTML = '<th>Actions</th>';
    }
    function minutesToTime(totalMinutes) { /* ... Unchanged ... */ const hours = Math.floor(totalMinutes / 60).toString().padStart(2, '0'); const minutes = (totalMinutes % 60).toString().padStart(2, '0'); return `${hours}<br>${minutes}`; }

    // Add Bus Row - creates data and row shell
    function addBusRow(busData = null) { /* ... Unchanged ... */
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
        const row = gridTableBody.insertRow(); row.dataset.busId = busData.busId;
        if (busData.busType === 'Diesel') { row.classList.add('diesel-row'); }
        populateBusRow(row, busData);
        if (isNewBus) { console.log(`Added new bus row: ID=${busData.busId}, Name=${busData.busName}`); saveCurrentEditorState(); }
    }

     // Populate Row Helper - Fills cells
    function populateBusRow(rowElement, busData) { /* ... Unchanged ... */
        rowElement.innerHTML = '';
        const busId = busData.busId;
        const nameCell = rowElement.insertCell(); nameCell.contentEditable = true; nameCell.classList.add('bus-name-cell'); nameCell.dataset.busId = busId; nameCell.textContent = busData.busName || busId;
        const typeCell = rowElement.insertCell(); const typeSelect = document.createElement('select'); typeSelect.classList.add('bus-type-select'); typeSelect.dataset.busId = busId; const bebOption = document.createElement('option'); bebOption.value = 'BEB'; bebOption.textContent = 'BEB'; const dieselOption = document.createElement('option'); dieselOption.value = 'Diesel'; dieselOption.textContent = 'Diesel'; typeSelect.appendChild(bebOption); typeSelect.appendChild(dieselOption); typeSelect.value = busData.busType || 'BEB'; typeCell.appendChild(typeSelect);
        const socCell = rowElement.insertCell(); const socInput = document.createElement('input'); socInput.type = 'number'; socInput.value = busData.startSOC; socInput.min = 0; socInput.max = 100; socInput.classList.add('start-soc-input'); socInput.dataset.busId = busId; socInput.addEventListener('change', handleSocChange); if (busData.busType === 'Diesel') { socInput.disabled = true; socInput.style.backgroundColor = '#eee'; socInput.value = ''; } socCell.appendChild(socInput); socCell.appendChild(document.createTextNode(' %'));
        for (let i = 0; i < NUM_TIME_SLOTS; i++) {
            const cell = rowElement.insertCell(); cell.classList.add('time-slot'); cell.dataset.busId = busId; cell.dataset.timeSlot = i;
            const scheduleEntry = busData.schedule[i];
            // *** REMOVED disabling style here - handled by updateCellVisual and CSS ***
            updateCellVisual(cell, scheduleEntry); // Apply visual based on data
        }
        const actionCell = rowElement.insertCell(); const removeBtn = document.createElement('button'); removeBtn.textContent = '🗑️ Remove'; removeBtn.classList.add('remove-bus-btn'); removeBtn.dataset.busId = busId; removeBtn.addEventListener('click', handleRemoveBus); actionCell.appendChild(removeBtn);
    }

    // Render All Rows - Calls addBusRow
    function renderAllBusRows() { /* ... Unchanged ... */ gridTableBody.innerHTML = ''; if (runCutData.buses && runCutData.buses.length > 0) { runCutData.buses.forEach(bus => { addBusRow(bus); }); console.log("Rendered all bus rows from schedule data."); } else { console.log("No bus data to render. Grid is empty."); } }

    // --- Grid Interaction ---
    // *** MODIFIED: handleGridMouseDown checks bus type before allowing drag ***
    function handleGridMouseDown(event) {
        if (event.button !== 0 || event.target.tagName === 'INPUT' || event.target.tagName === 'BUTTON' || event.target.tagName === 'SELECT' || event.target.isContentEditable) return;
        const targetCell = event.target.closest('.time-slot');
        if (targetCell) {
            const targetBusId = targetCell.dataset.busId;
            // *** Check if the bus is Diesel - Don't start drag if it is ***
            // (We could allow drag but prevent assignment later, but simpler to prevent drag)
            // const targetBus = runCutData.buses.find(b => b.busId === targetBusId);
            // if (targetBus && targetBus.busType === 'Diesel') {
            //     console.log("Drag disabled for Diesel bus time slots.");
            //     return; // Prevent drag on Diesel slots
            // }
            // --> *** Correction: Allow drag, block assignment in popover ***

            // Proceed with drag setup
            event.preventDefault(); isDragging = true; dragStartCell = targetCell; dragStartBusId = targetBusId; dragStartTimeslot = parseInt(targetCell.dataset.timeSlot); dragCurrentEndTimeslot = dragStartTimeslot; console.log(`MouseDown: Target Bus ID: ${dragStartBusId}, Slot: ${dragStartTimeslot}`); clearRangeSelection(); targetCell.classList.add('range-selected');
        }
    }
    // (handleGridMouseOver - allow drag over any cell, check assignment later)
    function handleGridMouseOver(event) { if (!isDragging || !dragStartCell) return; const targetCell = event.target.closest('.time-slot'); if (targetCell && targetCell.dataset.busId === dragStartBusId) { const currentTimeslot = parseInt(targetCell.dataset.timeSlot); if(currentTimeslot !== dragCurrentEndTimeslot) { dragCurrentEndTimeslot = currentTimeslot; highlightRange(); } } }
    // (handleGridMouseUp - unchanged)
    function handleGridMouseUp(event) { if (!isDragging) return; isDragging = false; if (!dragStartCell) return; const startIndex = Math.min(dragStartTimeslot, dragCurrentEndTimeslot); const endIndex = Math.max(dragStartTimeslot, dragCurrentEndTimeslot); console.log(`MouseUp: Started on Bus ID ${dragStartBusId}, Final Range Slots ${startIndex}-${endIndex}`); currentBusId = dragStartBusId; currentBusIndex = runCutData.buses.findIndex(b => b.busId === currentBusId); console.log(`MouseUp: Set currentBusId: ${currentBusId}, Found currentBusIndex: ${currentBusIndex}`); if (currentBusIndex === -1) { console.error("!!! Bus data not found in runCutData.buses for ID:", currentBusId); resetDragState(); return; } rangeStartTimeSlot = startIndex; rangeEndTimeSlot = endIndex; const firstCellInSelection = gridTableBody.querySelector(`td.time-slot[data-bus-id="${currentBusId}"][data-time-slot="${startIndex}"]`); currentEditingCell = firstCellInSelection || dragStartCell; if (currentEditingCell) { showPopover(currentEditingCell); } else { console.error("Could not find cell to position popover."); } resetDragState(); }
    // (resetDragState - unchanged)
    function resetDragState() { dragStartCell = null; dragStartBusId = null; dragStartTimeslot = -1; dragCurrentEndTimeslot = -1; }

    // Handle Name/Type/SOC edits
    // (handleGridBlur - unchanged)
    function handleGridBlur(event) { if (event.target.classList.contains('bus-name-cell') && event.target.isContentEditable) { const cell = event.target; const busId = cell.dataset.busId; const busIndex = runCutData.buses.findIndex(b => b.busId === busId); if (busIndex !== -1) { const newName = cell.textContent.trim(); const oldName = runCutData.buses[busIndex].busName; if (newName && oldName !== newName) { console.log(`Bus Name Changed: ID ${busId}, From "${oldName}" to "${newName}"`); runCutData.buses[busIndex].busName = newName; saveCurrentEditorState(); showStatusMessage(runCutStatus, `Bus "${newName}" name updated.`); if (activityPopover.style.display === 'block' && currentBusId === busId) { const popoverBusName = popoverCellInfo.textContent.split(',')[0].split(':')[1].trim(); if (popoverBusName === oldName) { popoverCellInfo.textContent = popoverCellInfo.textContent.replace(`Bus: ${oldName}`, `Bus: ${newName}`); } } } else if (!newName) { cell.textContent = oldName || busId; console.warn(`Bus Name cannot be empty for Bus ID ${busId}. Reverted.`); } } } }
    // (handleGridChange - unchanged)
    function handleGridChange(event) { const target = event.target; const busId = target.dataset.busId; const busIndex = runCutData.buses.findIndex(b => b.busId === busId); if (busIndex === -1) return; if (target.classList.contains('bus-type-select')) { const newType = target.value; if (runCutData.buses[busIndex].busType !== newType) { console.log(`Bus Type Changed: ID ${busId}, From "${runCutData.buses[busIndex].busType}" to "${newType}"`); runCutData.buses[busIndex].busType = newType; const busData = runCutData.buses[busIndex]; const rowElement = gridTableBody.querySelector(`tr[data-bus-id="${busId}"]`); if(rowElement) { populateBusRow(rowElement, busData); if (newType === 'Diesel') { rowElement.classList.add('diesel-row'); } else { rowElement.classList.remove('diesel-row'); } } saveCurrentEditorState(); showStatusMessage(runCutStatus, `Bus "${busData.busName || busId}" type set to ${newType}.`); } } else if (target.classList.contains('start-soc-input')) { handleSocChange(event); } }

    // --- Data Update Handlers ---
    // (handleSocChange, handleRemoveBus - unchanged)
    function handleSocChange(event) { const input = event.target; const busId = input.dataset.busId; const busIndex = runCutData.buses.findIndex(b => b.busId === busId); if (busIndex === -1) return; let newSoc = parseInt(input.value); if (isNaN(newSoc)) newSoc = 0; newSoc = Math.max(0, Math.min(100, newSoc)); input.value = newSoc; runCutData.buses[busIndex].startSOC = newSoc; console.log(`Bus ID ${busId} Start SOC updated to: ${newSoc}`); saveCurrentEditorState(); }
    function handleRemoveBus(event) { const button = event.target.closest('.remove-bus-btn'); const busId = button?.dataset.busId; if (!busId) return; const busToRemove = runCutData.buses.find(b => b.busId === busId); const nameForConfirm = busToRemove ? busToRemove.busName || busId : busId; if (confirm(`Are you sure you want to remove Bus "${nameForConfirm}" and its schedule?`)) { const busIndexToRemove = runCutData.buses.findIndex(b => b.busId === busId); if (busIndexToRemove > -1) { runCutData.buses.splice(busIndexToRemove, 1); const rowToRemove = gridTableBody.querySelector(`tr[data-bus-id="${busId}"]`); if (rowToRemove) rowToRemove.remove(); showStatusMessage(runCutStatus, `Bus "${nameForConfirm}" removed.`); saveCurrentEditorState(); } } }

    // --- Popover Logic ---
    // (showPopover - unchanged)
    function showPopover(targetCell) { if (!targetCell) return; const rect = targetCell.getBoundingClientRect(); const scrollTop = window.pageYOffset || document.documentElement.scrollTop; const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft; activityPopover.style.top = `${rect.bottom + scrollTop + 5}px`; activityPopover.style.left = `${rect.left + scrollLeft}px`; activityPopover.style.display = 'block'; const startTime = minutesToTime(rangeStartTimeSlot * SLOT_DURATION_MINUTES).replace('<br>',':'); let timeRangeText = startTime; if (rangeStartTimeSlot !== rangeEndTimeSlot) { const endTimeMinutes = (rangeEndTimeSlot + 1) * SLOT_DURATION_MINUTES; const endTime = minutesToTime(endTimeMinutes - SLOT_DURATION_MINUTES).replace('<br>',':'); timeRangeText = `${startTime} - ${endTime}`; } const busData = runCutData.buses.find(b => b.busId === currentBusId); const displayName = busData ? busData.busName || busData.busId : currentBusId; popoverCellInfo.textContent = `Bus: ${displayName}, Time: ${timeRangeText}`; chargeOptionsDiv.style.display = 'none'; chargerSelect.value = ""; }
    // (hidePopover - unchanged)
    function hidePopover() { activityPopover.style.display = 'none'; clearRangeSelection(); currentEditingCell = null; currentBusId = null; currentBusIndex = -1; rangeStartTimeSlot = -1; rangeEndTimeSlot = -1; }
    // *** MODIFIED: handleActivitySelection prevents CHARGE on Diesel ***
    function handleActivitySelection(event) {
        const selectedActivity = event.target.dataset.activity;
        console.log("Selected Activity for range:", selectedActivity);
        if (currentBusIndex < 0 || rangeStartTimeSlot < 0 || rangeEndTimeSlot < 0) { console.error("Invalid state for activity selection."); hidePopover(); return; }

        // *** Check for Diesel + CHARGE attempt ***
        const currentBus = runCutData.buses[currentBusIndex];
        if (currentBus.busType === 'Diesel' && selectedActivity === 'CHARGE') {
            alert("Diesel buses cannot be assigned a CHARGE activity.");
            // Don't hide popover, let them choose something else
            return; // Stop processing this selection
        }
        // ****************************************

        if (selectedActivity === 'CHARGE') {
            populateChargerSelect();
            chargeOptionsDiv.style.display = 'block';
            // Don't apply yet, wait for charger selection change
        } else {
            // Apply RUN, BREAK, DEADHEAD immediately
            const scheduleEntry = { activity: selectedActivity, chargerId: null };
            updateScheduleRange(scheduleEntry);
        }
    }
    // (handleChargerSelection - unchanged, Diesel check happens before this)
    function handleChargerSelection() { const selectedChargerId = chargerSelect.value; if (currentBusIndex < 0 || rangeStartTimeSlot < 0 || rangeEndTimeSlot < 0 || !selectedChargerId) { console.log("Charger selection requires valid range and charger choice."); return; } const scheduleEntry = { activity: 'CHARGE', chargerId: selectedChargerId }; updateScheduleRange(scheduleEntry); }
    // (populateChargerSelect - unchanged)
    function populateChargerSelect() { chargerSelect.innerHTML = '<option value="">--Select Charger--</option>'; if (availableChargers.length === 0) { chargerSelect.innerHTML = '<option value="" disabled>No Chargers Configured</option>'; } else { availableChargers.forEach(charger => { const option = document.createElement('option'); option.value = charger.id; option.textContent = `${charger.name} (${charger.rate} kW)`; chargerSelect.appendChild(option); }); } }


    // --- Core Schedule Update Logic ---
    // *** MODIFIED: updateScheduleRange skips CHARGE for Diesel as safety ***
    function updateScheduleRange(scheduleEntry) {
        if (currentBusIndex < 0 || rangeStartTimeSlot < 0 || rangeEndTimeSlot < 0 || !runCutData.buses[currentBusIndex]) { console.error("Invalid state for updating schedule range. Aborting."); hidePopover(); return; }

        const currentBus = runCutData.buses[currentBusIndex];

        // *** Safety check: Don't store CHARGE activity for Diesel buses ***
        if (currentBus.busType === 'Diesel' && scheduleEntry.activity === 'CHARGE') {
            console.warn(`Attempted to save CHARGE activity for Diesel bus ID ${currentBus.busId}. Skipping.`);
            hidePopover(); // Hide popover as the action is invalid
            return;
        }
        // ******************************************************************

        // Conflict Check (only relevant for BEBs)
        if (scheduleEntry.activity === 'CHARGE' && scheduleEntry.chargerId && currentBus.busType === 'BEB') {
            for (let i = rangeStartTimeSlot; i <= rangeEndTimeSlot; i++) {
                for (let busIdx = 0; busIdx < runCutData.buses.length; busIdx++) {
                    if (busIdx === currentBusIndex) continue;
                    const otherBus = runCutData.buses[busIdx];
                    if (otherBus.busType === 'Diesel') continue; // Skip checking against diesel
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

        // Update Data & Visuals
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

    // *** MODIFIED: updateCellVisual handles DEADHEAD, applies diesel style ***
    function updateCellVisual(cellElement, scheduleEntry) {
        cellElement.innerHTML = ''; cellElement.style.backgroundColor = ''; cellElement.style.fontWeight = 'normal'; // Ensure weight reset
        const busId = cellElement.dataset.busId; const timeSlot = parseInt(cellElement.dataset.timeSlot);
        const time = minutesToTime(timeSlot * SLOT_DURATION_MINUTES).replace('<br>',':');
        const busData = runCutData.buses.find(b=>b.busId===busId);
        let baseTooltip = `Bus: ${busData?.busName || busId}, Time: ${time}`;

        // Apply base styling if Diesel (no activity shown)
         if (busData?.busType === 'Diesel') {
             // cellElement.classList.add('disabled-slot'); // Class added in populateBusRow
             cellElement.style.backgroundColor = '#e9ecef'; // Ensure disabled look
             cellElement.title = baseTooltip + "\n(Diesel)";
             // We explicitly allow assigning R/B/DH to diesel, so we *do* show the text, just no sim impact
             // return; // Old logic: Don't show activity for diesel
         } else {
             // Ensure BEB slots are visually enabled if they were previously disabled
              // cellElement.classList.remove('disabled-slot'); // Class removed in populateBusRow
              cellElement.style.pointerEvents = 'auto';
         }

        // Apply activity visuals
        if (!scheduleEntry) { cellElement.title = baseTooltip; return; } // Return if no activity scheduled

        let cellText = ''; let bgColor = ''; let tooltipText = `${baseTooltip}\nActivity: ${scheduleEntry.activity}`;
        switch (scheduleEntry.activity) {
            case 'RUN': cellText = 'R'; bgColor = '#add8e6'; break;
            case 'BREAK': cellText = 'B'; bgColor = '#fffacd'; break;
            case 'CHARGE':
                // Don't show charge visuals for Diesel, even if data somehow exists
                if (busData?.busType === 'Diesel') {
                     cellText = '-'; // Or empty? Indicate invalid state for diesel
                     bgColor = '#e9ecef';
                     tooltipText += ' (Invalid for Diesel)';
                } else {
                    cellText = 'C'; bgColor = '#90ee90';
                    if (scheduleEntry.chargerId) { const charger = availableChargers.find(ch => ch.id === scheduleEntry.chargerId); const chargerName = charger ? charger.name : 'Unknown'; tooltipText += `\nCharger: ${chargerName} (${scheduleEntry.chargerId || 'None'})`; }
                    else { tooltipText += `\nCharger: None assigned`; }
                }
                break;
            case 'DEADHEAD': cellText = 'DH'; bgColor = '#cccccc'; break; // Grey for Deadhead
            default: cellText = '?'; bgColor = '#eee'; break;
        }

        // Override background if diesel, otherwise use activity color
        cellElement.style.backgroundColor = (busData?.busType === 'Diesel') ? '#e9ecef' : bgColor;
        cellElement.textContent = cellText;
        cellElement.title = tooltipText;
    }


    // --- Data Loading/Saving ---
    // (loadChargerData, loadBusParameters - unchanged)
    function loadChargerData() { const storedChargers = localStorage.getItem('chargers'); try { availableChargers = storedChargers ? JSON.parse(storedChargers) : []; console.log("Available chargers loaded:", availableChargers); } catch (e) { console.error("Error parsing available chargers:", e); availableChargers = []; } }
    function loadBusParameters() { const storedParams = localStorage.getItem(BUS_PARAMS_KEY); currentBusParameters = null; if (storedParams) { try { const loadedParams = JSON.parse(storedParams); if (loadedParams && typeof loadedParams.essCapacity === 'number' && loadedParams.essCapacity > 0 && typeof loadedParams.euRate === 'number' && loadedParams.euRate >= 0 && typeof loadedParams.warningThresholdLow === 'number' && typeof loadedParams.warningThresholdCritical === 'number') { currentBusParameters = loadedParams; console.log("Bus parameters loaded for simulation:", currentBusParameters); return true; } else { console.error("Loaded bus parameters are invalid or incomplete:", loadedParams); alert("Error: Bus parameters configured in the Configuration tab are invalid or incomplete. Please check configuration."); return false; } } catch (e) { console.error("Error parsing bus parameters from Local Storage:", e); alert("Error: Could not parse bus parameters from configuration. Please check configuration."); return false; } } else { alert("Error: Bus parameters have not been configured or saved. Please go to the Configuration tab and save parameters."); return false; } }


    // --- Persistence Logic (Auto-Save/Load Last State) ---
    // (saveCurrentEditorState, loadLastEditorState, initializeEmptyScheduleData, initializeEmptyScheduleDataAndAddDefaultBus - unchanged)
    function saveCurrentEditorState() { runCutData.name = runCutNameInput.value.trim(); try { localStorage.setItem(EDITOR_LAST_STATE_KEY, JSON.stringify(runCutData)); } catch (e) { console.error("Error auto-saving editor state:", e); } }
    function loadLastEditorState() { const savedState = localStorage.getItem(EDITOR_LAST_STATE_KEY); if (savedState) { try { const loadedData = JSON.parse(savedState); if (loadedData && typeof loadedData === 'object' && Array.isArray(loadedData.buses)) { loadedData.buses.forEach((bus, index) => { if (!bus.busId) bus.busId = `Loaded-${index}-${Date.now()}`; if (bus.busName === undefined) bus.busName = bus.busId; if (!bus.busType) bus.busType = 'BEB'; }); runCutData = loadedData; runCutNameInput.value = runCutData.name || ''; console.log("Loaded last editor state (processed):", runCutData); if (runCutData.buses.length === 0) { console.log("Loaded state has no buses, adding one default bus."); addBusRow(); } } else { console.warn("Invalid data structure found in last editor state. Initializing fresh."); initializeEmptyScheduleDataAndAddDefaultBus(); } } catch (e) { console.error("Error parsing last editor state:", e, ". Initializing fresh."); initializeEmptyScheduleDataAndAddDefaultBus(); } } else { console.log("No previous editor state found. Initializing fresh."); initializeEmptyScheduleDataAndAddDefaultBus(); } }
    function initializeEmptyScheduleData() { runCutData = { name: '', buses: [] }; runCutNameInput.value = ''; console.log("Initialized empty schedule data structure."); }
    function initializeEmptyScheduleDataAndAddDefaultBus() { initializeEmptyScheduleData(); addBusRow(); }


    // --- Named Save/Load/Clear (Manual) ---
    // (handleSaveSchedule, showLoadScheduleModal, hideLoadScheduleModal, handleModalLoadClick, performLoad, handleModalDeleteClick, handleClearSchedule - unchanged)
    function handleSaveSchedule() { const name = runCutNameInput.value.trim(); if (!name) { alert("Please enter a name for the schedule before saving."); runCutNameInput.focus(); return; } runCutData.name = name; try { const storageKey = RUN_CUT_PREFIX + name; localStorage.setItem(storageKey, JSON.stringify(runCutData)); console.log("Schedule Saved:", runCutData); showStatusMessage(runCutStatus, `Schedule "${name}" saved successfully!`); } catch (e) { console.error("Error saving schedule:", e); showStatusMessage(runCutStatus, "Error saving schedule.", true); alert("Error saving schedule."); } }
    function showLoadScheduleModal() { console.log("Opening load schedule modal..."); modalRunCutList.innerHTML = ''; let savedScheduleNames = []; try { for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (key.startsWith(RUN_CUT_PREFIX)) { savedScheduleNames.push(key.substring(RUN_CUT_PREFIX.length)); } } } catch (e) { console.error("Error accessing localStorage:", e); modalRunCutList.innerHTML = '<p style="color: red;">Error accessing saved schedules.</p>'; loadModal.style.display = 'block'; return; } if (savedScheduleNames.length === 0) { modalRunCutList.innerHTML = '<p>No saved schedules found.</p>'; } else { const list = document.createElement('ul'); savedScheduleNames.sort().forEach(name => { const listItem = document.createElement('li'); const nameSpan = document.createElement('span'); nameSpan.textContent = name; nameSpan.style.flexGrow = '1'; nameSpan.style.marginRight = '10px'; const buttonGroup = document.createElement('div'); const loadBtn = document.createElement('button'); loadBtn.textContent = 'Load'; loadBtn.dataset.runCutName = name; loadBtn.addEventListener('click', handleModalLoadClick); const deleteBtn = document.createElement('button'); deleteBtn.textContent = 'Delete'; deleteBtn.classList.add('delete-btn'); deleteBtn.dataset.runCutName = name; deleteBtn.addEventListener('click', handleModalDeleteClick); buttonGroup.appendChild(loadBtn); buttonGroup.appendChild(deleteBtn); listItem.appendChild(nameSpan); listItem.appendChild(buttonGroup); list.appendChild(listItem); }); modalRunCutList.appendChild(list); } loadModal.style.display = 'block'; }
    function hideLoadScheduleModal() { loadModal.style.display = 'none'; }
    function handleModalLoadClick(event) { const button = event.target; const nameToLoad = button.dataset.runCutName; if (!nameToLoad) { console.error("Could not find schedule name on button:", button); return; } console.log(`Load button clicked for: ${nameToLoad}`); performLoad(nameToLoad); hideLoadScheduleModal(); }
    function performLoad(nameToLoad) { const storageKey = RUN_CUT_PREFIX + nameToLoad; const savedDataString = localStorage.getItem(storageKey); if (!savedDataString) { alert(`Schedule named "${nameToLoad}" not found.`); console.warn("Load failed: Schedule not found:", storageKey); return; } try { const loadedData = JSON.parse(savedDataString); if (loadedData && typeof loadedData === 'object' && Array.isArray(loadedData.buses)) { loadedData.buses.forEach((bus, index) => { if (!bus.busId) bus.busId = `Loaded-${index}-${Date.now()}`; if (bus.busName === undefined) bus.busName = bus.busId; if (!bus.busType) bus.busType = 'BEB'; }); runCutData = loadedData; runCutNameInput.value = runCutData.name || ''; console.log("Schedule Loaded (processed):", runCutData); clearSimulationColoring(); renderAllBusRows(); saveCurrentEditorState(); showStatusMessage(runCutStatus, `Schedule "${nameToLoad}" loaded successfully.`); } else { alert(`Error: Data for "${nameToLoad}" is invalid.`); console.error("Load failed: Invalid data structure.", loadedData); } } catch (e) { alert(`Error parsing data for "${nameToLoad}".`); console.error("Load failed: Error parsing JSON:", e); } }
    function handleModalDeleteClick(event) { const button = event.target; const nameToDelete = button.dataset.runCutName; if (!nameToDelete) { console.error("Could not find schedule name on delete button:", button); return; } if (confirm(`Are you sure you want to permanently delete the schedule named "${nameToDelete}"?`)) { console.log(`Delete button clicked for: ${nameToDelete}`); const storageKey = RUN_CUT_PREFIX + nameToDelete; try { localStorage.removeItem(storageKey); console.log(`Removed item: ${storageKey}`); const listItemToRemove = button.closest('li'); if (listItemToRemove) { listItemToRemove.remove(); } const remainingItems = modalRunCutList.querySelectorAll('li'); if (remainingItems.length === 0) { modalRunCutList.innerHTML = '<p>No saved schedules found.</p>'; } showStatusMessage(runCutStatus, `Schedule "${nameToDelete}" deleted.`); } catch (e) { console.error("Error removing item:", e); alert(`Could not delete schedule "${nameToDelete}".`); } } else { console.log(`Deletion cancelled for: ${nameToDelete}`); } }
    function handleClearSchedule() { if (confirm("Are you sure you want to clear the current schedule? Any unsaved changes will be lost.")) { console.log("Clearing current schedule..."); clearSimulationColoring(); initializeEmptyScheduleData(); addBusRow(); renderAllBusRows(); showStatusMessage(runCutStatus, "Schedule cleared."); } else { console.log("Clear cancelled by user."); } }


    // --- Simulation Logic ---
    // (clearSimulationColoring, handleRunSimulation, applySimulationColoring - unchanged)
    function clearSimulationColoring() { console.log("Clearing simulation grid colors..."); const allTimeCells = gridTableBody.querySelectorAll('td.time-slot'); allTimeCells.forEach(cell => { const busId = cell.dataset.busId; const timeSlot = parseInt(cell.dataset.timeSlot); const busData = runCutData.buses.find(b => b.busId === busId); const scheduleEntry = busData?.schedule[timeSlot] || null; updateCellVisual(cell, scheduleEntry); }); }
    function handleRunSimulation() { console.log("Run Simulation button clicked."); resultsOutput.innerHTML = '<p>Running simulation...</p>'; resultsContainer.style.display = 'block'; clearSimulationColoring(); if (!loadBusParameters()) { resultsOutput.innerHTML = '<p style="color: red;">Simulation cancelled due to configuration errors.</p>'; return; } runCutData.name = runCutNameInput.value.trim(); if (typeof runSimulation !== 'function') { console.error("Simulation function 'runSimulation' not found."); resultsOutput.innerHTML = '<p style="color: red;">Critical Error: Simulation engine not loaded.</p>'; return; } const simulationResults = runSimulation(runCutData, currentBusParameters, availableChargers); displaySimulationResults(simulationResults); applySimulationColoring(simulationResults); }
    function applySimulationColoring(results) { console.log("Applying simulation grid colors..."); if (!results || !results.resultsPerBus) { console.warn("No bus results found to apply coloring."); return; } for (const busId in results.resultsPerBus) { const busResult = results.resultsPerBus[busId]; if (busResult.isDiesel) continue; const triggers = busResult.triggerTimes; const busRow = gridTableBody.querySelector(`tr[data-bus-id="${busId}"]`); if (!busRow || !triggers) { console.warn(`Skipping coloring for bus ${busId} - row or triggers not found.`); continue; } const timeCells = busRow.querySelectorAll('td.time-slot'); timeCells.forEach(cell => { const timeSlotIndex = parseInt(cell.dataset.timeSlot); const isStranded = triggers.stranded !== null && timeSlotIndex >= triggers.stranded; const isCritical = triggers.critical !== null && timeSlotIndex >= triggers.critical; const isLow = triggers.low !== null && timeSlotIndex >= triggers.low; if (isStranded) { cell.style.backgroundColor = COLOR_WARNING_STRANDED; cell.style.fontWeight = 'bold'; if (cell.textContent === 'R' || cell.textContent === 'DH') { cell.textContent = 'X'; } } else if (isCritical) { cell.style.backgroundColor = COLOR_WARNING_CRITICAL; cell.style.fontWeight = 'normal'; } else if (isLow) { cell.style.backgroundColor = COLOR_WARNING_LOW; cell.style.fontWeight = 'normal'; } }); } }
    // (displaySimulationResults - unchanged)
    function displaySimulationResults(results) { console.log("Displaying simulation results:", results); resultsOutput.innerHTML = ''; if (results.overallErrors && results.overallErrors.length > 0) { const errorList = document.createElement('ul'); results.overallErrors.forEach(err => { const item = document.createElement('li'); item.textContent = err; item.style.color = 'red'; errorList.appendChild(item); }); resultsOutput.appendChild(errorList); return; } if (!results.resultsPerBus || Object.keys(results.resultsPerBus).length === 0) { resultsOutput.innerHTML = '<p>Simulation ran, but no results were generated.</p>'; return; } for (const busId in results.resultsPerBus) { const busResult = results.resultsPerBus[busId]; const originalBusData = runCutData.buses.find(b => b.busId === busId); const busName = originalBusData?.busName || busId; const startSOC = originalBusData ? originalBusData.startSOC : 0; const busDiv = document.createElement('div'); busDiv.style.marginBottom = '15px'; busDiv.style.borderBottom = '1px solid #eee'; busDiv.style.paddingBottom = '10px'; const title = document.createElement('h4'); title.textContent = `Bus: ${busName}`; busDiv.appendChild(title); if (busResult.isDiesel) { const dieselMsg = document.createElement('p'); dieselMsg.textContent = "Diesel Bus - Simulation N/A."; dieselMsg.style.fontStyle = 'italic'; busDiv.appendChild(dieselMsg); resultsOutput.appendChild(busDiv); continue; } if (busResult.errors && busResult.errors.length > 0) { const issueTitle = document.createElement('p'); issueTitle.textContent = 'Potential Issues / Warnings:'; issueTitle.style.fontWeight = 'bold'; busDiv.appendChild(issueTitle); const issueList = document.createElement('ul'); busResult.errors.forEach(errText => { const item = document.createElement('li'); item.textContent = errText; const lowerErrText = errText.toLowerCase(); if (lowerErrText.includes('stranded')) { item.style.color = 'red'; item.style.fontWeight = 'bold'; } else if (lowerErrText.includes('critical soc')) { item.style.color = 'red'; } else if (lowerErrText.includes('low soc warning')) { item.style.color = 'darkorange'; } else if (lowerErrText.includes('error')) { item.style.color = 'purple'; } issueList.appendChild(item); }); busDiv.appendChild(issueList); } else { const noIssues = document.createElement('p'); noIssues.textContent = 'No SOC warnings or schedule/config errors detected.'; noIssues.style.color = 'green'; busDiv.appendChild(noIssues); } if (busResult.socTimeSeries && busResult.socTimeSeries.length > 0) { const finalSOC = busResult.socTimeSeries[busResult.socTimeSeries.length - 1]; const minSOC = Math.min(...busResult.socTimeSeries); const summaryP = document.createElement('p'); summaryP.innerHTML = `Ending SOC: <strong>${finalSOC.toFixed(1)}%</strong> / Minimum SOC: <strong>${minSOC.toFixed(1)}%</strong>`; if (minSOC < (currentBusParameters?.warningThresholdCritical ?? 10)) { summaryP.querySelector('strong:last-of-type').style.color = 'red'; } else if (minSOC < (currentBusParameters?.warningThresholdLow ?? 20)) { summaryP.querySelector('strong:last-of-type').style.color = 'darkorange'; } busDiv.appendChild(summaryP); } else { const noSocP = document.createElement('p'); noSocP.textContent = "No SOC data generated."; busDiv.appendChild(noSocP); } const energyP = document.createElement('p'); const internalConsumed = busResult.totalEnergyConsumedKWh ?? 0; const charged = busResult.totalEnergyChargedKWh ?? 0; const essCapacity = currentBusParameters?.essCapacity ?? 0; const initialEnergy = (startSOC / 100) * essCapacity; const maxPossibleConsumed = initialEnergy + charged; let displayConsumed = internalConsumed; if (essCapacity > 0 && internalConsumed > (maxPossibleConsumed + 0.01)) { console.warn(`Bus ${busName}: Capping displayed consumed energy. Internal value (${internalConsumed.toFixed(1)} kWh) exceeded max possible (${maxPossibleConsumed.toFixed(1)} kWh).`); displayConsumed = maxPossibleConsumed; } energyP.innerHTML = `Energy Consumed: <strong>${displayConsumed.toFixed(1)} kWh</strong> / Energy Charged: <strong>${charged.toFixed(1)} kWh</strong>`; busDiv.appendChild(energyP); resultsOutput.appendChild(busDiv); } }
    // (hideResults - unchanged)
    function hideResults() { resultsContainer.style.display = 'none'; resultsOutput.innerHTML = ''; clearSimulationColoring(); }


    // --- Helper functions for drag-select ---
    // (highlightRange, clearRangeSelection - unchanged)
    function highlightRange() { clearRangeSelection(); const startIndex = Math.min(dragStartTimeslot, dragCurrentEndTimeslot); const endIndex = Math.max(dragStartTimeslot, dragCurrentEndTimeslot); const busRow = gridTableBody.querySelector(`tr[data-bus-id="${dragStartBusId}"]`); if (!busRow) return; for (let i = startIndex; i <= endIndex; i++) { const cell = busRow.querySelector(`td.time-slot[data-time-slot="${i}"]`); if (cell) cell.classList.add('range-selected'); } }
    function clearRangeSelection() { const selectedCells = gridTableBody.querySelectorAll('.time-slot.range-selected'); selectedCells.forEach(cell => cell.classList.remove('range-selected')); }

    // --- Utility ---
    // (showStatusMessage - unchanged)
    function showStatusMessage(element, message, isError = false) { if (!element) return; element.textContent = message; element.style.color = isError ? 'red' : 'green'; setTimeout(() => { if (element.textContent === message) element.textContent = ''; }, 4000); }

    // --- Start the application ---
    initializeEditor();

}); // End DOMContentLoaded