// Проверка поведения combobox-логина: удерживает ли текст после ввода/blur, появляется ли выпадашка.
import { chromium } from 'playwright';
const URL = process.env.PROBE_URL || 'https://wsp.kbtu.kz/RegistrationOnline';
const b = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const p = await (await b.newContext({ ignoreHTTPSErrors: true, locale: 'ru-RU' })).newPage();
await p.goto(URL, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
await p.waitForSelector('input.v-filterselect-input', { timeout: 30000 });
await p.waitForTimeout(1500);

const user = p.locator('input.v-filterselect-input');
await user.click();
await user.pressSequentially('testuser123', { delay: 60 });
await p.waitForTimeout(1200);
const popup = await p.$('.v-filterselect-suggestpopup');
console.log('suggest popup visible after typing:', !!popup);
if (popup) {
  const items = await p.$$eval('.v-filterselect-suggestpopup td span, .v-filterselect-suggestpopup .gwt-MenuItem',
    els => els.map(e => e.textContent.trim()).slice(0, 10));
  console.log('popup items:', JSON.stringify(items));
}
const valAfterType = await user.inputValue();
console.log('username value right after type:', JSON.stringify(valAfterType));

// blur -> в пароль
await p.locator('input[type=password]').click();
await p.waitForTimeout(800);
const valAfterBlur = await user.inputValue();
console.log('username value AFTER blur:', JSON.stringify(valAfterBlur));
console.log('CLEARED ON BLUR:', valAfterType && !valAfterBlur);

await p.screenshot({ path: 'probe-fill.png' }).catch(() => {});
await b.close();
