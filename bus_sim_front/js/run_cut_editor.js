// Wait for the HTML DOM to be fully loaded before running the script
document.addEventListener('DOMContentLoaded', () => {

    // --- Constants ---
    const NUM_TIME_SLOTS = 96; const SLOT_DURATION_MINUTES = 15;
    const EDITOR_LAST_STATE_KEY = 'editor_lastState'; const RUN_CUT_PREFIX = 'runCut_';
    const BUS_PARAMS_KEY = 'busParameters';

    // --- DOM Element References ---
    // (Keep all existing references)
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
    // (Keep all existing state variables)
    let runCutData = { name: '', buses: [] };
    let availableChargers = [];
    let currentBusParameters = null;
    let currentEditingCell = null; let currentBusId = null; let currentBusIndex = -1;
    let rangeStartTimeSlot = -1; let rangeEndTimeSlot = -1;
    let isDragging = false; let dragStartCell = null; let dragStartBusId = null;
    let dragStartTimeslot = -1; let dragCurrentEndTimeslot = -1;


    // --- Initialization ---
    // (initializeEditor - unchanged)
    function initializeEditor() { console.log("Initializing Run Cut Editor..."); loadChargerData(); generateGridHeader(); loadLastEditorState(); renderAllBusRows(); setupEventListeners(); }

    // --- Event Listeners Setup ---
    // (setupEventListeners - unchanged, relies on listeners added in showLoadRunCutModal)
    function setupEventListeners() { addBusBtn.addEventListener('click', () => addBusRow()); saveRunCutBtn.addEventListener('click', handleSaveRunCut); loadRunCutBtn.addEventListener('click', showLoadRunCutModal); clearRunCutBtn.addEventListener('click', handleClearRunCut); modalCloseBtn.addEventListener('click', hideLoadRunCutModal); loadModal.addEventListener('click', (event) => { if (event.target === loadModal) hideLoadRunCutModal(); }); runSimulationBtn.addEventListener('click', handleRunSimulation); closeResultsBtn.addEventListener('click', hideResults); gridTableBody.addEventListener('mousedown', handleGridMouseDown); gridTableBody.addEventListener('mouseover', handleGridMouseOver); document.addEventListener('mouseup', handleGridMouseUp); activityButtons.forEach(btn => btn.addEventListener('click', handleActivitySelection)); popoverCancelBtn.addEventListener('click', hidePopover); chargerSelect.addEventListener('change', handleChargerSelection); gridTableBody.addEventListener('dragstart', (e) => e.preventDefault()); runCutNameInput.addEventListener('input', saveCurrentEditorState); }

    // --- Grid Generation ---
    // (generateGridHeader, minutesToTime, addBusRow, renderAllBusRows - unchanged)
    function generateGridHeader() { const thead = gridTable.querySelector('thead') || gridTable.createTHead(); thead.innerHTML = ''; const headerRow = thead.insertRow(); headerRow.innerHTML = '<th>Bus ID</th><th>Start SOC (%)</th>'; for (let i = 0; i < NUM_TIME_SLOTS; i++) { const th = document.createElement('th'); const time = minutesToTime(i * SLOT_DURATION_MINUTES); th.textContent = time; th.title = `Time Slot ${i} (${time})`; headerRow.appendChild(th); } headerRow.insertCell().outerHTML = '<th>Actions</th>'; }
    function minutesToTime(totalMinutes) { const hours = Math.floor(totalMinutes / 60).toString().padStart(2, '0'); const minutes = (totalMinutes % 60).toString().padStart(2, '0'); return `${hours}:${minutes}`; }
    function addBusRow(busData = null) { const isNewBus = !busData; if (isNewBus) { const newBusId = `Bus-${Date.now().toString().slice(-3)}`; busData = { busId: newBusId, startSOC: 90, schedule: Array(NUM_TIME_SLOTS).fill(null) }; if (runCutData.buses.findIndex(b => b.busId === busData.busId) === -1) { runCutData.buses.push(busData); } } const busIndex = runCutData.buses.findIndex(b => b.busId === busData.busId); if (busIndex === -1) { console.error("Render failed: Bus data not found in runCutData:", busData.busId); return; } const row = gridTableBody.insertRow(); row.dataset.busId = busData.busId; const idCell = row.insertCell(); idCell.textContent = busData.busId; const socCell = row.insertCell(); const socInput = document.createElement('input'); socInput.type = 'number'; socInput.value = busData.startSOC; socInput.min = 0; socInput.max = 100; socInput.classList.add('start-soc-input'); socInput.dataset.busId = busData.busId; socInput.addEventListener('change', handleSocChange); socCell.appendChild(socInput); socCell.appendChild(document.createTextNode(' %')); for (let i = 0; i < NUM_TIME_SLOTS; i++) { const cell = row.insertCell(); cell.classList.add('time-slot'); cell.dataset.busId = busData.busId; cell.dataset.timeSlot = i; const scheduleEntry = busData.schedule[i]; updateCellVisual(cell, scheduleEntry); } const actionCell = row.insertCell(); const removeBtn = document.createElement('button'); removeBtn.textContent = '🗑️ Remove'; removeBtn.classList.add('remove-bus-btn'); removeBtn.dataset.busId = busData.busId; removeBtn.addEventListener('click', handleRemoveBus); actionCell.appendChild(removeBtn); if (isNewBus) { console.log("Added new bus row via button:", busData.busId); saveCurrentEditorState(); } }
    function renderAllBusRows() { gridTableBody.innerHTML = ''; if (runCutData.buses && runCutData.buses.length > 0) { runCutData.buses.forEach(bus => { addBusRow(bus); }); console.log("Rendered all bus rows from runCutData."); } else { console.log("No bus data to render. Grid is empty."); } }

    // --- Grid Interaction ---
    // (handleGridMouseDown, handleGridMouseOver, handleGridMouseUp, resetDragState - unchanged)
    function handleGridMouseDown(event) { if (event.button !== 0 || event.target.tagName === 'INPUT' || event.target.tagName === 'BUTTON') return; const targetCell = event.target.closest('.time-slot'); if (targetCell) { event.preventDefault(); isDragging = true; dragStartCell = targetCell; dragStartBusId = targetCell.dataset.busId; dragStartTimeslot = parseInt(targetCell.dataset.timeSlot); dragCurrentEndTimeslot = dragStartTimeslot; console.log(`MouseDown: Target Bus ID: ${targetCell.dataset.busId}, Stored dragStartBusId: ${dragStartBusId}, Slot: ${dragStartTimeslot}`); clearRangeSelection(); targetCell.classList.add('range-selected'); } }
    function handleGridMouseOver(event) { if (!isDragging || !dragStartCell) return; const targetCell = event.target.closest('.time-slot'); if (targetCell) { const currentBusId = targetCell.dataset.busId; const currentTimeslot = parseInt(targetCell.dataset.timeSlot); if (currentBusId === dragStartBusId) { if(currentTimeslot !== dragCurrentEndTimeslot) { dragCurrentEndTimeslot = currentTimeslot; highlightRange(); } } } }
    function handleGridMouseUp(event) { if (!isDragging) return; isDragging = false; if (!dragStartCell) return; const startIndex = Math.min(dragStartTimeslot, dragCurrentEndTimeslot); const endIndex = Math.max(dragStartTimeslot, dragCurrentEndTimeslot); console.log(`MouseUp: Started on Bus ${dragStartBusId}, Final Range Slots ${startIndex}-${endIndex}`); currentBusId = dragStartBusId; currentBusIndex = runCutData.buses.findIndex(b => b.busId === currentBusId); console.log(`MouseUp: Set currentBusId: ${currentBusId}, Found currentBusIndex: ${currentBusIndex}`); if (currentBusIndex === -1) { console.error("!!! Bus data not found in runCutData.buses for ID:", currentBusId); } if (currentBusIndex === -1) { console.error("Bus data not found on mouseup:", currentBusId); clearRangeSelection(); resetDragState(); return; } rangeStartTimeSlot = startIndex; rangeEndTimeSlot = endIndex; const firstCellInSelection = gridTableBody.querySelector(`td.time-slot[data-bus-id="${currentBusId}"][data-time-slot="${startIndex}"]`); currentEditingCell = firstCellInSelection || dragStartCell; if (currentEditingCell) { showPopover(currentEditingCell); } else { console.error("Could not find cell to position popover."); } resetDragState(); }
    function resetDragState() { dragStartCell = null; dragStartBusId = null; dragStartTimeslot = -1; dragCurrentEndTimeslot = -1; }

    // --- Data Update Handlers ---
    // (handleSocChange, handleRemoveBus - unchanged)
    function handleSocChange(event) { const input = event.target; const busId = input.dataset.busId; const busIndex = runCutData.buses.findIndex(b => b.busId === busId); if (busIndex === -1) return; let newSoc = parseInt(input.value); if (isNaN(newSoc)) newSoc = 0; newSoc = Math.max(0, Math.min(100, newSoc)); input.value = newSoc; runCutData.buses[busIndex].startSOC = newSoc; console.log(`Bus ${busId} Start SOC updated to: ${newSoc}`); saveCurrentEditorState(); }
    function handleRemoveBus(event) { const button = event.target.closest('.remove-bus-btn'); const busId = button?.dataset.busId; if (!busId) return; if (confirm(`Are you sure you want to remove ${busId} and its schedule?`)) { const busIndexToRemove = runCutData.buses.findIndex(b => b.busId === busId); if (busIndexToRemove > -1) { runCutData.buses.splice(busIndexToRemove, 1); const rowToRemove = gridTableBody.querySelector(`tr[data-bus-id="${busId}"]`); if (rowToRemove) rowToRemove.remove(); showStatusMessage(runCutStatus, `${busId} removed.`); saveCurrentEditorState(); } } }

    // --- Popover Logic ---
    // (showPopover, hidePopover, handleActivitySelection, handleChargerSelection, populateChargerSelect - unchanged)
    function showPopover(targetCell) { if (!targetCell) return; const rect = targetCell.getBoundingClientRect(); const scrollTop = window.pageYOffset || document.documentElement.scrollTop; const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft; activityPopover.style.top = `${rect.bottom + scrollTop + 5}px`; activityPopover.style.left = `${rect.left + scrollLeft}px`; activityPopover.style.display = 'block'; const startTime = minutesToTime(rangeStartTimeSlot * SLOT_DURATION_MINUTES); let timeRangeText = startTime; if (rangeStartTimeSlot !== rangeEndTimeSlot) { const endTimeMinutes = (rangeEndTimeSlot + 1) * SLOT_DURATION_MINUTES; const endTime = minutesToTime(endTimeMinutes - SLOT_DURATION_MINUTES); timeRangeText = `${startTime} - ${endTime}`; } popoverCellInfo.textContent = `Bus: ${currentBusId}, Time: ${timeRangeText}`; chargeOptionsDiv.style.display = 'none'; chargerSelect.value = ""; }
    function hidePopover() { activityPopover.style.display = 'none'; clearRangeSelection(); currentEditingCell = null; currentBusId = null; currentBusIndex = -1; rangeStartTimeSlot = -1; rangeEndTimeSlot = -1; }
    function handleActivitySelection(event) { const selectedActivity = event.target.dataset.activity; console.log("Selected Activity for range:", selectedActivity); if (currentBusIndex < 0 || rangeStartTimeSlot < 0 || rangeEndTimeSlot < 0) { console.error("Invalid state for activity selection."); hidePopover(); return; } if (selectedActivity === 'CHARGE') { populateChargerSelect(); chargeOptionsDiv.style.display = 'block'; } else { const scheduleEntry = { activity: selectedActivity, chargerId: null }; updateScheduleRange(scheduleEntry); } }
    function handleChargerSelection() { const selectedChargerId = chargerSelect.value; if (currentBusIndex < 0 || rangeStartTimeSlot < 0 || rangeEndTimeSlot < 0 || !selectedChargerId) { console.log("Charger selection requires valid range and charger choice."); return; } const scheduleEntry = { activity: 'CHARGE', chargerId: selectedChargerId }; updateScheduleRange(scheduleEntry); }
    function populateChargerSelect() { chargerSelect.innerHTML = '<option value="">--Select Charger--</option>'; if (availableChargers.length === 0) { chargerSelect.innerHTML = '<option value="" disabled>No Chargers Configured</option>'; } else { availableChargers.forEach(charger => { const option = document.createElement('option'); option.value = charger.id; option.textContent = `${charger.name} (${charger.rate} kW)`; chargerSelect.appendChild(option); }); } }


    // --- Core Schedule Update Logic ---
    // (updateScheduleRange, updateCellVisual - unchanged)
    function updateScheduleRange(scheduleEntry) { if (currentBusIndex < 0 || rangeStartTimeSlot < 0 || rangeEndTimeSlot < 0 || !runCutData.buses[currentBusIndex]) { console.error("Invalid state for updating schedule range. Aborting."); hidePopover(); return; } if (scheduleEntry.activity === 'CHARGE' && scheduleEntry.chargerId) { const currentBusIdBeingEdited = runCutData.buses[currentBusIndex].busId; for (let i = rangeStartTimeSlot; i <= rangeEndTimeSlot; i++) { for (let busIdx = 0; busIdx < runCutData.buses.length; busIdx++) { if (busIdx === currentBusIndex) continue; const otherBusSchedule = runCutData.buses[busIdx].schedule[i]; if (otherBusSchedule && otherBusSchedule.activity === 'CHARGE' && otherBusSchedule.chargerId === scheduleEntry.chargerId) { const conflictTime = minutesToTime(i * SLOT_DURATION_MINUTES); const conflictBusId = runCutData.buses[busIdx].busId; const charger = availableChargers.find(ch => ch.id === scheduleEntry.chargerId); const chargerName = charger ? charger.name : scheduleEntry.chargerId; alert(`Conflict detected!\nCharger "${chargerName}" is already assigned to Bus "${conflictBusId}" at ${conflictTime}. \nPlease choose a different charger or time slot.`); return; } } } } console.log(`updateScheduleRange: Attempting update for Bus ID: ${currentBusId}, Bus Index: ${currentBusIndex}, Slots: ${rangeStartTimeSlot}-${rangeEndTimeSlot}`); const busRowElement = gridTableBody.querySelector(`tr[data-bus-id="${currentBusId}"]`); if (!busRowElement) { console.error(`!!! updateScheduleRange: Could not find bus row element for ID: ${currentBusId}`); hidePopover(); return; } for (let i = rangeStartTimeSlot; i <= rangeEndTimeSlot; i++) { runCutData.buses[currentBusIndex].schedule[i] = { ...scheduleEntry }; const cellElement = busRowElement.querySelector(`td.time-slot[data-time-slot="${i}"]`); if(cellElement) { cellElement.classList.remove('range-selected'); updateCellVisual(cellElement, scheduleEntry); } else { console.warn(`!!! updateScheduleRange: Could not find cell element for Bus ${currentBusId}, Slot ${i}`); } } console.log(`Updated Bus ${currentBusId} (Index ${currentBusIndex}), Slots ${rangeStartTimeSlot}-${rangeEndTimeSlot}:`, scheduleEntry); saveCurrentEditorState(); hidePopover(); }
    function updateCellVisual(cellElement, scheduleEntry) { cellElement.innerHTML = ''; cellElement.style.backgroundColor = ''; const busId = cellElement.dataset.busId; const timeSlot = parseInt(cellElement.dataset.timeSlot); const time = minutesToTime(timeSlot * SLOT_DURATION_MINUTES); let baseTooltip = `Bus: ${busId}, Time: ${time}`; if (!scheduleEntry) { cellElement.title = baseTooltip; return; } let cellText = ''; let bgColor = ''; let tooltipText = `${baseTooltip}\nActivity: ${scheduleEntry.activity}`; switch (scheduleEntry.activity) { case 'RUN': cellText = 'R'; bgColor = '#add8e6'; break; case 'BREAK': cellText = 'B'; bgColor = '#fffacd'; break; case 'CHARGE': cellText = 'C'; bgColor = '#90ee90'; if (scheduleEntry.chargerId) { const charger = availableChargers.find(ch => ch.id === scheduleEntry.chargerId); const chargerName = charger ? charger.name : 'Unknown'; tooltipText += `\nCharger: ${chargerName} (ID: ${scheduleEntry.chargerId || 'None'})`; } else { tooltipText += `\nCharger: None assigned`; } break; } cellElement.textContent = cellText; cellElement.style.backgroundColor = bgColor; cellElement.title = tooltipText; }

    // --- Data Loading/Saving ---
    // (loadChargerData, loadBusParameters - unchanged)
    function loadChargerData() { const storedChargers = localStorage.getItem('chargers'); try { availableChargers = storedChargers ? JSON.parse(storedChargers) : []; console.log("Available chargers loaded:", availableChargers); } catch (e) { console.error("Error parsing available chargers:", e); availableChargers = []; } }
    function loadBusParameters() { const storedParams = localStorage.getItem(BUS_PARAMS_KEY); currentBusParameters = null; if (storedParams) { try { const loadedParams = JSON.parse(storedParams); if (loadedParams && typeof loadedParams.essCapacity === 'number' && loadedParams.essCapacity > 0 && typeof loadedParams.euRate === 'number' && loadedParams.euRate >= 0 && typeof loadedParams.warningThresholdLow === 'number' && loadedParams.warningThresholdLow >= 0 && loadedParams.warningThresholdLow <= 100 && typeof loadedParams.warningThresholdCritical === 'number' && loadedParams.warningThresholdCritical >= 0 && loadedParams.warningThresholdCritical <= 100) { currentBusParameters = loadedParams; console.log("Bus parameters loaded for simulation:", currentBusParameters); return true; } else { console.error("Loaded bus parameters are invalid or incomplete:", loadedParams); alert("Error: Bus parameters configured in the Configuration tab are invalid or incomplete. Please check configuration."); return false; } } catch (e) { console.error("Error parsing bus parameters from Local Storage:", e); alert("Error: Could not parse bus parameters from configuration. Please check configuration."); return false; } } else { alert("Error: Bus parameters have not been configured or saved. Please go to the Configuration tab and save parameters."); return false; } }


    // --- Persistence Logic (Auto-Save/Load Last State) ---
    // (saveCurrentEditorState, loadLastEditorState, initializeEmptyRunCutData, initializeEmptyRunCutDataAndAddDefaultBus - unchanged)
    function saveCurrentEditorState() { runCutData.name = runCutNameInput.value.trim(); try { localStorage.setItem(EDITOR_LAST_STATE_KEY, JSON.stringify(runCutData)); } catch (e) { console.error("Error auto-saving editor state:", e); } }
    function loadLastEditorState() { const savedState = localStorage.getItem(EDITOR_LAST_STATE_KEY); if (savedState) { try { const loadedData = JSON.parse(savedState); if (loadedData && typeof loadedData === 'object' && Array.isArray(loadedData.buses)) { runCutData = loadedData; runCutNameInput.value = runCutData.name || ''; console.log("Loaded last editor state:", runCutData); if (runCutData.buses.length === 0) { console.log("Loaded state has no buses, adding one default bus."); addBusRow(); } } else { console.warn("Invalid data found in last editor state. Initializing fresh."); initializeEmptyRunCutDataAndAddDefaultBus(); } } catch (e) { console.error("Error parsing last editor state:", e, ". Initializing fresh."); initializeEmptyRunCutDataAndAddDefaultBus(); } } else { console.log("No previous editor state found. Initializing fresh."); initializeEmptyRunCutDataAndAddDefaultBus(); } }
    function initializeEmptyRunCutData() { runCutData = { name: '', buses: [] }; runCutNameInput.value = ''; console.log("Initialized empty run cut data structure."); }
    function initializeEmptyRunCutDataAndAddDefaultBus() { initializeEmptyRunCutData(); addBusRow(); }


    // --- Named Save/Load/Clear (Manual) ---
    // (handleSaveRunCut - unchanged)
    function handleSaveRunCut() { const name = runCutNameInput.value.trim(); if (!name) { alert("Please enter a name for the run cut before saving."); runCutNameInput.focus(); return; } runCutData.name = name; try { const storageKey = RUN_CUT_PREFIX + name; localStorage.setItem(storageKey, JSON.stringify(runCutData)); console.log("Run Cut Saved:", runCutData); showStatusMessage(runCutStatus, `Run cut "${name}" saved successfully!`); } catch (e) { console.error("Error saving run cut to Local Storage:", e); showStatusMessage(runCutStatus, "Error saving run cut.", true); alert("Error saving run cut. Local Storage might be full or disabled."); } }

    // *** Show Load Modal - MODIFIED to add Delete button ***
    function showLoadRunCutModal() {
        console.log("Opening load run cut modal...");
        modalRunCutList.innerHTML = ''; // Clear previous list
        let savedRunCutNames = [];
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key.startsWith(RUN_CUT_PREFIX)) {
                    savedRunCutNames.push(key.substring(RUN_CUT_PREFIX.length));
                }
            }
        } catch (e) {
             console.error("Error accessing localStorage:", e);
             modalRunCutList.innerHTML = '<p style="color: red;">Error accessing saved run cuts.</p>';
             loadModal.style.display = 'block';
             return;
        }

        if (savedRunCutNames.length === 0) {
            modalRunCutList.innerHTML = '<p>No saved run cuts found.</p>';
        } else {
            const list = document.createElement('ul');
            savedRunCutNames.sort().forEach(name => {
                const listItem = document.createElement('li');
                const nameSpan = document.createElement('span');
                nameSpan.textContent = name;
                nameSpan.style.flexGrow = '1'; // Allow name to take up space
                nameSpan.style.marginRight = '10px';

                 // --- Container for buttons ---
                 const buttonGroup = document.createElement('div');

                // Load Button
                const loadBtn = document.createElement('button');
                loadBtn.textContent = 'Load';
                loadBtn.dataset.runCutName = name; // Store name on button
                loadBtn.addEventListener('click', handleModalLoadClick);

                // *** NEW: Delete Button ***
                const deleteBtn = document.createElement('button');
                deleteBtn.textContent = 'Delete';
                deleteBtn.classList.add('delete-btn'); // For CSS styling
                deleteBtn.dataset.runCutName = name; // Store name here too
                deleteBtn.addEventListener('click', handleModalDeleteClick); // Add listener

                buttonGroup.appendChild(loadBtn);
                buttonGroup.appendChild(deleteBtn); // Add delete button next to load

                listItem.appendChild(nameSpan);
                listItem.appendChild(buttonGroup); // Add the group of buttons
                list.appendChild(listItem);
            });
            modalRunCutList.appendChild(list);
        }
        loadModal.style.display = 'block'; // Show the modal
    }

    // (hideLoadRunCutModal - unchanged)
    function hideLoadRunCutModal() { loadModal.style.display = 'none'; }
    // (handleModalLoadClick - unchanged)
    function handleModalLoadClick(event) { const button = event.target; const nameToLoad = button.dataset.runCutName; if (!nameToLoad) { console.error("Could not find run cut name on button:", button); return; } console.log(`Load button clicked for: ${nameToLoad}`); performLoad(nameToLoad); hideLoadRunCutModal(); }
    // (performLoad - unchanged)
    function performLoad(nameToLoad) { const storageKey = RUN_CUT_PREFIX + nameToLoad; const savedDataString = localStorage.getItem(storageKey); if (!savedDataString) { alert(`Run cut named "${nameToLoad}" not found.`); console.warn("Load failed: Run cut not found in localStorage:", storageKey); return; } try { const loadedData = JSON.parse(savedDataString); if (loadedData && typeof loadedData === 'object' && Array.isArray(loadedData.buses)) { runCutData = loadedData; runCutNameInput.value = runCutData.name || ''; console.log("Run Cut Loaded:", runCutData); renderAllBusRows(); saveCurrentEditorState(); showStatusMessage(runCutStatus, `Run cut "${nameToLoad}" loaded successfully.`); } else { alert(`Error: Data for "${nameToLoad}" is invalid.`); console.error("Load failed: Invalid data structure found:", loadedData); } } catch (e) { alert(`Error parsing data for "${nameToLoad}".`); console.error("Load failed: Error parsing JSON:", e); } }

    // *** NEW: Handle Click on Delete Button inside Modal ***
    function handleModalDeleteClick(event) {
        const button = event.target;
        const nameToDelete = button.dataset.runCutName;

        if (!nameToDelete) {
            console.error("Could not find run cut name on delete button:", button);
            return;
        }

        if (confirm(`Are you sure you want to permanently delete the run cut named "${nameToDelete}"?`)) {
            console.log(`Delete button clicked for: ${nameToDelete}`);
            const storageKey = RUN_CUT_PREFIX + nameToDelete;
            try {
                localStorage.removeItem(storageKey);
                console.log(`Removed item from localStorage: ${storageKey}`);

                // Remove the corresponding list item from the modal UI
                const listItemToRemove = button.closest('li'); // Find the parent <li>
                if (listItemToRemove) {
                    listItemToRemove.remove();
                }

                // Check if the list is now empty
                const remainingItems = modalRunCutList.querySelectorAll('li');
                if (remainingItems.length === 0) {
                    modalRunCutList.innerHTML = '<p>No saved run cuts found.</p>';
                }

                // Optional: Show a status message on the main page
                showStatusMessage(runCutStatus, `Run cut "${nameToDelete}" deleted.`);

            } catch (e) {
                console.error("Error removing item from localStorage:", e);
                alert(`Could not delete run cut "${nameToDelete}". LocalStorage might be inaccessible.`);
            }
        } else {
            console.log(`Deletion cancelled for: ${nameToDelete}`);
        }
    }


    // (handleClearRunCut - unchanged)
    function handleClearRunCut() { if (confirm("Are you sure you want to clear the current schedule? Any unsaved changes will be lost.")) { console.log("Clearing current run cut..."); initializeEmptyRunCutData(); addBusRow(); renderAllBusRows(); showStatusMessage(runCutStatus, "Schedule cleared."); } else { console.log("Clear cancelled by user."); } }

    // --- Simulation Logic ---
    // (handleRunSimulation - unchanged)
    function handleRunSimulation() { console.log("Run Simulation button clicked."); resultsOutput.innerHTML = '<p>Running simulation...</p>'; resultsContainer.style.display = 'block'; if (!loadBusParameters()) { resultsOutput.innerHTML = '<p style="color: red;">Simulation cancelled due to configuration errors.</p>'; return; } runCutData.name = runCutNameInput.value.trim(); if (typeof runSimulation !== 'function') { console.error("Simulation function 'runSimulation' not found."); resultsOutput.innerHTML = '<p style="color: red;">Critical Error: Simulation engine not loaded.</p>'; return; } const simulationResults = runSimulation(runCutData, currentBusParameters, availableChargers); displaySimulationResults(simulationResults); }
    // (displaySimulationResults - unchanged, already displays energy totals)
    function displaySimulationResults(results) { console.log("Displaying simulation results:", results); resultsOutput.innerHTML = ''; if (results.overallErrors && results.overallErrors.length > 0) { const errorList = document.createElement('ul'); results.overallErrors.forEach(err => { const item = document.createElement('li'); item.textContent = err; item.style.color = 'red'; errorList.appendChild(item); }); resultsOutput.appendChild(errorList); return; } if (!results.resultsPerBus || Object.keys(results.resultsPerBus).length === 0) { resultsOutput.innerHTML = '<p>Simulation ran, but no results were generated.</p>'; return; } for (const busId in results.resultsPerBus) { const busResult = results.resultsPerBus[busId]; const busDiv = document.createElement('div'); busDiv.style.marginBottom = '15px'; busDiv.style.borderBottom = '1px solid #eee'; busDiv.style.paddingBottom = '10px'; const title = document.createElement('h4'); title.textContent = `Bus: ${busId}`; busDiv.appendChild(title); if (busResult.errors && busResult.errors.length > 0) { const issueTitle = document.createElement('p'); issueTitle.textContent = 'Potential Issues / Warnings:'; issueTitle.style.fontWeight = 'bold'; busDiv.appendChild(issueTitle); const issueList = document.createElement('ul'); busResult.errors.forEach(errText => { const item = document.createElement('li'); item.textContent = errText; const lowerErrText = errText.toLowerCase(); if (lowerErrText.includes('stranded')) { item.style.color = 'red'; item.style.fontWeight = 'bold'; } else if (lowerErrText.includes('critical soc')) { item.style.color = 'red'; } else if (lowerErrText.includes('low soc warning')) { item.style.color = 'darkorange'; } else if (lowerErrText.includes('error')) { item.style.color = 'purple'; } issueList.appendChild(item); }); busDiv.appendChild(issueList); } else { const noIssues = document.createElement('p'); noIssues.textContent = 'No SOC warnings or schedule/config errors detected.'; noIssues.style.color = 'green'; busDiv.appendChild(noIssues); } if (busResult.socTimeSeries && busResult.socTimeSeries.length > 0) { const finalSOC = busResult.socTimeSeries[busResult.socTimeSeries.length - 1]; const minSOC = Math.min(...busResult.socTimeSeries); const summaryP = document.createElement('p'); summaryP.innerHTML = `Ending SOC: <strong>${finalSOC.toFixed(1)}%</strong> / Minimum SOC: <strong>${minSOC.toFixed(1)}%</strong>`; if (minSOC < (currentBusParameters?.warningThresholdCritical ?? 10)) { summaryP.querySelector('strong:last-of-type').style.color = 'red'; } else if (minSOC < (currentBusParameters?.warningThresholdLow ?? 20)) { summaryP.querySelector('strong:last-of-type').style.color = 'darkorange'; } busDiv.appendChild(summaryP); } else { busDiv.appendChild(document.createElement('p'). T="No SOC data generated."); } const energyP = document.createElement('p'); const consumed = busResult.totalEnergyConsumedKWh?.toFixed(1) || 'N/A'; const charged = busResult.totalEnergyChargedKWh?.toFixed(1) || 'N/A'; energyP.innerHTML = `Energy Consumed: <strong>${consumed} kWh</strong> / Energy Charged: <strong>${charged} kWh</strong>`; busDiv.appendChild(energyP); resultsOutput.appendChild(busDiv); } }
    // (hideResults - unchanged)
    function hideResults() { resultsContainer.style.display = 'none'; resultsOutput.innerHTML = ''; }


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