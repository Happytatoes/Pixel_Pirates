// gemini-service.js


import { API_CONFIG } from './config.js';

/**
 * Calls Gemini API to analyze financial data
 * @param {Object} financialData - User's financial information
 * @returns {Promise<Object>} - Analysis result with score, state, and message
 */


export async function analyzeFinancialData(data) {
    try {
        const prompt = `You are Penny, a virtual pet whose health depends on the user's finances.
Respond ONLY with JSON in this exact format:
{"state": "<one of: FLATLINED, CRITICAL, STRUGGLING, SURVIVING, HEALTHY, THRIVING, LEGENDARY>", "message": "<fun, Gen Z-style one sentence>", "health": <number 0-100>}

Financial data:
- Income: $${data.income}
- Spending: $${data.spending}
- Savings: $${data.savings}
- Debt: $${data.debt}
- Monthly Investments: $${data.monthlyInvestments}
- Investment Balance: $${data.investmentBalance}`;

        // Call your Node server instead of Gemini directly
        const response = await fetch('http://localhost:3000/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt })
        });

        if (!response.ok) throw new Error('Server error');
        const dataResp = await response.json();

        const candidate = dataResp.candidates?.[0];
        if (!candidate) throw new Error('No candidates returned');

        let text = candidate.content?.parts?.[0].text || candidate.text || '';
        text = text.replace(/```json|```/g, "").trim();

        const analysis = JSON.parse(text);
        analysis.health = Math.max(0, Math.min(100, analysis.health || 50));
        analysis.state = analysis.state || "SURVIVING";
        analysis.message = analysis.message || "Penny is doing okay.";

        return analysis;

    } catch (err) {
        console.error('Failed to analyze financial data:', err);
        return {
            state: 'SURVIVING',
            message: "😐 API is taking a break. You're doing okay!",
            health: 50
        };
    }
}

/**
 * Builds a comprehensive prompt for Gemini
 */
function buildFinancialPrompt(data) {
    const prompt = `You are FinPet, a virtual pet who reacts to the user's finances.

Example:
{"state": "THRIVING", "message": "Emergency fund strong, debt low — I'm doing backflips!", "health": 85}

valid states: FLATLINED, CRITICAL, STRUGGLING, SURVIVING, HEALTHY, THRIVING, LEGENDARY

Now respond in EXACTLY that format based on this data:
- Income: $${data.income}
- Spending: $${data.spending}
- Savings: $${data.savings}
- Debt: $${data.debt}
- Monthly Investments: $${data.monthlyInvestments}
- Investment Balance: $${data.investmentBalance}

Respond ONLY with JSON. No commentary.`;

    return prompt;
}
/**
 * Calls the Gemini API
 */
async function callGeminiAPI(prompt) {
    const url = `${API_CONFIG.GEMINI_ENDPOINT}?key=${API_CONFIG.GEMINI_API_KEY}`;
    
    const requestBody = {
        contents: [{
            parts: [{
                text: prompt
            }]
        }],
        generationConfig: {
            temperature: API_CONFIG.MODEL_CONFIG.temperature,
            maxOutputTokens: API_CONFIG.MODEL_CONFIG.maxOutputTokens,
            topP: API_CONFIG.MODEL_CONFIG.topP,
            topK: API_CONFIG.MODEL_CONFIG.topK
        }
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Gemini API Error: ${JSON.stringify(errorData)}`);
    }

    const data = await response.json();
    return data;
}

/**
 * Parses Gemini's response and extracts the analysis
 */
function parseGeminiResponse(response) {
    try {
        console.log('Full response:', response); // Debug
        
        // Check if we have candidates
        if (!response.candidates || response.candidates.length === 0) {
            throw new Error('No candidates in response');
        }
        
        const candidate = response.candidates[0];
        console.log('Candidate:', candidate); // Debug
        
        // NEW: Handle different response structures
        let text;
        
        // Try content.parts[0].text (standard format)
        if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
            text = candidate.content.parts[0].text;
        }
        // Try direct text field (some models)
        else if (candidate.text) {
            text = candidate.text;
        }
        // Try output field (alternative format)
        else if (candidate.output) {
            text = candidate.output;
        }
        else {
            console.error('Could not find text in candidate:', candidate);
            throw new Error('Could not extract text from response');
        }
        
        console.log('Extracted text:', text); // Debug
        
        // Remove markdown code blocks if present
        let jsonText = text.trim();
        if (jsonText.startsWith('```json')) {
            jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
        } else if (jsonText.startsWith('```')) {
            jsonText = jsonText.replace(/```\n?/g, '');
        }
        
        console.log('Cleaned JSON text:', jsonText); // Debug
        
        // Parse JSON
        const analysis = JSON.parse(jsonText);
        
        // Validate the response
        if (!analysis.state || !analysis.message) {
            throw new Error('Invalid response format from Gemini');
        }
        
        // Ensure values are within bounds
        analysis.health = Math.max(0, Math.min(100, analysis.health || 50));
        
        console.log('Parsed analysis:', analysis); // Debug
        
        return analysis;
    } catch (error) {
        console.error('Error parsing Gemini response:', error);
        console.error('Raw response:', response);
        
        // More helpful error message
        if (error instanceof SyntaxError) {
            console.error('JSON parsing failed. Gemini might not have returned valid JSON.');
        }
        
        throw new Error('Failed to parse Gemini response');
    }
}

/**
 * Fallback function if API fails
 */
function getFallbackAnalysis(data) {
    return {
        state: 'SURVIVING',
        message: "😐 API is taking a break. Using basic analysis. You're doing okay, but let's aim higher!",
        health: 50,
    };
}