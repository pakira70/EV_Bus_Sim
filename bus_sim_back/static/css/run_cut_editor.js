document.addEventListener('DOMContentLoaded', function() {
    // --- DOM Element References ---
    const gridBody = document.getElementById('schedule-grid-body');
    const gridHeader = document.querySelector('#schedule-grid thead');
    const addBusBtn = document.getElementById('add-bus-btn');
    
    // Popover elements
    const popover = document.getElementById('activity-popover');
    const popoverCellInfo = document.getElementById('popover-cell-info');
    const chargeOptions = document.getElementById('charge-options');
    const chargerSelect = document.getElementById('charger-select');
    const popoverCancelBtn = document.getElementById('popover-cancel');

    let scheduleData = {};
    let activeCell = null; // To keep track of which cell was clicked

    // --- NEW: Function to load chargers from the backend ---
    async function loadChargers() {
        try {
            const response = await fetch('/api/chargers');
            if (!response.ok) {
                throw new Error('Failed to fetch chargers');
            }
            const chargers = await response.json();

            // Clear existing options (except the default one)
            chargerSelect.innerHTML = '<option value="">--Select Charger--</option>';

            if (chargers.length === 0) {
                // If no chargers, disable the CHARGE button in popover
                const chargeBtn = document.querySelector('.activity-btn[data-activity="CHARGE"]');
                if(chargeBtn) {
                    chargeBtn.disabled = true;
                    chargeBtn.title = 'No chargers configured. Please add one in Configuration.';
                }
                return; // Exit if no chargers
            }

            // Enable the charge button if it was disabled
             const chargeBtn = document.querySelector('.activity-btn[data-activity="CHARGE"]');
            if(chargeBtn) {
                chargeBtn.disabled = false;
                chargeBtn.title = '';
            }

            // Populate the dropdown in the popover
            chargers.forEach(charger => {
                const option = document.createElement('option');
                option.value = charger.id;
                option.textContent = `${charger.name} (${charger.rate_kw} kW)`;
                chargerSelect.appendChild(option);
            });

        } catch (error) {
            console.error('Error loading chargers:', error);
            // Optionally, show an error message to the user
        }
    }


    // --- Core Grid and Popover Logic ---

    function createTimeHeader() {
        const headerRow = document.createElement('tr');
        const thBus = document.createElement('th');
        thBus.textContent = 'Bus #';
        headerRow.appendChild(thBus);

        for (let i = 0; i < 48; i++) { // 48 half-hour slots
            const th = document.createElement('th');
            const hour = Math.floor(i / 2);
            const minute = (i % 2) * 30;
            th.textContent = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
            headerRow.appendChild(th);
        }
        gridHeader.innerHTML = ''; // Clear existing header
        gridHeader.appendChild(headerRow);
    }
    
    function addBusRow(busId) {
        if (scheduleData[busId]) {
            alert(`Bus ${busId} already exists in the schedule.`);
            return;
        }
        
        scheduleData[busId] = Array(48).fill(null); // Initialize with null (empty)
        
        const row = document.createElement('tr');
        row.dataset.busId = busId;
        
        const busCell = document.createElement('td');
        busCell.textContent = busId;
        row.appendChild(busCell);

        for (let i = 0; i < 48; i++) {
            const cell = document.createElement('td');
            cell.dataset.timeSlot = i;
            cell.addEventListener('click', () => onCellClick(cell, busId, i));
            row.appendChild(cell);
        }
        gridBody.appendChild(row);
    }
    
    function onCellClick(cell, busId, timeSlot) {
        activeCell = cell; // Store the clicked cell
        
        // Position the popover near the clicked cell
        const rect = cell.getBoundingClientRect();
        popover.style.left = `${rect.left + window.scrollX}px`;
        popover.style.top = `${rect.bottom + window.scrollY}px`;
        
        // Update popover info
        const hour = Math.floor(timeSlot / 2);
        const minute = (timeSlot % 2) * 30;
        popoverCellInfo.textContent = `Bus: ${busId}, Time: ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

        popover.style.display = 'block';
    }

    // Event delegation for activity buttons
    popover.addEventListener('click', function(e) {
        if (e.target.classList.contains('activity-btn')) {
            const activity = e.target.dataset.activity;

            if (activity === 'CHARGE') {
                chargeOptions.style.display = 'block';
                // If a charger is selected, assign the event
                chargerSelect.onchange = () => {
                    const chargerId = chargerSelect.value;
                    const chargerName = chargerSelect.options[chargerSelect.selectedIndex].text;
                    if(chargerId) {
                        assignActivity(activity, { chargerId, chargerName });
                        chargerSelect.value = ""; // Reset for next time
                        chargerSelect.onchange = null; // Clear handler
                    }
                };
            } else {
                chargeOptions.style.display = 'none';
                assignActivity(activity);
            }
        }
    });
    
    function assignActivity(activity, chargeDetails = null) {
        if (!activeCell) return;
        const busId = activeCell.parentElement.dataset.busId;
        const timeSlot = parseInt(activeCell.dataset.timeSlot);
        
        const eventData = { type: activity };
        if (activity === 'CHARGE' && chargeDetails) {
            eventData.chargerId = chargeDetails.chargerId;
            eventData.chargerName = chargeDetails.chargerName; // Store name for display
        }

        scheduleData[busId][timeSlot] = eventData;
        
        // Update cell appearance
        activeCell.className = `activity-${activity.toLowerCase()}`;
        activeCell.textContent = activity === 'CHARGE' ? '⚡️' : '';
        
        hidePopover();
    }

    function hidePopover() {
        popover.style.display = 'none';
        chargeOptions.style.display = 'none';
        activeCell = null;
    }

    popoverCancelBtn.addEventListener('click', hidePopover);

    addBusBtn.addEventListener('click', () => {
        const busId = prompt("Enter a unique Bus ID (e.g., 26001):");
        if (busId && busId.trim() !== "") {
            addBusRow(busId.trim());
        }
    });


    // --- Initial Page Load ---
    createTimeHeader();
    loadChargers(); // <<< THIS IS THE NEW, IMPORTANT LINE that loads chargers on page entry.
    
});