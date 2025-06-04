from flask import Flask

app = Flask(__name__)

@app.route('/')
def hello():
    # No logger here yet to keep it minimal, Gunicorn logs will show if it starts
    return "Hello from Minimal Flask App on Netlify!"

# Remove ALL other routes, ALL database code, ALL other imports for this test.
# The if __name__ == '__main__': block is NOT run by Gunicorn, so it can stay or be removed.
if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000) # Gunicorn won't use this