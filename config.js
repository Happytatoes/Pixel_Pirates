// config.js
const API_CONFIG = {
    // REPLACE THIS WITH YOUR ACTUAL API KEY
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    
    // Gemini API endpoint
     GEMINI_ENDPOINT:
    "https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent",
  	
    // Model configuration
    MODEL_CONFIG: {
        temperature: 0.2,     // lower = less “thinking”
		maxOutputTokens: 2500, // small cap = less cost + shorter output
		topP: 0.8,
		topK: 40,
		stopSequences: ["}"]  // stop at end of JSON
    }
};