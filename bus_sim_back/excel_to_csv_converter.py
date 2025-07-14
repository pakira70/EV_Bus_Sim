import pandas as pd
import os
import glob

def batch_excel_to_csv(excel_folder_path, csv_folder_path):
    """
    Converts all Excel files (.xlsx, .xls) in a specified folder to CSV files.

    Args:
        excel_folder_path (str): The path to the folder containing Excel files.
        csv_folder_path (str): The path to the folder where CSV files will be saved.
    """
    # Create the output CSV folder if it doesn't exist
    if not os.path.exists(csv_folder_path):
        os.makedirs(csv_folder_path)
        print(f"Created output folder: {csv_folder_path}")

    # Find all .xlsx files
    excel_files_xlsx = glob.glob(os.path.join(excel_folder_path, "*.xlsx"))
    # Find all .xls files
    excel_files_xls = glob.glob(os.path.join(excel_folder_path, "*.xls"))

    all_excel_files = excel_files_xlsx + excel_files_xls

    if not all_excel_files:
        print(f"No Excel files found in '{excel_folder_path}'.")
        return

    print(f"Found {len(all_excel_files)} Excel file(s) to convert.")

    for excel_file_path in all_excel_files:
        try:
            # Get the base name of the Excel file (e.g., "January_Data")
            base_name = os.path.splitext(os.path.basename(excel_file_path))[0]
            
            # Read the Excel file. Pandas can often read the first sheet by default.
            # If your data is not on the first sheet, or if there are multiple sheets
            # you want to convert, this part needs to be more sophisticated.
            # For now, let's assume one data sheet per file.
            xls = pd.ExcelFile(excel_file_path)
            
            # Iterate through each sheet in the Excel file
            for sheet_name in xls.sheet_names:
                print(f"  Processing sheet: '{sheet_name}' in file: '{os.path.basename(excel_file_path)}'")
                df = pd.read_excel(xls, sheet_name=sheet_name)
                
                # Construct the CSV filename
                # If there's only one sheet, or if sheet names are generic like "Sheet1",
                # you might just use the base_name.
                # If sheet names are meaningful (e.g., "Operational", "Charging"), include them.
                if len(xls.sheet_names) > 1 and sheet_name.lower() not in ['sheet1', 'sheet2', 'sheet3']: # Avoid generic sheet names if multiple sheets
                    csv_file_name = f"{base_name}_{sheet_name}.csv"
                else:
                    csv_file_name = f"{base_name}.csv"
                
                csv_file_path = os.path.join(csv_folder_path, csv_file_name)
                
                # Save the DataFrame to CSV
                df.to_csv(csv_file_path, index=False) # index=False prevents pandas from writing the DataFrame index as a column
                print(f"    Successfully converted '{os.path.basename(excel_file_path)}' (Sheet: {sheet_name}) to '{csv_file_name}'")

        except Exception as e:
            print(f"    Could not convert file '{os.path.basename(excel_file_path)}'. Error: {e}")

    print("\nBatch conversion process complete.")

# --- Configuration ---
# IMPORTANT: Replace these paths with your actual folder paths!
# Use raw strings (r"...") or double backslashes (\\) for Windows paths.

# Path to the folder where your Excel files are located
EXCEL_FILES_DIRECTORY = r"C:\EV_Bus_Sim\bus_sim_data\excel_360_files" 

# Path to the folder where you want to save the converted CSV files
# This can be the same folder or a new one (e.g., a "csv_output" subfolder)
CSV_OUTPUT_DIRECTORY = r"C:\EV_Bus_Sim\bus_sim_data\csv_converted" 

# --- Run the conversion ---
if __name__ == "__main__":
    # Make sure to update the directory paths above before running!
    if EXCEL_FILES_DIRECTORY == r"C:\path\to\your\bus_sim_data" or \
       CSV_OUTPUT_DIRECTORY == r"C:\path\to\your\bus_sim_data\csv_converted":
        print("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!")
        print("!!! PLEASE UPDATE THE EXCEL_FILES_DIRECTORY AND               !!!")
        print("!!! CSV_OUTPUT_DIRECTORY VARIABLES IN THE SCRIPT BEFORE RUNNING !!!")
        print("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!")
    else:
        batch_excel_to_csv(EXCEL_FILES_DIRECTORY, CSV_OUTPUT_DIRECTORY)