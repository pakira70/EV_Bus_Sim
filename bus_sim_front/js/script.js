// Wait for the HTML DOM to be fully loaded before running the script
document.addEventListener('DOMContentLoaded', () => {

    // --- Constants ---
    const BUS_PARAMS_KEY = 'busParameters'; // Moved key here for consistency
    const CHARGERS_KEY = 'chargers';
    const DEFAULT_ESS_CAPACITY = 435;
    const DEFAULT_EU_RATE = 55;
    // *** NEW: Default Thresholds ***
    const DEFAULT_WARN_LOW = 20;
    const DEFAULT_WARN_CRITICAL = 10;
    const STRANDED_THRESHOLD = 5; // Fixed threshold for stranded state

    // --- DOM Element References ---
    const tabButtons = document.querySelectorAll('.tab-button');
    const contentSections = document.querySelectorAll('.content-section');

    // Bus Parameters Elements
    const essCapacityInput = document.getElementById('ess-capacity');
    const euRateInput = document.getElementById('eu-rate');
    // *** NEW: Threshold Inputs ***
    const warnLowInput = document.getElementById('warning-threshold-low');
    const warnCriticalInput = document.getElementById('warning-threshold-critical');
    const saveBusParamsBtn = document.getElementById('save-bus-params');
    const busParamsStatus = document.getElementById('bus-params-status');

    // Charger Setup Elements
    const addChargerBtn = document.getElementById('add-charger-btn');
    const chargerListContainer = document.getElementById('charger-list-container');
    const chargerFormContainer = document.getElementById('charger-form-container');
    const chargerStatus = document.getElementById('charger-status');

    // Charger Form Elements
    const chargerIdInput = document.getElementById('charger-id');
    const chargerNameInput = document.getElementById('charger-name');
    const chargerRateInput = document.getElementById('charger-rate');
    const saveChargerBtn = document.getElementById('save-charger-btn');
    const cancelChargerBtn = document.getElementById('cancel-charger-btn');

    // --- State Variables ---
    let chargers = []; // Array to hold charger objects

    // --- Initialization ---
    function initializeApp() {
        console.log("Initializing Config App...");
        loadBusParameters();
        loadChargers();
        setupEventListeners();
        showTab('tab-bus-params');
    }

    // --- Event Listeners Setup ---
    function setupEventListeners() {
        tabButtons.forEach(button => {
            button.addEventListener('click', () => showTab(button.id));
        });
        saveBusParamsBtn.addEventListener('click', handleSaveBusParameters);
        addChargerBtn.addEventListener('click', handleAddCharger);
        saveChargerBtn.addEventListener('click', handleSaveChargerSubmit);
        cancelChargerBtn.addEventListener('click', hideChargerForm);
        // Edit/Delete listeners added dynamically in renderChargerList
    }

    // --- Tab Switching Logic ---
    function showTab(tabId) {
        tabButtons.forEach(button => button.classList.remove('active'));
        contentSections.forEach(section => section.classList.remove('active'));
        const activeButton = document.getElementById(tabId);
        const activeContentId = tabId.replace('tab-', '') + '-content';
        const activeContent = document.getElementById(activeContentId);
        if (activeButton) activeButton.classList.add('active');
        if (activeContent) activeContent.classList.add('active');
    }

    // --- Bus Parameters Logic ---
    function loadBusParameters() {
        const storedParams = localStorage.getItem(BUS_PARAMS_KEY);
        let params = {}; // Start with empty object

        if (storedParams) {
            try {
                params = JSON.parse(storedParams);
                console.log("Bus parameters loaded from Local Storage.");
            } catch (e) {
                console.error("Error parsing bus parameters from Local Storage:", e);
                // Keep params as empty object, defaults will apply below
            }
        } else {
            console.log("No bus parameters found in Local Storage, using defaults.");
        }

        // Apply loaded values or defaults
        essCapacityInput.value = params.essCapacity > 0 ? params.essCapacity : DEFAULT_ESS_CAPACITY;
        euRateInput.value = params.euRate >= 0 ? params.euRate : DEFAULT_EU_RATE;
        // *** NEW: Load Thresholds ***
        warnLowInput.value = params.warningThresholdLow >= 0 ? params.warningThresholdLow : DEFAULT_WARN_LOW;
        warnCriticalInput.value = params.warningThresholdCritical >= 0 ? params.warningThresholdCritical : DEFAULT_WARN_CRITICAL;

        // Perform validation after loading/applying defaults
        validateThresholds();
    }

    // *** NEW: Validate Threshold Input Fields ***
    function validateThresholds() {
        let lowVal = parseInt(warnLowInput.value);
        let critVal = parseInt(warnCriticalInput.value);

        // Ensure they are numbers and within 0-100
        lowVal = isNaN(lowVal) ? DEFAULT_WARN_LOW : Math.max(0, Math.min(100, lowVal));
        critVal = isNaN(critVal) ? DEFAULT_WARN_CRITICAL : Math.max(0, Math.min(100, critVal));

        // Ensure critical is not above low
        if (critVal > lowVal) {
            critVal = lowVal; // Or set to lowVal - 1, or show error; simplest is just cap it
             console.warn("Validation: Critical threshold was > Low threshold. Adjusting Critical.");
        }
        // Ensure critical is at least the stranded threshold
         if (critVal < STRANDED_THRESHOLD) {
             critVal = STRANDED_THRESHOLD;
             console.warn(`Validation: Critical threshold cannot be below Stranded threshold (${STRANDED_THRESHOLD}%). Adjusting Critical.`);
         }
          // Ensure low is at least the critical threshold
         if (lowVal < critVal) {
            lowVal = critVal;
             console.warn("Validation: Low threshold cannot be below Critical threshold. Adjusting Low.");
         }


        // Update input fields with validated values
        warnLowInput.value = lowVal;
        warnCriticalInput.value = critVal;

        return { low: lowVal, critical: critVal }; // Return validated values
    }


    function handleSaveBusParameters() {
        // Validate thresholds *before* getting values
        const validatedThresholds = validateThresholds();

        const params = {
            essCapacity: parseInt(essCapacityInput.value) || 0,
            euRate: parseFloat(euRateInput.value) || 0,
            // *** NEW: Save validated thresholds ***
            warningThresholdLow: validatedThresholds.low,
            warningThresholdCritical: validatedThresholds.critical
        };

        // Basic Validation
        let errors = [];
        if (params.essCapacity <= 0) errors.push("ESS Capacity must be positive.");
        if (params.euRate < 0) errors.push("EU Rate cannot be negative.");
        // Threshold validation is handled by validateThresholds now

        if (errors.length > 0) {
            showStatusMessage(busParamsStatus, `Error: ${errors.join(' ')}`, true);
            return;
        }

        try {
            localStorage.setItem(BUS_PARAMS_KEY, JSON.stringify(params));
            console.log("Bus parameters saved:", params);
            showStatusMessage(busParamsStatus, "Bus parameters saved successfully!");
        } catch (e) {
            console.error("Error saving bus parameters to Local Storage:", e);
            showStatusMessage(busParamsStatus, "Error saving parameters.", true);
        }
    }

    // --- Charger Setup Logic ---
    function loadChargers() {
        const storedChargers = localStorage.getItem(CHARGERS_KEY);
        if (storedChargers) {
            try { chargers = JSON.parse(storedChargers); console.log("Chargers loaded:", chargers); }
            catch (e) { console.error("Error parsing chargers:", e); chargers = []; }
        } else { chargers = []; console.log("No chargers found."); }
        renderChargerList();
    }

    function saveChargers() {
        try { localStorage.setItem(CHARGERS_KEY, JSON.stringify(chargers)); console.log("Chargers saved."); }
        catch (e) { console.error("Error saving chargers:", e); showStatusMessage(chargerStatus, "Error saving charger list.", true); }
    }

    function renderChargerList() {
        chargerListContainer.innerHTML = ''; // Clear
        if (chargers.length === 0) { chargerListContainer.innerHTML = '<p>No chargers configured yet.</p>'; return; }
        const table = document.createElement('table'); table.style.width = '100%'; table.style.borderCollapse = 'collapse';
        const thead = table.createTHead(); const headerRow = thead.insertRow(); headerRow.innerHTML = '<th>Name</th><th>Rate (kW)</th><th>Actions</th>'; headerRow.style.textAlign = 'left'; headerRow.style.borderBottom = '1px solid #ccc';
        const tbody = table.createTBody();
        chargers.forEach(charger => {
            const row = tbody.insertRow(); row.style.borderBottom = '1px solid #eee';
            row.insertCell().textContent = charger.name;
            row.insertCell().textContent = charger.rate;
            const actionsCell = row.insertCell();
            const editBtn = document.createElement('button'); editBtn.textContent = 'Edit'; editBtn.style.marginRight = '5px'; editBtn.dataset.id = charger.id; editBtn.addEventListener('click', () => handleEditCharger(charger.id)); actionsCell.appendChild(editBtn);
            const deleteBtn = document.createElement('button'); deleteBtn.textContent = 'Delete'; deleteBtn.style.backgroundColor = '#dc3545'; deleteBtn.dataset.id = charger.id; deleteBtn.addEventListener('click', () => handleDeleteCharger(charger.id)); actionsCell.appendChild(deleteBtn);
        });
        chargerListContainer.appendChild(table);
    }

    function handleAddCharger() {
        chargerIdInput.value = ''; chargerNameInput.value = ''; chargerRateInput.value = '';
        showChargerForm(); chargerNameInput.focus();
    }

    function handleEditCharger(chargerId) {
        const chargerToEdit = chargers.find(c => c.id === chargerId);
        if (!chargerToEdit) { console.error("Charger not found:", chargerId); showStatusMessage(chargerStatus, "Error: Charger not found.", true); return; }
        chargerIdInput.value = chargerToEdit.id; chargerNameInput.value = chargerToEdit.name; chargerRateInput.value = chargerToEdit.rate;
        showChargerForm(); chargerNameInput.focus();
    }

     function handleDeleteCharger(chargerId) {
        const chargerToDelete = chargers.find(c => c.id === chargerId); // Find for name in confirmation
        const chargerName = chargerToDelete ? chargerToDelete.name : `ID ${chargerId}`;
        if (!confirm(`Are you sure you want to delete charger "${chargerName}"?`)) return;
        chargers = chargers.filter(c => c.id !== chargerId);
        saveChargers(); renderChargerList();
        showStatusMessage(chargerStatus, `Charger ${chargerName} deleted.`);
        hideChargerForm();
    }

    function handleSaveChargerSubmit() {
        const id = chargerIdInput.value;
        const name = chargerNameInput.value.trim();
        const rate = parseFloat(chargerRateInput.value);
        if (!name || isNaN(rate) || rate <= 0) { alert('Please enter a valid Charger Name and a positive Charge Rate.'); return; }
        if (id) { // Edit
            const index = chargers.findIndex(c => c.id === id);
            if (index > -1) { chargers[index].name = name; chargers[index].rate = rate; showStatusMessage(chargerStatus, `Charger ${name} updated.`); }
            else { console.error("Charger ID not found for update:", id); showStatusMessage(chargerStatus, "Error updating charger.", true); return; }
        } else { // Add
            const newCharger = { id: generateId(), name: name, rate: rate }; chargers.push(newCharger); showStatusMessage(chargerStatus, `Charger ${name} added.`);
        }
        saveChargers(); renderChargerList(); hideChargerForm();
    }

    function showChargerForm() { chargerFormContainer.style.display = 'block'; }
    function hideChargerForm() { chargerFormContainer.style.display = 'none'; chargerIdInput.value = ''; chargerNameInput.value = ''; chargerRateInput.value = ''; }

    // --- Utility Functions ---
    function showStatusMessage(element, message, isError = false) { element.textContent = message; element.style.color = isError ? 'red' : 'green'; setTimeout(() => { if (element.textContent === message) element.textContent = ''; }, 4000); }
    function generateId() { return 'charger-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5); }

    // --- Start the application ---
    initializeApp();

}); // End DOMContentLoaded