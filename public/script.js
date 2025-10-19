import { analyzeFinancialData } from './gemini-service.js';

window.switchPage = function(pageId) {
    //console.log('Switching to:', pageId); // Debug
    
    // Hide all pages
    const pages = document.querySelectorAll('.page');
    pages.forEach(page => page.classList.remove('active'));
    
    // Show target page
    const targetPage = document.getElementById(pageId);
    if (targetPage) {
        targetPage.classList.add('active');
    }
    
    // Update nav buttons
    const navBtns = document.querySelectorAll('.nav-btn');
    navBtns.forEach(btn => {
        btn.classList.remove('active');
        if (btn.getAttribute('onclick').includes(pageId)) {
            btn.classList.add('active');
        }
    });
};


function savePetState(state) {
    localStorage.setItem('pennyState', JSON.stringify(state));
}

// Load state on page load
function loadPetState() {
    const saved = localStorage.getItem('pennyState');
    if (saved) {
        const state = JSON.parse(saved);
        updatePetDisplay(state);
    }
}

// Temporary debug function - add at the top of script.js
window.debugGemini = async function() {
    const testData = {
        income: '5000',
        spending: '3000',
        savings: '10000',
        debt: '2000',
        monthlyInvestments: '500',
        investmentBalance: '15000'
    };
    
    try {
        const prompt = buildFinancialPrompt(testData);
        console.log('=== PROMPT ===');
        console.log(prompt);
        
        const response = await callGeminiAPI(prompt);
        console.log('=== RAW RESPONSE ===');
        console.log(JSON.stringify(response, null, 2));
        
        if (response.candidates && response.candidates[0]) {
            console.log('=== CANDIDATE STRUCTURE ===');
            console.log(response.candidates[0]);
            
            if (response.candidates[0].content) {
                console.log('=== CONTENT ===');
                console.log(response.candidates[0].content);
                
                if (response.candidates[0].content.parts) {
                    console.log('=== TEXT ===');
                    console.log(response.candidates[0].content.parts[0].text);
                }
            }
        }
    } catch (error) {
        console.error('Debug failed:', error);
    }
};


// script.js

// Pet States Configuration (YOU'RE MISSING THIS!)
const PET_STATES = {
    FLATLINED: { 
        emoji: '💀', 
        className: 'flatlined',
        name: 'FLATLINED',
        animation: 'pulse'
    },
    CRITICAL: { 
        emoji: '🤢', 
        className: 'critical',
        name: 'CRITICAL',
        animation: 'bounce'
    },
    STRUGGLING: { 
        emoji: '😰', 
        className: 'struggling',
        name: 'STRUGGLING',
        animation: 'pulse'
    },
    SURVIVING: { 
        emoji: '😐', 
        className: 'surviving',
        name: 'SURVIVING',
        animation: ''
    },
    HEALTHY: { 
        emoji: '😊', 
        className: 'healthy',
        name: 'HEALTHY',
        animation: ''
    },
    THRIVING: { 
        emoji: '✨', 
        className: 'thriving',
        name: 'THRIVING',
        animation: 'bounce'
    },
    LEGENDARY: { 
        emoji: '🔥', 
        className: 'legendary',
        name: 'LEGENDARY',
        animation: 'pulse'
    },
    EGG: {
        emoji: '🥚',
        className: 'egg',
        name: 'EGG',
        animation: 'bounce'
    }
};

// Remove old calculation functions (we're using Gemini now!)

// Update Pet Display (keep this)
function updatePetDisplay(petState) {
    const petArea = document.getElementById('petArea');
    const pet = document.getElementById('pet');
    const stateName = document.getElementById('stateName');
    const petMessage = document.getElementById('petMessage');
    const scoreDisplay = document.getElementById('scoreDisplay');
    const stats = document.getElementById('stats');
    const healthBar = document.getElementById('healthBar');
    const healthValue = document.getElementById('healthValue');

    const currentPetState = PET_STATES[petState.state];

    // Update pet area background
    petArea.className = 'pet-area ' + currentPetState.className;

    // Update pet emoji and animation
    pet.textContent = currentPetState.emoji;
    pet.className = 'pet ' + currentPetState.animation;

    // Update state name
    stateName.textContent = currentPetState.name;

    // Update message
    petMessage.textContent = petState.message;

    // Update score badge
    if (petState.score !== null) {
        
        // Show stats
        stats.style.display = 'flex';
        // Update health bar
        healthBar.style.width = petState.health + '%';
        healthValue.textContent = petState.health + '%';
        
    }
}

async function handleSubmit() {
    const income = document.getElementById('income').value;
    const spending = document.getElementById('spending').value;
    const savings = document.getElementById('savings').value;
    const debt = document.getElementById('debt').value;
    const monthlyInvestments = document.getElementById('monthlyInvestments').value;
    const investmentBalance = document.getElementById('investmentBalance').value;

    if (!income || !spending || !savings || !debt || !monthlyInvestments || !investmentBalance) {
        alert('Please fill in all fields!');
        return;
    }

    const formData = {
        income,
        spending,
        savings,
        debt,
        monthlyInvestments,
        investmentBalance
    };

    const submitBtn = document.getElementById('submitBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Analyzing with AI...';
    
    document.getElementById('petMessage').textContent = 'Gemini is analyzing your finances... This might take a moment!';

    try {
        const analysis = await analyzeFinancialData(formData);
        updatePetDisplay(analysis);
    
        // Switch back to pet view to see results!
        window.switchPage('petView');

    } catch (error) {
        console.error('Analysis failed:', error);
        document.getElementById('petMessage').textContent = 'Oops! Something went wrong. Try again?';
        
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Feed Penny 🍼';
    }
}

// Event Listeners (keep these)
document.getElementById('submitBtn').addEventListener('click', handleSubmit);

document.addEventListener('DOMContentLoaded', () => {
    loadPetState();
});

document.querySelectorAll('input').forEach(input => {
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            handleSubmit();
        }
    });
});