
// Снимок формы логина wsp.kbtu.kz: печатает все поля ввода и кнопки, делает скриншот.
// Запуск: node probe-login.mjs   (можно PROBE_URL=... HEADFUL=1)
import { chromium } from 'playwright';

const URL = process.env.PROBE_URL || 'https://wsp.kbtu.kz/RegistrationOnline';

const browser = await chromium.launch({
  headless: !process.env.HEADFUL,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, locale: 'ru-RU' });
const page = await ctx.newPage();

console.log('goto', URL);
await page.goto(URL, { waitUntil: 'networkidle', timeout: 45000 }).catch(e => console.log('goto warn:', e.message));

// ждём, пока Vaadin дорисует UI
await page.waitForSelector('input, .v-button', { timeout: 30000 }).catch(() => console.log('no inputs/buttons appeared'));
await page.waitForTimeout(2500);

console.log('URL after load:', page.url());
console.log('title:', await page.title());

const inputs = await page.$$eval('input', els => els.map(e => ({
  type: e.type, id: e.id || null, name: e.name || null,
  cls: e.className || null, placeholder: e.placeholder || null,
  aria: e.getAttribute('aria-label') || null,
  visible: !!(e.offsetParent || e.getClientRects().length),
})));
console.log('\n=== INPUTS ===');
console.log(JSON.stringify(inputs, null, 2));

const buttons = await page.$$eval('.v-button, button, [role="button"], .v-nativebutton', els => els.map(e => {
  const cap = e.querySelector('.v-button-caption');
  return {
    text: ((cap ? cap.textContent : e.textContent) || '').trim(),
    cls: e.className || null,
    visible: !!(e.offsetParent || e.getClientRects().length),
  };
}).filter(b => b.text));
console.log('\n=== BUTTONS ===');
console.log(JSON.stringify(buttons, null, 2));

// подписи/лейблы, чтобы понять какое поле логин, какое пароль
const labels = await page.$$eval('.v-caption, label, .v-formlayout-captioncell', els =>
  els.map(e => (e.textContent || '').trim()).filter(Boolean).slice(0, 40));
console.log('\n=== CAPTIONS/LABELS ===');
console.log(JSON.stringify(labels, null, 2));

await page.screenshot({ path: 'probe-login.png', fullPage: true }).catch(() => {});
console.log('\nscreenshot -> server/probe-login.png');

await browser.close();
