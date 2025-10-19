
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

    // Reposition once the pet image loads (important on first paint)
    const img = charEl ? charEl.querySelector('img') : null;
    if (img && !img.complete) {
      img.addEventListener('load', positionTrigger, { once: true });
    }

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
    window.addEventListener('load', positionTrigger, { passive: true }); // after images/fonts
    if ('fonts' in document && document.fonts?.ready) {
      document.fonts.ready.then(positionTrigger).catch(()=>{});
    }
    if (window.ResizeObserver) {
      ro = new ResizeObserver(() => positionTrigger());
      ro.observe(areaEl);
      ro.observe(charEl);
      // also observe the pet image if present
      const img = charEl.querySelector('img');
      if (img) ro.observe(img);
    }

    trigger.addEventListener('click', open);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    closeBtn.addEventListener('click', close);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

    // First position after everything is wired
    requestAnimationFrame(positionTrigger);

    // Expose small API
    window.pennyShowMessage = show;
    window.pennyHideMessage = hide;
  }

  // Place the mini bubble centered horizontally above the pet
  function positionTrigger() {
    if (!trigger || !areaEl || !charEl) return;

    const areaRect = areaEl.getBoundingClientRect();
    const rect     = charEl.getBoundingClientRect();
    const offsetY  = 24; // distance above the pet

    // If the pet hasn't laid out yet, center in the area as a fallback
    const hasSize = rect.width > 0 && rect.height > 0;

    // Horizontal: pet center inside its area
    const petCenterX = hasSize
      ? (rect.left - areaRect.left) + rect.width / 2
      : areaEl.clientWidth / 2;

    // Vertical: just above the top of the pet; fallback to 35% height
    let topRel = hasSize
      ? (rect.top - areaRect.top) - offsetY
      : (areaEl.clientHeight * 0.35);

    // Constrain inside the area
    const pad = 24;
    const left = Math.max(pad, Math.min(areaEl.clientWidth - pad, petCenterX));
    const top  = Math.max(0, topRel);

    trigger.style.left = `${left}px`;
    trigger.style.top  = `${top}px`;
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
