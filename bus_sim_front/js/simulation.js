/**
 * EV Bus Energy Simulation Engine
 */

// Constants
const NUM_TIME_SLOTS = 96;
const SLOT_DURATION_MINUTES = 15;
const SLOT_DURATION_HOURS = SLOT_DURATION_MINUTES / 60;
const STRANDED_THRESHOLD = 5; // Fixed percentage

/**
 * Runs the energy simulation.
 * @param {object} runCutData - The run cut data object.
 * @param {object} busParameters - Bus config including thresholds.
 * @param {array} availableChargers - Array of charger objects.
 * @returns {object} - Simulation results including trigger times.
 *                     Example: { resultsPerBus: { 'Bus-123': { socTimeSeries: [...], errors: [...], triggerTimes: { low: 40, critical: 55, stranded: 60 }, totalEnergyConsumedKWh: ..., totalEnergyChargedKWh: ... } }, overallErrors: [] }
 */
function runSimulation(runCutData, busParameters, availableChargers) {
    console.log("Starting simulation with grid coloring data...");

    const results = { resultsPerBus: {}, overallErrors: [] };

    // --- Input Validation --- (Unchanged)
    if (!runCutData || !runCutData.buses || runCutData.buses.length === 0) { results.overallErrors.push("Simulation Error: No bus data provided."); return results; }
    if (!busParameters || typeof busParameters.essCapacity !== 'number' || busParameters.essCapacity <= 0 || typeof busParameters.euRate !== 'number' || busParameters.euRate < 0 || typeof busParameters.warningThresholdLow !== 'number' || busParameters.warningThresholdLow < 0 || busParameters.warningThresholdLow > 100 || typeof busParameters.warningThresholdCritical !== 'number' || busParameters.warningThresholdCritical < 0 || busParameters.warningThresholdCritical > 100) { results.overallErrors.push("Simulation Error: Invalid or missing bus parameters. Check Configuration."); return results; }
    if (!availableChargers || !Array.isArray(availableChargers)) { console.warn("Simulation Warning: No available charger data provided."); availableChargers = []; }

    const essCapacity = busParameters.essCapacity;
    const euRate = busParameters.euRate;
    const lowThreshold = busParameters.warningThresholdLow;
    const criticalThreshold = busParameters.warningThresholdCritical;

    // --- Simulate each bus ---
    runCutData.buses.forEach(bus => {
        console.log(`Simulating bus: ${bus.busId}`);
        const busResult = {
            socTimeSeries: [],
            errors: [],
            totalEnergyConsumedKWh: 0,
            totalEnergyChargedKWh: 0,
            // *** NEW: Store first trigger time index (null if not triggered) ***
            triggerTimes: {
                low: null,
                critical: null,
                stranded: null
            }
        };
        results.resultsPerBus[bus.busId] = busResult;

        let currentSOC = bus.startSOC;
        // Flags to prevent adding duplicate text warnings
        let warnedLowText = false;
        let warnedCriticalText = false;
        let warnedStrandedText = false;

        // Loop through each time slot
        for (let i = 0; i < NUM_TIME_SLOTS; i++) {
            busResult.socTimeSeries.push(currentSOC); // Record SOC at START

            const scheduleEntry = bus.schedule[i];
            const activity = scheduleEntry ? scheduleEntry.activity : 'BREAK';
            const chargerId = scheduleEntry ? scheduleEntry.chargerId : null;
            const timeStr = minutesToTimeSim(i * SLOT_DURATION_MINUTES);

            let energyChangeKWh = 0;
            let actualEnergyConsumedKWh = 0;
            let actualEnergyChargedKWh = 0;

            // Check for attempted RUN at 0 SOC first
            if (currentSOC <= 0 && activity === 'RUN') {
                 if (!warnedStrandedText) { // Only add text warning once
                    busResult.errors.push(`Stranded Alert at ${timeStr}: Attempted RUN with 0% SOC.`);
                    warnedStrandedText = true;
                 }
                 // If already stranded, ensure trigger time is set (might happen if starting SOC is < 5)
                 if (busResult.triggerTimes.stranded === null) {
                     busResult.triggerTimes.stranded = i; // Mark stranded time if not already
                 }
            }

            switch (activity) {
                case 'RUN':
                    if (currentSOC > 0) {
                        const theoreticalEnergyDemandKWh = euRate * SLOT_DURATION_HOURS;
                        const maxAvailableEnergyKWh = (currentSOC / 100) * essCapacity;
                        actualEnergyConsumedKWh = Math.min(theoreticalEnergyDemandKWh, maxAvailableEnergyKWh);
                        energyChangeKWh = -actualEnergyConsumedKWh;
                        busResult.totalEnergyConsumedKWh += actualEnergyConsumedKWh;
                    } else {
                        energyChangeKWh = 0; // Cannot consume if already at 0
                    }
                    break;
                case 'CHARGE':
                    let potentialChargeKWh = 0;
                    if (chargerId) { /* ... (charger finding logic unchanged) ... */
                         const charger = availableChargers.find(ch => ch.id === chargerId);
                         if (charger && typeof charger.rate === 'number' && charger.rate > 0) { potentialChargeKWh = charger.rate * SLOT_DURATION_HOURS; }
                         else { if (!busResult.errors.some(e => e.includes(`Charger ID "${chargerId}" missing/invalid`))) { busResult.errors.push(`Config Error: Charger ID "${chargerId}" missing/invalid in configuration.`); } console.warn(`Bus ${bus.busId}, Time ${timeStr}: Charger ${chargerId} not found/invalid rate.`); potentialChargeKWh = 0; }
                     } else { /* ... (no charger assigned error unchanged) ... */
                          if (!busResult.errors.some(e => e.includes(`CHARGE activity at ${timeStr} has no charger`))) { busResult.errors.push(`Schedule Error at ${timeStr}: CHARGE activity has no charger assigned.`); } potentialChargeKWh = 0;
                     }
                    const maxChargeToReach100 = ((100 - currentSOC) / 100) * essCapacity;
                    actualEnergyChargedKWh = Math.min(potentialChargeKWh, Math.max(0, maxChargeToReach100)); // Ensure maxCharge is not negative if SOC > 100 somehow
                    energyChangeKWh = actualEnergyChargedKWh;
                    busResult.totalEnergyChargedKWh += actualEnergyChargedKWh;
                    break;
                case 'BREAK': default: energyChangeKWh = 0; break;
            }

            const socChange = (energyChangeKWh / essCapacity) * 100;
            // Use a very small epsilon to handle floating point comparisons near thresholds
            const epsilon = 0.00001;
            const potentialNextSOC = currentSOC + socChange;

            // --- Check thresholds and record *first* trigger time index ---
            // Stranded check
            if (potentialNextSOC < STRANDED_THRESHOLD - epsilon && busResult.triggerTimes.stranded === null) {
                busResult.triggerTimes.stranded = i; // Record time index
                if (!warnedStrandedText) { // Add text warning only once
                     busResult.errors.push(`Stranded Alert at ${timeStr}: SOC dropped below ${STRANDED_THRESHOLD}% (predicted ${potentialNextSOC.toFixed(1)}%)`);
                     warnedStrandedText = true;
                }
            }
            // Critical check (only if not already stranded)
            if (potentialNextSOC < criticalThreshold - epsilon && busResult.triggerTimes.critical === null && busResult.triggerTimes.stranded === null) {
                 busResult.triggerTimes.critical = i;
                 if (!warnedCriticalText) {
                     busResult.errors.push(`Critical SOC at ${timeStr}: SOC dropped below ${criticalThreshold}% (predicted ${potentialNextSOC.toFixed(1)}%)`);
                     warnedCriticalText = true;
                 }
            }
             // Low check (only if not already critical or stranded)
            if (potentialNextSOC < lowThreshold - epsilon && busResult.triggerTimes.low === null && busResult.triggerTimes.critical === null && busResult.triggerTimes.stranded === null) {
                 busResult.triggerTimes.low = i;
                 if (!warnedLowText) {
                     busResult.errors.push(`Low SOC Warning at ${timeStr}: SOC dropped below ${lowThreshold}% (predicted ${potentialNextSOC.toFixed(1)}%)`);
                     warnedLowText = true;
                 }
            }

            // Update SOC for the *next* interval, applying constraints (0-100)
            currentSOC = Math.max(0, Math.min(100, potentialNextSOC)); // Clamp SOC

        } // End time slot loop

        // Store final SOC in time series for potential display? Or rely on calculation?
        // Let's add it for completeness - makes min/max easier later too.
         busResult.socTimeSeries.push(currentSOC); // Add SOC state *after* last interval


        console.log(`Finished bus: ${bus.busId}. Final SOC: ${currentSOC.toFixed(1)}%. Triggers: Low@${busResult.triggerTimes.low}, Crit@${busResult.triggerTimes.critical}, Strnd@${busResult.triggerTimes.stranded}`);

    }); // End bus loop

    console.log("Simulation finished.");
    return results;
}

// Helper function (remains the same)
function minutesToTimeSim(totalMinutes) {
    const hours = Math.floor(totalMinutes / 60).toString().padStart(2, '0');
    const minutes = (totalMinutes % 60).toString().padStart(2, '0');
    return `${hours}:${minutes}`;
}