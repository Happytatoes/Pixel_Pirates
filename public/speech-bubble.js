// speech-bubble.js
// Manages a click-to-open retro speech bubble modal for Penny's advice.

(function() {
  let triggerEl = null;
  let overlayEl = null;
  let cardEl = null;
  let currentMessage = '';

  function init() {
    // Create the small cloud trigger bubble
    triggerEl = document.createElement('div');
    triggerEl.className = 'speech-trigger';
    triggerEl.innerHTML = `
      <div class="puff puff-left"></div>
      <div class="puff puff-right"></div>
      <span class="preview">…</span>
      <div class="nub"></div>
    `;

    // Create fullscreen overlay modal
    overlayEl = document.createElement('div');
    overlayEl.className = 'speech-overlay';
    overlayEl.innerHTML = `
      <div class="speech-card">
        <button class="speech-close" aria-label="Close">×</button>
        <h3>Penny says:</h3>
        <p id="speechCardText"></p>
      </div>
    `;

    cardEl = overlayEl.querySelector('.speech-card');
    const closeBtn = overlayEl.querySelector('.speech-close');

    // Click trigger → open modal
    triggerEl.addEventListener('click', openModal);

    // Click close button → close modal
    closeBtn.addEventListener('click', closeModal);

    // Click outside card → close modal
    overlayEl.addEventListener('click', (e) => {
      if (e.target === overlayEl) closeModal();
    });

    // ESC key → close modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && overlayEl.classList.contains('open')) {
        closeModal();
      }
    });

    // Append to body
    document.body.appendChild(overlayEl);

    // Position trigger above pet (will be repositioned dynamically)
    const petArea = document.getElementById('petArea');
    if (petArea) {
      petArea.appendChild(triggerEl);
      positionTrigger();
    }

    // Reposition on window resize
    window.addEventListener('resize', positionTrigger);
  }

  function positionTrigger() {
    const pet = document.getElementById('pet');
    if (!pet || !triggerEl) return;

    const petRect = pet.getBoundingClientRect();
    const petAreaRect = pet.closest('.pet-area')?.getBoundingClientRect();
    
    if (!petAreaRect) return;

    // Position above pet, centered
    const left = petRect.left - petAreaRect.left + (petRect.width / 2);
    const top = petRect.top - petAreaRect.top;

    triggerEl.style.left = `${left}px`;
    triggerEl.style.top = `${top}px`;
  }

  function openModal() {
    if (overlayEl) {
      overlayEl.classList.add('open');
      document.body.style.overflow = 'hidden'; // Prevent scroll
    }
  }

  function closeModal() {
    if (overlayEl) {
      overlayEl.classList.remove('open');
      document.body.style.overflow = ''; // Restore scroll
    }
  }

  // Public API: Show/hide trigger + update message
  window.pennyShowMessage = function(msg) {
    if (!triggerEl || !overlayEl) return;

    currentMessage = String(msg || '').trim();
    if (!currentMessage) {
      // Hide trigger if no message
      triggerEl.classList.remove('visible');
      return;
    }

    // Update preview (first 40 chars with ellipsis)
    const preview = currentMessage.length > 40 
      ? currentMessage.slice(0, 40) + '…' 
      : currentMessage;
    
    const previewEl = triggerEl.querySelector('.preview');
    if (previewEl) previewEl.textContent = preview;

    // Update modal content
    const textEl = document.getElementById('speechCardText');
    if (textEl) textEl.textContent = currentMessage;

    // Show trigger
    triggerEl.classList.add('visible');
    positionTrigger();
  };

  window.pennyHideMessage = function() {
    if (triggerEl) triggerEl.classList.remove('visible');
  };

  // Init when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();