/**
 * EV Bus Energy Simulation Engine + Editor adapter
 * - Robust adapter converts editor state -> engine inputs
 * - No crash if schedules/rows missing
 * - Leaves coloring/marking to the editor (optional later)
 */

// ---------------- Engine ----------------

const SLOTS = window.SLOTS ?? 96;
const SLOT_DURATION_MINUTES = 15;
const SLOT_DURATION_HOURS = SLOT_DURATION_MINUTES / 60;
const STRANDED_THRESHOLD = 5; // %

function runSimulation(runCutData, busParameters, availableChargers) {
  console.log("Starting simulation (Handles Diesel/Deadhead)...");

  const results = { resultsPerBus: {}, overallErrors: [] };

  // Validate
  if (!runCutData || !Array.isArray(runCutData.buses) || runCutData.buses.length === 0) {
    results.overallErrors.push("Simulation Error: No bus data provided.");
    return results;
  }
  if (!busParameters
      || typeof busParameters.essCapacity !== 'number' || busParameters.essCapacity <= 0
      || typeof busParameters.euRate !== 'number' || busParameters.euRate < 0
      || typeof busParameters.warningThresholdLow !== 'number'
      || typeof busParameters.warningThresholdCritical !== 'number') {
    results.overallErrors.push("Simulation Error: Invalid or missing bus parameters. Check Configuration.");
    return results;
  }
  if (!availableChargers || !Array.isArray(availableChargers)) {
    console.warn("Simulation Warning: No available charger data provided.");
    availableChargers = [];
  }

  const essCapacity = busParameters.essCapacity;
  const euRate = busParameters.euRate; // kWh per hour during RUN/DEADHEAD
  const lowThreshold = busParameters.warningThresholdLow;
  const criticalThreshold = busParameters.warningThresholdCritical;

  runCutData.buses.forEach(bus => {
    // Diesel: skip simulation but produce placeholder
    if (bus.busType === 'Diesel') {
      results.resultsPerBus[bus.busId] = {
        socTimeSeries: Array(SLOTS + 1).fill('N/A'),
        errors: ["Bus type is Diesel - simulation not applicable."],
        totalEnergyConsumedKWh: 'N/A',
        totalEnergyChargedKWh: 'N/A',
        triggerTimes: { low: null, critical: null, stranded: null },
        isDiesel: true
      };
      return;
    }

    console.log(`Simulating BEB bus: ${bus.busName || bus.busId}`);
    const busResult = {
      socTimeSeries: [],
      errors: [],
      totalEnergyConsumedKWh: 0,
      totalEnergyChargedKWh: 0,
      triggerTimes: { low: null, critical: null, stranded: null },
      isDiesel: false
    };
    results.resultsPerBus[bus.busId] = busResult;

    // Guard: ensure schedule array exists
    const schedule = Array.isArray(bus.schedule) ? bus.schedule : Array(SLOTS).fill(null);

    let currentSOC = Number(bus.startSOC);
    if (!Number.isFinite(currentSOC)) currentSOC = 90; // default

    let warnedLowText = false;
    let warnedCriticalText = false;
    let warnedStrandedText = false;

    for (let i = 0; i < SLOTS; i++) {
      busResult.socTimeSeries.push(currentSOC); // SOC at start of slot

      const scheduleEntry = schedule[i] || null;
      const activity = scheduleEntry?.activity || 'BREAK';
      const chargerId = scheduleEntry?.chargerId ?? null;
      const timeStr = minutesToTimeSim(i * SLOT_DURATION_MINUTES);

      let energyChangeKWh = 0;

      // Stranded attempt
      if (currentSOC <= 0 && (activity === 'RUN' || activity === 'DEADHEAD')) {
        if (!warnedStrandedText) {
          busResult.errors.push(`Stranded Alert at ${timeStr}: Attempted ${activity} with 0% SOC.`);
          warnedStrandedText = true;
        }
        if (busResult.triggerTimes.stranded === null) {
          busResult.triggerTimes.stranded = i;
        }
      }

      switch (activity) {
        case 'RUN':
        case 'DEADHEAD': {
          if (currentSOC > 0) {
            const theoreticalEnergyDemandKWh = euRate * SLOT_DURATION_HOURS;    // kWh this slot
            const maxAvailableEnergyKWh = (currentSOC / 100) * essCapacity;
            const actual = Math.min(theoreticalEnergyDemandKWh, maxAvailableEnergyKWh);
            energyChangeKWh = -actual;
          }
          break;
        }
        case 'CHARGE': {
          let potential = 0;
          if (chargerId) {
            const ch = availableChargers.find(c => String(c.id) === String(chargerId));
            const rate = Number(ch?.rate);
            if (Number.isFinite(rate) && rate > 0) {
              potential = rate * SLOT_DURATION_HOURS;
            } else {
              if (!busResult.errors.some(e => e.includes(`Charger ID "${chargerId}" missing/invalid`))) {
                busResult.errors.push(`Config Error: Charger ID "${chargerId}" missing/invalid in configuration.`);
              }
            }
          } else {
            if (!busResult.errors.some(e => e.includes('CHARGE activity has no charger'))) {
              busResult.errors.push(`Schedule Error at ${timeStr}: CHARGE activity has no charger assigned.`);
            }
          }
          const maxTo100 = ((100 - currentSOC) / 100) * essCapacity;
          const actual = Math.min(potential, Math.max(0, maxTo100));
          energyChangeKWh = actual;
          break;
        }
        case 'BREAK':
        default:
          energyChangeKWh = 0;
      }

      if (energyChangeKWh < 0) busResult.totalEnergyConsumedKWh += Math.abs(energyChangeKWh);
      if (energyChangeKWh > 0) busResult.totalEnergyChargedKWh  += energyChangeKWh;

      const socChange = (energyChangeKWh / essCapacity) * 100;
      const potentialNextSOC = currentSOC + socChange;
      const eps = 1e-6;

      if (potentialNextSOC < STRANDED_THRESHOLD - eps && busResult.triggerTimes.stranded === null) {
        busResult.triggerTimes.stranded = i;
        if (!warnedStrandedText) { busResult.errors.push(`Stranded Alert at ${timeStr}: SOC < ${STRANDED_THRESHOLD}% (pred ${potentialNextSOC.toFixed(1)}%)`); warnedStrandedText = true; }
      }
      if (potentialNextSOC < criticalThreshold - eps && busResult.triggerTimes.critical === null && busResult.triggerTimes.stranded === null) {
        busResult.triggerTimes.critical = i;
        if (!warnedCriticalText) { busResult.errors.push(`Critical SOC at ${timeStr}: SOC < ${criticalThreshold}% (pred ${potentialNextSOC.toFixed(1)}%)`); warnedCriticalText = true; }
      }
      if (potentialNextSOC < lowThreshold - eps && busResult.triggerTimes.low === null && busResult.triggerTimes.critical === null && busResult.triggerTimes.stranded === null) {
        busResult.triggerTimes.low = i;
        if (!warnedLowText) { busResult.errors.push(`Low SOC at ${timeStr}: SOC < ${lowThreshold}% (pred ${potentialNextSOC.toFixed(1)}%)`); warnedLowText = true; }
      }

      currentSOC = Math.max(0, Math.min(100, potentialNextSOC)); // clamp
    }

    busResult.socTimeSeries.push(currentSOC); // final
  });

  console.log("Simulation finished.");
  return results;
}

function minutesToTimeSim(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60).toString().padStart(2, '0');
  const minutes = (totalMinutes % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

// ---------------- Editor adapter ----------------

(function(){
  // Keep the original engine ref
  const engineRunSimulation = runSimulation;

  function showResultsHTML(html){
    const box = document.getElementById('simulation-results-container');
    const out = document.getElementById('simulation-output');
    if (out) out.innerHTML = html;
    if (box) box.style.display = 'block';
  }
  function showResultsText(text){
    const box = document.getElementById('simulation-results-container');
    const out = document.getElementById('simulation-output');
    if (out) out.textContent = text || '';
    if (box) box.style.display = 'block';
  }

  async function resolveBusParameters(){
    if (window.busParameters) return window.busParameters;
    if (window.CONFIG?.busParameters) return window.CONFIG.busParameters;
    // fallback defaults (match your config UI expectations)
    return {
      essCapacity: Number(document.getElementById('ess-capacity')?.value) || 400,
      euRate: Number(document.getElementById('eu-rate')?.value) || 55,
      warningThresholdLow: Number(document.getElementById('warning-threshold-low')?.value) || 20,
      warningThresholdCritical: Number(document.getElementById('warning-threshold-critical')?.value) || 10
    };
  }

  async function resolveChargers(){
    if (Array.isArray(window.availableChargers)) return normalizeChargers(window.availableChargers);
    if (Array.isArray(window.chargers))          return normalizeChargers(window.chargers);
    try{
      const res = await fetch('/api/chargers');
      if (res.ok) return normalizeChargers(await res.json());
    } catch {}
    return [];
  }
  function normalizeChargers(arr){
    return (arr || []).map(ch => ({
      id: ch.id ?? ch.chargerId ?? ch.name ?? '',
      rate: typeof ch.rate === 'number' ? ch.rate
           : typeof ch.rate_kw === 'number' ? ch.rate_kw
           : typeof ch.rateKw === 'number' ? ch.rateKw : 0
    }));
  }

  function toRunCutData(editorState){
    const slots = window.SLOTS ?? 96;
    const store = editorState?.data || window.scheduleData || {};
    const busesList = editorState?.buses || [];

    const buses = busesList.map(b => {
      const busId = b.id || b.busId || b.busName || 'BUS';
      const row   = store[busId] || Array(slots).fill(null);
      const schedule = Array.from({length: slots}, (_, i) => {
        const ev = row[i];
        return {
          activity: ev?.type || 'BREAK',
          chargerId: ev?.chargerId ?? null
        };
      });
      return {
        busId,
        busName: busId,
        busType: b.type || b.busType || 'EV',
        startSOC: Number.isFinite(Number(b.soc ?? b.startSOC)) ? Number(b.soc ?? b.startSOC) : 90,
        schedule
      };
    });

    return { buses };
  }

  async function runSimulationFromEditor(editorState){
    try{
      const runCutData       = toRunCutData(editorState);
      const busParameters    = await resolveBusParameters();
      const availableChargers= await resolveChargers();

      const results = engineRunSimulation(runCutData, busParameters, availableChargers);

      // Simple readable summary (you can replace with charts later)
      const busIds = Object.keys(results.resultsPerBus || {});
      const html = `
        <div><strong>Simulation complete.</strong></div>
        <div>Buses: ${busIds.length}</div>
        <ul style="margin-top:8px">
          ${busIds.map(id => {
            const r = results.resultsPerBus[id];
            const finalSOC = Array.isArray(r?.socTimeSeries) ? r.socTimeSeries.at(-1) : 'n/a';
            const errs = (r?.errors || []).slice(0,2).map(e=>`<div style="color:#f88">• ${e}</div>`).join('');
            return `<li><strong>${id}</strong> — Final SOC: ${typeof finalSOC==='number'?finalSOC.toFixed(1)+'%':finalSOC}${errs?errs:''}</li>`;
          }).join('')}
        </ul>
      `;
      showResultsHTML(html);
    } catch (e){
      console.error('[simulation adapter] error:', e);
      showResultsText('Simulation error. See console for details.');
    }
  }

  // publish wrapper that the editor will call via event
  window.addEventListener('run-simulation', (e) => runSimulationFromEditor(e.detail));
})();
