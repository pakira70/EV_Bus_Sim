from flask import Flask

# This line creates the Flask application instance.
# The variable 'app' now holds your Flask application object.
app = Flask(__name__) 

@app.route('/')
def hello_world():
    return 'Hello, World!'

# This part is only for running the app with Flask's built-in
# development server when you execute "python app.py" directly.
# Gunicorn does NOT use this block.
if __name__ == '__main__':
    app.run(debug=True) 