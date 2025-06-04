document.addEventListener('DOMContentLoaded', function() {
    // --- DOM Element References ---
    const essCapacityInput = document.getElementById('ess-capacity');
    const euRateInput = document.getElementById('eu-rate');
    const lowSocWarningInput = document.getElementById('warning-threshold-low');
    const criticalSocWarningInput = document.getElementById('warning-threshold-critical');
    const saveBusParamsButton = document.getElementById('save-bus-params-btn');
    const busParamsStatus = document.getElementById('bus-params-status');

    const tabBusParams = document.getElementById('tab-bus-params');
    const tabChargerSetup = document.getElementById('tab-charger-setup');
    const busParamsContent = document.getElementById('bus-params-content');
    const chargerSetupContent = document.getElementById('charger-setup-content');

    // Charger Setup Elements (basic setup, expand with your full logic)
    const addChargerBtn = document.getElementById('add-charger-btn');
    const chargerFormContainer = document.getElementById('charger-form-container');
    const chargerIdInput = document.getElementById('charger-id-input');
    const chargerNameInput = document.getElementById('charger-name-input');
    const chargerRateInput = document.getElementById('charger-rate-input');
    const saveChargerDetailsBtn = document.getElementById('save-charger-details-btn');
    const cancelChargerDetailsBtn = document.getElementById('cancel-charger-details-btn');
    const chargerListContainer = document.getElementById('charger-list-container');
    const chargerStatus = document.getElementById('charger-status');

    let chargers = []; // To store charger configurations

    // --- Functions ---

    function displayStatus(element, message, isError = false) {
        if (element) {
            element.textContent = message;
            element.className = isError ? 'status-message error' : 'status-message success';
            setTimeout(() => {
                element.textContent = '';
                element.className = 'status-message';
            }, 3000);
        }
    }

    function saveBusParameters() {
        console.log("Attempting to save bus parameters...");
        if (!essCapacityInput || !euRateInput || !lowSocWarningInput || !criticalSocWarningInput || !busParamsStatus) {
            console.error("One or more bus parameter DOM elements are missing.");
            alert("Error: Page elements not loaded correctly. Try refreshing.");
            return;
        }

        const essCapacity = parseFloat(essCapacityInput.value);
        const euRate = parseFloat(euRateInput.value);
        const lowSOC = parseFloat(lowSocWarningInput.value);
        const criticalSOC = parseFloat(criticalSocWarningInput.value);

        if (isNaN(essCapacity) || essCapacity <= 0) {
            displayStatus(busParamsStatus, "Error: Invalid ESS Capacity.", true);
            return;
        }
        if (isNaN(euRate) || euRate < 0) { // Allow 0 for EU rate if bus is just idling with no load
            displayStatus(busParamsStatus, "Error: Invalid EU Rate.", true);
            return;
        }
        if (isNaN(lowSOC) || lowSOC < 0 || lowSOC > 100) {
            displayStatus(busParamsStatus, "Error: Invalid Low SOC Warning.", true);
            return;
        }
        if (isNaN(criticalSOC) || criticalSOC < 0 || criticalSOC > 100) {
            displayStatus(busParamsStatus, "Error: Invalid Critical SOC Warning.", true);
            return;
        }
        if (lowSOC <= criticalSOC) {
            displayStatus(busParamsStatus, "Error: Low SOC warning must be higher than Critical SOC.", true);
            return;
        }
         if (criticalSOC < 5) { // As per your helper text
            displayStatus(busParamsStatus, "Error: Critical SOC warning should be >= 5%.", true);
            return;
        }


        try {
            localStorage.setItem('busESSCapacity', essCapacity.toString());
            localStorage.setItem('euRate', euRate.toString());
            localStorage.setItem('lowSOCThreshold', lowSOC.toString());
            localStorage.setItem('criticalSOCThreshold', criticalSOC.toString());
            console.log("Bus parameters saved:", { essCapacity, euRate, lowSOC, criticalSOC });
            displayStatus(busParamsStatus, "Bus parameters saved successfully!");
        } catch (e) {
            console.error("Error saving bus parameters to localStorage:", e);
            displayStatus(busParamsStatus, "Failed to save bus parameters.", true);
        }
    }

    function loadBusParameters() {
        console.log("Loading bus parameters from localStorage...");
        const essCapacity = localStorage.getItem('busESSCapacity');
        const euRate = localStorage.getItem('euRate');
        const lowSOC = localStorage.getItem('lowSOCThreshold');
        const criticalSOC = localStorage.getItem('criticalSOCThreshold');

        if (essCapacityInput && essCapacity) essCapacityInput.value = essCapacity;
        if (euRateInput && euRate) euRateInput.value = euRate;
        if (lowSocWarningInput && lowSOC) lowSocWarningInput.value = lowSOC;
        if (criticalSocWarningInput && criticalSOC) criticalSocWarningInput.value = criticalSOC;
        console.log("Bus parameters loaded.");
    }

    function switchTab(activeTabId) {
        if (activeTabId === 'bus-params') {
            tabBusParams.classList.add('active');
            busParamsContent.classList.add('active');
            tabChargerSetup.classList.remove('active');
            chargerSetupContent.classList.remove('active');
        } else if (activeTabId === 'charger-setup') {
            tabChargerSetup.classList.add('active');
            chargerSetupContent.classList.add('active');
            tabBusParams.classList.remove('active');
            busParamsContent.classList.remove('active');
        }
        // Hide charger form when switching tabs unless explicitly shown
        if (chargerFormContainer) chargerFormContainer.style.display = 'none';
    }

    // --- Charger Functions (Simplified - integrate your full logic) ---
    function renderChargers() {
        if (!chargerListContainer) return;
        chargerListContainer.innerHTML = ''; // Clear existing list
        if (chargers.length === 0) {
            chargerListContainer.innerHTML = '<p>No chargers configured yet.</p>';
            return;
        }
        const ul = document.createElement('ul');
        chargers.forEach((charger, index) => {
            const li = document.createElement('li');
            li.textContent = `${charger.name} - ${charger.rate} kW `;
            
            const editBtn = document.createElement('button');
            editBtn.textContent = 'Edit';
            editBtn.onclick = () => editCharger(index);
            li.appendChild(editBtn);

            const deleteBtn = document.createElement('button');
            deleteBtn.textContent = 'Delete';
            deleteBtn.style.marginLeft = '5px';
            deleteBtn.onclick = () => deleteCharger(index);
            li.appendChild(deleteBtn);
            
            ul.appendChild(li);
        });
        chargerListContainer.appendChild(ul);
    }

    function showChargerForm(chargerData = null, index = -1) {
        if (!chargerFormContainer || !chargerIdInput || !chargerNameInput || !chargerRateInput) return;
        chargerIdInput.value = index; // Use index as ID for simplicity
        chargerNameInput.value = chargerData ? chargerData.name : '';
        chargerRateInput.value = chargerData ? chargerData.rate : '';
        chargerFormContainer.style.display = 'block';
        chargerNameInput.focus();
    }

    function saveCharger() {
        if (!chargerNameInput || !chargerRateInput || !chargerIdInput || !chargerStatus) return;

        const name = chargerNameInput.value.trim();
        const rate = parseFloat(chargerRateInput.value);
        const id = parseInt(chargerIdInput.value);

        if (!name) {
            displayStatus(chargerStatus, "Error: Charger name cannot be empty.", true);
            return;
        }
        if (isNaN(rate) || rate <= 0) {
            displayStatus(chargerStatus, "Error: Invalid charge rate.", true);
            return;
        }

        const newCharger = { name, rate };
        if (id === -1) { // New charger
            chargers.push(newCharger);
        } else { // Editing existing
            chargers[id] = newCharger;
        }
        localStorage.setItem('chargers', JSON.stringify(chargers));
        renderChargers();
        chargerFormContainer.style.display = 'none';
        displayStatus(chargerStatus, `Charger ${id === -1 ? 'added' : 'updated'} successfully!`);
    }
    
    function editCharger(index) {
        showChargerForm(chargers[index], index);
    }

    function deleteCharger(index) {
        if (confirm(`Are you sure you want to delete charger "${chargers[index].name}"?`)) {
            chargers.splice(index, 1);
            localStorage.setItem('chargers', JSON.stringify(chargers));
            renderChargers();
            displayStatus(chargerStatus, "Charger deleted.");
        }
    }


    function loadChargers() {
        console.log("Loading chargers from localStorage...");
        const storedChargers = localStorage.getItem('chargers');
        if (storedChargers) {
            try {
                chargers = JSON.parse(storedChargers);
            } catch (e) {
                console.error("Error parsing stored chargers:", e);
                chargers = []; // Reset if data is corrupt
                localStorage.removeItem('chargers'); // Clear corrupt data
            }
        } else {
            chargers = []; // Default to empty if nothing stored
        }
        renderChargers();
        console.log("Chargers loaded:", chargers);
    }


    // --- Event Listeners ---
    if (saveBusParamsButton) {
        saveBusParamsButton.addEventListener('click', saveBusParameters);
    }
    if (tabBusParams) {
        tabBusParams.addEventListener('click', () => switchTab('bus-params'));
    }
    if (tabChargerSetup) {
        tabChargerSetup.addEventListener('click', () => switchTab('charger-setup'));
    }
    if (addChargerBtn) {
        addChargerBtn.addEventListener('click', () => showChargerForm());
    }
    if (saveChargerDetailsBtn) {
        saveChargerDetailsBtn.addEventListener('click', saveCharger);
    }
    if (cancelChargerDetailsBtn && chargerFormContainer) {
        cancelChargerDetailsBtn.addEventListener('click', () => {
            chargerFormContainer.style.display = 'none';
        });
    }

    // --- Initial Load ---
    loadBusParameters();
    loadChargers();
    switchTab('bus-params'); // Ensure bus params tab is active on load

});