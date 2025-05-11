import pandas as pd
import os
import glob
import sqlite3 # For SQLite database operations

# --- Configuration Constants ---
BUS_ESS_CAPACITY_KWH = 435  # <<< ADD THIS LINE (Example: 450 kWh)

# --- Helper Functions (from before, mostly unchanged) ---
def clean_column_name(col_name):
    """Cleans a column name: lowercase, replace spaces/special chars with underscore."""
    name = str(col_name).lower() # Ensure col_name is a string
    name = name.replace('[%]', 'percent')
    name = name.replace('[kwh]', 'kwh')
    name = name.replace('[kwh/mile]', 'kwh_per_mile')
    name = name.replace('[miles]', 'miles')
    name = name.replace('[mph]', 'mph')
    name = name.replace('[kw]', 'kw')
    name = name.replace('[°f]', 'f')
    name = name.replace('�f', 'f') # Handle the specific replacement character
    name = name.replace('%', 'percent')
    name = name.replace(' ', '_')
    name = name.replace('.', '')
    name = name.replace('/', '_')
    if name.endswith('_'):
        name = name[:-1]
    return name

def parse_duration_to_hours(duration_str):
    """Converts HH:MM:SS duration string to total hours as a float."""
    if pd.isna(duration_str) or not isinstance(duration_str, str):
        return None
    try:
        h, m, s = map(int, duration_str.split(':'))
        return h + (m / 60.0) + (s / 3600.0)
    except ValueError:
        # print(f"Warning: Could not parse duration '{duration_str}'. Returning None.")
        return None

# --- Processing Functions (modified slightly) ---
def process_operational_data_file(csv_file_path):
    """Reads and processes a single operational data CSV file."""
    try:
        df = pd.read_csv(csv_file_path)
    except FileNotFoundError:
        print(f"Error: Operational data file not found at {csv_file_path}")
        return None
    except pd.errors.EmptyDataError:
        print(f"Warning: Operational data file is empty: {csv_file_path}")
        return None


    df.columns = [clean_column_name(col) for col in df.columns]

    if 'date' not in df.columns:
        print(f"Warning: 'date' column not found in {csv_file_path}. Skipping this file for ops data.")
        return None

    df['date'] = pd.to_datetime(df['date'], errors='coerce')
    df.dropna(subset=['date'], inplace=True) # Remove rows where date couldn't be parsed

    numeric_cols_ops = [
        'air_compressor_energy_kwh', 'rear_hvac_energy_kwh', 'lv_access_energy_kwh',
        'electric_heater_energy_kwh', 'traction_energy_kwh', 'energy_used_kwh',
        'mileage_miles', 'average_speed_mph', 'soc_start_percent', 'soc_end_percent',
        'regen_energy_kwh', 'regen_ratio', 'net_energy_consumption_kwh_per_mile',
        'average_power_consumption_kw', 'average_temperature_f'
    ]
    for col in numeric_cols_ops:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')

    if 'duration' in df.columns:
        df['duration_hours'] = df['duration'].apply(parse_duration_to_hours)
    else:
        df['duration_hours'] = None # Add column even if original duration is missing

    return df

def process_charge_summary_data_file(csv_file_path):
    """Reads and processes a single charge summary data CSV file."""
    try:
        df = pd.read_csv(csv_file_path)
    except FileNotFoundError:
        print(f"Error: Charge summary data file not found at {csv_file_path}")
        return None
    except pd.errors.EmptyDataError:
        print(f"Warning: Charge summary data file is empty: {csv_file_path}")
        return None

    df.columns = [clean_column_name(col) for col in df.columns]

    if 'date' not in df.columns:
        print(f"Warning: 'date' column not found in {csv_file_path}. Skipping this file for charge data.")
        return None

    df['date'] = pd.to_datetime(df['date'], errors='coerce')
    df.dropna(subset=['date'], inplace=True)

    numeric_cols_charge = [
        'soc_start_percent', 'soc_end_percent', 'air_compressor_energy_consumption_kwh',
        'rear_hvac_energy_consumption_kwh', 'lv_access_energy_consumption_kwh',
        'electric_heater_energy_consumptionkwh', # Original from your header
        'electric_heater_energy_consumption_kwh',# Desired cleaned version
        'energy_transferred_kwh'
    ]
    # Standardize the heater column name if the slightly different one exists
    if 'electric_heater_energy_consumptionkwh' in df.columns and 'electric_heater_energy_consumption_kwh' not in df.columns:
        df.rename(columns={'electric_heater_energy_consumptionkwh': 'electric_heater_energy_consumption_kwh'}, inplace=True)

    for col in numeric_cols_charge:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')

    if 'duration' in df.columns:
        df['duration_hours'] = df['duration'].apply(parse_duration_to_hours)
    else:
        df['duration_hours'] = None

    if 'energy_transferred_kwh' in df.columns and 'duration_hours' in df.columns:
        df['average_charging_power_kw'] = df.apply(
            lambda row: row['energy_transferred_kwh'] / row['duration_hours']
            if pd.notna(row['duration_hours']) and row['duration_hours'] > 0 and pd.notna(row['energy_transferred_kwh'])
            else None,
            axis=1
        )
    else:
        df['average_charging_power_kw'] = None

 # ++++++++++++++ NEW CODE STARTS HERE ++++++++++++++
    # Calculate SOC change and SOC-based energy & power
    if 'soc_start_percent' in df.columns and \
       'soc_end_percent' in df.columns and \
       'duration_hours' in df.columns:
        
        df['soc_change_percent'] = df['soc_end_percent'] - df['soc_start_percent']
        
        # Calculate energy added to battery based on SOC change
        # Uses the global BUS_ESS_CAPACITY_KWH defined at the top of the script
        df['soc_kwh_added'] = (df['soc_change_percent'] / 100.0) * BUS_ESS_CAPACITY_KWH
        
        # Calculate charging power based on energy added to battery
        # Only for actual charging events (SOC increase)
        df['soc_based_charge_power_kw'] = df.apply(
            lambda row: row['soc_kwh_added'] / row['duration_hours']
            if pd.notna(row['duration_hours']) and row['duration_hours'] > 0 and \
               pd.notna(row['soc_kwh_added']) and pd.notna(row['soc_change_percent']) and row['soc_change_percent'] > 0
            else None, # Returns None if not a valid charging scenario for this calculation
            axis=1
        )
    else:
        # Ensure columns exist even if input columns are missing
        df['soc_change_percent'] = None
        df['soc_kwh_added'] = None
        df['soc_based_charge_power_kw'] = None
    # ++++++++++++++ NEW CODE ENDS HERE ++++++++++++++
    return df

def infer_activity_type_ops(df_ops):
    """Infers activity type for operational data."""
    if df_ops is None or df_ops.empty:
        return df_ops
    
    # Define a small threshold for mileage to be considered driving
    mileage_threshold = 0.1 

    conditions = [
        df_ops['mileage_miles'] > mileage_threshold,
        df_ops['mileage_miles'] <= mileage_threshold
    ]
    choices = ['DRIVING', 'IDLE'] # Kept simple for now: RUN/DEADHEAD are 'DRIVING'

    df_ops['activity_type'] = pd.Series(pd.NA) # Initialize with NAs
    df_ops['activity_type'] = df_ops.apply(
        lambda row: 'DRIVING' if pd.notna(row['mileage_miles']) and row['mileage_miles'] > mileage_threshold else 'IDLE',
        axis=1
    )
    return df_ops

def load_data_to_sqlite(db_path, ops_df, charge_df):
    """Loads the processed DataFrames into an SQLite database."""
    try:
        conn = sqlite3.connect(db_path)
        print(f"\nConnecting to SQLite database: {db_path}")

        if ops_df is not None and not ops_df.empty:
            ops_df.to_sql('operational_segments', conn, if_exists='replace', index=False)
            print(f"Loaded {len(ops_df)} rows into 'operational_segments' table.")
        else:
            print("No operational data to load.")

        if charge_df is not None and not charge_df.empty:
            charge_df.to_sql('charging_sessions', conn, if_exists='replace', index=False)
            print(f"Loaded {len(charge_df)} rows into 'charging_sessions' table.")
        else:
            print("No charging data to load.")

        conn.close()
        print("Data successfully loaded to SQLite and connection closed.")
    except Exception as e:
        print(f"Error loading data to SQLite: {e}")

# --- Configuration ---
CSV_FILES_DIRECTORY = r"C:\EV_Bus_Sim\bus_sim_data\csv_converted"  # Relative path to your CSVs
DATABASE_PATH = r"fleet_history.db"  # Will be created in the same directory as the script

# Keywords to identify file types (adjust if your filenames differ)
OPS_DATA_KEYWORD = "Summary" # Assumes "Summary" (not "Charge_Summary") indicates operational data
CHARGE_DATA_KEYWORD = "Charge_Summary"

# --- Main Processing Logic ---
if __name__ == "__main__":
    all_ops_data_list = []
    all_charge_data_list = []

    # Use absolute path for glob if running from a different CWD than script location
    script_dir = os.path.dirname(os.path.abspath(__file__))
    csv_dir_abs_path = os.path.join(script_dir, CSV_FILES_DIRECTORY)


    print(f"Searching for CSV files in: {csv_dir_abs_path}")
    
    for csv_file in glob.glob(os.path.join(csv_dir_abs_path, "*.csv")):
        filename = os.path.basename(csv_file)
        print(f"\nProcessing file: {filename}")

        if CHARGE_DATA_KEYWORD.lower() in filename.lower():
            df_charge_single = process_charge_summary_data_file(csv_file)
            if df_charge_single is not None and not df_charge_single.empty:
                all_charge_data_list.append(df_charge_single)
                print(f"Added {len(df_charge_single)} rows from charge summary: {filename}")
        # Ensure "Charge_Summary" isn't also caught by the "Summary" keyword for ops data
        elif OPS_DATA_KEYWORD.lower() in filename.lower():
            df_ops_single = process_operational_data_file(csv_file)
            if df_ops_single is not None and not df_ops_single.empty:
                all_ops_data_list.append(df_ops_single)
                print(f"Added {len(df_ops_single)} rows from operational data: {filename}")
        else:
            print(f"Skipping file (unknown type or does not match keywords): {filename}")

    # Concatenate all DataFrames
    final_ops_df = pd.DataFrame()
    if all_ops_data_list:
        final_ops_df = pd.concat(all_ops_data_list, ignore_index=True)
        print(f"\nTotal operational segments processed: {len(final_ops_df)}")
        # Infer activity type for the combined operational data
        final_ops_df = infer_activity_type_ops(final_ops_df)
        print("Operational data head after activity inference:")
        print(final_ops_df[['date', 'bus', 'mileage_miles', 'activity_type']].head())
    else:
        print("\nNo operational data was processed.")

    final_charge_df = pd.DataFrame()
    if all_charge_data_list:
        final_charge_df = pd.concat(all_charge_data_list, ignore_index=True)
        print(f"\nTotal charging sessions processed: {len(final_charge_df)}")
    else:
        print("\nNo charging data was processed.")

    # Load data into SQLite
    # Make DATABASE_PATH relative to script directory as well
    db_abs_path = os.path.join(script_dir, DATABASE_PATH)
    load_data_to_sqlite(db_abs_path, final_ops_df, final_charge_df)

    print("\n--- Script Finished ---")