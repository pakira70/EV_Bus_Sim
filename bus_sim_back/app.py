from flask import Flask, jsonify, request, render_template
import sqlite3
import os
import logging # For better logging

# --- Configuration ---
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATABASE_PATH = os.path.join(SCRIPT_DIR, 'fleet_history.db')
TEMPLATES_DIR = os.path.join(SCRIPT_DIR, 'templates')
STATIC_DIR = os.path.join(SCRIPT_DIR, 'static')

# --- Flask App Initialization ---
app = Flask(__name__, template_folder=TEMPLATES_DIR, static_folder=STATIC_DIR)

# --- Logging Setup ---
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# --- Database Helper Function ---
def query_db(query, args=(), one=False):
    """Helper function to query the database and return results."""
    try:
        conn = sqlite3.connect(DATABASE_PATH)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute(query, args)
        rv = cur.fetchall()
        conn.close()

        if one:
            return dict(rv[0]) if rv else None
        else:
            return [dict(row) for row in rv]
    except sqlite3.Error as e:
        logger.error(f"Database error: {e}")
        logger.error(f"Query: {query}")
        logger.error(f"Arguments: {args}")
        return None
    except Exception as e:
        logger.error(f"An unexpected error occurred in query_db: {e}")
        return None

# --- HTML Serving Routes ---
# ... (other imports and app setup) ...

@app.route('/temp_insights')
def temp_insights_page():
    logger.info("Serving temp_insights.html")
    return render_template('temp_insights.html')

# In app.py
# In app.py

@app.route('/api/temp_insights_data', methods=['GET'])
def get_temp_insights_data():
    low_temp_f_str = request.args.get('low_temp')
    high_temp_f_str = request.args.get('high_temp')

    try:
        low_temp_f = float(low_temp_f_str) if low_temp_f_str is not None else -float('inf')
        high_temp_f = float(high_temp_f_str) if high_temp_f_str is not None else float('inf')
    except ValueError:
        logger.error("Invalid temperature parameters received.")
        return jsonify({"error": "Invalid temperature parameters"}), 400

    logger.info(f"Fetching temp insights data for temp range: {low_temp_f}°F - {high_temp_f}°F")

    results = {} # Initialize results dictionary
    query_params_temp_filter = {'low_temp': low_temp_f, 'high_temp': high_temp_f}
    
    run_activity_types = ('DRIVING',) 
    run_activity_types_sql_tuple = ', '.join([f"'{activity}'" for activity in run_activity_types])

    base_run_query_from_clause = f"""
    FROM operational_segments
    WHERE activity_type IN ({run_activity_types_sql_tuple}) 
      AND duration_hours > 0
    """ # Common FROM and WHERE for RUN queries
    
    # --- Temperature-Filtered RUN Data ---
    run_ops_query_temp_filtered = f"""
    SELECT
        SUM(energy_used_kwh) as total_run_energy_kwh,
        SUM(duration_hours) as total_run_duration_hours,
        SUM(mileage_miles) as total_run_mileage_miles,
        SUM(air_compressor_energy_kwh) as run_total_ac_kwh,
        SUM(rear_hvac_energy_kwh) as run_total_hvac_kwh,
        SUM(lv_access_energy_kwh) as run_total_lv_kwh,
        SUM(electric_heater_energy_kwh) as run_total_heater_kwh,
        SUM(traction_energy_kwh) as run_total_traction_kwh,
        SUM(regen_energy_kwh) as total_run_regen_kwh
        -- min/max kwh_per_mile for temp-filtered removed for now to simplify, can add back if needed
    {base_run_query_from_clause}
      AND average_temperature_f >= :low_temp
      AND average_temperature_f <= :high_temp
    """
    run_data_temp_filtered = query_db(run_ops_query_temp_filtered, query_params_temp_filter, one=True)
    
    # Initialize temp-filtered keys
    temp_filtered_keys_to_init = [
        "total_run_energy_kwh", "total_run_duration_hours", "total_run_mileage_miles",
        "run_total_ac_kwh", "run_total_hvac_kwh", "run_total_lv_kwh",
        "run_total_heater_kwh", "run_total_traction_kwh", "total_run_regen_kwh"
    ]
    for key in temp_filtered_keys_to_init:
        results[key] = run_data_temp_filtered.get(key) if run_data_temp_filtered else None
    
    # --- All-Time RUN Data (for comparison) ---
    all_time_run_ops_query = f"""
    SELECT
        SUM(energy_used_kwh) / NULLIF(SUM(duration_hours), 0) as all_time_avg_power_run_kw,
        SUM(energy_used_kwh) / NULLIF(SUM(mileage_miles), 0) as all_time_avg_economy_run_kwh_per_mile,
        SUM(regen_energy_kwh) / NULLIF(SUM(duration_hours),0) as all_time_avg_regen_power_kw,
        (SUM(regen_energy_kwh) / NULLIF(SUM(traction_energy_kwh), 0)) * 100.0 as all_time_regen_percent_traction
        -- min/max all_time kwh_per_mile removed based on feedback
    {base_run_query_from_clause} 
    """ # base_run_query_from_clause was defined earlier

    all_time_run_data = query_db(all_time_run_ops_query, {}, one=True)
    logger.info(f"ALL TIME RUN DATA FROM DB: {all_time_run_data}") # KEEP THIS DEBUG LINE

    # Define the keys we expect from the all_time_run_data query
    all_time_keys = [
        "all_time_avg_power_run_kw", 
        "all_time_avg_economy_run_kwh_per_mile", 
        "all_time_avg_regen_power_kw", 
        "all_time_regen_percent_traction"
    ]

    # Safely merge/update the main results dictionary with all_time_run_data
    if all_time_run_data: # Check if all_time_run_data dictionary itself is not None
        for key in all_time_keys:
            # Use .get() on the dictionary to safely retrieve values, defaulting to None if a key is missing
            # This also handles if the value for a key within all_time_run_data is already None (e.g., from SQL NULLIF)
            results[key] = all_time_run_data.get(key) 
    else: # If all_time_run_data is None (e.g., query_db returned None)
        for key in all_time_keys:
            results[key] = None # Ensure these keys exist in results as None

    # --- Charging Data (Overall, as it is now) ---
    min_duration_hours_charge = 5.0 / 60.0
    min_soc_increase_percent_charge = 0.1
    max_plausible_charge_power_kw_charge = 350
    query_params_charge = {
        'min_duration': min_duration_hours_charge,
        'min_soc_increase': min_soc_increase_percent_charge,
        'max_power': max_plausible_charge_power_kw_charge
    }
    charge_conditions = [
        "duration_hours > :min_duration", "soc_change_percent > :min_soc_increase",
        "soc_based_charge_power_kw IS NOT NULL", "soc_based_charge_power_kw > 0",
        "soc_based_charge_power_kw < :max_power"
    ]
    charge_where_clause = " AND ".join(charge_conditions)
    charging_summary_query = f"""
    SELECT
        AVG(soc_based_charge_power_kw) as avg_charge_rate_kw,
        MAX(soc_end_percent) as data_driven_max_soc_percent 
    FROM charging_sessions WHERE {charge_where_clause}
    """
    charging_data = query_db(charging_summary_query, query_params_charge, one=True)
    
    results['avg_charge_rate_kw'] = charging_data.get('avg_charge_rate_kw') if charging_data else None
    results['data_driven_max_soc_percent'] = charging_data.get('data_driven_max_soc_percent') if charging_data else None
        
    logger.info(f"Final API Response for temp_insights_data: {results}")
    return jsonify(results)
# ... (rest of your app.py) ...
@app.route('/')
def index():
    logger.info("Serving index.html")
    return render_template('index.html')

@app.route('/editor')
def editor():
    logger.info("Serving run_cut_editor.html")
    return render_template('run_cut_editor.html')

@app.route('/insights')
def insights_dashboard():
    logger.info("Serving insights.html")
    return render_template('insights.html')

# --- API Endpoints ---

@app.route('/api/kpi/average_eu_by_temp', methods=['GET'])
def get_average_eu_by_temp():
    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')

    query_params = {}
    date_conditions = []
    if start_date:
        date_conditions.append("date >= :start_date")
        query_params['start_date'] = start_date
    if end_date:
        date_conditions.append("date <= :end_date")
        query_params['end_date'] = end_date
    
    date_where_clause = (" AND ".join(date_conditions)) if date_conditions else "1=1"

    # Assumes 'operational_segments' table and relevant columns exist
    # and 'activity_type' column helps distinguish DRIVING segments.
    query = f"""
    SELECT 
        CASE 
            WHEN average_temperature_f < 30 THEN 'Below 30°F'
            WHEN average_temperature_f >= 30 AND average_temperature_f < 40 THEN '30-39°F'
            WHEN average_temperature_f >= 40 AND average_temperature_f < 50 THEN '40-49°F'
            WHEN average_temperature_f >= 50 AND average_temperature_f < 60 THEN '50-59°F'
            WHEN average_temperature_f >= 60 AND average_temperature_f < 70 THEN '60-69°F'
            WHEN average_temperature_f >= 70 AND average_temperature_f < 80 THEN '70-79°F'
            WHEN average_temperature_f >= 80 THEN '80°F and Above'
            ELSE 'Unknown Temp Range'
        END as temperature_bin,
        SUM(energy_used_kwh) / SUM(duration_hours) as avg_eu_kw
    FROM operational_segments
    WHERE activity_type = 'DRIVING' 
      AND duration_hours > 0 
      AND average_temperature_f IS NOT NULL
      AND {date_where_clause}
    GROUP BY temperature_bin
    ORDER BY MIN(average_temperature_f)
    """
    data = query_db(query, query_params)
    logger.info(f"Data for average_eu_by_temp: {data}")
    return jsonify(data if data else [])

@app.route('/api/kpi/average_charging_rate', methods=['GET'])
def get_average_charging_rate():
    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')

    # These thresholds define a "plausible" charging session
    min_duration_hours_charge = 5.0 / 60.0  # 5 minutes
    min_soc_increase_percent_charge = 0.1
    max_plausible_charge_power_kw_charge = 350

    # Using named parameters for consistency and clarity
    query_params = {
        'min_duration': min_duration_hours_charge,
        'min_soc_increase': min_soc_increase_percent_charge,
        'max_power': max_plausible_charge_power_kw_charge
    }
    
    conditions = [
        "duration_hours > :min_duration",
        "soc_change_percent > :min_soc_increase", # Assumes soc_change_percent is pre-calculated
        "soc_based_charge_power_kw IS NOT NULL",  # Assumes soc_based_charge_power_kw is pre-calculated
        "soc_based_charge_power_kw > 0",
        "soc_based_charge_power_kw < :max_power"
    ]

    if start_date:
        conditions.append("date >= :start_date")
        query_params['start_date'] = start_date
    if end_date:
        conditions.append("date <= :end_date")
        query_params['end_date'] = end_date
    
    where_clause = " AND ".join(conditions)

    # Assumes 'charging_sessions' table with 'soc_based_charge_power_kw' and 'soc_change_percent'
    query = f"""
    SELECT AVG(soc_based_charge_power_kw) as avg_battery_charging_kw
    FROM charging_sessions
    WHERE {where_clause}
    """
    result = query_db(query, query_params, one=True)
    
    if result and result.get('avg_battery_charging_kw') is not None:
        logger.info(f"Avg charging rate: {result['avg_battery_charging_kw']}")
        return jsonify({'avg_battery_charging_kw': result['avg_battery_charging_kw']})
    else:
        logger.info("No plausible charging sessions found or calculation resulted in null for avg_charging_rate.")
        return jsonify({'avg_battery_charging_kw': None, 'message': 'No plausible sessions found'})

@app.route('/api/kpi/energy_breakdown_by_activity', methods=['GET'])
def get_energy_breakdown_by_activity():
    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')

    query_params = {}
    date_conditions = []
    if start_date:
        date_conditions.append("date >= :start_date")
        query_params['start_date'] = start_date
    if end_date:
        date_conditions.append("date <= :end_date")
        query_params['end_date'] = end_date
    
    date_where_clause = (" AND ".join(date_conditions)) if date_conditions else "1=1"

    # CORRECTED COLUMN NAMES BASED ON YOUR SCHEMA:
    query = f"""
    SELECT
        activity_type,
        SUM(air_compressor_energy_kwh) / NULLIF(SUM(duration_hours), 0) as avg_air_compressor_power_kw,
        SUM(rear_hvac_energy_kwh) / NULLIF(SUM(duration_hours), 0) as avg_rear_hvac_power_kw,
        SUM(lv_access_energy_kwh) / NULLIF(SUM(duration_hours), 0) as avg_lv_access_power_kw, -- Assuming "Iv" OCR was "lv"
        SUM(electric_heater_energy_kwh) / NULLIF(SUM(duration_hours), 0) as avg_electric_heater_power_kw,
        SUM(CASE WHEN activity_type = 'DRIVING' THEN traction_energy_kwh ELSE 0 END) / 
            NULLIF(SUM(CASE WHEN activity_type = 'DRIVING' THEN duration_hours ELSE 0 END), 0) as avg_traction_power_kw_driving_only
    FROM operational_segments
    WHERE duration_hours > 0 
      AND activity_type IN ('DRIVING', 'IDLE')
      AND {date_where_clause}
    GROUP BY activity_type
    """
    data = query_db(query, query_params)
    logger.info(f"Data for energy_breakdown_by_activity: {data}")
    return jsonify(data if data else [])

@app.route('/api/period_analysis/summary', methods=['GET'])
def get_period_analysis_summary():
    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')

    query_params_ops = {}
    date_conditions_ops = []
    if start_date:
        date_conditions_ops.append("date >= :start_date")
        query_params_ops['start_date'] = start_date
    if end_date:
        date_conditions_ops.append("date <= :end_date")
        query_params_ops['end_date'] = end_date
    date_where_clause_ops = (" AND ".join(date_conditions_ops)) if date_conditions_ops else "1=1"

    ops_summary_query = f"""
    SELECT
        SUM(energy_used_kwh) / NULLIF(SUM(duration_hours), 0) as overall_avg_eu_kw,
        SUM(energy_used_kwh) / NULLIF(SUM(mileage_miles), 0) as overall_avg_kwh_per_mile,
        SUM(mileage_miles) as total_driving_miles,
        SUM(duration_hours) as total_driving_duration_hours,
        COUNT(*) as count_driving_segments,
        SUM(CASE WHEN regen_energy_kwh > 0 THEN regen_energy_kwh ELSE 0 END) / 
            NULLIF(SUM(CASE WHEN regen_energy_kwh > 0 THEN duration_hours ELSE 0 END), 0) as overall_avg_regen_kw_driving,
        SUM(CASE WHEN regen_energy_kwh > 0 THEN regen_energy_kwh ELSE 0 END) / 
            NULLIF(SUM(mileage_miles), 0) as overall_avg_regen_kwh_per_mile_driving
    FROM operational_segments
    WHERE activity_type = 'DRIVING' 
      AND duration_hours > 0 AND mileage_miles > 0 
      AND {date_where_clause_ops}
    """
    ops_summary_data = query_db(ops_summary_query, query_params_ops, one=True) or {}

    min_duration_hours_charge = 5.0 / 60.0
    min_soc_increase_percent_charge = 0.1
    max_plausible_charge_power_kw_charge = 350
    
    query_params_charge = {
        'min_duration': min_duration_hours_charge,
        'min_soc_increase': min_soc_increase_percent_charge,
        'max_power': max_plausible_charge_power_kw_charge
    }
    charge_conditions = [
        "duration_hours > :min_duration",
        "soc_change_percent > :min_soc_increase",
        "soc_based_charge_power_kw IS NOT NULL",
        "soc_based_charge_power_kw > 0",
        "soc_based_charge_power_kw < :max_power"
    ]
    if start_date:
        charge_conditions.append("date >= :start_date")
        query_params_charge['start_date'] = start_date
    if end_date:
        charge_conditions.append("date <= :end_date")
        query_params_charge['end_date'] = end_date
    charge_where_clause = " AND ".join(charge_conditions)

    charging_summary_query = f"""
    SELECT
        AVG(soc_based_charge_power_kw) as overall_avg_charging_rate_kw,
        COUNT(*) as num_plausible_charging_sessions
    FROM charging_sessions
    WHERE {charge_where_clause}
    """
    charging_summary_data = query_db(charging_summary_query, query_params_charge, one=True) or {}
    
    # Temperature Profile: Using query_params_ops as it shares date filters with operational_segments
    temp_profile_base_clause = f"average_temperature_f IS NOT NULL AND {date_where_clause_ops}"

    abs_temps_query = f"SELECT MIN(average_temperature_f) as absolute_coldest_segment_temp_f, MAX(average_temperature_f) as absolute_hottest_segment_temp_f FROM operational_segments WHERE {temp_profile_base_clause}"
    abs_temps_data = query_db(abs_temps_query, query_params_ops, one=True) or {}

    avg_daily_min_temp_query = f"""
    SELECT AVG(daily_min) as avg_daily_min_temp_f
    FROM (
        SELECT MIN(average_temperature_f) as daily_min
        FROM operational_segments
        WHERE {temp_profile_base_clause}
        GROUP BY date
    )
    """
    avg_daily_min_temp_data = query_db(avg_daily_min_temp_query, query_params_ops, one=True) or {}

    avg_daily_max_temp_query = f"""
    SELECT AVG(daily_max) as avg_daily_max_temp_f
    FROM (
        SELECT MAX(average_temperature_f) as daily_max
        FROM operational_segments
        WHERE {temp_profile_base_clause}
        GROUP BY date
    )
    """
    avg_daily_max_temp_data = query_db(avg_daily_max_temp_query, query_params_ops, one=True) or {}

    temp_distribution_query = f"""
    SELECT 
        CASE 
            WHEN daily_avg_temp < 30 THEN 'Below 30°F'
            WHEN daily_avg_temp >= 30 AND daily_avg_temp < 40 THEN '30-39°F'
            WHEN daily_avg_temp >= 40 AND daily_avg_temp < 50 THEN '40-49°F'
            WHEN daily_avg_temp >= 50 AND daily_avg_temp < 60 THEN '50-59°F'
            WHEN daily_avg_temp >= 60 AND daily_avg_temp < 70 THEN '60-69°F'
            WHEN daily_avg_temp >= 70 AND daily_avg_temp < 80 THEN '70-79°F'
            WHEN daily_avg_temp >= 80 THEN '80°F and Above'
            ELSE 'Unknown Temp Range'
        END as temperature_bin,
        COUNT(*) as day_count
    FROM (
        SELECT date, AVG(average_temperature_f) as daily_avg_temp
        FROM operational_segments
        WHERE {temp_profile_base_clause}
        GROUP BY date
    )
    GROUP BY temperature_bin
    ORDER BY MIN(daily_avg_temp) 
    """
    temp_distribution_data = query_db(temp_distribution_query, query_params_ops) or []
    
    results = {**ops_summary_data, **charging_summary_data, **abs_temps_data, **avg_daily_min_temp_data, **avg_daily_max_temp_data}
    results['daily_avg_temp_distribution'] = temp_distribution_data
    
    expected_keys = [
        'overall_avg_eu_kw', 'overall_avg_kwh_per_mile', 'total_driving_miles',
        'total_driving_duration_hours', 'count_driving_segments', 'overall_avg_regen_kw_driving',
        'overall_avg_regen_kwh_per_mile_driving', 'overall_avg_charging_rate_kw',
        'num_plausible_charging_sessions', 'absolute_coldest_segment_temp_f',
        'absolute_hottest_segment_temp_f', 'avg_daily_min_temp_f', 'avg_daily_max_temp_f'
    ]
    for key in expected_keys:
        if key not in results or results[key] is None: # Check for None as well
            results[key] = None 
    
    logger.info(f"Period analysis summary data: {results}")
    return jsonify(results)

# --- Main Application Runner ---
if __name__ == '__main__':
    if not os.path.exists(DATABASE_PATH):
        logger.error(f"ERROR: Database file not found at {DATABASE_PATH}")
        logger.error("Please run data_processor.py first to create and populate the database.")
    else:
        logger.info(f"Database found at: {DATABASE_PATH}")
        logger.info("Starting Flask development server on http://0.0.0.0:5000")
        app.run(debug=True, host='0.0.0.0', port=5000)