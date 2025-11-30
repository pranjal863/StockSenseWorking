from flask import Flask, render_template, request, redirect, url_for, session
from pymongo import MongoClient
from flask_bcrypt import Bcrypt

app = Flask(__name__)
app.secret_key = "yoursecret123"

bcrypt = Bcrypt(app)

# MongoDB connection
client = MongoClient("mongodb://127.0.0.1:27017/")
db = client["StockSenseDb"]
users = db["users"]

# --------------------------
# ROUTES
# --------------------------

@app.route("/")
def home():
    return render_template("dashboard.html")

@app.route("/signup", methods=["GET", "POST"])
def signup():
    if request.method == "POST":
        name = request.form["name"]
        email = request.form["email"]
        password = bcrypt.generate_password_hash(request.form["password"]).decode("utf-8")

        # Insert user
        result = users.insert_one({
            "name": name,
            "email": email,
            "password": password
        })

        # AUTO LOGIN (store session)
        session["user_id"] = str(result.inserted_id)
        session["email"] = email
        session["name"] = name

        return redirect(url_for("dashboard"))

    return render_template("login.html")

@app.route("/signin", methods=["GET", "POST"])
def signin():
    if request.method == "POST":
        email = request.form["email"]
        password = request.form["password"]

        user = users.find_one({"email": email})

        if user and bcrypt.check_password_hash(user["password"], password):
            session["user_id"] = str(user["_id"])
            session["email"] = user["email"]
            session["name"] = user.get("name", "")
            return redirect(url_for("dashboard"))
        else:
            return "Invalid credentials"

    return render_template("login.html")

@app.route("/dashboard")
def dashboard():
    if "user_id" not in session:
        return redirect(url_for("signin"))
    return f"""
        <h1>Welcome {session['name']}</h1>
        <h2>Dashboard Coming Soon...</h2>
        <a href='/logout'>Logout</a>
    """

@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("home"))

if __name__ == "__main__":
    app.run(port=5000, debug=True)
