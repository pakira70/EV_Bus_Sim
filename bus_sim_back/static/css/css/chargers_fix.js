/* chargers_fix.js — forces Schedule Editor to always use fresh chargers
   - Fetches from /api/chargers with cache-buster
   - Normalizes shape to [{id, name, rate}]
   - De-dupes by id
   - Clears any legacy globals/localStorage
   - Repopulates the Assign popover select whenever it opens
   - Disables CHARGE when no chargers exist
   - Optional: disables SOC input & charging for Diesel rows
*/
(function () {
  'use strict';

  // ---- Hard reset any legacy state (once, on load) ----
  try {
    // Wipe common cache keys in localStorage if present
    ['chargers', 'availableChargers'].forEach(k => {
      if (localStorage.getItem(k) != null) localStorage.removeItem(k);
    });
  } catch {}
  // Wipe legacy globals
  try { delete window.chargers; } catch {}
  window.availableChargers = []; // single source of truth on editor page

  // ---- Helpers ----
  function qs(sel, root = document) { return root.querySelector(sel); }
  function qsa(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

  // Normalize incoming charger list to {id, name, rate}
  function normalizeChargers(arr) {
    const seen = new Set();
    const out = [];
    for (const ch of (arr || [])) {
      const id =
        ch?.id ??
        ch?.chargerId ??
        (typeof ch?.name === 'string' && ch.name.trim()) ||
        null;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const rate =
        (typeof ch?.rate === 'number' && ch.rate) ||
        (typeof ch?.rate_kw === 'number' && ch.rate_kw) ||
        (typeof ch?.rateKw === 'number' && ch.rateKw) ||
        0;
      out.push({ id, name: ch?.name || String(id), rate });
    }
    return out;
  }

  // Fetch chargers fresh from backend (cache-busted)
  async function fetchChargersFresh() {
    try {
      const res = await fetch('/api/chargers?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      window.availableChargers = normalizeChargers(data);
      console.log('[chargers_fix] fresh chargers:', window.availableChargers);
      return window.availableChargers;
    } catch (err) {
      console.error('[chargers_fix] fetch error:', err);
      window.availableChargers = [];
      return [];
    }
  }

  // Fill the <select id="charger-select"> using the freshest list
  async function populateChargerSelect() {
    const sel = qs('#charger-select');
    if (!sel) return;

    // Always fetch fresh right before showing
    const list = await fetchChargersFresh();
    sel.innerHTML = '<option value="">—Select Charger—</option>';

    for (const ch of list) {
      const opt = document.createElement('option');
      opt.value = ch.id;
      opt.textContent = `${ch.name} (${ch.rate} kW)`;
      sel.appendChild(opt);
    }

    // Disable the CHARGE activity button if none exist
    const chargeBtn = qs('.activity-btn[data-activity="CHARGE"]');
    if (chargeBtn) {
      chargeBtn.disabled = list.length === 0;
      chargeBtn.title = list.length ? '' : 'No chargers configured.';
    }
  }

  // Detect when the Assign popover opens; auto-populate the select
  function watchAssignPopover() {
    const pop = qs('#activity-popover');
    if (!pop) return;

    let wasVisible = false;
    const isVisible = () => {
      const st = getComputedStyle(pop);
      return st.display !== 'none' && st.visibility !== 'hidden' && pop.offsetParent !== null;
    };

    const maybePopulate = async () => {
      const now = isVisible();
      if (now && !wasVisible) {
        wasVisible = true;
        await populateChargerSelect();
      } else if (!now && wasVisible) {
        wasVisible = false;
      }
    };

    // Initial check
    maybePopulate();

    // React to style/class changes that show/hide the popover
    const mo = new MutationObserver(maybePopulate);
    mo.observe(pop, { attributes: true, attributeFilter: ['style', 'class'] });

    // Also refresh if user changes focus (returning from Config tab)
    window.addEventListener('focus', () => { fetchChargersFresh(); });
  }

  // Optional: disable SOC input & charging UI for Diesel rows
  function isDieselRow(row) {
    const sel = qs('.bus-type-select', row);
    return sel && sel.value && sel.value.toLowerCase() === 'diesel';
  }
  function setRowFuelState(row) {
    const socInput = qs('.start-soc-input', row);
    const isDiesel = isDieselRow(row);

    if (socInput) {
      socInput.disabled = !!isDiesel;
      socInput.placeholder = isDiesel ? '—' : (socInput.placeholder || 'e.g. 90');
      if (isDiesel) socInput.value = '';
    }

    // If popover is open and this is the active row, disable CHARGE button when Diesel
    const chargeBtn = qs('.activity-btn[data-activity="CHARGE"]');
    if (chargeBtn) chargeBtn.disabled = chargeBtn.disabled || !!isDiesel;
  }
  function wireDieselToggles() {
    const tbody = qs('#schedule-grid-body');
    if (!tbody) return;

    // Apply once to existing rows
    qsa('tr', tbody).forEach(setRowFuelState);

    // Delegate change handler
    tbody.addEventListener('change', (e) => {
      const sel = e.target.closest('.bus-type-select');
      if (!sel) return;
      const row = e.target.closest('tr');
      setRowFuelState(row);

      // If row switched to Diesel, clear any CHARGE events in its scheduleData
      try {
        const busId = row?.dataset?.busId;
        const data = window.scheduleData?.[busId];
        if (busId && Array.isArray(data)) {
          for (let i = 0; i < data.length; i++) {
            if (data[i]?.type === 'CHARGE') data[i] = null;
          }
          // Also update UI for that row’s cells (remove “C” glyphs)
          qsa('td.time-slot', row).forEach(td => {
            if (td.textContent === 'C') td.textContent = '';
            td.classList.remove('activity-charge');
          });
        }
      } catch {}
    });
  }

  // Boot
  document.addEventListener('DOMContentLoaded', () => {
    // Force a fresh load immediately (and purge legacy)
    fetchChargersFresh();
    // Auto-fill whenever the Assign popover opens
    watchAssignPopover();
    // Respect Diesel rows
    wireDieselToggles();
  });
})();
