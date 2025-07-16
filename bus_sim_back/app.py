from flask import Flask, jsonify, request, render_template
import sqlite3
import os
import logging
import json
import pandas as pd

# --- Configuration & Initialization ---
app = Flask(__name__, template_folder='templates', static_folder='static')
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
DATABASE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fleet_history.db')

# --- Database Utility ---
def get_db_conn():
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    return conn

# --- Database Initialization ---
# Creates tables if they don't exist yet
def init_db():
    try:
        conn = get_db_conn()
        cur = conn.cursor()
        
        cur.execute('''
            CREATE TABLE IF NOT EXISTS operational_segments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                bus TEXT, date TEXT, activity_type TEXT, start_time TEXT, end_time TEXT,
                duration_hours REAL, mileage_miles REAL, energy_used_kwh REAL,
                average_temperature_f REAL, traction_energy_kwh REAL, regen_energy_kwh REAL,
                electric_heater_energy_kwh REAL, rear_hvac_energy_kwh REAL,
                air_compressor_energy_kwh REAL, lv_access_energy_kwh REAL
            );
        ''')

        cur.execute('''
            CREATE TABLE IF NOT EXISTS bus_parameters (
                id INTEGER PRIMARY KEY CHECK (id = 1), -- Enforce only one row
                ess_capacity_kwh REAL,
                avg_energy_use_kw REAL,
                low_soc_warning_percent INTEGER,
                critical_soc_warning_percent INTEGER
            );
        ''')
        cur.execute("INSERT OR IGNORE INTO bus_parameters (id, ess_capacity_kwh, avg_energy_use_kw, low_soc_warning_percent, critical_soc_warning_percent) VALUES (1, 435, 55, 20, 10);")

        cur.execute('''
            CREATE TABLE IF NOT EXISTS chargers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                rate_kw REAL NOT NULL
            );
        ''')
        
        conn.commit()
        conn.close()
        logger.info("Database initialized successfully.")
    except Exception as e:
        logger.error(f"Error initializing database: {e}")

# --- HTML Serving Routes ---
@app.route('/')
def index(): return render_template('index.html')

@app.route('/editor')
def editor(): return render_template('run_cut_editor.html')

@app.route('/analytics')
def analytics(): return render_template('fleet_analytics.html')

@app.route('/temp_insights')
def temp_insights_page(): return render_template('temp_insights.html')

# --- Bus Parameter API (FOR CONFIG PAGE) ---
@app.route('/api/bus_params', methods=['GET', 'POST'])
def bus_params():
    conn = get_db_conn()
    if request.method == 'GET':
        cur = conn.cursor()
        cur.execute("SELECT * FROM bus_parameters WHERE id = 1")
        params = cur.fetchone()
        conn.close()
        if params:
            return jsonify(dict(params))
        return jsonify({"error": "Parameters not found"}), 404

    if request.method == 'POST':
        data = request.json
        try:
            cur = conn.cursor()
            cur.execute("""
                UPDATE bus_parameters SET 
                ess_capacity_kwh = ?, avg_energy_use_kw = ?, 
                low_soc_warning_percent = ?, critical_soc_warning_percent = ?
                WHERE id = 1
            """, (data['ess_capacity_kwh'], data['avg_energy_use_kw'], data['low_soc_warning_percent'], data['critical_soc_warning_percent']))
            conn.commit()
            conn.close()
            return jsonify({"message": "Bus parameters saved successfully!"})
        except Exception as e:
            conn.close()
            return jsonify({"error": str(e)}), 500

# --- Charger API (FOR CONFIG PAGE) ---
@app.route('/api/chargers', methods=['GET', 'POST'])
def handle_chargers():
    conn = get_db_conn()
    if request.method == 'GET':
        cur = conn.cursor()
        cur.execute("SELECT * FROM chargers ORDER BY name")
        chargers = [dict(row) for row in cur.fetchall()]
        conn.close()
        return jsonify(chargers)
    
    if request.method == 'POST':
        data = request.json
        try:
            cur = conn.cursor()
            cur.execute("INSERT INTO chargers (name, rate_kw) VALUES (?, ?)", (data['name'], data['rate_kw']))
            conn.commit()
            conn.close()
            return jsonify({"message": "Charger added successfully!", "id": cur.lastrowid}), 201
        except Exception as e:
            conn.close()
            return jsonify({"error": str(e)}), 500

@app.route('/api/chargers/<int:charger_id>', methods=['PUT', 'DELETE'])
def handle_single_charger(charger_id):
    conn = get_db_conn()
    if request.method == 'PUT':
        data = request.json
        try:
            cur = conn.cursor()
            cur.execute("UPDATE chargers SET name = ?, rate_kw = ? WHERE id = ?", (data['name'], data['rate_kw'], charger_id))
            conn.commit()
            conn.close()
            return jsonify({"message": "Charger updated successfully!"})
        except Exception as e:
            conn.close()
            return jsonify({"error": str(e)}), 500

    if request.method == 'DELETE':
        try:
            cur = conn.cursor()
            cur.execute("DELETE FROM chargers WHERE id = ?", (charger_id,))
            conn.commit()
            conn.close()
            return jsonify({"message": "Charger deleted successfully!"})
        except Exception as e:
            conn.close()
            return jsonify({"error": str(e)}), 500


# --- Fleet Analytics API ---
@app.route('/api/fleet_analytics_data', methods=['GET'])
def get_fleet_analytics_data():
    conn = get_db_conn()
    cur = conn.cursor()
    
    try:
        low_temp = float(request.args.get('low_temp', -100))
        high_temp = float(request.args.get('high_temp', 200))
        timeseries_buses_str = request.args.get('timeseries_buses', None)
    except (ValueError, TypeError):
        return jsonify({"error": "Invalid filter parameters"}), 400

    if timeseries_buses_str:
        try:
            # --- MODIFICATION START: Convert bus IDs to integers ---
            bus_list = [int(bus.strip()) for bus in timeseries_buses_str.split(',') if bus.strip()]
            # --- MODIFICATION END ---
        except ValueError:
            return jsonify({"error": "Invalid bus ID in list. IDs must be integers."}), 400
        
        if not bus_list:
            return jsonify({"error": "No buses specified for time-series"}), 400

        placeholders = ','.join(['?'] * len(bus_list))
        
        time_series_query = f"""
            SELECT 
                bus, 
                date, 
                SUM(energy_used_kwh) / NULLIF(SUM(duration_hours), 0) as avg_power_kw, 
                AVG(average_temperature_f) as avg_temp 
            FROM operational_segments 
            WHERE average_temperature_f BETWEEN ? AND ? 
              AND bus IN ({placeholders})
              AND activity_type = 'DRIVING' 
              AND duration_hours > 0 
            GROUP BY bus, date 
            ORDER BY bus, date ASC
        """
        
        ts_params = [low_temp, high_temp] + bus_list
        cur.execute(time_series_query, ts_params)
        results = [dict(row) for row in cur.fetchall()]
        conn.close()

        if not results:
            return jsonify({})

        df = pd.DataFrame(results)
        df['date'] = pd.to_datetime(df['date'])
        df = df.sort_values(by=['bus', 'date'])
        
        df['moving_avg_power_kw'] = df.groupby('bus')['avg_power_kw'].transform(
            lambda x: x.rolling(window=7, min_periods=1).mean()
        )
        
        df['date'] = df['date'].dt.strftime('%Y-%m-%d')
        df['moving_avg_power_kw'] = df['moving_avg_power_kw'].round(2)
        
        # In JSON, object keys must be strings. Convert numeric bus IDs to strings for the output keys.
        df['bus'] = df['bus'].astype(str)
        bus_list_str = [str(bus_id) for bus_id in bus_list]

        output_data = {}
        for bus_id in bus_list_str:
            bus_data = df[df['bus'] == bus_id].to_dict('records')
            if bus_data:
                output_data[bus_id] = bus_data

        return jsonify(output_data)

    # This part remains the same for the snapshot KPIs
    params = {'low_temp': low_temp, 'high_temp': high_temp}
    base_where = "WHERE average_temperature_f BETWEEN :low_temp AND :high_temp AND activity_type = 'DRIVING' AND duration_hours > 0"
    
    def calculate_metrics_from_row(row):
        if not row: return {}
        duration = row.get('total_duration_hours') or 0
        total_energy = row.get('total_energy_kwh') or 0
        total_miles = row.get('total_mileage_miles') or 0
        traction_kwh = row.get('total_traction_kwh') or 0
        return {
            'avg_power_kw': total_energy / duration if duration > 0 else 0,
            'avg_economy_kwh_per_mile': total_energy / total_miles if total_miles > 0 else 0,
            'breakdown_kw': {
                'Traction': traction_kwh / duration if duration > 0 else 0, 'Heater': (row.get('total_heater_kwh') or 0) / duration if duration > 0 else 0,
                'HVAC': (row.get('total_hvac_kwh') or 0) / duration if duration > 0 else 0, 'Air Comp.': (row.get('total_ac_kwh') or 0) / duration if duration > 0 else 0,
                'LV Acc.': (row.get('total_lv_kwh') or 0) / duration if duration > 0 else 0,
            },
            'regen_offset_percent': (row.get('total_regen_kwh') or 0) / traction_kwh * 100 if traction_kwh > 0 else 0
        }
    
    sql_aggregates = "SUM(energy_used_kwh) as total_energy_kwh, SUM(duration_hours) as total_duration_hours, SUM(mileage_miles) as total_mileage_miles, SUM(traction_energy_kwh) as total_traction_kwh, SUM(regen_energy_kwh) as total_regen_kwh, SUM(electric_heater_energy_kwh) as total_heater_kwh, SUM(rear_hvac_energy_kwh) as total_hvac_kwh, SUM(air_compressor_energy_kwh) as total_ac_kwh, SUM(lv_access_energy_kwh) as total_lv_kwh"
    all_buses_query = f"SELECT bus, {sql_aggregates} FROM operational_segments {base_where} GROUP BY bus"
    cur.execute(all_buses_query, params)
    filtered_bus_data = [dict(row) for row in cur.fetchall()]

    calculated_data = {row['bus']: calculate_metrics_from_row(row) for row in filtered_bus_data}
    
    bus_list_query = "SELECT DISTINCT bus FROM operational_segments ORDER BY bus ASC"
    cur.execute(bus_list_query)
    all_bus_ids = [row['bus'] for row in cur.fetchall()]
    conn.close()

    default_metrics = {'avg_power_kw': 0, 'avg_economy_kwh_per_mile': 0, 'breakdown_kw': {}, 'regen_offset_percent': 0}
    # In JSON, keys must be strings. Convert bus IDs to strings for the keys here.
    fleet_metrics_by_bus = {str(bus_id): calculated_data.get(bus_id, default_metrics) for bus_id in all_bus_ids}
    
    valid_buses = {k: v for k, v in fleet_metrics_by_bus.items() if v.get('avg_power_kw', 0) > 0}

    if valid_buses:
        fleet_avg_power = sum(d['avg_power_kw'] for d in valid_buses.values()) / len(valid_buses)
        fleet_avg_economy = sum(d['avg_economy_kwh_per_mile'] for d in valid_buses.values()) / len(valid_buses)
        best_by_power = sorted(valid_buses.items(), key=lambda item: item[1]['avg_power_kw'])
        worst_by_power = sorted(best_by_power, key=lambda item: item[1]['avg_power_kw'], reverse=True)
        best_by_economy = sorted(valid_buses.items(), key=lambda item: item[1]['avg_economy_kwh_per_mile'])
        worst_by_economy = sorted(best_by_economy, key=lambda item: item[1]['avg_economy_kwh_per_mile'], reverse=True)
    else:
        fleet_avg_power, fleet_avg_economy = 0, 0
        best_by_power, worst_by_power, best_by_economy, worst_by_economy = [], [], [], []

    response_data = {
        'snapshot_kpis': {
            'fleet_avg_power': fleet_avg_power, 'fleet_avg_economy': fleet_avg_economy,
            'best_bus_by_power_id': best_by_power[0][0] if best_by_power else None,
            'worst_bus_by_power_id': worst_by_power[0][0] if worst_by_power else None,
            'best_bus_by_economy_id': best_by_economy[0][0] if best_by_economy else None,
            'worst_bus_by_economy_id': worst_by_economy[0][0] if worst_by_economy else None,
        },
        'fleet_metrics_by_bus': fleet_metrics_by_bus,
        'bus_list': all_bus_ids
    }
    return jsonify(response_data)


if __name__ == '__main__':
    init_db()
    if not os.path.exists(DATABASE_PATH): 
        logger.error(f"DB not found at {DATABASE_PATH}")
    else: 
        app.run(debug=True, host='0.0.0.0', port=5000)