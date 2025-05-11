from flask import Flask, jsonify, request, render_template
import sqlite3
import os
import pandas as pd # Still useful if we wanted to process query results further

# --- Configuration (Define these first!) ---
# Get the directory where this script (app.py) is located
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

# Construct the absolute path to the database
DATABASE_PATH = os.path.join(SCRIPT_DIR, 'fleet_history.db')

# Define paths for templates and static folders relative to the script directory
TEMPLATES_DIR = os.path.join(SCRIPT_DIR, 'templates')
STATIC_DIR = os.path.join(SCRIPT_DIR, 'static') # For dashboard-specific CSS/JS if you add them later

# --- Flask App Initialization ---
# Explicitly set template_folder and static_folder.
# If these folders are named 'templates' and 'static' and are in the same
# directory as app.py, Flask often finds them by default, but being explicit is good.
app = Flask(__name__, template_folder=TEMPLATES_DIR, static_folder=STATIC_DIR)

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
        print(f"Database error: {e}")
        print(f"Query: {query}")
        print(f"Arguments: {args}")
        return None 
    except Exception as e:
        print(f"An unexpected error occurred: {e}")
        return None

# --- HTML Serving Routes ---

@app.route('/')
def home():
    return "Flask API for EV Bus Sim Historical Data is Running! Access dashboard at /insights"

@app.route('/insights') 
def insights_dashboard_page():
    """Serves the insights.html dashboard page."""
    # This tells Flask to look for 'insights.html' inside the TEMPLATES_DIR
    return render_template('insights.html') 

# --- API Endpoints for Dashboard (These remain the same as before) ---

@app.route('/api/kpi/average_eu_by_temp', methods=['GET'])
def get_average_eu_by_temp():
    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')
    base_query = """
    SELECT 
        CASE 
            WHEN average_temperature_f < 30 THEN 'Below 30°F'
            WHEN average_temperature_f >= 30 AND average_temperature_f < 40 THEN '30-39°F'
            WHEN average_temperature_f >= 40 AND average_temperature_f < 50 THEN '40-49°F'
            WHEN average_temperature_f >= 50 AND average_temperature_f < 60 THEN '50-59°F'
            WHEN average_temperature_f >= 60 AND average_temperature_f < 70 THEN '60-69°F'
            WHEN average_temperature_f >= 70 AND average_temperature_f < 80 THEN '70-79°F'
            WHEN average_temperature_f >= 80 THEN '80°F and Above'
            ELSE 'Unknown Temp'
        END as temperature_bin,
        AVG(average_power_consumption_kw) as avg_eu_kw,
        COUNT(*) as record_count
    FROM operational_segments
    WHERE activity_type = 'DRIVING' 
      AND average_power_consumption_kw IS NOT NULL
      AND average_temperature_f IS NOT NULL
    """
    conditions = []
    params = []
    if start_date:
        conditions.append("date >= ?")
        params.append(start_date)
    if end_date:
        conditions.append("date <= ?")
        params.append(end_date)
    if conditions:
        base_query += " AND " + " AND ".join(conditions)
    base_query += " GROUP BY temperature_bin ORDER BY MIN(average_temperature_f);"
    data = query_db(base_query, tuple(params))
    if data is None:
        return jsonify({"error": "Failed to retrieve data from database"}), 500
    return jsonify(data)

@app.route('/api/kpi/average_charging_rate', methods=['GET'])
def get_average_charging_rate():
    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')
    min_duration_hours = 5.0 / 60.0
    min_soc_increase_percent = 0.1
    max_plausible_charge_power_kw = 350 
    query_conditions = [
        "duration_hours > ?",
        "soc_change_percent > ?",
        "soc_based_charge_power_kw IS NOT NULL",
        "soc_based_charge_power_kw > 0",
        "soc_based_charge_power_kw < ?"
    ]
    params = [min_duration_hours, min_soc_increase_percent, max_plausible_charge_power_kw]
    if start_date:
        query_conditions.append("date >= ?")
        params.append(start_date)
    if end_date:
        query_conditions.append("date <= ?")
        params.append(end_date)
    where_clause = " AND ".join(query_conditions)
    query = f"""
    SELECT 
        AVG(soc_based_charge_power_kw) as avg_battery_charging_kw,
        MIN(soc_based_charge_power_kw) as min_battery_charging_kw,
        MAX(soc_based_charge_power_kw) as max_battery_charging_kw,
        COUNT(*) as num_plausible_charging_sessions,
        AVG(CASE WHEN duration_hours > 0 THEN energy_transferred_kwh / duration_hours ELSE NULL END) as avg_charger_delivery_kw_filtered
    FROM charging_sessions
    WHERE {where_clause}
    """
    data = query_db(query, tuple(params), one=True) 
    if data is None:
        return jsonify({"error": "Failed to retrieve charging data from database"}), 500
    if not data.get("num_plausible_charging_sessions"):
         return jsonify({"message": "No plausible charging sessions found for the selected criteria", "data": data}), 200
    return jsonify(data)

@app.route('/api/kpi/energy_breakdown_by_activity', methods=['GET'])
def get_energy_breakdown_by_activity():
    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')
    query_base = """
    SELECT
        activity_type,
        COUNT(*) as count_of_segments,
        AVG(duration_hours) as avg_duration_hours,
        AVG(CASE WHEN duration_hours > 0 THEN air_compressor_energy_kwh / duration_hours ELSE NULL END) as avg_air_compressor_power_kw,
        AVG(CASE WHEN duration_hours > 0 THEN rear_hvac_energy_kwh / duration_hours ELSE NULL END) as avg_rear_hvac_power_kw,
        AVG(CASE WHEN duration_hours > 0 THEN lv_access_energy_kwh / duration_hours ELSE NULL END) as avg_lv_access_power_kw,
        AVG(CASE WHEN duration_hours > 0 THEN electric_heater_energy_kwh / duration_hours ELSE NULL END) as avg_electric_heater_power_kw,
        AVG(CASE WHEN duration_hours > 0 AND activity_type = 'DRIVING' THEN traction_energy_kwh / duration_hours ELSE NULL END) as avg_traction_power_kw_driving_only,
        AVG(average_power_consumption_kw) as avg_total_power_kw 
    FROM operational_segments
    """
    conditions = []
    params = []
    if start_date:
        conditions.append("date >= ?")
        params.append(start_date)
    if end_date:
        conditions.append("date <= ?")
        params.append(end_date)
    if conditions:
        query_base += " WHERE " + " AND ".join(conditions)
    query_base += " GROUP BY activity_type;"
    data = query_db(query_base, tuple(params))
    if data is None:
        return jsonify({"error": "Failed to retrieve energy breakdown data"}), 500
    return jsonify(data)

# --- Main Application Runner ---
if __name__ == '__main__':
    if not os.path.exists(DATABASE_PATH):
        print(f"ERROR: Database file not found at {DATABASE_PATH}")
        print("Please run data_processor.py first to create and populate the database.")
    else:
        print(f"Database found at: {DATABASE_PATH}")
        print("Starting Flask development server...")
        app.run(debug=True, host='0.0.0.0', port=5000)