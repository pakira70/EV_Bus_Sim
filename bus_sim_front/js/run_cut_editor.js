// Wait for the HTML DOM to be fully loaded before running the script
document.addEventListener('DOMContentLoaded', () => {

    // --- Constants ---
    const NUM_TIME_SLOTS = 96; // 24 hours * 4 slots/hour
    const SLOT_DURATION_MINUTES = 15;

    // --- DOM Element References ---
    const runCutNameInput = document.getElementById('run-cut-name');
    const saveRunCutBtn = document.getElementById('save-run-cut-btn');
    const loadRunCutBtn = document.getElementById('load-run-cut-btn'); // Listener not yet added
    const addBusBtn = document.getElementById('add-bus-btn');
    const runCutStatus = document.getElementById('run-cut-status');
    const gridTable = document.getElementById('schedule-grid');
    const gridTableBody = document.getElementById('schedule-grid-body');

    // Popover Elements
    const activityPopover = document.getElementById('activity-popover');
    const popoverCellInfo = document.getElementById('popover-cell-info');
    const chargeOptionsDiv = document.getElementById('charge-options');
    const chargerSelect = document.getElementById('charger-select');
    const popoverCancelBtn = document.getElementById('popover-cancel');
    const activityButtons = activityPopover.querySelectorAll('.activity-btn');

    // --- State Variables ---
    let runCutData = { // Structure to hold the schedule data
        name: '',
        buses: [] // Array of bus schedule objects { busId: string, startSOC: number, schedule: array[96] }
    };
    let availableChargers = []; // Will be loaded from config storage

    // Variables to track the cell being edited by the popover
    let currentEditingCell = null; // The actual <td> element used for positioning popover
    let currentBusId = null;       // The ID of the bus being edited
    let currentBusIndex = -1;      // The index in the runCutData.buses array
    let rangeStartTimeSlot = -1;  // Store the START of the selected range (0-95)
    let rangeEndTimeSlot = -1;   // Store the END of the selected range (0-95)

    // Variables for drag-select ("paint") functionality
    let isDragging = false;
    let dragStartCell = null;      // The cell where dragging started
    let dragStartBusId = null;     // The bus ID of the row where dragging started
    let dragStartTimeslot = -1;    // The timeslot index where dragging started
    let dragCurrentEndTimeslot = -1; // The timeslot index the mouse is currently over during drag


    // --- Initialization ---
    function initializeEditor() {
        console.log("Initializing Run Cut Editor...");
        loadChargerData(); // Load available chargers first
        generateGridHeader();
        // TODO: Implement loading existing run cut data
        // For now, add one default bus row if empty
        if (runCutData.buses.length === 0) {
            addBusRow(); // Add one default bus
        } else {
            renderAllBusRows(); // Render buses if data was loaded (future feature)
        }
        setupEventListeners();
    }

    // --- Event Listeners Setup ---
    function setupEventListeners() {
        addBusBtn.addEventListener('click', () => addBusRow()); // Pass no args to create new
        saveRunCutBtn.addEventListener('click', handleSaveRunCut);
        // TODO: Add listener for loadRunCutBtn

        // --- Event delegation for drag-and-drop/click ---
        gridTableBody.addEventListener('mousedown', handleGridMouseDown); // Start drag/click
        gridTableBody.addEventListener('mouseover', handleGridMouseOver); // Handle dragging over cells
        // Mouseup needs to be on the document to catch release outside the grid
        document.addEventListener('mouseup', handleGridMouseUp); // End drag/click

        // Add listeners for popover buttons
        activityButtons.forEach(btn => btn.addEventListener('click', handleActivitySelection));
        popoverCancelBtn.addEventListener('click', hidePopover);

        // Add listener for charger selection change
        chargerSelect.addEventListener('change', handleChargerSelection);

        // Prevent browser's default drag behavior which can interfere
        gridTableBody.addEventListener('dragstart', (e) => e.preventDefault());
    }

    // --- Grid Generation ---
    function generateGridHeader() {
        const thead = gridTable.querySelector('thead') || gridTable.createTHead();
        thead.innerHTML = ''; // Clear existing header
        const headerRow = thead.insertRow();

        // First columns for Bus ID and Start SOC
        headerRow.innerHTML = '<th>Bus ID</th><th>Start SOC (%)</th>';

        // Generate time slot headers
        for (let i = 0; i < NUM_TIME_SLOTS; i++) {
            const th = document.createElement('th');
            const time = minutesToTime(i * SLOT_DURATION_MINUTES);
            th.textContent = time;
            th.title = `Time Slot ${i} (${time})`; // Tooltip
            headerRow.appendChild(th);
        }
        // Add column for actions (like Remove Bus)
        headerRow.insertCell().outerHTML = '<th>Actions</th>';
    }

    function minutesToTime(totalMinutes) {
        const hours = Math.floor(totalMinutes / 60).toString().padStart(2, '0');
        const minutes = (totalMinutes % 60).toString().padStart(2, '0');
        return `${hours}:${minutes}`;
    }

    // Function to add a bus row to the table and data model
    function addBusRow(busData = null) {
        const isNewBus = !busData; // Flag if we're creating a new bus object

        if (isNewBus) {
            const newBusId = `Bus-${Date.now().toString().slice(-3)}`;
            busData = {
                busId: newBusId,
                startSOC: 90,
                schedule: Array(NUM_TIME_SLOTS).fill(null)
            };
            runCutData.buses.push(busData);
        }

        const busIndex = runCutData.buses.findIndex(b => b.busId === busData.busId);
        if (busIndex === -1 && !isNewBus) {
            console.error("Render failed: Bus data not found:", busData.busId);
            return;
        }

        const row = gridTableBody.insertRow();
        row.dataset.busId = busData.busId;

        // Cell 1: Bus ID
        const idCell = row.insertCell();
        idCell.textContent = busData.busId;

        // Cell 2: Start SOC Input
        const socCell = row.insertCell();
        const socInput = document.createElement('input');
        socInput.type = 'number';
        socInput.value = busData.startSOC;
        socInput.min = 0;
        socInput.max = 100;
        socInput.classList.add('start-soc-input');
        socInput.dataset.busId = busData.busId;
        socInput.addEventListener('change', handleSocChange);
        socCell.appendChild(socInput);
        socCell.appendChild(document.createTextNode(' %'));

        // Cells 3 to (NUM_TIME_SLOTS + 2): Time Slots
        for (let i = 0; i < NUM_TIME_SLOTS; i++) {
            const cell = row.insertCell();
            cell.classList.add('time-slot');
            cell.dataset.busId = busData.busId;
            cell.dataset.timeSlot = i;
            updateCellVisual(cell, busData.schedule[i]);
        }

        // Cell (NUM_TIME_SLOTS + 3): Actions
        const actionCell = row.insertCell();
        const removeBtn = document.createElement('button');
        removeBtn.textContent = '🗑️ Remove';
        removeBtn.classList.add('remove-bus-btn');
        removeBtn.dataset.busId = busData.busId;
        removeBtn.addEventListener('click', handleRemoveBus);
        actionCell.appendChild(removeBtn);

        if (isNewBus) {
            console.log("Added bus row:", busData.busId);
        }
    }

    // Clears and redraws all bus rows based on the current runCutData.buses array
    function renderAllBusRows() {
        gridTableBody.innerHTML = ''; // Clear existing rows
        runCutData.buses.forEach(bus => {
            addBusRow(bus);
        });
        console.log("Rendered all bus rows.");
    }

    // --- Grid Interaction ---

    // Mousedown initiates the drag selection process or prepares for single click
    function handleGridMouseDown(event) {
        if (event.button !== 0 || event.target.tagName === 'INPUT' || event.target.tagName === 'BUTTON') {
            return; // Only left-click, ignore clicks on inputs/buttons
        }

        const targetCell = event.target.closest('.time-slot');
        if (targetCell) {
            event.preventDefault(); // Prevent text selection
            isDragging = true;
            dragStartCell = targetCell;
            dragStartBusId = targetCell.dataset.busId;
            dragStartTimeslot = parseInt(targetCell.dataset.timeSlot);
            dragCurrentEndTimeslot = dragStartTimeslot; // Start and end are same initially

            clearRangeSelection(); // Clear any previous visual selection
            targetCell.classList.add('range-selected'); // Highlight starting cell
            console.log(`MouseDown: Bus ${dragStartBusId}, Slot ${dragStartTimeslot}`);
        }
    }

    // Mouseover updates the selection range if dragging is active
    function handleGridMouseOver(event) {
        if (!isDragging || !dragStartCell) {
            return; // Exit if not dragging
        }

        const targetCell = event.target.closest('.time-slot');
        if (targetCell) {
            const currentBusId = targetCell.dataset.busId;
            const currentTimeslot = parseInt(targetCell.dataset.timeSlot);

            // Ensure dragging stays within the same bus row
            if (currentBusId === dragStartBusId) {
                // Only update if the end slot has changed
                if(currentTimeslot !== dragCurrentEndTimeslot) {
                    dragCurrentEndTimeslot = currentTimeslot;
                    highlightRange(); // Update visual selection range
                }
            }
            // Optional: Could reset drag if mouse moves to a different row
        }
    }

    // Mouseup finalizes the selection and shows the popover
    function handleGridMouseUp(event) {
        if (!isDragging) {
            return; // Exit if not dragging
        }
        isDragging = false; // End dragging state IMPORTANT

        // Check if drag actually happened or if it was just a click
        if (!dragStartCell) return; // Should not happen if isDragging was true, but safety check

        // Determine the final start and end of the selection range
        const startIndex = Math.min(dragStartTimeslot, dragCurrentEndTimeslot);
        const endIndex = Math.max(dragStartTimeslot, dragCurrentEndTimeslot);

        console.log(`MouseUp: Final Range Bus ${dragStartBusId}, Slots ${startIndex}-${endIndex}`);

        // Set the state needed for the popover interaction
        currentBusId = dragStartBusId;
        currentBusIndex = runCutData.buses.findIndex(b => b.busId === currentBusId);

        if (currentBusIndex === -1) {
            console.error("Bus data not found on mouseup:", currentBusId);
            clearRangeSelection();
            resetDragState();
            return;
        }

        // Store the final validated range for popover actions
        rangeStartTimeSlot = startIndex;
        rangeEndTimeSlot = endIndex;

        // Find the first cell in the selection for positioning the popover
        const firstCellInSelection = gridTableBody.querySelector(`td.time-slot[data-bus-id="${currentBusId}"][data-time-slot="${startIndex}"]`);
        currentEditingCell = firstCellInSelection || dragStartCell; // Use first cell or fallback

        // Only show popover if currentEditingCell is valid
        if (currentEditingCell) {
             showPopover(currentEditingCell); // Show popover near the start of the selection
        } else {
             console.error("Could not find cell to position popover.");
        }


        // Reset drag-specific variables
        resetDragState();
        // Note: Visual highlighting is cleared via hidePopover later
    }

    // Helper to reset variables used during the drag operation
    function resetDragState() {
         dragStartCell = null;
         dragStartBusId = null;
         dragStartTimeslot = -1;
         dragCurrentEndTimeslot = -1;
    }

    // Handles changes to the Start SOC input field
    function handleSocChange(event) {
        const input = event.target;
        const busId = input.dataset.busId;
        const busIndex = runCutData.buses.findIndex(b => b.busId === busId);

        if (busIndex === -1) return; // Should not happen

        let newSoc = parseInt(input.value);
        if (isNaN(newSoc)) newSoc = 0;
        newSoc = Math.max(0, Math.min(100, newSoc)); // Clamp between 0-100
        input.value = newSoc;

        runCutData.buses[busIndex].startSOC = newSoc;
        console.log(`Bus ${busId} Start SOC updated to: ${newSoc}`);
    }

    // Handles clicking the remove button on a bus row
    function handleRemoveBus(event) {
        const button = event.target.closest('.remove-bus-btn');
        const busId = button?.dataset.busId; // Use optional chaining

        if (!busId) return;

        if (confirm(`Are you sure you want to remove ${busId} and its schedule?`)) {
            const busIndexToRemove = runCutData.buses.findIndex(b => b.busId === busId);
            if (busIndexToRemove > -1) {
                runCutData.buses.splice(busIndexToRemove, 1); // Remove from data
                const rowToRemove = gridTableBody.querySelector(`tr[data-bus-id="${busId}"]`);
                if (rowToRemove) rowToRemove.remove(); // Remove from table
                showStatusMessage(runCutStatus, `${busId} removed.`);
            }
        }
    }

    // --- Popover Logic ---

    function showPopover(targetCell) {
        if (!targetCell) return;
        const rect = targetCell.getBoundingClientRect();
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

        activityPopover.style.top = `${rect.bottom + scrollTop + 5}px`;
        activityPopover.style.left = `${rect.left + scrollLeft}px`;
        activityPopover.style.display = 'block';

        const startTime = minutesToTime(rangeStartTimeSlot * SLOT_DURATION_MINUTES);
        let timeRangeText = startTime;
        if (rangeStartTimeSlot !== rangeEndTimeSlot) {
            const endTimeMinutes = (rangeEndTimeSlot + 1) * SLOT_DURATION_MINUTES;
            const endTime = minutesToTime(endTimeMinutes - SLOT_DURATION_MINUTES); // Show end of last slot included
            timeRangeText = `${startTime} - ${endTime}`;
        }
        popoverCellInfo.textContent = `Bus: ${currentBusId}, Time: ${timeRangeText}`;

        chargeOptionsDiv.style.display = 'none';
        chargerSelect.value = "";
    }

    function hidePopover() {
        activityPopover.style.display = 'none';
        clearRangeSelection(); // Clear visual selection highlight
        // Reset popover interaction state
        currentEditingCell = null;
        currentBusId = null;
        currentBusIndex = -1;
        rangeStartTimeSlot = -1;
        rangeEndTimeSlot = -1;
    }

    // Handles clicks on the RUN/BREAK/CHARGE buttons within the popover
    function handleActivitySelection(event) {
        const selectedActivity = event.target.dataset.activity;
        console.log("Selected Activity for range:", selectedActivity);

        if (currentBusIndex < 0 || rangeStartTimeSlot < 0 || rangeEndTimeSlot < 0) {
            console.error("Invalid state for activity selection.");
            hidePopover();
            return;
        }

        if (selectedActivity === 'CHARGE') {
            populateChargerSelect();
            chargeOptionsDiv.style.display = 'block';
        } else {
            const scheduleEntry = {
                activity: selectedActivity,
                chargerId: null
            };
            updateScheduleRange(scheduleEntry); // Apply RUN or BREAK to range
        }
    }

    // Handles the change event of the charger dropdown select
    function handleChargerSelection() {
        const selectedChargerId = chargerSelect.value;

        if (currentBusIndex < 0 || rangeStartTimeSlot < 0 || rangeEndTimeSlot < 0 || !selectedChargerId) {
            console.log("Charger selection requires valid range and charger choice.");
            return; // Don't proceed if no valid charger selected
        }

        const scheduleEntry = {
            activity: 'CHARGE',
            chargerId: selectedChargerId
        };
        updateScheduleRange(scheduleEntry); // Apply CHARGE to range
    }


    // Applies a schedule entry to the selected range in data and visuals
    function updateScheduleRange(scheduleEntry) {
         // Validate state before updating
        if (currentBusIndex < 0 || rangeStartTimeSlot < 0 || rangeEndTimeSlot < 0 || !runCutData.buses[currentBusIndex]) {
            console.error("Invalid state for updating schedule range. Aborting.");
            hidePopover();
            return;
        }

        // --- VALIDATION START: Check for Charger Conflicts ---
        if (scheduleEntry.activity === 'CHARGE' && scheduleEntry.chargerId) {
            const currentBusIdBeingEdited = runCutData.buses[currentBusIndex].busId; // Get ID of the bus being edited
            for (let i = rangeStartTimeSlot; i <= rangeEndTimeSlot; i++) { // Loop through time slots in the target range
                // Check all OTHER buses
                for (let busIdx = 0; busIdx < runCutData.buses.length; busIdx++) {
                    // Skip the bus we are currently editing
                    if (busIdx === currentBusIndex) continue;

                    const otherBusSchedule = runCutData.buses[busIdx].schedule[i];
                    // Check if the other bus is charging with the same charger at this specific time slot
                    if (otherBusSchedule &&
                        otherBusSchedule.activity === 'CHARGE' &&
                        otherBusSchedule.chargerId === scheduleEntry.chargerId) {

                        // --- Conflict Found! ---
                        const conflictTime = minutesToTime(i * SLOT_DURATION_MINUTES);
                        const conflictBusId = runCutData.buses[busIdx].busId;
                        const charger = availableChargers.find(ch => ch.id === scheduleEntry.chargerId);
                        const chargerName = charger ? charger.name : scheduleEntry.chargerId;

                        alert(`Conflict detected!\nCharger "${chargerName}" is already assigned to Bus "${conflictBusId}" at ${conflictTime}. \nPlease choose a different charger or time slot.`);
                        // Don't hide popover here, let user maybe choose different charger
                        // But we must stop the update process for this selection
                        return;
                    }
                }
            }
        }
        // --- VALIDATION END ---


        // If validation passes, proceed with update...
        const busRowElement = gridTableBody.querySelector(`tr[data-bus-id="${currentBusId}"]`);
        if (!busRowElement) {
             console.warn(`Could not find bus row element for ${currentBusId} during range update`);
             hidePopover(); // Hide popover if row is gone
             return;
        }

        // Loop through the stored range (inclusive) and update data + visuals
        for (let i = rangeStartTimeSlot; i <= rangeEndTimeSlot; i++) {
            // --- Update the Data Model ---
            // Use spread syntax for a shallow copy, ensures object identity differs if needed later
            runCutData.buses[currentBusIndex].schedule[i] = { ...scheduleEntry };

            // --- Update the Cell's Visual Appearance ---
            const cellElement = busRowElement.querySelector(`td.time-slot[data-time-slot="${i}"]`);
            if(cellElement) {
                cellElement.classList.remove('range-selected'); // Remove highlight
                updateCellVisual(cellElement, scheduleEntry); // Apply final style
            }
        }

        console.log(`Updated Bus ${currentBusId} (Index ${currentBusIndex}), Slots ${rangeStartTimeSlot}-${rangeEndTimeSlot}:`, scheduleEntry);
        // TODO: Consider adding auto-save indication

        hidePopover(); // Hide popover and clear selection state after successful update
    }

    function updateCellVisual(cellElement, scheduleEntry) {
        // ... (clear previous content/styles) ...
        const busId = cellElement.dataset.busId;
        const timeSlot = parseInt(cellElement.dataset.timeSlot);
        const time = minutesToTime(timeSlot * SLOT_DURATION_MINUTES);
        let baseTooltip = `Bus: ${busId}, Time: ${time}`;

        if (!scheduleEntry) {
            cellElement.title = baseTooltip;
            return;
        }

        let cellText = '';
        let bgColor = '';
        let tooltipText = `${baseTooltip}\nActivity: ${scheduleEntry.activity}`;

        switch (scheduleEntry.activity) {
            case 'RUN':
                cellText = 'R'; bgColor = '#add8e6'; break;
            case 'BREAK':
                cellText = 'B'; bgColor = '#fffacd'; break;
            case 'CHARGE':
                cellText = 'C'; // Default to just 'C'
                bgColor = '#90ee90';
                if (scheduleEntry.chargerId) {
                    // --- MODIFICATION START ---
                    console.log(`Updating cell visual for CHARGE. Charger ID from scheduleEntry: ${scheduleEntry.chargerId}`); // Add logging

                    // Find the charger object using the ID
                    const charger = availableChargers.find(ch => ch.id === scheduleEntry.chargerId);
                    const chargerName = charger ? charger.name : 'Unknown'; // Get name or default
                    const chargerIdForTooltip = scheduleEntry.chargerId || 'None'; // Ensure we have the ID

                    // Decide what to display in the cell - Keep it simple: just 'C'
                    // We rely on the tooltip for charger info
                    cellText = 'C';

                    // Build the tooltip carefully
                    tooltipText += `\nCharger: ${chargerName} (ID: ${chargerIdForTooltip})`;
                    // --- MODIFICATION END ---
                } else {
                     tooltipText += `\nCharger: None assigned`; // Tooltip if no charger ID
                }
                break;
        }
        cellElement.textContent = cellText;
        cellElement.style.backgroundColor = bgColor;
        cellElement.title = tooltipText; // Set detailed tooltip
    }

    // --- Data Loading/Saving ---

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

    function populateChargerSelect() {
        chargerSelect.innerHTML = '<option value="">--Select Charger--</option>';
        if (availableChargers.length === 0) {
            chargerSelect.innerHTML = '<option value="" disabled>No Chargers Configured</option>';
        } else {
            availableChargers.forEach(charger => {
                const option = document.createElement('option');
                option.value = charger.id;
                option.textContent = charger.name;
                chargerSelect.appendChild(option);
            });
        }
    }

    function handleSaveRunCut() {
        const name = runCutNameInput.value.trim();
        if (!name) {
            alert("Please enter a name for the run cut before saving.");
            runCutNameInput.focus();
            return;
        }
        runCutData.name = name;
        try {
            localStorage.setItem(`runCut_${name}`, JSON.stringify(runCutData));
            console.log("Run Cut Saved:", runCutData);
            showStatusMessage(runCutStatus, `Run cut "${name}" saved successfully!`);
        } catch (e) {
            console.error("Error saving run cut to Local Storage:", e);
            showStatusMessage(runCutStatus, "Error saving run cut.", true);
            alert("Error saving run cut. Local Storage might be full or disabled.");
        }
    }

    // TODO: Implement handleLoadRunCut function

    // --- Helper functions for drag-select ---

    function highlightRange() {
        clearRangeSelection(); // Clear previous highlight
        // Determine actual start/end regardless of drag direction
        const startIndex = Math.min(dragStartTimeslot, dragCurrentEndTimeslot);
        const endIndex = Math.max(dragStartTimeslot, dragCurrentEndTimeslot);

        const busRow = gridTableBody.querySelector(`tr[data-bus-id="${dragStartBusId}"]`);
        if (!busRow) return;

        for (let i = startIndex; i <= endIndex; i++) {
            const cell = busRow.querySelector(`td.time-slot[data-time-slot="${i}"]`);
            if (cell) cell.classList.add('range-selected');
        }
    }

    function clearRangeSelection() {
        const selectedCells = gridTableBody.querySelectorAll('.time-slot.range-selected');
        selectedCells.forEach(cell => cell.classList.remove('range-selected'));
    }

    // --- Utility ---
    function showStatusMessage(element, message, isError = false) {
        if (!element) return;
        element.textContent = message;
        element.style.color = isError ? 'red' : 'green';
        setTimeout(() => {
            // Ensure the message hasn't been overwritten before clearing
            if (element.textContent === message) element.textContent = '';
        }, 4000);
    }

    // --- Start the application ---
    initializeEditor();

}); // End DOMContentLoaded