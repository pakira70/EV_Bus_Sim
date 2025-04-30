/**
 * EV Bus Energy Simulation Engine
 */

// Constants
const NUM_TIME_SLOTS = 96;
const SLOT_DURATION_MINUTES = 15;
const SLOT_DURATION_HOURS = SLOT_DURATION_MINUTES / 60;
const STRANDED_THRESHOLD = 5; // Fixed percentage below which bus is considered stranded

/**
 * Runs the energy simulation.
 * @param {object} runCutData - The run cut data object.
 * @param {object} busParameters - Bus config including thresholds.
 * @param {array} availableChargers - Array of charger objects.
 * @returns {object} - Simulation results.
 */
function runSimulation(runCutData, busParameters, availableChargers) {
    console.log("Starting simulation with tiered warnings & energy totals...");

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
            totalEnergyConsumedKWh: 0, // Initialize here
            totalEnergyChargedKWh: 0  // Initialize here
        };
        results.resultsPerBus[bus.busId] = busResult;

        let currentSOC = bus.startSOC;
        let warnedLow = false;
        let warnedCritical = false;
        let warnedStranded = false;

        // Loop through each time slot
        for (let i = 0; i < NUM_TIME_SLOTS; i++) {
            busResult.socTimeSeries.push(currentSOC); // Record SOC at START

            // If SOC is already 0, the bus cannot run or discharge further.
            // It can only BREAK or CHARGE.
            if (currentSOC <= 0) {
                const scheduleEntryCheck = bus.schedule[i];
                const activityCheck = scheduleEntryCheck ? scheduleEntryCheck.activity : 'BREAK';
                if (activityCheck === 'RUN') {
                    // Attempted to run with 0 SOC - log an error *once* if needed, but no energy consumed.
                    const timeStr = minutesToTimeSim(i * SLOT_DURATION_MINUTES);
                    if (!warnedStranded) { // Use stranded flag to prevent repeated "cannot run" errors
                        busResult.errors.push(`Stranded Alert at ${timeStr}: Attempted RUN with 0% SOC.`);
                        warnedStranded = true; // Mark as stranded/warned
                    }
                    // Ensure no energy change and SOC remains 0
                    // The main logic below will handle clamping, but this prevents negative consumption calc
                }
                 // Allow CHARGE or BREAK to proceed normally even if starting at 0 SOC
            }


            const scheduleEntry = bus.schedule[i];
            const activity = scheduleEntry ? scheduleEntry.activity : 'BREAK';
            const chargerId = scheduleEntry ? scheduleEntry.chargerId : null;
            const timeStr = minutesToTimeSim(i * SLOT_DURATION_MINUTES);

            let energyChangeKWh = 0;
            let actualEnergyConsumedKWh = 0; // Track actual consumption this step
            let actualEnergyChargedKWh = 0; // Track actual charge this step


            switch (activity) {
                case 'RUN':
                    // *** Corrected RUN Logic ***
                    if (currentSOC > 0) { // Can only consume if SOC > 0
                        const theoreticalEnergyDemandKWh = euRate * SLOT_DURATION_HOURS;
                        // Max energy available from current SOC down to 0
                        const maxAvailableEnergyKWh = (currentSOC / 100) * essCapacity;
                        // Actual energy consumed is the minimum of demand and availability
                        actualEnergyConsumedKWh = Math.min(theoreticalEnergyDemandKWh, maxAvailableEnergyKWh);
                        energyChangeKWh = -actualEnergyConsumedKWh; // Energy change is negative
                        busResult.totalEnergyConsumedKWh += actualEnergyConsumedKWh; // Accumulate actual
                    } else {
                        // Cannot run if SOC is 0 or less
                        energyChangeKWh = 0;
                        actualEnergyConsumedKWh = 0;
                         // Warning for attempting to run at 0% is handled above the switch
                    }
                    break; // *** End Corrected RUN ***

                case 'CHARGE':
                    // Calculate potential charge energy
                    let potentialChargeKWh = 0;
                    if (chargerId) {
                        const charger = availableChargers.find(ch => ch.id === chargerId);
                        if (charger && typeof charger.rate === 'number' && charger.rate > 0) {
                            potentialChargeKWh = charger.rate * SLOT_DURATION_HOURS;
                        } else {
                            // Config error handling (unchanged)
                            if (!busResult.errors.some(e => e.includes(`Charger ID "${chargerId}" missing/invalid`))) { busResult.errors.push(`Config Error: Charger ID "${chargerId}" missing/invalid in configuration.`); } console.warn(`Bus ${bus.busId}, Time ${timeStr}: Charger ${chargerId} not found/invalid rate.`); potentialChargeKWh = 0;
                        }
                    } else {
                        // Schedule error handling (unchanged)
                         if (!busResult.errors.some(e => e.includes(`CHARGE activity at ${timeStr} has no charger`))) { busResult.errors.push(`Schedule Error at ${timeStr}: CHARGE activity has no charger assigned.`); } potentialChargeKWh = 0;
                    }
                    // Limit charge by available capacity up to 100%
                    const maxChargeToReach100 = ((100 - currentSOC) / 100) * essCapacity;
                    actualEnergyChargedKWh = Math.min(potentialChargeKWh, maxChargeToReach100);
                    energyChangeKWh = actualEnergyChargedKWh; // Energy change is positive
                    busResult.totalEnergyChargedKWh += actualEnergyChargedKWh; // Accumulate actual
                    break;

                case 'BREAK':
                default:
                    energyChangeKWh = 0;
                    break;
            }

            // Calculate SOC change based on *actual* energy transfer
            const socChange = (energyChangeKWh / essCapacity) * 100;
            const potentialNextSOC = currentSOC + socChange;

            // Check against thresholds *before* clamping (using potentialNextSOC)
            // (Warning logic remains the same as before)
            if (potentialNextSOC < STRANDED_THRESHOLD && !warnedStranded) { busResult.errors.push(`Stranded Alert at ${timeStr}: SOC dropped below ${STRANDED_THRESHOLD}% (predicted ${potentialNextSOC.toFixed(1)}%)`); warnedStranded = true; }
            else if (potentialNextSOC < criticalThreshold && !warnedCritical) { busResult.errors.push(`Critical SOC at ${timeStr}: SOC dropped below ${criticalThreshold}% (predicted ${potentialNextSOC.toFixed(1)}%)`); warnedCritical = true; }
            else if (potentialNextSOC < lowThreshold && !warnedLow) { busResult.errors.push(`Low SOC Warning at ${timeStr}: SOC dropped below ${lowThreshold}% (predicted ${potentialNextSOC.toFixed(1)}%)`); warnedLow = true; }

            // Update SOC for the *next* interval, applying constraints (0-100)
            currentSOC = Math.max(0, Math.min(100, potentialNextSOC)); // Clamp SOC

        } // End time slot loop

        console.log(`Finished bus: ${bus.busId}. Final SOC: ${currentSOC.toFixed(1)}%. Consumed: ${busResult.totalEnergyConsumedKWh.toFixed(1)} kWh, Charged: ${busResult.totalEnergyChargedKWh.toFixed(1)} kWh`);

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