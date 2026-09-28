# Образ Playwright с уже вшитым Chromium и системными зависимостями.
# Версия базового образа ДОЛЖНА совпадать с версией playwright в package.json (1.63.0).
FROM mcr.microsoft.com/playwright:v1.63.0-jammy

WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY bot.mjs ./
# сюда монтируем .env и папку для скринов (см. docker-compose.yml)

CMD ["node", "bot.mjs"]
