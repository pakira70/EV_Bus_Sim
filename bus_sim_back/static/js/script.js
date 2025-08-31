// static/js/script.js — FULL FILE (safe incremental upgrade)
// Keeps your existing behaviors AND adds:
// 1) Default charger name prefilled (Depot Charger N, editable)
// 2) “Add New Charger” clones the previous charge rate and increments the name
// 3) Helpers for other pages: window.getConfiguredChargers() + window.getBusParams()
// 4) Emits CustomEvent 'evsim:config-changed' when config updates (optional hook)

// --- Navigation Link Handler (active link on load) ---
document.addEventListener('DOMContentLoaded', function() {
  const navLinks = document.querySelectorAll('.main-nav .nav-link');
  if (!navLinks.length) return; // Exit if nav doesn't exist on this page

  const currentPath = window.location.pathname;

  navLinks.forEach(link => {
    const linkPath = new URL(link.href, window.location.origin).pathname;

    if (linkPath === '/' && (currentPath === '/' || currentPath.endsWith('/index.html'))) {
      link.classList.add('active');
    } else if (linkPath !== '/' && currentPath.startsWith(linkPath)) {
      link.classList.add('active');
    }
  });
});

// --- Main Config Logic ---
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

  // Charger Setup Elements
  const addChargerBtn = document.getElementById('add-charger-btn');
  const chargerFormContainer = document.getElementById('charger-form-container');
  const chargerIdInput = document.getElementById('charger-id-input');
  const chargerNameInput = document.getElementById('charger-name-input');
  const chargerRateInput = document.getElementById('charger-rate-input');
  const saveChargerDetailsBtn = document.getElementById('save-charger-details-btn');
  const cancelChargerDetailsBtn = document.getElementById('cancel-charger-details-btn');
  const chargerListContainer = document.getElementById('charger-list-container');
  const chargerStatus = document.getElementById('charger-status');

  let chargers = []; // in-memory list

  // --- Small utilities ---
  const toNum = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : NaN;
  };
  const displayStatus = (element, message, isError = false) => {
    if (!element) return;
    element.textContent = message;
    element.className = isError ? 'status-message error' : 'status-message success';
    setTimeout(() => {
      element.textContent = '';
      element.className = 'status-message';
    }, 3000);
  };
  const dispatchConfigChanged = (what) => {
    try { document.dispatchEvent(new CustomEvent('evsim:config-changed', { detail: { what } })); } catch {}
  };

  // --- Bus parameter save/load ---
  function saveBusParameters() {
    if (!essCapacityInput || !euRateInput || !lowSocWarningInput || !criticalSocWarningInput || !busParamsStatus) {
      console.error('One or more bus parameter DOM elements are missing.');
      displayStatus(busParamsStatus, 'Error: Page elements not loaded correctly. Try refreshing.', true);
      return;
    }

    const essCapacity = toNum(essCapacityInput.value);
    const euRate = toNum(euRateInput.value);
    const lowSOC = toNum(lowSocWarningInput.value);
    const criticalSOC = toNum(criticalSocWarningInput.value);

    if (!(essCapacity > 0)) { displayStatus(busParamsStatus, 'Error: Invalid ESS Capacity.', true); return; }
    if (!(euRate >= 0)) { displayStatus(busParamsStatus, 'Error: Invalid EU Rate.', true); return; }
    if (!(lowSOC >= 0 && lowSOC <= 100)) { displayStatus(busParamsStatus, 'Error: Invalid Low SOC Warning.', true); return; }
    if (!(criticalSOC >= 0 && criticalSOC <= 100)) { displayStatus(busParamsStatus, 'Error: Invalid Critical SOC Warning.', true); return; }
    if (!(lowSOC > criticalSOC)) { displayStatus(busParamsStatus, 'Error: Low SOC must be higher than Critical SOC.', true); return; }
    if (criticalSOC < 5) { displayStatus(busParamsStatus, 'Error: Critical SOC should be ≥ 5%.', true); return; }

    try {
      localStorage.setItem('busESSCapacity', String(essCapacity));
      localStorage.setItem('euRate', String(euRate));
      localStorage.setItem('lowSOCThreshold', String(lowSOC));
      localStorage.setItem('criticalSOCThreshold', String(criticalSOC));
      displayStatus(busParamsStatus, 'Bus parameters saved successfully!');
      dispatchConfigChanged('busParams');
    } catch (e) {
      console.error('Error saving bus parameters to localStorage:', e);
      displayStatus(busParamsStatus, 'Failed to save bus parameters.', true);
    }
  }

  function loadBusParameters() {
    const essCapacity = localStorage.getItem('busESSCapacity');
    const euRate = localStorage.getItem('euRate');
    const lowSOC = localStorage.getItem('lowSOCThreshold');
    const criticalSOC = localStorage.getItem('criticalSOCThreshold');

    if (essCapacityInput && essCapacity) essCapacityInput.value = essCapacity;
    if (euRateInput && euRate) euRateInput.value = euRate;
    if (lowSocWarningInput && lowSOC) lowSocWarningInput.value = lowSOC;
    if (criticalSocWarningInput && criticalSOC) criticalSocWarningInput.value = criticalSOC;
  }

  // Expose for other pages (editor)
  window.getBusParams = function(){
    return {
      essCapacity: toNum(localStorage.getItem('busESSCapacity')),
      euRate: toNum(localStorage.getItem('euRate')),
      lowSOC: toNum(localStorage.getItem('lowSOCThreshold')),
      criticalSOC: toNum(localStorage.getItem('criticalSOCThreshold')),
    };
  };

  // --- Tab switching ---
  function switchTab(activeTabId) {
    if (activeTabId === 'bus-params') {
      tabBusParams && tabBusParams.classList.add('active');
      busParamsContent && busParamsContent.classList.add('active');
      tabChargerSetup && tabChargerSetup.classList.remove('active');
      chargerSetupContent && chargerSetupContent.classList.remove('active');
    } else if (activeTabId === 'charger-setup') {
      tabChargerSetup && tabChargerSetup.classList.add('active');
      chargerSetupContent && chargerSetupContent.classList.add('active');
      tabBusParams && tabBusParams.classList.remove('active');
      busParamsContent && busParamsContent.classList.remove('active');
    }
    if (chargerFormContainer) chargerFormContainer.style.display = 'none';
  }

  // --- Chargers: load, render, add/edit/delete ---
  function loadChargers() {
    const stored = localStorage.getItem('chargers');
    if (stored) {
      try { chargers = JSON.parse(stored) || []; } catch { chargers = []; localStorage.removeItem('chargers'); }
    } else { chargers = []; }
    renderChargers();
  }

  function renderChargers() {
    if (!chargerListContainer) return;
    chargerListContainer.innerHTML = '';
    if (!Array.isArray(chargers) || chargers.length === 0) {
      chargerListContainer.innerHTML = '<p>No chargers configured yet.</p>';
      return;
    }
    const ul = document.createElement('ul');
    chargers.forEach((charger, index) => {
      const li = document.createElement('li');
      li.textContent = `${charger.name} - ${charger.rate} kW `;

      const editBtn = document.createElement('button');
      editBtn.textContent = 'Edit';
      editBtn.classList.add('action-btn-small');
      editBtn.onclick = () => editCharger(index);
      li.appendChild(editBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = 'Delete';
      deleteBtn.classList.add('action-btn-small');
      deleteBtn.style.marginLeft = '5px';
      deleteBtn.onclick = () => deleteCharger(index);
      li.appendChild(deleteBtn);

      ul.appendChild(li);
    });
    chargerListContainer.appendChild(ul);
  }

  // Default name helper (Depot Charger N) with smart increment if previous ends in a number
  function getNextChargerName() {
  const count = chargers?.length || 0;
  const last = chargers[count - 1];
  if (last && last.name) {
    const m = /^(.*?)(\d+)$/.exec(String(last.name).trim());
    if (m) {
      let base = m[1].trim() || 'Depot Charger';
      const num = parseInt(m[2], 10) + 1;
      // ensure exactly one space between base and the number
      return `${base.endsWith(' ') ? base : base + ' '}${num}`;
    }
  }
  return `Depot Charger ${count + 1}`;
}


  function showChargerForm(chargerData = null, index = -1) {
    if (!chargerFormContainer || !chargerIdInput || !chargerNameInput || !chargerRateInput) return;
    chargerIdInput.value = index;

    // If caller provided nothing, compute defaults here as well
    if (!chargerData) {
      const nextName = getNextChargerName();
      const last = chargers[chargers.length - 1];
      const nextRate = (last && typeof last.rate === 'number') ? last.rate : '';
      chargerData = { name: nextName, rate: nextRate };
    }

    chargerNameInput.value = chargerData.name ?? '';
    chargerRateInput.value = chargerData.rate ?? '';
    chargerFormContainer.style.display = 'block';
    chargerNameInput.focus();
  }

  function saveCharger() {
    if (!chargerNameInput || !chargerRateInput || !chargerIdInput || !chargerStatus) return;

    const name = (chargerNameInput.value || '').trim();
    const rate = toNum(chargerRateInput.value);
    const id = parseInt(chargerIdInput.value, 10);

    if (!name) { displayStatus(chargerStatus, 'Error: Charger name cannot be empty.', true); return; }
    if (!(rate > 0)) { displayStatus(chargerStatus, 'Error: Invalid charge rate.', true); return; }

    const newCharger = { name, rate };
    if (id === -1 || Number.isNaN(id)) {
      chargers.push(newCharger);
    } else {
      chargers[id] = newCharger;
    }
    localStorage.setItem('chargers', JSON.stringify(chargers));
    renderChargers();
    chargerFormContainer.style.display = 'none';
    displayStatus(chargerStatus, `Charger ${id === -1 || Number.isNaN(id) ? 'added' : 'updated'} successfully!`);
    dispatchConfigChanged('chargers');
  }

  function editCharger(index) { showChargerForm(chargers[index], index); }

  function deleteCharger(index) {
    // Retain confirm() for now (will migrate to Notification Center later)
    if (confirm(`Are you sure you want to delete charger "${chargers[index].name}"?`)) {
      chargers.splice(index, 1);
      localStorage.setItem('chargers', JSON.stringify(chargers));
      renderChargers();
      displayStatus(chargerStatus, 'Charger deleted.');
      dispatchConfigChanged('chargers');
    }
  }

  // --- Event Listeners ---
  if (saveBusParamsButton) saveBusParamsButton.addEventListener('click', saveBusParameters);
  if (tabBusParams) tabBusParams.addEventListener('click', () => switchTab('bus-params'));
  if (tabChargerSetup) tabChargerSetup.addEventListener('click', () => switchTab('charger-setup'));

  if (addChargerBtn) {
    addChargerBtn.addEventListener('click', () => {
      // Refresh from storage to avoid stale state if modified elsewhere
      try { const stored = localStorage.getItem('chargers'); chargers = stored ? JSON.parse(stored) : []; } catch { chargers = []; }
      const last = chargers[chargers.length - 1];
      const nextName = getNextChargerName();
      const nextRate = (last && typeof last.rate === 'number') ? last.rate : '';
      showChargerForm({ name: nextName, rate: nextRate }, -1);
    });
  }
  if (saveChargerDetailsBtn) saveChargerDetailsBtn.addEventListener('click', saveCharger);
  if (cancelChargerDetailsBtn && chargerFormContainer) {
    cancelChargerDetailsBtn.addEventListener('click', () => { chargerFormContainer.style.display = 'none'; });
  }

  // --- Initial Load ---
  if (document.getElementById('bus-params-content')) {
    loadBusParameters();
    loadChargers();
    switchTab('bus-params');
  }

  // --- Editor helpers exposed globally ---
  window.getConfiguredChargers = function() {
    try {
      const stored = localStorage.getItem('chargers');
      const list = stored ? JSON.parse(stored) : [];
      return Array.isArray(list) ? list : [];
    } catch { return []; }
  };
});
