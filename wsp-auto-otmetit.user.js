// ==UserScript==
// @name         WSP KBTU — авто-клик «Отметиться»
// @namespace    wsp.kbtu.kz
// @version      1.0.0
// @description  Автоматически жмёт кнопку «отметить/отметиться», как только она появляется и становится активной. Работает в твоём залогиненном браузере, куки/сессию не трогает.
// @match        https://wsp.kbtu.kz/*
// @run-at       document-idle
// @noframes
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // ===================== НАСТРОЙКИ =====================
  const CFG = {
    // Стем текста нужной кнопки. Матчится как подстрока, регистр не важен.
    // 'отметит' ловит «Отметиться» и «Отметить», но НЕ «Отметки» (это меню оценок).
    targets: ['отметит', 'отметь'],

    // После клика может выскочить окно подтверждения — жмём и его.
    confirmExact:  ['да', 'ok', 'ок', 'yes', 'иә'],       // точное совпадение
    confirmPrefix: ['подтвер', 'отправ', 'сохран', 'жіберу'], // по началу слова

    clickOnce: true,   // остановиться после первого успешного клика
    beep:      true,   // пикнуть при клике
    notify:    true,   // системное уведомление
    pollMs:    150,    // как часто дополнительно опрашивать DOM (мс)
    startArmed:true,   // сразу «на взводе» после загрузки
  };
  // ====================================================

  let armed = CFG.startArmed;
  let state = 'watching';      // watching -> confirming -> done
  let confirmDeadline = 0;
  let lastClickTs = 0;

  // ---------- поиск ----------
  function textOf(el) {
    const cap = el.querySelector && el.querySelector('.v-button-caption');
    let t = (cap ? cap.textContent : el.textContent) || '';
    if (!t && 'value' in el) t = el.value || '';
    return t.trim().toLowerCase();
  }
  function isVisible(el) {
    if (!el || !el.getClientRects().length) return false;
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity !== 0;
  }
  function isDisabled(el) {
    if (el.disabled) return true;
    if (el.getAttribute && el.getAttribute('aria-disabled') === 'true') return true;
    if (el.classList && (el.classList.contains('v-disabled') || el.classList.contains('v-button-disabled'))) return true;
    if (el.closest && el.closest('.v-disabled')) return true;
    return false;
  }
  const SEL = '.v-button, button, [role="button"], .v-nativebutton, input[type="button"], input[type="submit"], a.v-button';

  function findByStems(stems) {
    for (const el of document.querySelectorAll(SEL)) {
      const t = textOf(el);
      if (t && stems.some(s => t.includes(s)) && isVisible(el) && !isDisabled(el)) return el;
    }
    return null;
  }
  function findConfirm() {
    for (const el of document.querySelectorAll(SEL)) {
      const t = textOf(el);
      if (!t || !isVisible(el) || isDisabled(el)) continue;
      if (CFG.confirmExact.includes(t) || CFG.confirmPrefix.some(p => t.startsWith(p))) return el;
    }
    return null;
  }

  // ---------- клик (полная последовательность событий для Vaadin) ----------
  function fire(el, type) {
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true, view: window, button: 0,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
    }));
  }
  function clickEl(el) {
    try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
    try { el.focus(); } catch (e) {}
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(t => fire(el, t));
  }

  // ---------- фидбэк ----------
  let badgeEl;
  function badge(text, color) {
    if (!badgeEl) {
      badgeEl = document.createElement('div');
      badgeEl.style.cssText =
        'position:fixed;z-index:2147483647;right:12px;bottom:12px;padding:8px 12px;border-radius:10px;' +
        'font:600 13px/1.3 system-ui,Segoe UI,Arial;color:#fff;box-shadow:0 4px 14px rgba(0,0,0,.3);' +
        'cursor:pointer;user-select:none;max-width:300px';
      badgeEl.title = 'Клик — вкл/выкл · Alt+A вкл/выкл · Alt+R перевзвести';
      badgeEl.addEventListener('click', toggleArmed);
      (document.body || document.documentElement).appendChild(badgeEl);
    }
    badgeEl.textContent = text;
    badgeEl.style.background = color || '#334155';
  }
  function refreshBadge() {
    if (state === 'done') return badge('🏁 Готово · Alt+R — повторить', '#0ea5e9');
    if (!armed)           return badge('⏸ Пауза · Alt+A — включить', '#64748b');
    badge('🟢 Слежу за кнопкой…', '#334155');
  }
  function beep() {
    if (!CFG.beep) return;
    try {
      const a = new (window.AudioContext || window.webkitAudioContext)();
      const o = a.createOscillator(), g = a.createGain();
      o.connect(g); g.connect(a.destination);
      o.type = 'square'; o.frequency.value = 880; g.gain.value = 0.05;
      o.start(); setTimeout(() => { o.stop(); a.close(); }, 180);
    } catch (e) {}
  }
  function notify(msg) {
    if (!CFG.notify) return;
    try { if (window.Notification && Notification.permission === 'granted') new Notification('WSP авто-клик', { body: msg }); } catch (e) {}
  }

  // ---------- управление ----------
  function toggleArmed() { armed = !armed; refreshBadge(); }
  function rearm() { state = 'watching'; armed = true; refreshBadge(); }
  window.addEventListener('keydown', (e) => {
    if (!e.altKey) return;
    const k = (e.key || '').toLowerCase();
    if (k === 'a' || k === 'ф') { e.preventDefault(); toggleArmed(); }   // Alt+A (RU-раскладка = ф)
    if (k === 'r' || k === 'к') { e.preventDefault(); rearm(); }         // Alt+R (RU-раскладка = к)
  });

  // ---------- главный цикл ----------
  function tick() {
    if (!armed || state === 'done') return;

    if (state === 'watching') {
      const btn = findByStems(CFG.targets);
      if (!btn) return;
      const now = Date.now();
      if (now - lastClickTs < 800) return; // антидребезг
      lastClickTs = now;

      const label = textOf(btn);
      clickEl(btn);
      beep(); notify('Нажал: «' + label + '»');
      badge('✅ НАЖАЛ: ' + label, '#16a34a');

      state = 'confirming';
      confirmDeadline = Date.now() + 4000;
      return;
    }

    if (state === 'confirming') {
      const cf = findConfirm();
      if (cf) {
        clickEl(cf);
        badge('✅ Подтвердил', '#16a34a');
        finish();
      } else if (Date.now() > confirmDeadline) {
        finish();
      }
    }
  }
  function finish() {
    if (CFG.clickOnce) { state = 'done'; refreshBadge(); }
    else { state = 'watching'; refreshBadge(); }
  }

  // ---------- старт ----------
  if (CFG.notify) { try { if (Notification.permission === 'default') Notification.requestPermission(); } catch (e) {} }
  refreshBadge();

  const obs = new MutationObserver(() => tick());
  obs.observe(document.documentElement, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: ['class', 'disabled', 'aria-disabled', 'style'],
  });
  setInterval(tick, CFG.pollMs);
  tick();

  console.log('%c[WSP авто-клик] заряжен. Ловлю кнопку:', 'color:#16a34a;font-weight:700', CFG.targets);
})();
