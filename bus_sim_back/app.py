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
_APP_DIR = os.path.dirname(os.path.abspath(__file__))
_DEFAULT_DB_PATH = os.path.join(_APP_DIR, 'fleet_history.db')
_env_db = (os.environ.get('DATABASE_PATH') or '').strip()
DATABASE_PATH = _env_db if _env_db else _DEFAULT_DB_PATH

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


init_db()

# --- HTML Serving Routes ---
@app.route('/')
def index(): return render_template('index.html')

@app.route('/editor')
def editor(): return render_template('run_cut_editor.html')

@app.route('/analytics')
def analytics(): return render_template('fleet_analytics.html')

@app.route('/temp_insights')
def temp_insights_page(): return render_template('temp_insights.html')

def _table_exists(cur, table_name):
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", (table_name,))
    return cur.fetchone() is not None


def _column_exists(cur, table_name, column_name):
    cur.execute(f"PRAGMA table_info({table_name})")
    cols = [row["name"] for row in cur.fetchall()]
    return column_name in cols

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


@app.route('/api/config_presets/princeton', methods=['GET'])
def config_presets_princeton():
    conn = get_db_conn()
    cur = conn.cursor()

    if not _table_exists(cur, 'operational_segments'):
        conn.close()
        return jsonify({"error": "Operational data is unavailable."}), 404

    selected_year = request.args.get('year', type=int)
    selected_month = request.args.get('month', type=int)

    cur.execute("""
        SELECT DISTINCT
            CAST(strftime('%Y', date) AS INTEGER) AS year,
            CAST(strftime('%m', date) AS INTEGER) AS month
        FROM operational_segments
        WHERE date IS NOT NULL
        ORDER BY year DESC, month DESC
    """)
    periods = [dict(row) for row in cur.fetchall() if row['year'] and row['month']]

    if not periods:
        conn.close()
        return jsonify({"error": "No historical periods are available."}), 404

    if selected_year is None or selected_month is None:
        selected_year = periods[0]['year']
        selected_month = periods[0]['month']

    # Suggested values for selected period
    period_params = {'year': selected_year, 'month': selected_month}
    cur.execute("""
        SELECT
            SUM(energy_used_kwh) AS total_energy_kwh,
            SUM(duration_hours) AS total_duration_hours,
            AVG(average_temperature_f) AS avg_monthly_temp_f
        FROM operational_segments
        WHERE activity_type = 'DRIVING'
          AND CAST(strftime('%Y', date) AS INTEGER) = :year
          AND CAST(strftime('%m', date) AS INTEGER) = :month
    """, period_params)
    period_ops = dict(cur.fetchone() or {})

    suggested_eu_kw = None
    if period_ops.get('total_duration_hours'):
        duration = period_ops['total_duration_hours'] or 0
        if duration > 0:
            suggested_eu_kw = (period_ops.get('total_energy_kwh') or 0) / duration

    # Prefer default ESS value from configured parameters to keep behavior stable.
    cur.execute("SELECT ess_capacity_kwh FROM bus_parameters WHERE id = 1")
    ess_row = cur.fetchone()
    suggested_ess_kwh = (ess_row['ess_capacity_kwh'] if ess_row else None) or 435

    # Suggested charge rate if charging sessions are present in the selected period.
    suggested_charge_rate_kw = None
    if _table_exists(cur, 'charging_sessions'):
        charge_rate_col = None
        if _column_exists(cur, 'charging_sessions', 'soc_based_charge_power_kw'):
            charge_rate_col = 'soc_based_charge_power_kw'
        elif _column_exists(cur, 'charging_sessions', 'average_charging_power_kw'):
            charge_rate_col = 'average_charging_power_kw'

        if charge_rate_col:
            cur.execute(f"""
                SELECT AVG({charge_rate_col}) AS avg_charge_rate_kw
                FROM charging_sessions
                WHERE CAST(strftime('%Y', date) AS INTEGER) = :year
                  AND CAST(strftime('%m', date) AS INTEGER) = :month
                  AND {charge_rate_col} > 0
            """, period_params)
            charge_row = cur.fetchone()
            if charge_row and charge_row['avg_charge_rate_kw'] is not None:
                suggested_charge_rate_kw = charge_row['avg_charge_rate_kw']

    # Provenance metrics are all-time for context.
    cur.execute("SELECT COUNT(DISTINCT bus) AS bus_count FROM operational_segments")
    bus_count = (cur.fetchone() or {'bus_count': 0})['bus_count'] or 0

    cur.execute("SELECT COUNT(DISTINCT strftime('%Y-%m', date)) AS month_count FROM operational_segments WHERE date IS NOT NULL")
    month_count = (cur.fetchone() or {'month_count': 0})['month_count'] or 0

    cur.execute("SELECT COUNT(*) AS trip_count FROM operational_segments WHERE activity_type = 'DRIVING'")
    trip_count = (cur.fetchone() or {'trip_count': 0})['trip_count'] or 0

    charging_session_count = 0
    if _table_exists(cur, 'charging_sessions'):
        cur.execute("SELECT COUNT(*) AS session_count FROM charging_sessions")
        charging_session_count = (cur.fetchone() or {'session_count': 0})['session_count'] or 0

    conn.close()

    return jsonify({
        "source": {
            "id": "princeton_fleet",
            "label": "Princeton Fleet (real-world)",
            "location": "Princeton, NJ"
        },
        "selected_period": {"year": selected_year, "month": selected_month},
        "available_periods": periods,
        "suggested_defaults": {
            "ess_capacity_kwh": round(float(suggested_ess_kwh), 2) if suggested_ess_kwh is not None else None,
            "avg_energy_use_kw": round(float(suggested_eu_kw), 2) if suggested_eu_kw is not None else None,
            "charge_rate_kw": round(float(suggested_charge_rate_kw), 2) if suggested_charge_rate_kw is not None else None,
            "avg_monthly_temp_f": round(float(period_ops.get('avg_monthly_temp_f')), 1) if period_ops.get('avg_monthly_temp_f') is not None else None
        },
        "provenance": {
            "buses": int(bus_count),
            "months": int(month_count),
            "trips": int(trip_count),
            "charging_sessions": int(charging_session_count)
        }
    })

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

        df['moving_avg_power_kw'] = df['moving_avg_power_kw'].fillna(0)
        df['avg_power_kw'] = df['avg_power_kw'].fillna(0)
        df['avg_temp'] = df['avg_temp'].fillna(0)

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
    if not os.path.exists(DATABASE_PATH):
        logger.error(f"DB not found at {DATABASE_PATH}")
    else:
        app.run(debug=True, host='0.0.0.0', port=5000)