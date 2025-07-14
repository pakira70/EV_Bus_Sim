from flask import Flask, jsonify, request, render_template
import sqlite3
import os
import logging

# --- Configuration & Initialization ---
app = Flask(__name__, template_folder='templates', static_folder='static')
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
DATABASE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fleet_history.db')

def query_db(query, args=(), one=False):
    try:
        conn = sqlite3.connect(DATABASE_PATH)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute(query, args)
        rv = cur.fetchall()
        conn.close()
        if one: return dict(rv[0]) if rv else None
        return [dict(row) for row in rv]
    except Exception as e:
        logger.error(f"DB Error. Query: {query}, Args: {args}, Error: {e}")
        return None

# --- HTML Serving Routes (Unchanged) ---
@app.route('/')
def index(): return render_template('index.html')
@app.route('/editor')
def editor(): return render_template('run_cut_editor.html')
@app.route('/insights')
def insights_dashboard(): return render_template('insights.html')
@app.route('/temp_insights')
def temp_insights_page(): return render_template('temp_insights.html')
@app.route('/analytics')
def analytics(): return render_template('fleet_analytics.html')

# --- Main Analytics API ---
@app.route('/api/fleet_analytics_data', methods=['GET'])
def get_fleet_analytics_data():
    try:
        low_temp = float(request.args.get('low_temp', -100))
        high_temp = float(request.args.get('high_temp', 200))
        timeseries_bus = request.args.get('timeseries_bus', None)
    except (ValueError, TypeError):
        return jsonify({"error": "Invalid filter parameters"}), 400

    if timeseries_bus:
        ts_params = [low_temp, high_temp, timeseries_bus]
        time_series_query = "SELECT date, SUM(energy_used_kwh) / NULLIF(SUM(duration_hours), 0) as avg_power_kw, AVG(average_temperature_f) as avg_temp FROM operational_segments WHERE average_temperature_f BETWEEN ? AND ? AND bus = ? AND activity_type = 'DRIVING' AND duration_hours > 0 GROUP BY date ORDER BY date ASC"
        time_series_data = query_db(time_series_query, ts_params) or []
        return jsonify(time_series_data)

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

    # Query for buses that HAVE data matching the filter
    sql_aggregates = "SUM(energy_used_kwh) as total_energy_kwh, SUM(duration_hours) as total_duration_hours, SUM(mileage_miles) as total_mileage_miles, SUM(traction_energy_kwh) as total_traction_kwh, SUM(regen_energy_kwh) as total_regen_kwh, SUM(electric_heater_energy_kwh) as total_heater_kwh, SUM(rear_hvac_energy_kwh) as total_hvac_kwh, SUM(air_compressor_energy_kwh) as total_ac_kwh, SUM(lv_access_energy_kwh) as total_lv_kwh"
    all_buses_query = f"SELECT bus, {sql_aggregates} FROM operational_segments {base_where} GROUP BY bus"
    filtered_bus_data = query_db(all_buses_query, params) or []

    # Create a dictionary of the calculated data, keyed by bus ID
    calculated_data = {row['bus']: calculate_metrics_from_row(row) for row in filtered_bus_data}
    
    # Get the complete list of ALL buses from the database
    bus_list_query = "SELECT DISTINCT bus FROM operational_segments ORDER BY bus ASC"
    all_bus_ids = [row['bus'] for row in query_db(bus_list_query) or []]

    # *** NEW LOGIC: Ensure all buses are in the final dictionary ***
    # Use the calculated data if available, otherwise use a default structure.
    default_metrics = {'avg_power_kw': 0, 'avg_economy_kwh_per_mile': 0, 'breakdown_kw': {}, 'regen_offset_percent': 0}
    fleet_metrics_by_bus = {bus_id: calculated_data.get(bus_id, default_metrics) for bus_id in all_bus_ids}
    
    # Filter out buses with zero power for best/worst calculations to avoid misleading results
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
            'fleet_avg_power': fleet_avg_power,
            'fleet_avg_economy': fleet_avg_economy,
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
    if not os.path.exists(DATABASE_PATH): logger.error(f"DB not found at {DATABASE_PATH}")
    else: app.run(debug=True, host='0.0.0.0', port=5000)