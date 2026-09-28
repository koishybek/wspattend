# WSP KBTU — сервер-бот «Отметиться» 24/7

Headless-браузер (Playwright/Chromium) сам логинится в `wsp.kbtu.kz`, сидит на
`RegistrationOnline`, держит сессию живой и **жмёт кнопку, как только она появилась**.
Крутится на сервере — работает при выключенном ноуте, переживает ребут.

## Почему это вообще работает

`wsp.kbtu.kz` имеет **split-horizon DNS**: изнутри кампуса → `192.168.1.52`, снаружи →
публичный `188.127.36.18`. Портал доступен из интернета, поэтому подойдёт **любой VPS**.
Приложение на Vaadin 7 — поэтому нужен настоящий браузер (не «сырые» HTTP-запросы).

Нагрузка на сервер университета минимальная: опрос кнопки идёт **внутри браузера по DOM**
(не запросы на сервер). К серверу KBTU уходит только Vaadin-heartbeat раз в 120с и один
запрос в момент реального клика.

## Что нужно

- Любой VPS с Linux (Ubuntu 22.04+). Хватит **1 vCPU / 2 ГБ RAM**. Chromium ест ~0.5–1 ГБ.
  Дёшево: Hetzner CX22 (~€4/мес), Contabo, Aeza, любой.
- Твой логин/пароль от WSP (вписываются в `.env` **на сервере**, в чат/код не попадают).

---

## Шаг 1. Локально проверить, что логин и клик работают (на своём ПК, ты в кампусе)

```bash
cd server
npm install
npx playwright install chromium
cp .env.example .env
# впиши WSP_LOGIN и WSP_PASSWORD в .env
```

Посмотреть все кнопки на странице после входа (чтобы точно знать текст цели):
```bash
DUMP=1 node bot.mjs          # Windows PowerShell: $env:DUMP=1; node bot.mjs
```
Найди в списке нужную кнопку и при необходимости поправь `TARGET_STEMS` в `.env`.

Прогнать по-настоящему с видимым окном браузера:
```bash
HEADFUL=1 node bot.mjs       # PowerShell: $env:HEADFUL=1; node bot.mjs
```
Дождись в логах `login: успех` → `слежу за кнопкой`. Когда появится кнопка — бот её нажмёт,
пришлёт скрин `clicked-*.png`. Первый логин рендерится ~30с (Vaadin грузит виджеты) — это норм.

---

## Шаг 2. Деплой на VPS через Docker (рекомендуется)

```bash
# на VPS:
sudo apt update && sudo apt install -y docker.io docker-compose-plugin git
# залей папку server на сервер (git clone своего репо, либо scp -r server user@vps:~/wsp-bot)
cd wsp-bot/server        # или куда залил
cp .env.example .env
nano .env                # WSP_LOGIN, WSP_PASSWORD, (по желанию Telegram)

docker compose up -d --build
docker compose logs -f   # смотрим, что залогинился и «слежу за кнопкой»
```

- `restart: unless-stopped` + автозапуск демона Docker → бот сам поднимается после
  ребута сервера и после любых падений.
- Скрины и сохранённая сессия лежат в `server/data/`.

Управление:
```bash
docker compose restart      # перезапуск
docker compose down         # остановить
docker compose up -d --build   # обновить после правок
```

## Шаг 2 (альтернатива). Без Docker — systemd

Смотри [wsp-bot.service](wsp-bot.service): поставить node 20+, `npm install`,
`npx playwright install --with-deps chromium`, положить unit в `/etc/systemd/system/`,
`systemctl enable --now wsp-bot`. Логи: `journalctl -u wsp-bot -f`.

---

## 🆓 Бесплатный вариант — GitHub Actions (ноут не нужен, VPS не нужен)

GitHub сам включает бота к каждой паре по твоему расписанию, он логинится, жмёт кнопку и
шлёт в Telegram. Всё в облаке GitHub, $0. Готовый workflow: [`.github/workflows/wsp-attendance.yml`](../.github/workflows/wsp-attendance.yml),
расписание: [`schedule.json`](schedule.json).

**Подключить (5 минут):**

1. Залить репозиторий на GitHub (ветка `main`):
   ```bash
   git remote add origin https://github.com/<ты>/<репо>.git
   git push -u origin main
   ```
2. Минуты Actions: **публичный** репо — безлимит (но код и расписание видны всем);
   **приватный** — 2000 мин/мес. Хватает, если кнопка появляется на большинстве пар (бот выходит
   сразу после клика). Если кнопки нет — сидит до конца пары и тратит минуты.
3. Вписать секреты: **Settings → Secrets and variables → Actions → New repository secret**:
   - `WSP_LOGIN` = твой логин от WSP (поле «Қолданушы»)
   - `WSP_PASSWORD` = твой пароль
   - (по желанию) `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
4. Проверить: вкладка **Actions → WSP авто-отметка → Run workflow**. В логах должно быть
   `login: успех` → `слежу за кнопкой`. Если да — дальше всё само по расписанию.

**Важно знать:**
- Бесплатный планировщик GitHub может **задержать старт на 5–20 мин** под нагрузкой. Поэтому кроны
  стоят за 5 мин до пары, а бот следит **до конца пары** — окно отметки почти всегда попадает.
  Но 100% гарантии по времени нет. Нужна железобетонность — тогда VPS (см. выше).
- Поменялось расписание → правь `schedule.json` **и** кроны в workflow (время там в **UTC = Алматы − 5ч**).
- GitHub отключает scheduled-workflow после **60 дней без коммитов** в репо (любой push сбрасывает счётчик).
- Логин идёт с серверов GitHub (Azure, США/ЕС). Обычно ок; если портал заблокирует по гео — бери VPS в КЗ.

**Ещё бесплатнее и надёжнее:** [Oracle Cloud Always Free](https://www.oracle.com/cloud/free/) даёт
реальную всегда-включённую VM бесплатно навсегда — туда ставится Docker-вариант (см. выше) и работает
24/7 без ограничений GitHub. Чуть сложнее в настройке аккаунта, но это настоящий бесплатный сервер.

---

## Настройка (`.env`)

| Переменная | Что делает |
|---|---|
| `WSP_LOGIN`, `WSP_PASSWORD` | твои данные входа (обязательно) |
| `TARGET_STEMS` | стем текста кнопки, напр. `отметит,отметь`. Ловит по подстроке |
| `CLICK_ONCE` | `false` — жать каждый раз при появлении (посещаемость на каждой паре); `true` — один раз |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | уведомление «нажал» + скрин в Telegram (по желанию) |
| `POLL_MS` | период опроса DOM, мс (по умолч. 500) |
| `HEADFUL`, `RUN_ONCE`, `DUMP` | режимы отладки |

**Telegram:** создай бота у [@BotFather](https://t.me/BotFather), токен → `TELEGRAM_BOT_TOKEN`;
свой `chat_id` узнай у [@userinfobot](https://t.me/userinfobot) → `TELEGRAM_CHAT_ID`.

## Безопасность

- Пароль хранится только в `.env` на **твоём** сервере. `.env` в `.gitignore` — в git не попадёт.
- Ставь на VPS, к которому имеешь доступ только ты. Это автоматизация **твоего** аккаунта.
- Если сменишь пароль в WSP — поправь `.env` и `docker compose restart`.

## Если что-то не так

- `не смог залогиниться` → проверь логин/пароль в `.env` (и нет ли капчи; смотри `data/login-failed-*.png`).
- Бот не жмёт нужную кнопку → запусти `DUMP=1` и подставь правильный `TARGET_STEMS`.
- Сессия часто слетает → бот сам перелогинивается; смотри логи `docker compose logs -f`.
