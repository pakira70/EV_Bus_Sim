# bus_sim_back/check_data_completeness.py

import os
import glob
from datetime import datetime
import pandas as pd

def audit_data_files():
    """
    Audits the data directory to check for missing monthly summary and
    charge_summary files from a specified start date to the current month.
    """
    # --- CONFIGURATION ---
    START_YEAR = 2022
    START_MONTH = 11
    EXPECTED_FILE_TYPES = ['Summary', 'Charge_Summary']
    project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    data_directory = os.path.join(project_root, 'bus_sim_data', 'csv_converted')
    # --- END CONFIGURATION ---

    print("--- Starting Data File Audit ---")
    print(f"Checking for files in: {data_directory}")

    # 1. Generate a list of all expected file "signatures" based on the new format
    expected_signatures = set()
    start_date = datetime(START_YEAR, START_MONTH, 1)
    end_date = datetime.now()
    date_range = pd.date_range(start_date, end_date, freq='MS')

    for report_date in date_range:
        # NEW: Generate the pattern "Month_Year" e.g., "November_2022"
        month_year_str = report_date.strftime('%B_%Y') # %B gives full month name
        for file_type in EXPECTED_FILE_TYPES:
            # The signature is now "Month_Year_FileType" e.g., "November_2022_Charge_Summary"
            signature = f"{month_year_str}_{file_type}"
            expected_signatures.add(signature)

    # 2. Scan the directory and identify the signatures of files we actually have
    found_signatures = set()
    if not os.path.isdir(data_directory):
        print(f"\nERROR: Data directory not found. Please check the path.")
        return

    all_csv_files = glob.glob(os.path.join(data_directory, "*.csv"))

    for filepath in all_csv_files:
        filename_lower = os.path.basename(filepath).lower()

        # Check this filename against all possible expected formats
        for expected_sig in expected_signatures:
            # We need to make the expected signature lowercase to match the filename
            # and replace the underscore between type parts for "Charge_Summary"
            # Example: "november_2022_charge_summary"
            search_pattern = expected_sig.lower()

            if search_pattern in filename_lower:
                found_signatures.add(expected_sig)
                break # Match found, move to the next file

    # 3. Compare the lists and report the findings
    missing_files = sorted(list(expected_signatures - found_signatures))
    
    print("\n--- Audit Report ---")
    print(f"Expected monthly reports from {START_YEAR}-{START_MONTH} to {end_date.strftime('%Y-%m')}.")
    print(f"Found {len(found_signatures)} out of {len(expected_signatures)} expected file types.")

    if not missing_files:
        print("\n✅ SUCCESS: All expected files are present!")
    else:
        print("\n❌ ACTION REQUIRED: The following files/data appear to be missing:")
        for missing in missing_files:
            # Split the signature back into readable parts
            parts = missing.split('_')
            month, year, file_type = parts[0], parts[1], "_".join(parts[2:])
            print(f"  - Month: {month} {year}, Type: {file_type}")

    print("\n--- Audit Finished ---\n")

if __name__ == "__main__":
    audit_data_files()