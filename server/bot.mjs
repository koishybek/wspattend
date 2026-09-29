// WSP KBTU — 24/7 бот: логинится и жмёт кнопку «Отметиться», как только она появится.
// Куки/пароль берутся из .env, в код не зашиты. Работает headless на сервере.
import 'dotenv/config';
import { chromium } from 'playwright';
import fs from 'node:fs';

const CFG = {
  url:      process.env.WSP_URL || 'https://wsp.kbtu.kz/RegistrationOnline',
  login:    process.env.WSP_LOGIN || '',
  password: process.env.WSP_PASSWORD || '',
  stems:         splitLower(process.env.TARGET_STEMS, 'отметит,отметь,белгілен'),
  confirmExact:  splitLower(process.env.CONFIRM_EXACT, 'да,ok,ок,yes,иә'),
  confirmPrefix: splitLower(process.env.CONFIRM_PREFIX, 'подтвер,отправ,сохран,жіберу'),
  loginBtn:      splitLower(process.env.LOGIN_BUTTON_TEXT, 'кіру,войти,вход,login,sign in'),
  clickOnce: (process.env.CLICK_ONCE ?? 'false').toLowerCase() === 'true',
  headful:   truthy(process.env.HEADFUL),
  pollMs:    int(process.env.POLL_MS, 500),
  healthMs:  int(process.env.HEALTH_MS, 15000),
  runOnce:   truthy(process.env.RUN_ONCE),
  tgToken:   process.env.TELEGRAM_BOT_TOKEN || '',
  tgChat:    process.env.TELEGRAM_CHAT_ID || '',
  shotDir:   process.env.SCREENSHOT_DIR || '.',
  stateFile: process.env.STORAGE_STATE || 'storage-state.json',
  maxMinutes:     int(process.env.MAX_MINUTES, 0),        // >0: выйти через N минут (для GitHub Actions)
  exitAfterClick: truthy(process.env.EXIT_AFTER_CLICK),   // выйти сразу после успешного клика
  scheduleJson:   process.env.SCHEDULE_JSON || '',        // путь к schedule.json: следить только во время пары
};

const BTN_SEL = '.v-button, button, [role="button"], .v-nativebutton, input[type="button"], input[type="submit"]';
let loginFails = 0; // неудачные входы подряд: после 2 — стоп, чтобы не заблокировали аккаунт
const LAUNCH_ARGS = [
  '--no-sandbox', '--disable-dev-shm-usage',
  // не давать Chromium душить таймеры/heartbeat в фоне (headless-вкладка = "скрытая")
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
];

// ---------- утилиты ----------
function splitLower(v, def) { return (v ?? def).split(',').map(s => s.trim().toLowerCase()).filter(Boolean); }
function truthy(v) { return ['1', 'true', 'yes', 'on'].includes(String(v ?? '').toLowerCase()); }
function int(v, def) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : def; }
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function nowAlmaty() { return new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' }); }
function log(...a) { console.log(`[${nowAlmaty()}]`, ...a); }

// ---------- расписание (для GitHub Actions) ----------
// Возвращает активную сейчас пару и сколько минут до её конца, либо null.
function activeBlock(path) {
  let blocks;
  try { blocks = JSON.parse(fs.readFileSync(path, 'utf8')); }
  catch (e) { log('schedule: ошибка чтения', path, '-', e.message); return null; }
  const f = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Almaty', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
  const p = Object.fromEntries(f.formatToParts(new Date()).map(x => [x.type, x.value]));
  const dow = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.weekday];
  const now = (parseInt(p.hour, 10) % 24) * 60 + parseInt(p.minute, 10);
  const GRACE = 30, ENDBUF = 3;                // крон стартует за 25 мин до пары (запас на задержку GitHub)
  const toMin = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  let best = null;
  for (const b of blocks) {
    if (b.dow !== dow) continue;
    const s = toMin(b.start), e = toMin(b.end);
    if (now >= s - GRACE && now <= e + ENDBUF && (!best || e > best.endMin)) {
      best = { name: b.name || `${b.start}-${b.end}`, endMin: e };
    }
  }
  return best ? { name: best.name, minutes: Math.max(1, best.endMin + ENDBUF - now) } : null;
}

// ---------- Telegram ----------
async function tg(text, photoPath) {
  if (!CFG.tgToken || !CFG.tgChat) return;
  try {
    if (photoPath && fs.existsSync(photoPath)) {
      const form = new FormData();
      form.append('chat_id', CFG.tgChat);
      form.append('caption', text.slice(0, 1000));
      form.append('photo', new Blob([fs.readFileSync(photoPath)]), 'shot.png');
      await fetch(`https://api.telegram.org/bot${CFG.tgToken}/sendPhoto`, { method: 'POST', body: form });
    } else {
      await fetch(`https://api.telegram.org/bot${CFG.tgToken}/sendMessage`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: CFG.tgChat, text }),
      });
    }
  } catch (e) { log('tg error:', e.message); }
}

// ---------- поиск элементов ----------
async function isLoginForm(page) {
  return await page.locator('input[type=password]').first().isVisible().catch(() => false);
}
async function pickButton(page, matchFn) {
  const btns = page.locator(BTN_SEL);
  const n = await btns.count().catch(() => 0);
  for (let i = 0; i < n; i++) {
    const b = btns.nth(i);
    let txt = '';
    try {
      txt = ((await b.textContent()) || '').trim().toLowerCase();
      if (!txt) { const v = await b.inputValue().catch(() => ''); txt = (v || '').trim().toLowerCase(); }
    } catch { continue; }
    if (!txt || !matchFn(txt)) continue;
    if (!(await b.isVisible().catch(() => false))) continue;
    const disabled = await b.evaluate(el =>
      el.disabled === true ||
      el.getAttribute('aria-disabled') === 'true' ||
      el.classList.contains('v-disabled') ||
      el.classList.contains('v-button-disabled') ||
      !!(el.closest && el.closest('.v-disabled'))
    ).catch(() => false);
    if (disabled) continue;
    return b;
  }
  return null;
}
const findTarget  = (page) => pickButton(page, t => CFG.stems.some(s => t.includes(s)));
const findConfirm = (page) => pickButton(page, t => CFG.confirmExact.includes(t) || CFG.confirmPrefix.some(p => t.startsWith(p)));
const findLoginBtn = (page) => pickButton(page, t => CFG.loginBtn.some(s => t.includes(s)));

// ---------- логин ----------
async function doLogin(page) {
  log('login: заполняю форму…');
  await page.waitForSelector('input.v-filterselect-input, input[type=password]', { timeout: 30000 });
  const user = page.locator('input.v-filterselect-input').first();
  if (await user.count()) {
    await user.click();
    await user.press('Control+a').catch(() => {});
    await user.pressSequentially(CFG.login, { delay: 40 });
    await sleep(400);
  }
  const pass = page.locator('input[type=password]').first();
  await pass.click();                 // заодно гасит выпадашку combobox
  await pass.fill(CFG.password);
  const btn = await findLoginBtn(page);
  if (!btn) throw new Error('кнопка входа не найдена');
  log('login: кнопка входа «' + (((await btn.textContent().catch(() => '')) || '').trim()) + '»'); // видно язык интерфейса
  await btn.click({ timeout: 10000 });
  // ждём исчезновения формы логина
  await page.waitForFunction(() => {
    const p = document.querySelector('input[type=password]');
    return !p || !(p.offsetParent || p.getClientRects().length);
  }, { timeout: 30000 }).catch(() => {});
  await sleep(1500);
  if (await isLoginForm(page)) {
    const shot = `${CFG.shotDir}/login-failed-${Date.now()}.png`;
    await page.screenshot({ path: shot }).catch(() => {});
    await tg('⚠️ WSP: не смог залогиниться (неверный логин/пароль или капча). См. скрин.', shot);
    const err = new Error('после сабмита всё ещё форма логина — проверь WSP_LOGIN/WSP_PASSWORD');
    err.code = 'LOGIN_FAILED';
    throw err;
  }
  loginFails = 0;
  log('login: успех');
}
async function gotoApp(page) {
  if (!page.url().includes('RegistrationOnline')) {
    await page.goto(CFG.url, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await sleep(1500);
  }
}
async function ensureLoggedIn(page, ctx) {
  await page.waitForSelector('input, .v-button', { timeout: 30000 }).catch(() => {});
  await sleep(1000);
  if (await isLoginForm(page)) {
    await doLogin(page);
    await gotoApp(page);
    try { await ctx.storageState({ path: CFG.stateFile }); log('сессия сохранена в', CFG.stateFile); } catch {}
  } else {
    log('уже залогинен (сессия из', CFG.stateFile + ')');
  }
}

// ---------- реакция на клик ----------
async function onTargetClicked(page, label) {
  log('✅ НАЖАЛ:', label);
  const shot = `${CFG.shotDir}/clicked-${Date.now()}.png`;
  await page.screenshot({ path: shot }).catch(() => {});
  await tg(`✅ WSP: нажал «${label}»\n${nowAlmaty()} (Алматы)`, shot);
}

// ---------- основной цикл сессии ----------
async function sessionLoop(page, ctx) {
  log('слежу за кнопкой:', CFG.stems, '| clickOnce =', CFG.clickOnce);
  let armed = true;         // можно ли сейчас кликать
  let doneForever = false;  // clickOnce отработал
  let lastClick = 0;
  let lastBeat = 0;
  let lastHealth = 0;

  while (true) {
    if (page.isClosed()) throw new Error('page closed');

    // здоровье сессии
    if (Date.now() - lastHealth > CFG.healthMs) {
      lastHealth = Date.now();
      if (await isLoginForm(page)) {
        log('сессия слетела → перелогин');
        await doLogin(page); await gotoApp(page);
        try { await ctx.storageState({ path: CFG.stateFile }); } catch {}
        log('снова на посту');
      }
    }

    if (!doneForever) {
      const btn = await findTarget(page);
      if (btn && armed) {
        const label = ((await btn.textContent().catch(() => '')) || '').trim() || '(без текста)';
        log('цель активна → жму:', label);
        await btn.click({ timeout: 5000 }).catch(e => log('ошибка клика:', e.message));
        await handleConfirm(page);
        await onTargetClicked(page, label);
        if (CFG.exitAfterClick) { log('EXIT_AFTER_CLICK: клик сделан — выход'); await sleep(500); process.exit(0); }
        lastClick = Date.now();
        armed = false;
        if (CFG.clickOnce) { doneForever = true; log('clickOnce: готово, дальше просто держу сессию'); }
      } else if (!btn && !armed && Date.now() - lastClick > 3000) {
        armed = true; // кнопка пропала → перевзвожусь для следующего появления
      }
    }

    if (CFG.runOnce) { log('RUN_ONCE: один проход завершён'); return; }
    if (Date.now() - lastBeat > 60000) { lastBeat = Date.now(); log('alive · url=', page.url()); }
    await sleep(CFG.pollMs);
  }
}
async function dumpButtons(page) {
  // дать Vaadin дорисовать экран после входа
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await sleep(3000);
  log('страница:', await page.title().catch(() => '?'), page.url());
  const list = await page.$$eval(
    '.v-button, button, [role="button"], .v-nativebutton, input[type="button"], input[type="submit"]',
    els => els.map(e => {
      const c = e.querySelector('.v-button-caption');
      return {
        text: ((c ? c.textContent : e.textContent) || e.value || '').trim(),
        visible: !!(e.offsetParent || e.getClientRects().length),
        disabled: e.classList.contains('v-disabled') || !!(e.closest && e.closest('.v-disabled')),
      };
    }).filter(b => b.text)
  );
  log('=== КНОПКИ НА СТРАНИЦЕ (подбери TARGET_STEMS по нужной) ===');
  console.log(JSON.stringify(list, null, 2));
  const hit = list.find(b => b.visible && !b.disabled && CFG.stems.some(s => b.text.toLowerCase().includes(s)));
  log(hit ? `совпадение с TARGET_STEMS сейчас: «${hit.text}»`
          : 'совпадений с TARGET_STEMS сейчас нет (кнопка появляется, только когда препод открыл отметку)');
}
async function handleConfirm(page) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const c = await findConfirm(page);
    if (c) { await c.click({ timeout: 3000 }).catch(() => {}); log('подтвердил диалог'); return true; }
    await sleep(300);
  }
  return false;
}

// ---------- запуск с автоперезапуском ----------
function validate() {
  if (!CFG.login || !CFG.password) {
    console.error('❌ Нет WSP_LOGIN / WSP_PASSWORD. Заполни server/.env (см. .env.example).');
    process.exit(1);
  }
}
async function main() {
  validate();
  log('старт. url=', CFG.url, '| headful=', CFG.headful);

  // режим расписания: если сейчас пары нет — сразу выходим (экономим минуты GitHub)
  if (CFG.scheduleJson) {
    const b = activeBlock(CFG.scheduleJson);
    if (!b) { log('расписание: сейчас пары нет — выход'); process.exit(0); }
    CFG.maxMinutes = b.minutes;
    log(`расписание: активна пара «${b.name}», слежу ещё ~${CFG.maxMinutes} мин`);
  }
  // жёсткий предохранитель по времени (для GitHub Actions)
  if (CFG.maxMinutes > 0) {
    setTimeout(() => { log(`MAX_MINUTES=${CFG.maxMinutes} — время вышло, выход`); process.exit(0); }, CFG.maxMinutes * 60000);
  }

  let backoff = 5000;
  while (true) {
    let browser;
    try {
      browser = await chromium.launch({ headless: !CFG.headful, args: LAUNCH_ARGS });
      const ctxOpts = { ignoreHTTPSErrors: true, locale: 'ru-RU', timezoneId: 'Asia/Almaty' };
      if (fs.existsSync(CFG.stateFile)) ctxOpts.storageState = CFG.stateFile;
      const ctx = await browser.newContext(ctxOpts);
      // без этой куки портал открывается на казахском и кнопка называется иначе
      await ctx.addCookies([{ name: 'r5-locale', value: process.env.WSP_LOCALE || 'ru', domain: 'wsp.kbtu.kz', path: '/' }]);
      const page = await ctx.newPage();
      page.setDefaultTimeout(20000);
      await page.goto(CFG.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await ensureLoggedIn(page, ctx);
      if (truthy(process.env.DUMP)) { await dumpButtons(page); await browser.close().catch(() => {}); return; }
      await sessionLoop(page, ctx);
      await browser.close().catch(() => {});
      if (CFG.runOnce) return;
      backoff = 5000;
    } catch (e) {
      log('‼ сессия упала:', e.message);
      try {
        const p = browser && browser.contexts()[0]?.pages()[0];
        if (p) await p.screenshot({ path: `${CFG.shotDir}/error-${Date.now()}.png` }).catch(() => {});
      } catch {}
      try { await browser?.close(); } catch {}
      if (e.code === 'LOGIN_FAILED' && ++loginFails >= 2) {
        log('‼ 2 неудачных входа подряд — стоп, чтобы не заблокировали аккаунт. Проверь WSP_LOGIN/WSP_PASSWORD.');
        process.exit(1);
      }
      if (CFG.runOnce) process.exit(1);
      log(`перезапуск через ${backoff} мс`);
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 60000);
    }
  }
}

process.on('SIGINT', () => { log('SIGINT — выхожу'); process.exit(0); });
process.on('SIGTERM', () => { log('SIGTERM — выхожу'); process.exit(0); });

// main() завершается только в режимах DUMP/RUN_ONCE — тогда выходим, не дожидаясь таймеров
main().then(() => process.exit(0), e => { console.error('fatal:', e); process.exit(1); });
