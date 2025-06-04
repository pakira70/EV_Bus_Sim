[build]
  command = "pip install -r requirements.txt"
  publish = "bus_sim_back/static" # Points to where your static CSS/JS are

[build.environment]
  # Let's try a very common, slightly older Python version known for broad compatibility
  # Ensure Netlify build images definitely have precompiled versions for these.
  PYTHON_VERSION = "3.9" 
  # If 3.9 somehow still causes issues, we can try 3.8 later, but 3.9 should be very safe.