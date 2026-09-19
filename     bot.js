const https = require("https");
const http = require("http");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHANNEL = process.env.TELEGRAM_CHANNEL_USERNAME || "@LesRekaClub";
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";

if (!TOKEN) {
  console.error("ERROR: TELEGRAM_BOT_TOKEN is not set");
  process.exit(1);
}

const API = `https://api.telegram.org/bot${TOKEN}`;
let offset = 0;
let lastPostSlot = "";

const menu = {
  keyboard: [
    [{ text: "🎣 Рыбалка сегодня" }, { text: "🗺 Места" }],
    [{ text: "🪱 Советы" }, { text: "🦌 Охота" }],
    [{ text: "📰 Новости" }, { text: "🤖 Помощник" }]
  ],
  resize_keyboard: true
};

function request(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;

    const req = lib.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: options.method || "GET",
      headers: options.headers || {}
    }, res => {
      let data = "";
      res.on("data", x => data += x);
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });

    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function tg(method, data = {}) {
  return request(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  }, JSON.stringify(data));
}

async function send(chat, text) {
  return tg("sendMessage", {
    chat_id: chat,
    text,
    parse_mode: "HTML",
    reply_markup: menu
  });
}

async function getUpdates() {
  return tg("getUpdates", {
    offset,
    timeout: 25,
    allowed_updates: ["message"]
  });
}

function clean(str) {
  return String(str || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

async function rss(query) {
  const url =
    "https://news.google.com/rss/search?q=" +
    encodeURIComponent(query) +
    "&hl=ru&gl=RU&ceid=RU:ru";

  const data = await request(url);
  const xml = String(data);

  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
    .slice(0, 5)
    .map(m => {
      const x = m[1];
      const title = clean(x.match(/<title>([\s\S]*?)<\/title>/)?.[1]);
      const link = clean(x.match(/<link>([\s\S]*?)<\/link>/)?.[1]);
      const description = clean(
        x.match(/<description>([\s\S]*?)<\/description>/)?.[1]
      );
      return { title, link, description };
    })
    .filter(x => x.title);

  return items;
}

async function news() {
  const items = await rss("рыбалка охота Россия");
  if (!items.length) return "📰 Свежих материалов сейчас не найдено.";

  return "📰 <b>Последние материалы</b>\n\n" +
    items.slice(0, 3).map((x, i) =>
      `${i + 1}. <b>${x.title}</b>\n${x.link}`
    ).join("\n\n");
}

async function answer(text) {
  const t = text.toLowerCase();

  if (t.includes("рыбалка")) {
    return `🎣 <b>Рыбалка сегодня</b>

Проверь погоду, давление и ветер перед выездом.

Для мирной рыбы:
• червь
• опарыш
• кукуруза
• хлеб

Для хищника:
• спиннинг
• блёсны
• воблеры

Если скажешь водоём и рыбу — подберу конкретную тактику.`;
  }

  if (t.includes("места")) {
    return `🗺 <b>Места</b>

Могу подобрать места для рыбалки по твоему району.

Напиши:
• город/район
• какую рыбу ищешь
• берег или лодка`;
  }

  if (t.includes("совет")) {
    return `🪱 <b>Совет рыболову</b>

Не начинай сразу с большого количества прикормки. Сначала проверь глубину и активность рыбы, затем постепенно докармливай точку.`;
  }

  if (t.includes("охот")) {
    return `🦌 <b>Охота</b>

Могу помочь с экипировкой, подготовкой лагеря, ориентированием и общими правилами безопасного поведения на природе.

Для конкретного вида дичи напиши название.`;
  }

  if (t.includes("новост")) return news();

  return `🤖 <b>Помощник «Лес и река»</b>

Спроси меня про:
🎣 рыбалку
🗺 места
🪱 снасти и наживки
🦌 охоту
🏕 лагерь

Например: «На что ловить карася сегодня?»`;
}

async function handleMessage(m) {
  const chat = m.chat?.id;
  const text = m.text || "";

  if (!chat) return;

  if (text === "/start" || text === "/help") {
    await send(chat,
      `🌲 <b>Лес и река</b>

Добро пожаловать в наш клуб!

Выбирай раздел в меню ниже 👇`
    );
    return;
  }

  const reply = await answer(text);
  await send(chat, reply);
}

async function poll() {
  try {
    const result = await getUpdates();

    if (result.ok && Array.isArray(result.result)) {
      for (const update of result.result) {
        offset = update.update_id + 1;

        try {
          await handleMessage(update.message);
        } catch (e) {
          console.error("Message error:", e.message);
        }
      }
    }
  } catch (e) {
    console.error("Polling error:", e.message);
    await new Promise(r => setTimeout(r, 3000));
  }
}

function moscowSlot() {
  const now = new Date();

  const parts = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(now);

  const hour = Number(parts.find(x => x.type === "hour").value);
  const minute = Number(parts.find(x => x.type === "minute").value);

  const slots = [0, 3, 6, 9, 12, 15, 18];

  if (minute !== 0) return null;
  if (!slots.includes(hour)) return null;

  return `${hour}:${minute}`;
}

async function autopost() {
  const slot = moscowSlot();
  if (!slot || slot === lastPostSlot) return;

  lastPostSlot = slot;

  let text;

  if ([0, 6, 12].includes(Number(slot.split(":")[0]))) {
    const items = await rss("рыбалка охота Россия");
    if (items.length) {
      const x = items[0];
      text = `📰 <b>${x.title}</b>\n\n${x.description || ""}\n\n${x.link}`;
    }
  }

  if (!text) {
    const posts = [
      "🎣 <b>Совет дня</b>\nПеред рыбалкой проверь ветер и давление. Эти параметры часто заметно влияют на активность рыбы.",
      "🪱 <b>Наживка дня</b>\nЧервь и опарыш остаются универсальными вариантами для многих мирных рыб.",
      "🏕 <b>Лагерь</b>\nПеред тем как разводить огонь, убедись, что место и условия позволяют делать это безопасно.",
      "🎣 <b>Рыболовный совет</b>\nЕсли поклёвок нет, сначала измени глубину и точку ловли, а не только наживку.",
      "🦌 <b>Лесной совет</b>\nВсегда сообщай близким маршрут и примерное время возвращения перед поездкой в лес."
    ];

    text = posts[Math.floor(Math.random() * posts.length)];
  }

  const result = await tg("sendMessage", {
    chat_id: CHANNEL,
    text,
    parse_mode: "HTML"
  });

  console.log("Autopost:", result.ok ? "OK" : result.description);
}

async function main() {
  console.log("🌲 Лес и река starting...");
  console.log("Channel:", CHANNEL);

  await tg("deleteWebhook", { drop_pending_updates: false });

  while (true) {
    await poll();
    await autopost();
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});