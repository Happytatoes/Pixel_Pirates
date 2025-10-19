/* ===== Speech Bubble controller (creates its own DOM) ===== */
(function () {
  const CHAR_SELECTOR = '#pet';
  const AREA_SELECTOR = '#petArea';

  let trigger, overlay, card, closeBtn, textEl, charEl, areaEl, lastText = '';
  let ro;

  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  function ensureDom() {
    areaEl = document.querySelector(AREA_SELECTOR);
    if (!areaEl) return false;

    // Cloud trigger INSIDE petArea
    if (!document.getElementById('speech-trigger')) {
      const t = document.createElement('div');
      t.id = 'speech-trigger';
      t.className = 'speech-trigger';
      t.setAttribute('aria-label', 'Open message');
      t.hidden = true;
      t.innerHTML = `
        <span class="puff puff-left"></span>
        <span class="puff puff-right"></span>
        <span class="preview">...</span>
        <span class="nub"></span>
      `;
      areaEl.appendChild(t);
    }

    // Fullscreen overlay at document level
    if (!document.getElementById('speech-overlay')) {
      const o = document.createElement('div');
      o.id = 'speech-overlay';
      o.className = 'speech-overlay';
      o.setAttribute('aria-hidden', 'true');
      o.innerHTML = `
        <div class="speech-card" role="dialog" aria-modal="true" aria-labelledby="speech-title" tabindex="-1">
          <button class="speech-close" aria-label="Close" title="Close">×</button>
          <h3 id="speech-title">Penny says</h3>
          <p id="speech-text"></p>
        </div>
      `;
      document.body.appendChild(o);
    }

    trigger = document.getElementById('speech-trigger');
    overlay = document.getElementById('speech-overlay');
    card    = overlay.querySelector('.speech-card');
    closeBtn= overlay.querySelector('.speech-close');
    textEl  = document.getElementById('speech-text');
    charEl  = document.querySelector(CHAR_SELECTOR);

    return !!(trigger && overlay && textEl && charEl);
  }

  function init() {
    if (!ensureDom()) {
      console.warn('[SpeechBubble] Missing required elements. Check selectors/HTML.');
      return;
    }

    // Reposition on layout changes
    window.addEventListener('resize', positionTrigger, { passive: true });
    window.addEventListener('scroll', positionTrigger, { passive: true });
    if ('fonts' in document && document.fonts?.ready) {
      document.fonts.ready.then(positionTrigger).catch(()=>{});
    }
    if (window.ResizeObserver) {
      ro = new ResizeObserver(() => positionTrigger());
      ro.observe(areaEl);
      ro.observe(charEl);
    }

    trigger.addEventListener('click', open);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    closeBtn.addEventListener('click', close);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

    positionTrigger();

    // Expose small API
    window.pennyShowMessage = show;
    window.pennyHideMessage = hide;
  }

  // Center horizontally in the pet area; raise above emoji
  function positionTrigger() {
    if (!trigger || !areaEl || !charEl) return;

    const areaRect = areaEl.getBoundingClientRect();
    const rect     = charEl.getBoundingClientRect();

    const centerX = areaEl.clientWidth / 2;

    let topRel = rect.top - areaRect.top;
    if (!isFinite(topRel) || rect.height === 0) {
      topRel = areaEl.clientHeight * 0.35;
    }

    const offsetY = 24; // distance above emoji
    const top  = Math.max(0, topRel - offsetY);
    const left = Math.max(24, Math.min(areaEl.clientWidth - 24, centerX));

    trigger.style.top  = `${top}px`;
    trigger.style.left = `${left}px`;
  }

  function show(text) {
    lastText = String(text || '').trim();

    // The mini bubble always shows "..." in pixel font (no sentence preview)
    const previewEl = trigger.querySelector('.preview');
    if (previewEl) previewEl.textContent = '...';

    // The full message goes in the overlay
    textEl.textContent = lastText || '';

    trigger.hidden = false;
    trigger.classList.add('visible');
    trigger.setAttribute('aria-label', 'Open message');
    positionTrigger();
  }

  function hide() {
    if (!trigger) return;
    trigger.classList.remove('visible');
    trigger.hidden = true;
  }

  function open() {
    if (!lastText) return;
    overlay.classList.add('open');
    overlay.removeAttribute('aria-hidden');
    document.documentElement.style.overflow = 'hidden';
    setTimeout(() => card && card.focus(), 0);
  }

  function close() {
    if (trigger) trigger.focus(); // return focus before hiding for a11y
    if (document.activeElement && overlay.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    document.documentElement.style.overflow = '';
  }

  onReady(init);
})();
