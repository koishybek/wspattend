// Будильник для бота. Крон GitHub бесплатный и ненадёжный (может опоздать или вообще не
// сработать), а Cloudflare Cron срабатывает по минутам. Каждые 5 минут проверяем, не пора ли
// запускать бота, и запускаем его через GitHub API (workflow_dispatch, mode=schedule).

// Начало блока пар минус 25 минут, в UTC (Алматы = UTC+5). День недели: 0 = Вс … 6 = Сб.
// Держать в синхроне с server/schedule.json и кронами в .github/workflows/wsp-attendance.yml.
const STARTS_UTC = [
  [1, '06:35'], // Пн 11:35 → 12:00–15:00
  [1, '10:35'], // Пн 15:35 → 16:00–19:00
  [2, '02:35'], // Вт 07:35 → 08:00–10:00
  [2, '07:35'], // Вт 12:35 → 13:00–14:00
  [3, '08:35'], // Ср 13:35 → 14:00–18:00
  [5, '03:35'], // Пт 08:35 → 09:00–12:00
  [5, '08:35'], // Пт 13:35 → 14:00–15:00
  [0, '03:35'], // Вс 08:35 → 09:00–10:00
];
const WINDOW_MIN = 10; // два тика по 5 минут: второй вызов — страховка, дубль встанет в очередь и выйдет сам

export function isDue(date) {
  const dow = date.getUTCDay();
  const now = date.getUTCHours() * 60 + date.getUTCMinutes();
  return STARTS_UTC.some(([d, t]) => {
    const [h, m] = t.split(':').map(Number);
    const start = h * 60 + m;
    return d === dow && now >= start && now < start + WINDOW_MIN;
  });
}

async function dispatch(env) {
  const res = await fetch(`https://api.github.com/repos/${env.REPO}/actions/workflows/wsp-attendance.yml/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.GH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'wsp-alarm',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ ref: 'main', inputs: { mode: 'schedule' } }),
  });
  if (res.status !== 204) throw new Error(`dispatch ${res.status}: ${await res.text()}`);
  console.log('dispatch ok');
}

export default {
  async scheduled(event, env, ctx) {
    if (!isDue(new Date(event.scheduledTime))) return;
    ctx.waitUntil(dispatch(env).catch(async (e) => {
      console.error('первая попытка:', e.message);
      await new Promise((r) => setTimeout(r, 20000));
      await dispatch(env);
    }));
  },
  async fetch() {
    return new Response('wsp-alarm ok');
  },
};
