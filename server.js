// ================================
// US. — SERVER
// Этап: авторизация + сессии + WebSocket + профиль + дневник + встречи + моменты
// ================================

const express = require("express");
const http = require("http");
const { WebSocketServer } = require("ws");
const Database = require("better-sqlite3");
const crypto = require("crypto");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = 3000;

// ================================
// БАЗА ДАННЫХ
// ================================

const db = new Database("chat.db");

// Включаем внешние ключи (для ON DELETE CASCADE)
db.pragma("foreign_keys = ON");

// Сообщения
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    author TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
`);
// Миграция: добавляем FOREIGN KEY к messages.chat_id
// SQLite не умеет добавлять FK к существующей колонке,
// поэтому удалять сообщения будем вручную — см. API
// (это просто комментарий, никакого кода)
// Пользователи
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL
  )
`);

// Сессии
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
`);

// Дневник (личные записи)
db.exec(`
  CREATE TABLE IF NOT EXISTS diary_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER
  )
`);

// Встречи — общие для группы
db.exec(`
  CREATE TABLE IF NOT EXISTS meetups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    meetup_at INTEGER NOT NULL,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
`);

// Моменты — общий архив группы
db.exec(`
  CREATE TABLE IF NOT EXISTS moments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    text TEXT NOT NULL,
    place TEXT,
    author TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER
  )
`);

// Вложения к моментам (фото, музыка, файлы)
db.exec(`
  CREATE TABLE IF NOT EXISTS moment_attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    moment_id INTEGER NOT NULL,
    url TEXT NOT NULL,
    filename TEXT,
    mime_type TEXT,
    size INTEGER,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (moment_id) REFERENCES moments(id) ON DELETE CASCADE
  )
`);
// Чаты — диалоги (группа + личные)
db.exec(`
  CREATE TABLE IF NOT EXISTS chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    title TEXT,
    created_at INTEGER NOT NULL
  )
`);

// Кто в каком чате
db.exec(`
  CREATE TABLE IF NOT EXISTS chat_members (
    chat_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    PRIMARY KEY (chat_id, username)
  )
`);
// Миграция: добавляем ON DELETE CASCADE к chat_members
const chatMembersSql = db
  .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='chat_members'")
  .get();

if (chatMembersSql && !chatMembersSql.sql.includes("ON DELETE CASCADE")) {
  db.exec(`
    CREATE TABLE chat_members_new (
      chat_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      PRIMARY KEY (chat_id, username),
      FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE CASCADE
    )
  `);

  // Переносим данные
  db.exec(`
    INSERT INTO chat_members_new (chat_id, username)
    SELECT chat_id, username FROM chat_members
  `);

  db.exec("DROP TABLE chat_members");
  db.exec("ALTER TABLE chat_members_new RENAME TO chat_members");

  console.log("✓ chat_members пересоздана с ON DELETE CASCADE");
}
console.log("✓ Таблицы чатов готовы");
// Прочтения сообщений — кто какое сообщение прочитал
db.exec(`
  CREATE TABLE IF NOT EXISTS message_reads (
    message_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    read_at INTEGER NOT NULL,
    PRIMARY KEY (message_id, username)
  )
`);
console.log("✓ База данных готова");

// ================================
// МИГРАЦИИ
// ================================

const userColumns = db.prepare("PRAGMA table_info(users)").all();

if (!userColumns.some((c) => c.name === "nickname")) {
  db.exec("ALTER TABLE users ADD COLUMN nickname TEXT");
  db.exec("UPDATE users SET nickname = username WHERE nickname IS NULL");
  console.log("✓ Добавлена колонка nickname");
}

if (!userColumns.some((c) => c.name === "avatar_url")) {
  db.exec("ALTER TABLE users ADD COLUMN avatar_url TEXT");
  console.log("✓ Добавлена колонка avatar_url");
}

if (!userColumns.some((c) => c.name === "mood_text")) {
  db.exec("ALTER TABLE users ADD COLUMN mood_text TEXT");
  console.log("✓ Добавлена колонка mood_text");
}

if (!userColumns.some((c) => c.name === "mood_updated_at")) {
  db.exec("ALTER TABLE users ADD COLUMN mood_updated_at INTEGER");
  console.log("✓ Добавлена колонка mood_updated_at");
}
if (!userColumns.some((c) => c.name === "avatar_color")) {
  db.exec("ALTER TABLE users ADD COLUMN avatar_color TEXT");
  console.log("✓ Добавлена колонка avatar_color");
}
// Миграция: avatar_url в chats (для групп)
const chatCols = db.prepare("PRAGMA table_info(chats)").all();

if (!chatCols.some((c) => c.name === "avatar_url")) {
  db.exec("ALTER TABLE chats ADD COLUMN avatar_url TEXT");
  console.log("✓ Добавлена колонка avatar_url в chats");
}
if (!userColumns.some((c) => c.name === "birthday")) {
  db.exec("ALTER TABLE users ADD COLUMN birthday TEXT");
  console.log("✓ Добавлена колонка birthday");
}
if (!userColumns.some((c) => c.name === "created_at")) {
  db.exec("ALTER TABLE users ADD COLUMN created_at INTEGER");
  db.exec("UPDATE users SET created_at = ? WHERE created_at IS NULL", [Date.now()]);
  console.log("✓ Добавлена колонка created_at");
}

// ================================
// NOTES & PLANS
// ================================

db.exec(`
  CREATE TABLE IF NOT EXISTS schedule_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    type TEXT NOT NULL,
    text TEXT NOT NULL,
    date TEXT,
    time TEXT,
    repeat TEXT,
    done_at INTEGER,
    done_date TEXT,
    created_at INTEGER NOT NULL
  )
`);
console.log("✓ Таблица schedule_items готова");

// Участники общих планов
db.exec(`
  CREATE TABLE IF NOT EXISTS schedule_members (
    item_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    PRIMARY KEY (item_id, username)
  )
`);
console.log("✓ Таблица schedule_members готова");

// Миграции для reply
const messageColumns = db.prepare("PRAGMA table_info(messages)").all();

if (!messageColumns.some((c) => c.name === "reply_to_id")) {
  db.exec("ALTER TABLE messages ADD COLUMN reply_to_id INTEGER");
  console.log("✓ Добавлена колонка reply_to_id");
}

if (!messageColumns.some((c) => c.name === "reply_to_author")) {
  db.exec("ALTER TABLE messages ADD COLUMN reply_to_author TEXT");
  console.log("✓ Добавлена колонка reply_to_author");
}

if (!messageColumns.some((c) => c.name === "reply_to_text")) {
  db.exec("ALTER TABLE messages ADD COLUMN reply_to_text TEXT");
  console.log("✓ Добавлена колонка reply_to_text");
}
// Колонка chat_id в messages
const messageCols = db.prepare("PRAGMA table_info(messages)").all();

if (!messageCols.some((c) => c.name === "chat_id")) {
  db.exec("ALTER TABLE messages ADD COLUMN chat_id INTEGER");
  console.log("✓ Добавлена колонка chat_id");
}

if (!userColumns.some((c) => c.name === "handle")) {
  db.exec("ALTER TABLE users ADD COLUMN handle TEXT");
  console.log("✓ Добавлена колонка handle");
}
if (!messageColumns.some((c) => c.name === "photo_url")) {
  db.exec("ALTER TABLE messages ADD COLUMN photo_url TEXT");
  console.log("✓ Добавлена колонка photo_url");
}
if (!messageColumns.some((c) => c.name === "video_url")) {
  db.exec("ALTER TABLE messages ADD COLUMN video_url TEXT");
  console.log("✓ Добавлена колонка video_url");
}

if (!messageColumns.some((c) => c.name === "voice_url")) {
  db.exec("ALTER TABLE messages ADD COLUMN voice_url TEXT");
  console.log("✓ Добавлена колонка voice_url");
}

if (!messageColumns.some((c) => c.name === "voice_duration")) {
  db.exec("ALTER TABLE messages ADD COLUMN voice_duration INTEGER");
  console.log("✓ Добавлена колонка voice_duration");
}
// ================================
// ДРУЗЬЯ
// ================================

db.exec(`
  CREATE TABLE IF NOT EXISTS friends (
    user1 TEXT NOT NULL,
    user2 TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user1, user2)
  )
`);

console.log("✓ Таблица friends готова");

// ================================
// СОХРАНЁННЫЕ СООБЩЕНИЯ
// ================================

db.exec(`
  CREATE TABLE IF NOT EXISTS saved_messages (
    username TEXT NOT NULL,
    message_id INTEGER NOT NULL,
    saved_at INTEGER NOT NULL,
    PRIMARY KEY (username, message_id)
  )
`);
console.log("✓ Таблица saved_messages готова");

// Миграция: добавляем initiator в friends
const friendCols = db.prepare("PRAGMA table_info(friends)").all();

if (!friendCols.some((c) => c.name === "initiator")) {
  db.exec("ALTER TABLE friends ADD COLUMN initiator TEXT");
  console.log("✓ Добавлена колонка initiator в friends");
}

// ================================
// ХЕШ ПАРОЛЯ
// ================================

function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}



// ================================
// ЗАПРОСЫ — СООБЩЕНИЯ
// ================================

const insertMessage = db.prepare(
  `INSERT INTO messages (author, text, created_at, reply_to_id, reply_to_author, reply_to_text, chat_id, photo_url, video_url, voice_url, voice_duration)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

const getMessagesByChat = db.prepare(
  `SELECT id, author, text, created_at, reply_to_id, reply_to_author, reply_to_text, chat_id, photo_url, video_url, voice_url, voice_duration
   FROM messages WHERE chat_id = ? ORDER BY id ASC LIMIT 200`
);

const getAllMessages = db.prepare(
  `SELECT id, author, text, created_at, reply_to_id, reply_to_author, reply_to_text, chat_id
   FROM messages ORDER BY id ASC LIMIT 200`
);

// ================================
// ЗАПРОСЫ — ДНЕВНИК
// ================================

const insertDiaryEntry = db.prepare(
  "INSERT INTO diary_entries (username, text, created_at) VALUES (?, ?, ?)"
);

const getDiaryEntries = db.prepare(
  "SELECT id, text, created_at, updated_at FROM diary_entries WHERE username = ? ORDER BY created_at DESC"
);

const getDiaryEntryById = db.prepare(
  "SELECT * FROM diary_entries WHERE id = ? AND username = ?"
);

const updateDiaryEntry = db.prepare(
  "UPDATE diary_entries SET text = ?, updated_at = ? WHERE id = ? AND username = ?"
);

const deleteDiaryEntry = db.prepare(
  "DELETE FROM diary_entries WHERE id = ? AND username = ?"
);

// ================================
// ЗАПРОСЫ — ВСТРЕЧИ
// ================================

const insertMeetup = db.prepare(
  "INSERT INTO meetups (title, meetup_at, created_by, created_at) VALUES (?, ?, ?, ?)"
);

const getLatestMeetup = db.prepare(
  "SELECT * FROM meetups ORDER BY created_at DESC LIMIT 1"
);

// ================================
// ЗАПРОСЫ — МОМЕНТЫ
// ================================

const insertMoment = db.prepare(
  "INSERT INTO moments (type, text, place, author, created_at) VALUES (?, ?, ?, ?, ?)"
);

const getAllMoments = db.prepare(
  "SELECT * FROM moments ORDER BY created_at DESC LIMIT 200"
);

const getMomentById = db.prepare(
  "SELECT * FROM moments WHERE id = ?"
);

const updateMoment = db.prepare(
  "UPDATE moments SET type = ?, text = ?, place = ?, updated_at = ? WHERE id = ?"
);

const deleteMoment = db.prepare(
  "DELETE FROM moments WHERE id = ?"
);

const getAttachmentsByMoment = db.prepare(
  "SELECT * FROM moment_attachments WHERE moment_id = ? ORDER BY id ASC"
);

// ================================
// ЗАПРОСЫ — ДРУЗЬЯ
// ================================

// Составить нормализованную пару (user1 < user2)
function friendPair(a, b) {
  return a < b ? [a, b] : [b, a];
}

const getFriendRow = db.prepare(
  "SELECT * FROM friends WHERE user1 = ? AND user2 = ?"
);

const insertFriend = db.prepare(
  "INSERT INTO friends (user1, user2, status, initiator, created_at) VALUES (?, ?, ?, ?, ?)"
);

const updateFriendStatus = db.prepare(
  "UPDATE friends SET status = ? WHERE user1 = ? AND user2 = ?"
);

const deleteFriendRow = db.prepare(
  "DELETE FROM friends WHERE user1 = ? AND user2 = ?"
);

// Все связи с моим участием
const getMyFriendRows = db.prepare(
  "SELECT * FROM friends WHERE user1 = ? OR user2 = ?"
);

// ================================
// ЗАПРОСЫ — СОХРАНЁННЫЕ
// ================================

const insertSaved = db.prepare(
  "INSERT OR IGNORE INTO saved_messages (username, message_id, saved_at) VALUES (?, ?, ?)"
);

const deleteSaved = db.prepare(
  "DELETE FROM saved_messages WHERE username = ? AND message_id = ?"
);

const getSavedByUser = db.prepare(
  "SELECT message_id, saved_at FROM saved_messages WHERE username = ? ORDER BY saved_at DESC"
);

const getSavedMessageFull = db.prepare(
  `SELECT m.id, m.author, m.text, m.created_at, m.chat_id, m.photo_url, m.reply_to_id, m.reply_to_author, m.reply_to_text
   FROM messages m WHERE m.id = ?`
);

// ================================
// ЗАПРОСЫ — NOTES & PLANS
// ================================

const insertScheduleItem = db.prepare(`
  INSERT INTO schedule_items (username, type, text, date, time, repeat, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const getScheduleItemById = db.prepare(
  "SELECT * FROM schedule_items WHERE id = ?"
);

const getScheduleItemsByUser = db.prepare(
  "SELECT * FROM schedule_items WHERE username = ? ORDER BY date ASC, time ASC, created_at ASC"
);

const deleteScheduleItem = db.prepare(
  "DELETE FROM schedule_items WHERE id = ? AND username = ?"
);

const updateScheduleItemDone = db.prepare(
  "UPDATE schedule_items SET done_at = ?, done_date = ? WHERE id = ? AND username = ?"
);

const updateScheduleItem = db.prepare(`
  UPDATE schedule_items
  SET type = ?, text = ?, date = ?, time = ?, repeat = ?
  WHERE id = ? AND username = ?
`);

const deleteDoneScheduleItems = db.prepare(
  "DELETE FROM schedule_items WHERE username = ? AND done_date IS NOT NULL"
);
// Участники плана
const insertScheduleMember = db.prepare(
  "INSERT OR IGNORE INTO schedule_members (item_id, username) VALUES (?, ?)"
);

const getScheduleMembers = db.prepare(
  "SELECT username FROM schedule_members WHERE item_id = ?"
);

const deleteScheduleMembers = db.prepare(
  "DELETE FROM schedule_members WHERE item_id = ?"
);

// Планы, где я участник (но не автор)
const getSharedItemsForUser = db.prepare(
  `SELECT s.* FROM schedule_items s
   JOIN schedule_members m ON m.item_id = s.id
   WHERE m.username = ? AND s.username != ?
   ORDER BY s.date ASC, s.time ASC`
);

// ================================
// ЗАПРОСЫ — ПРОЧТЕНИЯ СООБЩЕНИЙ
// ================================

const insertRead = db.prepare(
  "INSERT OR IGNORE INTO message_reads (message_id, username, read_at) VALUES (?, ?, ?)"
);

const getReadersByMessage = db.prepare(
  "SELECT username FROM message_reads WHERE message_id = ?"
);

const getReadsForMessages = db.prepare(
  `SELECT message_id, username FROM message_reads
   WHERE message_id IN (SELECT value FROM json_each(?))`
);

// ================================
// ЗАПРОСЫ — УДАЛЕНИЕ СООБЩЕНИЙ
// ================================

const getMessageById = db.prepare(
  "SELECT id, author, chat_id FROM messages WHERE id = ?"
);
const deleteMessageById = db.prepare("DELETE FROM messages WHERE id = ?");
const deleteReadsByMessage = db.prepare(
  "DELETE FROM message_reads WHERE message_id = ?"
);

// ================================
// ЗАПРОСЫ — УДАЛЕНИЕ ЧАТОВ
// ================================

const deleteMessagesByChat = db.prepare("DELETE FROM messages WHERE chat_id = ?");
const deleteReadsByChat = db.prepare(
  "DELETE FROM message_reads WHERE message_id IN (SELECT id FROM messages WHERE chat_id = ?)"
);
const deleteChatById = db.prepare("DELETE FROM chats WHERE id = ?");
const getChatById = db.prepare("SELECT * FROM chats WHERE id = ?");
// ================================
// EXPRESS — MIDDLEWARE
// ================================

app.use(express.json());
app.use(express.static(__dirname));
// ================================
// ЗАГРУЗКА ФАЙЛОВ
// ================================

const uploadsDir = path.join(__dirname, "uploads");

// Создаём папку, если нет
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    const name = crypto.randomBytes(16).toString("hex") + ext;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 МБ
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Только изображения"));
    }
  },
});
// Загрузка видео (до 50 МБ)
const uploadVideo = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("video/")) {
      cb(null, true);
    } else {
      cb(new Error("Только видео"));
    }
  },
});

// Загрузка голосовых (до 10 МБ)
const uploadVoice = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    // Разрешаем всё, что похоже на аудио или видео (браузеры пишут в webm/ogg/mp4)
    if (
      file.mimetype.startsWith("audio/") || 
      file.mimetype.startsWith("video/") || 
      file.mimetype === "application/octet-stream"
    ) {
      cb(null, true);
    } else {
      cb(new Error("Только аудио"));
    }
  },
});

// Раздача загруженных файлов
app.use("/uploads", express.static(uploadsDir));

// Проверка: имеет ли пользователь доступ к чату
function isUserInChat(username, chatId) {
  const row = db
    .prepare("SELECT 1 FROM chat_members WHERE chat_id = ? AND username = ?")
    .get(chatId, username);
  return !!row;
}

// Получить всех участников чата
function getChatMembers(chatId) {
  return db
    .prepare("SELECT username FROM chat_members WHERE chat_id = ?")
    .all(chatId)
    .map((r) => r.username);
}

// ================================
// API — СООБЩЕНИЯ
// ================================

app.get("/api/messages", (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Нет токена" });

  const session = db
    .prepare("SELECT * FROM sessions WHERE token = ?")
    .get(token);
  if (!session) return res.status(401).json({ error: "Сессия не найдена" });

  const chatId = Number(req.query.chat_id);

  if (!chatId) {
    return res.status(400).json({ error: "Не указан chat_id" });
  }

  if (!isUserInChat(session.username, chatId)) {
    return res.status(403).json({ error: "Нет доступа к чату" });
  }

  const messages = getMessagesByChat.all(chatId);
  res.json({ messages });
});

// ================================
// API — АВТОРИЗАЦИЯ
// ================================

// ================================
// Случайный цвет для аватара нового пользователя
// ================================

function randomColor() {
  const colors = [
    "#c7d9e2", "#e8d99e", "#e2cece", "#c5d9d0",
    "#d3cfe2", "#ead0bf", "#cfd5b8", "#d5a89a",
    "#b5cfe0", "#c9b5a3", "#b8b8b8", "#8fa8ba",
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

// ================================
// API — РЕГИСТРАЦИЯ
// ================================

app.post("/api/register", (req, res) => {
  const { username, nickname, password } = req.body;

  // Валидация
  if (!username || !nickname || !password) {
    return res.status(400).json({ error: "Заполни все поля" });
  }

  let user = String(username).trim().toLowerCase();
  if (user.startsWith("@")) user = user.slice(1);

  if (user.length < 3 || user.length > 20) {
    return res.status(400).json({ error: "Username 3–20 символов" });
  }

  if (!/^[a-z0-9_]+$/.test(user)) {
    return res.status(400).json({ error: "Только латиница, цифры и _" });
  }

  const nick = String(nickname).trim();
  if (!nick || nick.length > 24) {
    return res.status(400).json({ error: "Имя 1–24 символа" });
  }

  if (String(password).length < 6) {
    return res.status(400).json({ error: "Пароль минимум 6 символов" });
  }

  // Проверка: username или handle заняты?
  const taken = db
    .prepare("SELECT 1 FROM users WHERE username = ? OR handle = ?")
    .get(user, user);

  if (taken) {
    return res.status(409).json({ error: "Этот username занят" });
  }

  // Создаём
  const color = randomColor();

  db.prepare(
    `INSERT INTO users 
     (username, nickname, handle, password_hash, avatar_color, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(user, nick, user, hashPassword(password), color, Date.now());

  // Автологин после регистрации
  const token = crypto.randomBytes(32).toString("hex");

  db.prepare(
    "INSERT INTO sessions (token, username, created_at) VALUES (?, ?, ?)"
  ).run(token, user, Date.now());

  res.json({ token, username: user, nickname: nick });
});

// Логин
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "Введи логин и пароль" });
  }

  const usernameClean = String(username || "").trim().toLowerCase().replace(/^@/, "");

const user = db
  .prepare("SELECT * FROM users WHERE username = ? OR handle = ?")
  .get(usernameClean, usernameClean);

  if (!user) {
    return res.status(401).json({ error: "Неверный пользователь" });
  }

  if (user.password_hash !== hashPassword(password)) {
    return res.status(401).json({ error: "Неверный пароль" });
  }

  const token = crypto.randomBytes(32).toString("hex");

  db.prepare(
    "INSERT INTO sessions (token, username, created_at) VALUES (?, ?, ?)"
  ).run(token, username, Date.now());

  res.json({ token, username });
});

// Кто я?
app.get("/api/me", (req, res) => {
  const token = req.headers.authorization;

  if (!token) {
    return res.status(401).json({ error: "Нет токена" });
  }

  const session = db
    .prepare("SELECT * FROM sessions WHERE token = ?")
    .get(token);

  if (!session) {
    return res.status(401).json({ error: "Сессия не найдена" });
  }

  const user = db
  .prepare(
    "SELECT username, nickname, handle, avatar_url, avatar_color, birthday FROM users WHERE username = ?"
  )
  .get(session.username);

res.json(user);
});

// ================================
// API — ПРОФИЛЬ
// ================================

app.get("/api/profile", (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Нет токена" });

  const session = db
    .prepare("SELECT * FROM sessions WHERE token = ?")
    .get(token);
  if (!session) return res.status(401).json({ error: "Сессия не найдена" });

  const user = db
    .prepare(
      "SELECT username, nickname, avatar_url FROM users WHERE username = ?"
    )
    .get(session.username);

  res.json(user);
});

// Обновить никнейм
app.put("/api/profile/nickname", (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Нет токена" });

  const session = db
    .prepare("SELECT * FROM sessions WHERE token = ?")
    .get(token);
  if (!session) return res.status(401).json({ error: "Сессия не найдена" });

  const nickname = String(req.body.nickname || "").trim();

  if (!nickname) {
    return res.status(400).json({ error: "Ник не может быть пустым" });
  }

  if (nickname.length > 24) {
    return res.status(400).json({ error: "Слишком длинный ник (макс. 24)" });
  }

  db.prepare("UPDATE users SET nickname = ? WHERE username = ?").run(
    nickname,
    session.username
  );

  res.json({ nickname });
});

// ================================
// Смена @username (handle)
// ================================

app.put("/api/profile/handle", (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Нет токена" });

  const session = db
    .prepare("SELECT * FROM sessions WHERE token = ?")
    .get(token);
  if (!session) return res.status(401).json({ error: "Сессия не найдена" });

  let handle = String(req.body.handle || "").trim().toLowerCase();

  // Убираем @ если пользователь написал его сам
  if (handle.startsWith("@")) handle = handle.slice(1);

  if (!handle) {
    return res.status(400).json({ error: "Username не может быть пустым" });
  }

  if (handle.length < 3) {
    return res.status(400).json({ error: "Минимум 3 символа" });
  }

  if (handle.length > 20) {
    return res.status(400).json({ error: "Максимум 20 символов" });
  }

  // Только буквы, цифры, подчёркивание
  if (!/^[a-z0-9_]+$/.test(handle)) {
    return res.status(400).json({
      error: "Только латиница, цифры и _",
    });
  }

  // Проверка: не занят ли другим
  const taken = db
    .prepare("SELECT 1 FROM users WHERE handle = ? AND username != ?")
    .get(handle, session.username);

  if (taken) {
    return res.status(409).json({ error: "Этот username уже занят" });
  }

  db.prepare("UPDATE users SET handle = ? WHERE username = ?").run(
    handle,
    session.username
  );

  res.json({ handle });
});

// ================================
// API — ПОЛЬЗОВАТЕЛИ
// ================================

app.get("/api/users", (req, res) => {
  const users = db
    .prepare(
      "SELECT username, nickname, handle, avatar_url, avatar_color, birthday FROM users"
    )
    .all();
  res.json({ users });
});

// ================================
// API — ЗАГРУЗКА ФОТО
// ================================

app.post("/api/upload/photo", upload.single("photo"), (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Нет токена" });

  const session = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token);
  if (!session) return res.status(401).json({ error: "Сессия не найдена" });

  if (!req.file) {
    return res.status(400).json({ error: "Файл не загружен" });
  }

  const chatId = Number(req.body.chat_id);
  if (!chatId) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: "Не указан chat_id" });
  }

  if (!isUserInChat(session.username, chatId)) {
    fs.unlink(req.file.path, () => {});
    return res.status(403).json({ error: "Нет доступа" });
  }

  res.json({ url: "/uploads/" + req.file.filename });
});

// Загрузка видео
app.post("/api/upload/video", uploadVideo.single("video"), (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Нет токена" });

  const session = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token);
  if (!session) return res.status(401).json({ error: "Сессия не найдена" });

  if (!req.file) {
    return res.status(400).json({ error: "Файл не загружен" });
  }

  const chatId = Number(req.body.chat_id);
  if (!chatId) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: "Не указан chat_id" });
  }

  if (!isUserInChat(session.username, chatId)) {
    fs.unlink(req.file.path, () => {});
    return res.status(403).json({ error: "Нет доступа" });
  }

  res.json({ url: "/uploads/" + req.file.filename });
});

// Загрузка голосового
app.post("/api/upload/voice", uploadVoice.single("voice"), (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Нет токена" });

  const session = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token);
  if (!session) return res.status(401).json({ error: "Сессия не найдена" });

  if (!req.file) {
    return res.status(400).json({ error: "Файл не загружен" });
  }

  const chatId = Number(req.body.chat_id);
  if (!chatId) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: "Не указан chat_id" });
  }

  if (!isUserInChat(session.username, chatId)) {
    fs.unlink(req.file.path, () => {});
    return res.status(403).json({ error: "Нет доступа" });
  }

  res.json({ url: "/uploads/" + req.file.filename });
});

// Загрузка личной аватарки
app.post("/api/upload/avatar", upload.single("avatar"), (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Нет токена" });

  const session = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token);
  if (!session) return res.status(401).json({ error: "Сессия не найдена" });

  if (!req.file) {
    return res.status(400).json({ error: "Файл не загружен" });
  }

  const url = "/uploads/" + req.file.filename;

  // Удаляем старую аватарку с диска (если была)
  const oldUser = db.prepare("SELECT avatar_url FROM users WHERE username = ?").get(session.username);
  if (oldUser && oldUser.avatar_url && oldUser.avatar_url.startsWith("/uploads/")) {
    const oldPath = path.join(__dirname, oldUser.avatar_url);
    fs.unlink(oldPath, () => {});
  }

  db.prepare("UPDATE users SET avatar_url = ? WHERE username = ?")
    .run(url, session.username);

  // Оповещаем всех — аватарка обновилась
  broadcast({
    type: "user_updated",
    username: session.username,
    avatar_url: url,
  });

  res.json({ url });
});

// Удалить личную аватарку
app.delete("/api/profile/avatar", (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Нет токена" });

  const session = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token);
  if (!session) return res.status(401).json({ error: "Сессия не найдена" });

  const user = db.prepare("SELECT avatar_url FROM users WHERE username = ?").get(session.username);

  if (user && user.avatar_url && user.avatar_url.startsWith("/uploads/")) {
    const oldPath = path.join(__dirname, user.avatar_url);
    fs.unlink(oldPath, () => {});
  }

  db.prepare("UPDATE users SET avatar_url = NULL WHERE username = ?").run(session.username);

  broadcast({
    type: "user_updated",
    username: session.username,
    avatar_url: null,
  });

  res.json({ ok: true });
});

// Удалить аватарку группы
app.delete("/api/chats/:id/avatar", (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Нет токена" });

  const session = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token);
  if (!session) return res.status(401).json({ error: "Сессия не найдена" });

  const chatId = Number(req.params.id);
  if (!chatId) return res.status(400).json({ error: "Неверный id" });

  const chat = getChatById.get(chatId);
  if (!chat) return res.status(404).json({ error: "Чат не найден" });

  if (chat.type !== "group") return res.status(400).json({ error: "Не группа" });
  if (!isUserInChat(session.username, chatId)) return res.status(403).json({ error: "Нет доступа" });

  if (chat.avatar_url && chat.avatar_url.startsWith("/uploads/")) {
    const oldPath = path.join(__dirname, chat.avatar_url);
    fs.unlink(oldPath, () => {});
  }

  db.prepare("UPDATE chats SET avatar_url = NULL WHERE id = ?").run(chatId);

  broadcastToChat(chatId, {
    type: "chat_updated",
    chat_id: chatId,
  });

  res.json({ ok: true });
});

// Загрузка аватарки группы
app.post("/api/chats/:id/avatar", upload.single("avatar"), (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Нет токена" });

  const session = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token);
  if (!session) return res.status(401).json({ error: "Сессия не найдена" });

  const chatId = Number(req.params.id);
  if (!chatId) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: "Неверный id" });
  }

  const chat = getChatById.get(chatId);
  if (!chat) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(404).json({ error: "Чат не найден" });
  }

  if (chat.type !== "group") {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: "Это не группа" });
  }

  if (!isUserInChat(session.username, chatId)) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(403).json({ error: "Нет доступа" });
  }

  if (!req.file) {
    return res.status(400).json({ error: "Файл не загружен" });
  }

  const url = "/uploads/" + req.file.filename;

  // Удаляем старую
  if (chat.avatar_url && chat.avatar_url.startsWith("/uploads/")) {
    const oldPath = path.join(__dirname, chat.avatar_url);
    fs.unlink(oldPath, () => {});
  }

  db.prepare("UPDATE chats SET avatar_url = ? WHERE id = ?").run(url, chatId);

  // Оповещаем участников
  broadcastToChat(chatId, {
    type: "chat_updated",
    chat_id: chatId,
  });

  res.json({ url });
});

// ================================
// API — ЧАТЫ
// ================================

// Получить список чатов текущего пользователя
app.get("/api/chats", (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Нет токена" });

  const session = db
    .prepare("SELECT * FROM sessions WHERE token = ?")
    .get(token);
  if (!session) return res.status(401).json({ error: "Сессия не найдена" });

  // Все чаты, где я участник
  const chats = db
  .prepare(
    `SELECT c.id, c.type, c.title, c.avatar_url, c.created_at
     FROM chats c
     JOIN chat_members m ON m.chat_id = c.id
     WHERE m.username = ?
     ORDER BY c.created_at ASC`
  )
  .all(session.username);

  // Для каждого чата — последнее сообщение и участники
  const result = chats.map((chat) => {
    const lastMsg = db
      .prepare(
        `SELECT id, author, text, created_at FROM messages
         WHERE chat_id = ? ORDER BY created_at DESC LIMIT 1`
      )
      .get(chat.id);

    const members = getChatMembers(chat.id);

    return {
  id: chat.id,
  type: chat.type,
  title: chat.title,
  avatar_url: chat.avatar_url || null,
  members,
  lastMessage: lastMsg || null,
};
  });

  // Сортируем: свежие сверху, группа всегда сверху
  result.sort((a, b) => {
    const aTime = a.lastMessage ? a.lastMessage.created_at : 0;
    const bTime = b.lastMessage ? b.lastMessage.created_at : 0;

    if (a.type === "group" && b.type !== "group") return -1;
    if (b.type === "group" && a.type !== "group") return 1;

    return bTime - aTime;
  });

  res.json({ chats: result });
});

// Создать групповой чат
app.post("/api/chats/group", (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Нет токена" });

  const session = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token);
  if (!session) return res.status(401).json({ error: "Сессия не найдена" });

  const title = String(req.body.title || "").trim();
  const members = Array.isArray(req.body.members) ? req.body.members : [];

  if (!title) {
    return res.status(400).json({ error: "Напиши название группы" });
  }

  if (title.length > 60) {
    return res.status(400).json({ error: "Слишком длинное название" });
  }

  // Все участники: я + приглашённые (без дублей)
  const allMembers = [session.username];
  for (const m of members) {
    const u = String(m || "").trim();
    if (u && u !== session.username && !allMembers.includes(u)) {
      allMembers.push(u);
    }
  }

  if (allMembers.length < 2) {
    return res.status(400).json({ error: "Добавь хотя бы одного человека" });
  }

  // Проверим, что все пользователи существуют
  for (const username of allMembers) {
    const exists = db.prepare("SELECT 1 FROM users WHERE username = ?").get(username);
    if (!exists) {
      return res.status(404).json({ error: `Пользователь ${username} не найден` });
    }
  }

  // Создаём чат
  const info = db
    .prepare("INSERT INTO chats (type, title, created_at) VALUES (?, ?, ?)")
    .run("group", title, Date.now());

  const chatId = info.lastInsertRowid;

  const insertMember = db.prepare(
    "INSERT OR IGNORE INTO chat_members (chat_id, username) VALUES (?, ?)"
  );

  for (const username of allMembers) {
    insertMember.run(chatId, username);
  }

  const chat = {
    id: chatId,
    type: "group",
    title,
    members: allMembers,
    lastMessage: null,
  };

  // Оповестим всех участников, чтобы обновили список
  for (const username of allMembers) {
    wss.clients.forEach((client) => {
      if (client.readyState === 1 && client.username === username) {
        client.send(JSON.stringify({ type: "chat_created", chat }));
      }
    });
  }

  res.json({ chat });
});

// Создать личный чат с пользователем
app.post("/api/chats", (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Нет токена" });

  const session = db
    .prepare("SELECT * FROM sessions WHERE token = ?")
    .get(token);
  if (!session) return res.status(401).json({ error: "Сессия не найдена" });

  const withUser = String(req.body.with || "").trim();

  if (!withUser) {
    return res.status(400).json({ error: "Не указан пользователь" });
  }

  if (withUser === session.username) {
    return res.status(400).json({ error: "Нельзя создать чат с собой" });
  }

  const exists = db
    .prepare("SELECT 1 FROM users WHERE username = ?")
    .get(withUser);
  if (!exists) {
    return res.status(404).json({ error: "Пользователь не найден" });
  }

  // Ищем существующий личный чат
  const existing = db
    .prepare(
      `SELECT c.id, c.type, c.title, c.created_at
       FROM chats c
       JOIN chat_members m1 ON m1.chat_id = c.id AND m1.username = ?
       JOIN chat_members m2 ON m2.chat_id = c.id AND m2.username = ?
       WHERE c.type = 'direct'
       LIMIT 1`
    )
    .get(session.username, withUser);

  if (existing) {
    const members = getChatMembers(existing.id);
    return res.json({
      chat: {
        id: existing.id,
        type: existing.type,
        title: existing.title,
        members,
        lastMessage: null,
      },
    });
  }

  // Создаём новый
  const info = db
    .prepare("INSERT INTO chats (type, title, created_at) VALUES (?, ?, ?)")
    .run("direct", null, Date.now());

  const chatId = info.lastInsertRowid;

  const insertMember = db.prepare(
    "INSERT OR IGNORE INTO chat_members (chat_id, username) VALUES (?, ?)"
  );
  insertMember.run(chatId, session.username);
  insertMember.run(chatId, withUser);

  res.json({
    chat: {
      id: chatId,
      type: "direct",
      title: null,
      members: [session.username, withUser],
      lastMessage: null,
    },
  });
});
// Добавить участника в группу
app.post("/api/chats/:id/members", (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Нет токена" });

  const session = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token);
  if (!session) return res.status(401).json({ error: "Сессия не найдена" });

  const chatId = Number(req.params.id);
  if (!chatId) return res.status(400).json({ error: "Неверный id" });

  const chat = getChatById.get(chatId);
  if (!chat) return res.status(404).json({ error: "Чат не найден" });

  if (chat.type !== "group") {
    return res.status(400).json({ error: "Это не группа" });
  }

  // Я в группе?
  if (!isUserInChat(session.username, chatId)) {
    return res.status(403).json({ error: "Нет доступа" });
  }

  const target = String(req.body.username || "").trim();
  if (!target) return res.status(400).json({ error: "Не указан пользователь" });

  // Уже в группе?
  if (isUserInChat(target, chatId)) {
    return res.status(400).json({ error: "Уже в группе" });
  }

  // Проверим, что пользователь существует
  const exists = db.prepare("SELECT 1 FROM users WHERE username = ?").get(target);
  if (!exists) return res.status(404).json({ error: "Пользователь не найден" });

  // Добавляем
  db.prepare("INSERT INTO chat_members (chat_id, username) VALUES (?, ?)")
    .run(chatId, target);

  // Оповещаем всех участников
  broadcastToChat(chatId, {
    type: "chat_updated",
    chat_id: chatId,
  });

  // И нового участника — тоже (у него теперь есть этот чат)
  notifyUser(target, {
    type: "chat_updated",
    chat_id: chatId,
  });

  res.json({ ok: true });
});
// Удалить участника из группы
app.delete("/api/chats/:id/members/:username", (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Нет токена" });

  const session = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token);
  if (!session) return res.status(401).json({ error: "Сессия не найдена" });

  const chatId = Number(req.params.id);
  if (!chatId) return res.status(400).json({ error: "Неверный id" });

  const target = String(req.params.username || "").trim();
  if (!target) return res.status(400).json({ error: "Не указан пользователь" });

  const chat = getChatById.get(chatId);
  if (!chat) return res.status(404).json({ error: "Чат не найден" });

  if (chat.type !== "group") {
    return res.status(400).json({ error: "Это не группа" });
  }

  if (!isUserInChat(session.username, chatId)) {
    return res.status(403).json({ error: "Нет доступа" });
  }

  // Себя нельзя удалять через этот эндпоинт (см. «выйти из группы»)
  if (target === session.username) {
    return res.status(400).json({ error: "Используй «выйти из группы»" });
  }

  // В группе?
  if (!isUserInChat(target, chatId)) {
    return res.status(404).json({ error: "Пользователь не в группе" });
  }

  // Удаляем
  db.prepare("DELETE FROM chat_members WHERE chat_id = ? AND username = ?")
    .run(chatId, target);

  // Оповещаем
  broadcastToChat(chatId, {
    type: "chat_updated",
    chat_id: chatId,
  });

  // Удалённому — чтобы он убрал чат из списка
  notifyUser(target, {
    type: "chat_updated",
    chat_id: chatId,
  });

  res.json({ ok: true });
});
// Переименовать группу
app.put("/api/chats/:id/title", (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Нет токена" });

  const session = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token);
  if (!session) return res.status(401).json({ error: "Сессия не найдена" });

  const chatId = Number(req.params.id);
  if (!chatId) return res.status(400).json({ error: "Неверный id" });

  const title = String(req.body.title || "").trim();
  if (!title) return res.status(400).json({ error: "Название не может быть пустым" });
  if (title.length > 60) return res.status(400).json({ error: "Слишком длинное" });

  const chat = getChatById.get(chatId);
  if (!chat) return res.status(404).json({ error: "Чат не найден" });

  if (chat.type !== "group") {
    return res.status(400).json({ error: "Это не группа" });
  }

  if (!isUserInChat(session.username, chatId)) {
    return res.status(403).json({ error: "Нет доступа" });
  }

  db.prepare("UPDATE chats SET title = ? WHERE id = ?").run(title, chatId);

  broadcastToChat(chatId, {
    type: "chat_updated",
    chat_id: chatId,
  });

  res.json({ ok: true });
});
// Выйти из группы
app.post("/api/chats/:id/leave", (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Нет токена" });

  const session = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token);
  if (!session) return res.status(401).json({ error: "Сессия не найдена" });

  const chatId = Number(req.params.id);
  if (!chatId) return res.status(400).json({ error: "Неверный id" });

  const chat = getChatById.get(chatId);
  if (!chat) return res.status(404).json({ error: "Чат не найден" });

  if (chat.type !== "group") {
    return res.status(400).json({ error: "Это не группа" });
  }

  if (!isUserInChat(session.username, chatId)) {
    return res.status(403).json({ error: "Нет доступа" });
  }

  // Удаляем себя
  db.prepare("DELETE FROM chat_members WHERE chat_id = ? AND username = ?")
    .run(chatId, session.username);

  // Оповещаем оставшихся
  broadcastToChat(chatId, {
    type: "chat_updated",
    chat_id: chatId,
  });

  // Себе — чтобы убрал чат из списка
  notifyUser(session.username, {
    type: "chat_updated",
    chat_id: chatId,
  });

  res.json({ ok: true });
});
// Удалить чат
app.delete("/api/chats/:id", (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Нет токена" });

  const session = db
    .prepare("SELECT * FROM sessions WHERE token = ?")
    .get(token);
  if (!session) return res.status(401).json({ error: "Сессия не найдена" });

  const chatId = Number(req.params.id);
  if (!chatId) return res.status(400).json({ error: "Неверный id" });

  const chat = getChatById.get(chatId);
  if (!chat) {
    return res.status(404).json({ error: "Чат не найден" });
  }

  // Проверка: это группа?
  if (chat.type === "group") {
    return res.status(403).json({ error: "Групповой чат нельзя удалить" });
  }

  // Проверка: я участник?
  if (!isUserInChat(session.username, chatId)) {
    return res.status(403).json({ error: "Нет доступа к чату" });
  }

  // Запоминаем участников, чтобы разослать им уведомление
  const members = getChatMembers(chatId);

  // Удаляем в правильном порядке
  deleteReadsByChat.run(chatId);
  deleteMessagesByChat.run(chatId);
  deleteChatById.run(chatId);
  // chat_members удалятся каскадом

  // Рассылаем всем участникам: чат удалён
  for (const username of members) {
    wss.clients.forEach((client) => {
      if (client.readyState === 1 && client.username === username) {
        client.send(JSON.stringify({ type: "chat_deleted", chat_id: chatId }));
      }
    });
  }

  res.json({ ok: true });
});
// ================================
// API — НАСТРОЕНИЕ
// ================================

app.get("/api/moods", (req, res) => {
  const moods = db
    .prepare(
      `SELECT username, nickname, mood_text, mood_updated_at
       FROM users
       WHERE mood_text IS NOT NULL AND mood_text != ''
       ORDER BY mood_updated_at DESC`
    )
    .all();
  res.json({ moods });
});

app.put("/api/profile/mood", (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Нет токена" });

  const session = db
    .prepare("SELECT * FROM sessions WHERE token = ?")
    .get(token);
  if (!session) return res.status(401).json({ error: "Сессия не найдена" });

  const moodText = String(req.body.mood_text || "").trim();

  if (moodText.length > 80) {
    return res.status(400).json({ error: "Слишком длинное (макс. 80)" });
  }

  db.prepare(
    "UPDATE users SET mood_text = ?, mood_updated_at = ? WHERE username = ?"
  ).run(moodText || null, Date.now(), session.username);

  res.json({
    mood_text: moodText || null,
    mood_updated_at: Date.now(),
  });
});
// Обновить цвет аватара
app.put("/api/profile/color", (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Нет токена" });

  const session = db
    .prepare("SELECT * FROM sessions WHERE token = ?")
    .get(token);
  if (!session) return res.status(401).json({ error: "Сессия не найдена" });

  const color = String(req.body.avatar_color || "").trim();

  // Проверка: должен быть hex типа #xxxxxx
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    return res.status(400).json({ error: "Неверный формат цвета" });
  }

  db.prepare("UPDATE users SET avatar_color = ? WHERE username = ?").run(
    color,
    session.username
  );

  res.json({ avatar_color: color });
});
// Обновить день рождения
app.put("/api/profile/birthday", (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Нет токена" });

  const session = db
    .prepare("SELECT * FROM sessions WHERE token = ?")
    .get(token);
  if (!session) return res.status(401).json({ error: "Сессия не найдена" });

  const birthday = String(req.body.birthday || "").trim();

  // Пустая строка — удаляем ДР
  if (birthday === "") {
    db.prepare("UPDATE users SET birthday = NULL WHERE username = ?").run(
      session.username
    );
    return res.json({ birthday: null });
  }

  // Проверка: MM-DD
  if (!/^\d{2}-\d{2}$/.test(birthday)) {
    return res.status(400).json({ error: "Формат должен быть ММ-ДД" });
  }

  // Проверка, что месяц и день валидны
  const [mm, dd] = birthday.split("-").map(Number);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) {
    return res.status(400).json({ error: "Неверная дата" });
  }

  db.prepare("UPDATE users SET birthday = ? WHERE username = ?").run(
    birthday,
    session.username
  );

  res.json({ birthday });
});
// ================================
// API — ДНЕВНИК
// ================================

// Получить свои записи
app.get("/api/diary", (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Нет токена" });

  const session = db
    .prepare("SELECT * FROM sessions WHERE token = ?")
    .get(token);
  if (!session) return res.status(401).json({ error: "Сессия не найдена" });

  const entries = getDiaryEntries.all(session.username);
  res.json({ entries });
});

// Создать запись
app.post("/api/diary", (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Нет токена" });

  const session = db
    .prepare("SELECT * FROM sessions WHERE token = ?")
    .get(token);
  if (!session) return res.status(401).json({ error: "Сессия не найдена" });

  const text = String(req.body.text || "").trim();

  if (!text) {
    return res.status(400).json({ error: "Запись не может быть пустой" });
  }

  if (text.length > 5000) {
    return res.status(400).json({ error: "Слишком длинная (макс. 5000)" });
  }

  const createdAt = Date.now();
  const info = insertDiaryEntry.run(session.username, text, createdAt);

  res.json({
    entry: {
      id: info.lastInsertRowid,
      text,
      created_at: createdAt,
      updated_at: null,
    },
  });
});

// Редактировать запись
app.put("/api/diary/:id", (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Нет токена" });

  const session = db
    .prepare("SELECT * FROM sessions WHERE token = ?")
    .get(token);
  if (!session) return res.status(401).json({ error: "Сессия не найдена" });

  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "Неверный id" });

  const text = String(req.body.text || "").trim();
  if (!text) {
    return res.status(400).json({ error: "Запись не может быть пустой" });
  }

  if (text.length > 5000) {
    return res.status(400).json({ error: "Слишком длинная (макс. 5000)" });
  }

  const existing = getDiaryEntryById.get(id, session.username);
  if (!existing) {
    return res.status(404).json({ error: "Запись не найдена" });
  }

  const updatedAt = Date.now();
  updateDiaryEntry.run(text, updatedAt, id, session.username);

  res.json({
    entry: {
      id,
      text,
      created_at: existing.created_at,
      updated_at: updatedAt,
    },
  });
});

// Удалить запись
app.delete("/api/diary/:id", (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Нет токена" });

  const session = db
    .prepare("SELECT * FROM sessions WHERE token = ?")
    .get(token);
  if (!session) return res.status(401).json({ error: "Сессия не найдена" });

  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "Неверный id" });

  const existing = getDiaryEntryById.get(id, session.username);
  if (!existing) {
    return res.status(404).json({ error: "Запись не найдена" });
  }

  deleteDiaryEntry.run(id, session.username);
  res.json({ ok: true });
});

// ================================
// API — ВСТРЕЧИ
// ================================

// Получить ближайшую встречу
app.get("/api/meetup", (req, res) => {
  const meetup = getLatestMeetup.get();
  res.json({ meetup: meetup || null });
});

// Установить встречу
app.post("/api/meetup", (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Нет токена" });

  const session = db
    .prepare("SELECT * FROM sessions WHERE token = ?")
    .get(token);
  if (!session) return res.status(401).json({ error: "Сессия не найдена" });

  const title = String(req.body.title || "").trim();
  const meetupAt = Number(req.body.meetup_at);

  if (!title) {
    return res.status(400).json({ error: "Название обязательно" });
  }

  if (title.length > 60) {
    return res.status(400).json({ error: "Слишком длинное название" });
  }

  if (!meetupAt || isNaN(meetupAt)) {
    return res.status(400).json({ error: "Неверная дата" });
  }

  const createdAt = Date.now();
  const info = insertMeetup.run(title, meetupAt, session.username, createdAt);

  res.json({
    meetup: {
      id: info.lastInsertRowid,
      title,
      meetup_at: meetupAt,
      created_by: session.username,
      created_at: createdAt,
    },
  });
});

// ================================
// API — МОМЕНТЫ
// ================================

// Допустимые типы моментов
const MOMENT_TYPES = ["репетиция", "прогулка", "идея", "поездка", "заметка"];

// Получить все моменты
app.get("/api/moments", (req, res) => {
  const moments = getAllMoments.all();

  const withAttachments = moments.map((m) => ({
    ...m,
    attachments: getAttachmentsByMoment.all(m.id),
  }));

  res.json({ moments: withAttachments });
});

// Создать момент
app.post("/api/moments", (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Нет токена" });

  const session = db
    .prepare("SELECT * FROM sessions WHERE token = ?")
    .get(token);
  if (!session) return res.status(401).json({ error: "Сессия не найдена" });

  const type = String(req.body.type || "").trim();
  const text = String(req.body.text || "").trim();
  const place = String(req.body.place || "").trim();

  if (!MOMENT_TYPES.includes(type)) {
    return res.status(400).json({ error: "Неверный тип" });
  }

  if (!text) {
    return res.status(400).json({ error: "Текст не может быть пустым" });
  }

  if (text.length > 2000) {
    return res.status(400).json({ error: "Слишком длинный текст (макс. 2000)" });
  }

  if (place.length > 100) {
    return res.status(400).json({ error: "Слишком длинное место (макс. 100)" });
  }

  const createdAt = Date.now();
  const info = insertMoment.run(
    type,
    text,
    place || null,
    session.username,
    createdAt
  );

  const saved = {
    id: info.lastInsertRowid,
    type,
    text,
    place: place || null,
    author: session.username,
    created_at: createdAt,
    updated_at: null,
    attachments: [],
  };

  res.json({ moment: saved });
});

// Редактировать момент (только свой)
app.put("/api/moments/:id", (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Нет токена" });

  const session = db
    .prepare("SELECT * FROM sessions WHERE token = ?")
    .get(token);
  if (!session) return res.status(401).json({ error: "Сессия не найдена" });

  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "Неверный id" });

  const existing = getMomentById.get(id);
  if (!existing) {
    return res.status(404).json({ error: "Момент не найден" });
  }

  if (existing.author !== session.username) {
    return res.status(403).json({ error: "Можно редактировать только свои моменты" });
  }

  const type = String(req.body.type || "").trim();
  const text = String(req.body.text || "").trim();
  const place = String(req.body.place || "").trim();

  if (!MOMENT_TYPES.includes(type)) {
    return res.status(400).json({ error: "Неверный тип" });
  }

  if (!text) {
    return res.status(400).json({ error: "Текст не может быть пустым" });
  }

  if (text.length > 2000) {
    return res.status(400).json({ error: "Слишком длинный текст (макс. 2000)" });
  }

  if (place.length > 100) {
    return res.status(400).json({ error: "Слишком длинное место (макс. 100)" });
  }

  const updatedAt = Date.now();
  updateMoment.run(type, text, place || null, updatedAt, id);

  const updated = {
    id,
    type,
    text,
    place: place || null,
    author: existing.author,
    created_at: existing.created_at,
    updated_at: updatedAt,
    attachments: getAttachmentsByMoment.all(id),
  };

  res.json({ moment: updated });
});

// Удалить момент (только свой)
app.delete("/api/moments/:id", (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Нет токена" });

  const session = db
    .prepare("SELECT * FROM sessions WHERE token = ?")
    .get(token);
  if (!session) return res.status(401).json({ error: "Сессия не найдена" });

  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "Неверный id" });

  const existing = getMomentById.get(id);
  if (!existing) {
    return res.status(404).json({ error: "Момент не найден" });
  }

  if (existing.author !== session.username) {
    return res.status(403).json({ error: "Можно удалять только свои моменты" });
  }

  deleteMoment.run(id);
  res.json({ ok: true });
});

// ================================
// API — УДАЛЕНИЕ СООБЩЕНИЯ
// ================================

app.delete("/api/messages/:id", (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Нет токена" });

  const session = db
    .prepare("SELECT * FROM sessions WHERE token = ?")
    .get(token);
  if (!session) return res.status(401).json({ error: "Сессия не найдена" });

  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "Неверный id" });

  const msg = getMessageById.get(id);
  if (!msg) {
    return res.status(404).json({ error: "Сообщение не найдено" });
  }

  // Удалять можно только свои
  if (msg.author !== session.username) {
    return res.status(403).json({ error: "Можно удалять только свои сообщения" });
  }

  // Проверка доступа к чату
  if (!isUserInChat(session.username, msg.chat_id)) {
    return res.status(403).json({ error: "Нет доступа" });
  }

  // Удаляем
  deleteReadsByMessage.run(id);
  deleteMessageById.run(id);

  // Рассылаем всем в чате: сообщение удалено
  broadcastToChat(msg.chat_id, {
    type: "message_deleted",
    message_id: id,
    chat_id: msg.chat_id,
  });

  res.json({ ok: true });
});

// ================================
// API — ДРУЗЬЯ
// ================================

// Поиск пользователей по @username
app.get("/api/users/search", (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Нет токена" });

  const session = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token);
  if (!session) return res.status(401).json({ error: "Сессия не найдена" });

  const q = String(req.query.q || "").trim().toLowerCase().replace(/^@/, "");
  if (q.length < 2) {
    return res.json({ users: [] });
  }

  const users = db
    .prepare(
      `SELECT username, nickname, handle, avatar_color
       FROM users
       WHERE (LOWER(handle) LIKE ? OR LOWER(username) LIKE ?)
       AND username != ?
       LIMIT 20`
    )
    .all(`%${q}%`, `%${q}%`, session.username);

  res.json({ users });
});

// Список друзей и заявок
app.get("/api/friends", (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Нет токена" });

  const session = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token);
  if (!session) return res.status(401).json({ error: "Сессия не найдена" });

  const me = session.username;

  const rows = getMyFriendRows.all(me, me);

  const friends = [];
  const incoming = [];  // мне отправили заявку
  const outgoing = [];  // я отправил

    for (const row of rows) {
    const other = row.user1 === me ? row.user2 : row.user1;

    const u = db
      .prepare("SELECT username, nickname, handle, avatar_color FROM users WHERE username = ?")
      .get(other);

    if (!u) continue;

    if (row.status === "accepted") {
      friends.push(u);
    } else if (row.status === "pending") {
      const from = row.initiator || row.user1;

      if (from === me) {
        outgoing.push(u);
      } else {
        incoming.push(u);
      }
    }
  }

  res.json({ friends, incoming, outgoing });
});

// Отправить заявку
app.post("/api/friends/request", (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Нет токена" });

  const session = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token);
  if (!session) return res.status(401).json({ error: "Сессия не найдена" });

  const target = String(req.body.username || "").trim();
  if (!target) return res.status(400).json({ error: "Не указан пользователь" });

  if (target === session.username) {
    return res.status(400).json({ error: "Нельзя добавить себя" });
  }

  // Проверим, что пользователь существует
  const exists = db.prepare("SELECT 1 FROM users WHERE username = ?").get(target);
  if (!exists) return res.status(404).json({ error: "Пользователь не найден" });

  const [a, b] = friendPair(session.username, target);

  const existing = getFriendRow.get(a, b);
  if (existing) {
    if (existing.status === "accepted") {
      return res.status(400).json({ error: "Вы уже друзья" });
    }
    if (existing.status === "pending") {
      return res.status(400).json({ error: "Заявка уже существует" });
    }
  }

  insertFriend.run(a, b, "pending", session.username, Date.now());

   notifyUser(target, { type: "friend_request" });

  res.json({ ok: true });
});

// Принять заявку
app.post("/api/friends/accept", (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Нет токена" });

  const session = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token);
  if (!session) return res.status(401).json({ error: "Сессия не найдена" });

  const target = String(req.body.username || "").trim();
  if (!target) return res.status(400).json({ error: "Не указан пользователь" });

  const [a, b] = friendPair(session.username, target);
  const row = getFriendRow.get(a, b);

  if (!row || row.status !== "pending") {
    return res.status(404).json({ error: "Заявка не найдена" });
  }

    updateFriendStatus.run("accepted", a, b);

  // Оповестить обе стороны
  notifyUser(session.username, { type: "friend_accepted", by: target });
  notifyUser(target, { type: "friend_accepted", by: session.username });

  res.json({ ok: true });
});

// Отклонить / удалить заявку
app.post("/api/friends/remove", (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Нет токена" });

  const session = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token);
  if (!session) return res.status(401).json({ error: "Сессия не найдена" });

  const target = String(req.body.username || "").trim();
  if (!target) return res.status(400).json({ error: "Не указан пользователь" });

  const [a, b] = friendPair(session.username, target);

  deleteFriendRow.run(a, b);

  res.json({ ok: true });
});

// ================================
// API — СОХРАНЁННЫЕ СООБЩЕНИЯ
// ================================

// Получить все сохранённые сообщения
app.get("/api/saved", (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Нет токена" });

  const session = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token);
  if (!session) return res.status(401).json({ error: "Сессия не найдена" });

  const rows = getSavedByUser.all(session.username);

  const items = [];
  for (const row of rows) {
    const msg = getSavedMessageFull.get(row.message_id);
    if (!msg) continue;
    items.push({
      ...msg,
      saved_at: row.saved_at,
    });
  }

  res.json({ items });
});

// Сохранить сообщение
app.post("/api/saved", (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Нет токена" });

  const session = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token);
  if (!session) return res.status(401).json({ error: "Сессия не найдена" });

  const messageId = Number(req.body.message_id);
  if (!messageId) return res.status(400).json({ error: "Не указан message_id" });

  // Проверим, что сообщение существует и я участник его чата
  const msg = getMessageById.get(messageId);
  if (!msg) return res.status(404).json({ error: "Сообщение не найдено" });

  if (!isUserInChat(session.username, msg.chat_id)) {
    return res.status(403).json({ error: "Нет доступа" });
  }

  insertSaved.run(session.username, messageId, Date.now());

  res.json({ ok: true });
});

// Удалить из сохранённых
app.delete("/api/saved/:messageId", (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Нет токена" });

  const session = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token);
  if (!session) return res.status(401).json({ error: "Сессия не найдена" });

  const messageId = Number(req.params.messageId);
  if (!messageId) return res.status(400).json({ error: "Неверный id" });

  deleteSaved.run(session.username, messageId);

  res.json({ ok: true });
});

// ================================
// API — NOTES & PLANS
// ================================

// Получить все записи пользователя
app.get("/api/schedule", (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Нет токена" });

  const session = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token);
  if (!session) return res.status(401).json({ error: "Сессия не найдена" });

  // Мои планы
  const own = getScheduleItemsByUser.all(session.username);

  // Общие, где я участник (но не автор)
  const shared = getSharedItemsForUser.all(session.username, session.username);

  // Для каждого — список участников
  const enrich = (item) => ({
    ...item,
    members: getScheduleMembers.all(item.id).map((r) => r.username),
  });

  res.json({
    items: [...own.map(enrich), ...shared.map(enrich)],
  });
});

// Создать запись
app.post("/api/schedule", (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Нет токена" });

  const session = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token);
  if (!session) return res.status(401).json({ error: "Сессия не найдена" });

  const type = String(req.body.type || "").trim();
  const text = String(req.body.text || "").trim();
  const date = req.body.date ? String(req.body.date).trim() : null;
  const time = req.body.time ? String(req.body.time).trim() : null;
  const repeat = req.body.repeat ? String(req.body.repeat).trim() : null;

  // Участники (друзья)
  const members = Array.isArray(req.body.members)
    ? req.body.members.map((m) => String(m).trim()).filter(Boolean)
    : [];

  // Валидация
  if (!["todo", "reminder", "event", "note"].includes(type)) {
    return res.status(400).json({ error: "Неверный тип" });
  }

  if (!text) {
    return res.status(400).json({ error: "Текст не может быть пустым" });
  }

  if (text.length > 200) {
    return res.status(400).json({ error: "Слишком длинный текст" });
  }

  if ((type === "todo" || type === "event") && !date) {
    return res.status(400).json({ error: "Укажи дату" });
  }

  if (type === "reminder" && !repeat) {
    return res.status(400).json({ error: "Укажи повтор" });
  }

  const now = Date.now();
  const info = insertScheduleItem.run(
    session.username, type, text, date, time, repeat, now
  );

  const itemId = info.lastInsertRowid;

  // Добавляем участников
  const addedMembers = [];
  for (const m of members) {
    // Проверка: друг ли он
    const [a, b] = friendPair(session.username, m);
    const friendRow = getFriendRow.get(a, b);

    if (!friendRow || friendRow.status !== "accepted") {
      continue; // не друг — пропускаем
    }

    insertScheduleMember.run(itemId, m);
    addedMembers.push(m);
  }

  const saved = {
    id: itemId,
    username: session.username,
    type,
    text,
    date,
    time,
    repeat,
    done_at: null,
    done_date: null,
    created_at: now,
    members: addedMembers,
  };

  // Рассылаем участникам
  for (const m of addedMembers) {
    notifyUser(m, { type: "plan_shared", plan: saved });
  }

  res.json({ item: saved });
});

// Редактировать запись
app.put("/api/schedule/:id", (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Нет токена" });

  const session = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token);
  if (!session) return res.status(401).json({ error: "Сессия не найдена" });

  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "Неверный id" });

  const item = getScheduleItemById.get(id);
  if (!item || item.username !== session.username) {
    return res.status(404).json({ error: "Не найдено" });
  }

  const type = String(req.body.type || "").trim();
  const text = String(req.body.text || "").trim();
  const date = req.body.date ? String(req.body.date).trim() : null;
  const time = req.body.time ? String(req.body.time).trim() : null;
  const repeat = req.body.repeat ? String(req.body.repeat).trim() : null;

  if (!["todo", "reminder", "event", "note"].includes(type)) {
    return res.status(400).json({ error: "Неверный тип" });
  }

  if (!text) {
    return res.status(400).json({ error: "Текст не может быть пустым" });
  }

  if (text.length > 200) {
    return res.status(400).json({ error: "Слишком длинный текст (макс. 200)" });
  }

  if ((type === "todo" || type === "event") && !date) {
    return res.status(400).json({ error: "Укажи дату" });
  }

  if (type === "reminder" && !repeat) {
    return res.status(400).json({ error: "Укажи, как часто повторять" });
  }

    updateScheduleItem.run(
    type,
    text,
    type === "note" ? null : date,
    type === "note" ? null : time,
    type === "reminder" ? repeat : null,
    id,
    session.username
  );

  // Обновляем участников
  const members = Array.isArray(req.body.members)
    ? req.body.members.map((m) => String(m).trim()).filter(Boolean)
    : [];

  deleteScheduleMembers.run(id);

  const addedMembers = [];
  for (const m of members) {
    const [a, b] = friendPair(session.username, m);
    const friendRow = getFriendRow.get(a, b);
    if (!friendRow || friendRow.status !== "accepted") continue;
    insertScheduleMember.run(id, m);
    addedMembers.push(m);
  }

  const updated = getScheduleItemById.get(id);
  updated.members = addedMembers;

  // Рассылаем обновления
  for (const m of addedMembers) {
    notifyUser(m, { type: "plan_shared", plan: updated });
  }

  res.json({ item: updated });
});

// Переключить «выполнено»
app.put("/api/schedule/:id/toggle", (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Нет токена" });

  const session = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token);
  if (!session) return res.status(401).json({ error: "Сессия не найдена" });

  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "Неверный id" });

  const item = getScheduleItemById.get(id);
  if (!item || item.username !== session.username) {
    return res.status(404).json({ error: "Не найдено" });
  }

  const today = new Date().toISOString().slice(0, 10);

  // Если уже выполнено сегодня — снимаем
  if (item.done_date === today) {
    db.prepare(
      "UPDATE schedule_items SET done_at = NULL, done_date = NULL WHERE id = ?"
    ).run(id);
  } else {
    // Иначе отмечаем
    updateScheduleItemDone.run(Date.now(), today, id, session.username);
  }

  const updated = getScheduleItemById.get(id);
  res.json({ item: updated });
});

// Очистить все выполненные
app.delete("/api/schedule/done/all", (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Нет токена" });

  const session = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token);
  if (!session) return res.status(401).json({ error: "Сессия не найдена" });

  const info = deleteDoneScheduleItems.run(session.username);
  res.json({ ok: true, deleted: info.changes });
});

// Удалить
app.delete("/api/schedule/:id", (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Нет токена" });

  const session = db.prepare("SELECT * FROM sessions WHERE token = ?").get(token);
  if (!session) return res.status(401).json({ error: "Сессия не найдена" });

  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "Неверный id" });

  const item = getScheduleItemById.get(id);
  if (!item || item.username !== session.username) {
    return res.status(404).json({ error: "Не найдено" });
  }

  deleteScheduleItem.run(id, session.username);
  res.json({ ok: true });
});

// ================================
// API — ПРОЧТЕНИЕ СООБЩЕНИЙ
// ================================

app.post("/api/messages/read", (req, res) => {
  const token = req.headers.authorization;
  if (!token) return res.status(401).json({ error: "Нет токена" });

  const session = db
    .prepare("SELECT * FROM sessions WHERE token = ?")
    .get(token);
  if (!session) return res.status(401).json({ error: "Сессия не найдена" });

  const ids = Array.isArray(req.body.message_ids) ? req.body.message_ids : [];
  if (ids.length === 0) {
    return res.json({ ok: true, marked: [] });
  }

  const now = Date.now();
  const marked = [];

  for (const id of ids) {
    const numId = Number(id);
    if (!numId) continue;

    // Проверяем, что сообщение существует и не наше
    const msg = db.prepare("SELECT author FROM messages WHERE id = ?").get(numId);
    if (!msg) continue;
    if (msg.author === session.username) continue; // свои не отмечаем

    // Проверяем, что ещё не отмечено
    const existing = db
      .prepare("SELECT 1 FROM message_reads WHERE message_id = ? AND username = ?")
      .get(numId, session.username);

    if (existing) continue;

    insertRead.run(numId, session.username, now);
    marked.push(numId);
  }

  // Если что-то отметили — рассылаем всем
  if (marked.length > 0) {
  // Найдём chat_id этих сообщений (они все из одного чата)
  const firstMsg = db
    .prepare("SELECT chat_id FROM messages WHERE id = ?")
    .get(marked[0]);

  if (firstMsg && firstMsg.chat_id) {
    broadcastToChat(firstMsg.chat_id, {
      type: "read_update",
      message_ids: marked,
      reader: session.username,
      chat_id: firstMsg.chat_id,
    });
  }
}

  res.json({ ok: true, marked });
});
// ================================
// HTTP + WEBSOCKET
// ================================

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

function broadcast(payload) {
  const data = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(data);
    }
  });
}
// Рассылка только участникам чата
function broadcastToChat(chatId, payload) {
  const data = JSON.stringify(payload);
  const members = getChatMembers(chatId);

  wss.clients.forEach((client) => {
    if (
      client.readyState === 1 &&
      client.username &&
      members.includes(client.username)
    ) {
      client.send(data);
    }
  });
}
function getOnlineUsers() {
  const set = new Set();
  wss.clients.forEach((client) => {
    if (client.readyState === 1 && client.username) {
      set.add(client.username);
    }
  });
  return Array.from(set);
}

function broadcastOnline() {
  broadcast({ type: "online", users: getOnlineUsers() });
}

// Отправить сообщение конкретному пользователю
function notifyUser(username, payload) {
  const data = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState === 1 && client.username === username) {
      client.send(data);
    }
  });
}

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get("token");

  if (!token) {
    console.log("× Подключение без токена — закрываем");
    ws.close();
    return;
  }

  const session = db
    .prepare("SELECT * FROM sessions WHERE token = ?")
    .get(token);

  if (!session) {
    console.log("× Неверный токен — закрываем");
    ws.close();
    return;
  }

  ws.username = session.username;
  console.log(`✓ ${ws.username} подключился`);

  broadcastOnline();

  // Обогащаем каждое сообщение — список тех, кто его прочитал
const messagesWithReads = getAllMessages.all().map((msg) => {
  const readers = getReadersByMessage.all(msg.id).map((r) => r.username);
  return { ...msg, read_by: readers };
});

  // Отправляем историю группового чата по умолчанию
// ws.send(
//   JSON.stringify({
//     type: "history",
//     chat_id: GROUP_CHAT_ID,
//     messages: getMessagesByChat.all(GROUP_CHAT_ID),
//   })
// );

    ws.on("message", (raw) => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    // ─── Новое сообщение ───
        if (data.type === "message") {
  const text = String(data.text || "").trim();
  const photoUrl = data.photo_url ? String(data.photo_url).trim() : null;
  const videoUrl = data.video_url ? String(data.video_url).trim() : null;
  const voiceUrl = data.voice_url ? String(data.voice_url).trim() : null;
  const voiceDuration = data.voice_duration ? Number(data.voice_duration) : null;

  // Если нет ни текста, ни какого-либо вложения — выход
  if (!text && !photoUrl && !videoUrl && !voiceUrl) return;

      const chatId = Number(data.chat_id);
      if (!chatId) return;

      if (!isUserInChat(ws.username, chatId)) {
        return;
      }

      // Обработка reply
      let replyToId = null;
      let replyToAuthor = null;
      let replyToText = null;

      if (data.reply_to_id) {
  const original = db
    .prepare("SELECT id, author, text, chat_id, photo_url, video_url, voice_url FROM messages WHERE id = ?")
    .get(data.reply_to_id);

  if (original && original.chat_id === chatId) {
    replyToId = original.id;
    replyToAuthor = original.author;
    
    let textToQuote = original.text || "";
    
    // Если текста нет, подставляем иконку медиа
    if (!textToQuote) {
      if (original.photo_url) textToQuote = "📷 фото";
      else if (original.video_url) textToQuote = "🎥 видео";
      else if (original.voice_url) textToQuote = "🎤 голосовое";
    }

    replyToText = textToQuote.length > 100
      ? textToQuote.slice(0, 100) + "…"
      : textToQuote;
  }
}

            const createdAt = Date.now();
const info = insertMessage.run(
  ws.username,
  text || "",
  createdAt,
  replyToId,
  replyToAuthor,
  replyToText,
  chatId,
  photoUrl,
  videoUrl,
  voiceUrl,
  voiceDuration
);

      const saved = {
  id: info.lastInsertRowid,
  author: ws.username,
  text: text || "",
  created_at: createdAt,
  reply_to_id: replyToId,
  reply_to_author: replyToAuthor,
  reply_to_text: replyToText,
  chat_id: chatId,
  photo_url: photoUrl,
  video_url: videoUrl,
  voice_url: voiceUrl,
  voice_duration: voiceDuration,
  read_by: [],
};

      broadcastToChat(chatId, { type: "message", message: saved });
    }

    // ─── Typing ───
    if (data.type === "typing") {
      const chatId = Number(data.chat_id);
      if (!chatId) return;

      if (!isUserInChat(ws.username, chatId)) {
        return;
      }

      const payload = JSON.stringify({
        type: "typing",
        username: ws.username,
        chat_id: chatId,
      });

      const members = getChatMembers(chatId);

      wss.clients.forEach((client) => {
        if (
          client.readyState === 1 &&
          client.username &&
          members.includes(client.username) &&
          client !== ws
        ) {
          client.send(payload);
        }
      });
    }
  });

  // ─── Отключение клиента ───
  ws.on("close", () => {
    console.log(`× ${ws.username} отключился`);
    broadcastOnline();
  });
});

 
// ================================
// ЗАПУСК
// ================================

server.listen(PORT, '0.0.0.0', () => {
  console.log(`✓ Сервер запущен: http://localhost:${PORT}`);
});
