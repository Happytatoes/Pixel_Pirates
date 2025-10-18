# Penny – Your Financial Pet

**Penny** is a cute virtual pet that reacts to your financial data. Track your income, spending, savings, debt, and investments, and watch Penny's health change in real time! 🥚💖

---

## Features

- Interactive virtual pet that responds to your finances.
- Visual health bar showing Penny’s wellbeing.
- Fun, Gen Z-style messages from Penny based on financial data.
- Secure backend server to protect your Gemini API key.
- Pastel, cute design with customizable colors and fonts.

---

## Tech Stack

- Frontend: HTML, CSS, JavaScript  
- Backend: Node.js, Express  
- API: Google Gemini generative AI  
- Environment Variables: `.env` to store your API key  

---

## Installation

1. Clone the repository:

git clone https://github.com/yourusername/penny.git
cd penny

2. Install backend dependencies:

npm install

3. Set up environment variables:

Create a `.env` file in the root folder:

GEMINI_API_KEY=YOUR_GOOGLE_API_KEY_HERE
PORT=3000

Make sure `.env` is in your `.gitignore` to avoid exposing your key.

4. Start the backend server:

node server.js

Server runs on http://localhost:3000

5. Open frontend:  

Open `index.html` in your browser (or use Live Server extension in VS Code).

---

## Usage

1. Fill in your financial data in the input fields:
   - Monthly Income
   - Monthly Spending
   - Total Savings
   - Total Debt
   - Monthly Investments
   - Total Investment Balance

2. Click “Feed Penny”.  

3. Watch Penny react with:
   - An emoji representing the pet’s state
   - A health bar
   - A fun message based on your finances  

---

## Backend

`server.js` handles all calls to the Gemini API:

- Receives a JSON payload from frontend with your financial prompt.
- Sends request to Gemini using your private API key.
- Returns Gemini’s response to the frontend.
- Keeps your API key secure, hidden from the browser.

---

## Frontend

`gemini-service.js` handles:

- Building the prompt for Penny based on your financial inputs.
- Sending it to your backend server.
- Parsing Gemini’s JSON response.
- Updating Penny’s health, emoji, and message dynamically.