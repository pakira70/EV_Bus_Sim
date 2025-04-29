// Wait for the HTML DOM to be fully loaded before running the script
document.addEventListener('DOMContentLoaded', () => {

    // --- DOM Element References ---
    const tabButtons = document.querySelectorAll('.tab-button');
    const contentSections = document.querySelectorAll('.content-section');

    // Bus Parameters Elements
    const essCapacityInput = document.getElementById('ess-capacity');
    const euRateInput = document.getElementById('eu-rate');
    const saveBusParamsBtn = document.getElementById('save-bus-params');
    const busParamsStatus = document.getElementById('bus-params-status');

    // Charger Setup Elements
    const addChargerBtn = document.getElementById('add-charger-btn');
    const chargerListContainer = document.getElementById('charger-list-container');
    const chargerFormContainer = document.getElementById('charger-form-container');
    const chargerStatus = document.getElementById('charger-status');

    // Charger Form Elements
    const chargerIdInput = document.getElementById('charger-id'); // Hidden input
    const chargerNameInput = document.getElementById('charger-name');
    const chargerRateInput = document.getElementById('charger-rate');
    const saveChargerBtn = document.getElementById('save-charger-btn');
    const cancelChargerBtn = document.getElementById('cancel-charger-btn');

    // --- State Variables ---
    let chargers = []; // Array to hold charger objects

    // --- Initialization ---
    function initializeApp() {
        console.log("Initializing App...");
        loadBusParameters();
        loadChargers();
        setupEventListeners();
        // Ensure the correct tab is shown on load (usually Bus Params)
        showTab('tab-bus-params');
    }

    // --- Event Listeners Setup ---
    function setupEventListeners() {
        // Tab Button Listeners
        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                showTab(button.id);
            });
        });

        // Bus Parameters Save Button
        saveBusParamsBtn.addEventListener('click', handleSaveBusParameters);

        // Charger Setup Buttons
        addChargerBtn.addEventListener('click', handleAddCharger);
        saveChargerBtn.addEventListener('click', handleSaveChargerSubmit);
        cancelChargerBtn.addEventListener('click', hideChargerForm);

        // Note: Event listeners for Edit/Delete charger buttons are added dynamically
        //       in the renderChargerList function because those buttons don't exist on initial page load.
    }

    // --- Tab Switching Logic ---
    function showTab(tabId) {
        // Deactivate all tabs and content
        tabButtons.forEach(button => button.classList.remove('active'));
        contentSections.forEach(section => section.classList.remove('active'));

        // Activate the clicked tab and corresponding content
        const activeButton = document.getElementById(tabId);
        const activeContentId = tabId.replace('tab-', '') + '-content'; // e.g., 'tab-bus-params' -> 'bus-params-content'
        const activeContent = document.getElementById(activeContentId);

        if (activeButton) activeButton.classList.add('active');
        if (activeContent) activeContent.classList.add('active');
    }

    // --- Bus Parameters Logic ---
    function loadBusParameters() {
        const storedParams = localStorage.getItem('busParameters');
        if (storedParams) {
            try {
                const params = JSON.parse(storedParams);
                essCapacityInput.value = params.essCapacity || 435; // Default if property missing
                euRateInput.value = params.euRate || 55;          // Default if property missing
                console.log("Bus parameters loaded from Local Storage.");
            } catch (e) {
                console.error("Error parsing bus parameters from Local Storage:", e);
                // Use defaults if parsing fails
                essCapacityInput.value = 435;
                euRateInput.value = 55;
            }
        } else {
            // Use defaults if nothing is stored
            essCapacityInput.value = 435;
            euRateInput.value = 55;
            console.log("No bus parameters found in Local Storage, using defaults.");
        }
    }

    function handleSaveBusParameters() {
        const params = {
            essCapacity: parseInt(essCapacityInput.value) || 0, // Ensure it's a number
            euRate: parseFloat(euRateInput.value) || 0       // Ensure it's a number
        };

        // Basic Validation (optional for MVP but good)
        if (params.essCapacity <= 0 || params.euRate <= 0) {
            showStatusMessage(busParamsStatus, "ESS Capacity and EU Rate must be positive numbers.", true);
            return;
        }

        try {
            localStorage.setItem('busParameters', JSON.stringify(params));
            console.log("Bus parameters saved:", params);
            showStatusMessage(busParamsStatus, "Bus parameters saved successfully!");
        } catch (e) {
            console.error("Error saving bus parameters to Local Storage:", e);
            showStatusMessage(busParamsStatus, "Error saving parameters.", true);
        }
    }

    // --- Charger Setup Logic ---
    function loadChargers() {
        const storedChargers = localStorage.getItem('chargers');
        if (storedChargers) {
            try {
                chargers = JSON.parse(storedChargers);
                 console.log("Chargers loaded from Local Storage:", chargers);
            } catch (e) {
                console.error("Error parsing chargers from Local Storage:", e);
                chargers = []; // Reset to empty array on error
            }
        } else {
            chargers = []; // Start with empty array if nothing stored
            console.log("No chargers found in Local Storage.");
        }
        renderChargerList(); // Display the loaded or empty list
    }

    function saveChargers() {
        try {
            localStorage.setItem('chargers', JSON.stringify(chargers));
             console.log("Chargers saved to Local Storage.");
        } catch (e) {
            console.error("Error saving chargers to Local Storage:", e);
            showStatusMessage(chargerStatus, "Error saving charger list.", true);
        }
    }

    function renderChargerList() {
        chargerListContainer.innerHTML = ''; // Clear existing list

        if (chargers.length === 0) {
            chargerListContainer.innerHTML = '<p>No chargers configured yet.</p>';
            return;
        }

        // Create a simple table for display
        const table = document.createElement('table');
        table.style.width = '100%'; // Basic styling
        table.style.borderCollapse = 'collapse';

        // Table Header
        const thead = table.createTHead();
        const headerRow = thead.insertRow();
        headerRow.innerHTML = '<th>Charger Name</th><th>Charge Rate (kW)</th><th>Actions</th>';
        headerRow.style.textAlign = 'left';
        headerRow.style.borderBottom = '1px solid #ccc';

        // Table Body
        const tbody = table.createTBody();
        chargers.forEach(charger => {
            const row = tbody.insertRow();
            row.style.borderBottom = '1px solid #eee';

            const nameCell = row.insertCell();
            nameCell.textContent = charger.name;

            const rateCell = row.insertCell();
            rateCell.textContent = charger.rate;

            const actionsCell = row.insertCell();

            // Edit Button
            const editBtn = document.createElement('button');
            editBtn.textContent = 'Edit';
            editBtn.style.marginRight = '5px';
            editBtn.style.backgroundColor = '#ffc107'; // Yellowish for edit
            editBtn.dataset.id = charger.id; // Store ID on the button
            editBtn.addEventListener('click', () => handleEditCharger(charger.id));
            actionsCell.appendChild(editBtn);

            // Delete Button
            const deleteBtn = document.createElement('button');
            deleteBtn.textContent = 'Delete';
            deleteBtn.style.backgroundColor = '#dc3545'; // Red for delete
            deleteBtn.dataset.id = charger.id; // Store ID on the button
            deleteBtn.addEventListener('click', () => handleDeleteCharger(charger.id));
            actionsCell.appendChild(deleteBtn);
        });

        chargerListContainer.appendChild(table);
    }

    function handleAddCharger() {
        // Clear form for new entry
        chargerIdInput.value = ''; // Ensure hidden ID is empty for 'add' mode
        chargerNameInput.value = '';
        chargerRateInput.value = '';
        showChargerForm();
        chargerNameInput.focus(); // Focus on the first field
    }

    function handleEditCharger(chargerId) {
        const chargerToEdit = chargers.find(c => c.id === chargerId);
        if (!chargerToEdit) {
            console.error("Charger not found for editing:", chargerId);
            showStatusMessage(chargerStatus, "Error: Charger not found.", true);
            return;
        }

        // Populate form with existing data
        chargerIdInput.value = chargerToEdit.id; // Set the hidden ID for 'edit' mode
        chargerNameInput.value = chargerToEdit.name;
        chargerRateInput.value = chargerToEdit.rate;
        showChargerForm();
         chargerNameInput.focus();
    }

     function handleDeleteCharger(chargerId) {
        if (!confirm(`Are you sure you want to delete charger with ID: ${chargerId}?`)) {
            return; // User cancelled
        }

        // Filter out the charger to delete
        chargers = chargers.filter(c => c.id !== chargerId);
        saveChargers();
        renderChargerList();
        showStatusMessage(chargerStatus, `Charger ${chargerId} deleted.`);
        hideChargerForm(); // Hide form if it was open for the deleted item
    }

    function handleSaveChargerSubmit() {
        const id = chargerIdInput.value; // Get ID from hidden input (will be empty for new)
        const name = chargerNameInput.value.trim();
        const rate = parseFloat(chargerRateInput.value);

        // Validation
        if (!name || isNaN(rate) || rate <= 0) {
            alert('Please enter a valid Charger Name and a positive Charge Rate.');
            return;
        }

        if (id) {
            // --- Editing existing charger ---
            const index = chargers.findIndex(c => c.id === id);
            if (index > -1) {
                chargers[index].name = name;
                chargers[index].rate = rate;
                showStatusMessage(chargerStatus, `Charger ${name} updated.`);
            } else {
                console.error("Charger ID not found for update:", id);
                showStatusMessage(chargerStatus, "Error updating charger.", true);
                return; // Exit if ID wasn't found (shouldn't happen normally)
            }
        } else {
            // --- Adding new charger ---
            const newCharger = {
                id: generateId(), // Create a unique ID
                name: name,
                rate: rate
            };
            chargers.push(newCharger);
            showStatusMessage(chargerStatus, `Charger ${name} added.`);
        }

        saveChargers();
        renderChargerList();
        hideChargerForm();
    }

    function showChargerForm() {
        chargerFormContainer.style.display = 'block';
    }

    function hideChargerForm() {
        chargerFormContainer.style.display = 'none';
         chargerIdInput.value = ''; // Clear ID when hiding
         chargerNameInput.value = '';
         chargerRateInput.value = '';
    }

    // --- Utility Functions ---
    function showStatusMessage(element, message, isError = false) {
        element.textContent = message;
        element.style.color = isError ? 'red' : 'green';
        // Optional: Clear message after a few seconds
        setTimeout(() => {
            element.textContent = '';
        }, 4000); // Clear after 4 seconds
    }

    function generateId() {
        // Simple ID generator for MVP (not guaranteed unique in complex scenarios)
        return 'charger-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
    }

    // --- Start the application ---
    initializeApp();

}); // End DOMContentLoaded