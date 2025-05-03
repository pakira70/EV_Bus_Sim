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
 * @param {object} runCutData - The run cut data object. Expected buses array with { busId, busName, busType, startSOC, schedule }.
 * @param {object} busParameters - Bus config including thresholds { essCapacity, euRate, ... }.
 * @param {array} availableChargers - Array of charger objects.
 * @returns {object} - Simulation results including trigger times.
 */
function runSimulation(runCutData, busParameters, availableChargers) {
    console.log("Starting simulation (Handles Diesel/Deadhead)...");

    const results = { resultsPerBus: {}, overallErrors: [] };

    // --- Input Validation ---
    if (!runCutData || !runCutData.buses || runCutData.buses.length === 0) { results.overallErrors.push("Simulation Error: No bus data provided."); return results; }
    if (!busParameters || typeof busParameters.essCapacity !== 'number' || busParameters.essCapacity <= 0 || typeof busParameters.euRate !== 'number' || busParameters.euRate < 0 || typeof busParameters.warningThresholdLow !== 'number' || typeof busParameters.warningThresholdCritical !== 'number' ) { results.overallErrors.push("Simulation Error: Invalid or missing bus parameters. Check Configuration."); return results; }
    if (!availableChargers || !Array.isArray(availableChargers)) { console.warn("Simulation Warning: No available charger data provided."); availableChargers = []; }

    const essCapacity = busParameters.essCapacity;
    const euRate = busParameters.euRate; // Energy use rate for RUN and DEADHEAD
    const lowThreshold = busParameters.warningThresholdLow;
    const criticalThreshold = busParameters.warningThresholdCritical;

    // --- Simulate each bus ---
    runCutData.buses.forEach(bus => {
        // *** NEW: Check Bus Type ***
        if (bus.busType && bus.busType === 'Diesel') {
            console.log(`Skipping simulation for Diesel bus: ${bus.busName || bus.busId}`);
            // Add placeholder result for Diesel bus
            results.resultsPerBus[bus.busId] = {
                socTimeSeries: Array(NUM_TIME_SLOTS + 1).fill('N/A'), // Array of N/A for SOC
                errors: ["Bus type is Diesel - simulation not applicable."],
                totalEnergyConsumedKWh: 'N/A',
                totalEnergyChargedKWh: 'N/A',
                triggerTimes: { low: null, critical: null, stranded: null },
                isDiesel: true // Add flag for display logic
            };
            return; // Skip to the next bus using 'return' inside forEach
        }

        // --- Proceed with simulation for non-Diesel buses ---
        console.log(`Simulating BEB bus: ${bus.busName || bus.busId}`);
        const busResult = {
            socTimeSeries: [],
            errors: [],
            totalEnergyConsumedKWh: 0,
            totalEnergyChargedKWh: 0,
            triggerTimes: { low: null, critical: null, stranded: null },
            isDiesel: false // Mark as not diesel
        };
        results.resultsPerBus[bus.busId] = busResult;

        let currentSOC = bus.startSOC;
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

            // Check for attempted RUN/DEADHEAD at 0 SOC first
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
                // *** MODIFIED: Handle DEADHEAD same as RUN ***
                case 'RUN':
                case 'DEADHEAD':
                    if (currentSOC > 0) {
                        const theoreticalEnergyDemandKWh = euRate * SLOT_DURATION_HOURS;
                        const maxAvailableEnergyKWh = (currentSOC / 100) * essCapacity;
                        actualEnergyConsumedKWh = Math.min(theoreticalEnergyDemandKWh, maxAvailableEnergyKWh);
                        energyChangeKWh = -actualEnergyConsumedKWh;
                        // Accumulation happens after the switch now
                    } else {
                        energyChangeKWh = 0; // Cannot consume if already at 0
                    }
                    break;

                case 'CHARGE':
                    let potentialChargeKWh = 0;
                    if (chargerId) {
                         const charger = availableChargers.find(ch => ch.id === chargerId);
                         if (charger && typeof charger.rate === 'number' && charger.rate > 0) { potentialChargeKWh = charger.rate * SLOT_DURATION_HOURS; }
                         else { if (!busResult.errors.some(e => e.includes(`Charger ID "${chargerId}" missing/invalid`))) { busResult.errors.push(`Config Error: Charger ID "${chargerId}" missing/invalid in configuration.`); } console.warn(`Bus ${bus.busName || bus.busId}, Time ${timeStr}: Charger ${chargerId} not found/invalid rate.`); potentialChargeKWh = 0; }
                     } else {
                          if (!busResult.errors.some(e => e.includes(`CHARGE activity at ${timeStr} has no charger`))) { busResult.errors.push(`Schedule Error at ${timeStr}: CHARGE activity has no charger assigned.`); } potentialChargeKWh = 0;
                     }
                    const maxChargeToReach100 = ((100 - currentSOC) / 100) * essCapacity;
                    actualEnergyChargedKWh = Math.min(potentialChargeKWh, Math.max(0, maxChargeToReach100));
                    energyChangeKWh = actualEnergyChargedKWh;
                    // Accumulation happens after the switch now
                    break;

                case 'BREAK':
                default:
                    energyChangeKWh = 0;
                    break;
            }

            // Accumulate totals based on *actual* change calculated
            if (energyChangeKWh < 0) {
                busResult.totalEnergyConsumedKWh += Math.abs(energyChangeKWh);
            } else if (energyChangeKWh > 0) {
                busResult.totalEnergyChargedKWh += energyChangeKWh;
            }

            const socChange = (energyChangeKWh / essCapacity) * 100;
            const epsilon = 0.00001;
            const potentialNextSOC = currentSOC + socChange;

            // --- Check thresholds and record *first* trigger time index ---
            if (potentialNextSOC < STRANDED_THRESHOLD - epsilon && busResult.triggerTimes.stranded === null) {
                busResult.triggerTimes.stranded = i;
                if (!warnedStrandedText) { busResult.errors.push(`Stranded Alert at ${timeStr}: SOC dropped below ${STRANDED_THRESHOLD}% (predicted ${potentialNextSOC.toFixed(1)}%)`); warnedStrandedText = true; }
            }
            if (potentialNextSOC < criticalThreshold - epsilon && busResult.triggerTimes.critical === null && busResult.triggerTimes.stranded === null) {
                 busResult.triggerTimes.critical = i;
                 if (!warnedCriticalText) { busResult.errors.push(`Critical SOC at ${timeStr}: SOC dropped below ${criticalThreshold}% (predicted ${potentialNextSOC.toFixed(1)}%)`); warnedCriticalText = true; }
            }
            if (potentialNextSOC < lowThreshold - epsilon && busResult.triggerTimes.low === null && busResult.triggerTimes.critical === null && busResult.triggerTimes.stranded === null) {
                 busResult.triggerTimes.low = i;
                 if (!warnedLowText) { busResult.errors.push(`Low SOC Warning at ${timeStr}: SOC dropped below ${lowThreshold}% (predicted ${potentialNextSOC.toFixed(1)}%)`); warnedLowText = true; }
            }

            // Update SOC for the *next* interval, applying constraints (0-100)
            currentSOC = Math.max(0, Math.min(100, potentialNextSOC)); // Clamp SOC

        } // End time slot loop

        // Add final SOC state to time series
        busResult.socTimeSeries.push(currentSOC);

        console.log(`Finished BEB bus: ${bus.busName || bus.busId}. Final SOC: ${currentSOC.toFixed(1)}%. Consumed: ${busResult.totalEnergyConsumedKWh.toFixed(1)} kWh, Charged: ${busResult.totalEnergyChargedKWh.toFixed(1)} kWh.`);

    }); // End bus loop

    console.log("Simulation finished.");
    return results;
}

// Helper function
function minutesToTimeSim(totalMinutes) {
    const hours = Math.floor(totalMinutes / 60).toString().padStart(2, '0');
    const minutes = (totalMinutes % 60).toString().padStart(2, '0');
    return `${hours}:${minutes}`;
}