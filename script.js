// ================================
// ТЕМА (применяем сразу, до всего)
// ================================

const savedTheme = localStorage.getItem("us_theme");
if (savedTheme === "dark") {
  document.body.classList.add("dark");
}

// ================================
// АВТОРИЗАЦИЯ
// ================================

let authToken = localStorage.getItem("us_token") || null;
let currentUser = null;
let currentNickname = null;
// Глобальное состояние непрочитанных
let unreadByChat = {};
// Состояние записи голосового
let mediaRecorder = null;
let recordedChunks = [];
let recordingStartTime = 0;
let recordingTimerInterval = null;
let pendingVoiceBlob = null;
let pendingVoiceDuration = 0;
// ================================
// ПОЛЬЗОВАТЕЛИ И НИКИ
// ================================

let usersMap = {};
let userHandlesMap = {};
let userColorsMap = {};
let userAvatarsMap = {};  
let userBirthdaysMap = {};
let lastOnlineUsers = [];

let currentAvatarColor = "#c7d9e2";
let currentBirthday = null;
let currentHandle = null;
let currentAvatarUrl = null;

function getNickname(username) {
  return usersMap[username] || username;
}

async function loadUsers() {
  try {
    const res = await fetch("/api/users");
    const data = await res.json();
    ALL_USERS = data.users.map((u) => u.username);
    usersMap = {};
    userColorsMap = {};
    userBirthdaysMap = {};
    userHandlesMap = {};

    for (const u of data.users) {
      usersMap[u.username] = u.nickname || u.username;
      if (u.avatar_color) userColorsMap[u.username] = u.avatar_color;
      if (u.birthday) userBirthdaysMap[u.username] = u.birthday;
      if (u.handle) userHandlesMap[u.username] = u.handle;
      if (u.avatar_url) userAvatarsMap[u.username] = u.avatar_url;
      if (userHandlesMap[currentUser]) {
        currentHandle = userHandlesMap[currentUser];
        updateProfileUI();
      }
    }

    // Свои значения
    if (userColorsMap[currentUser]) currentAvatarColor = userColorsMap[currentUser];
    if (userBirthdaysMap[currentUser]) currentBirthday = userBirthdaysMap[currentUser];



  } catch (err) {
    console.error("Не удалось загрузить пользователей:", err);
  }
}

// ================================
// US. — INTERFACE
// ================================

const mainScreens = document.querySelector(".main-screens");
const meScreen = document.querySelector(".me-screen");
const homeScreen = document.querySelector(".home-screen");
const chatScreen = document.querySelector(".chat-screen");

const navItems = document.querySelectorAll(".nav-item");

const backButton = document.querySelector(".back-button");

const input = document.querySelector(".input input");
const sendButton = document.querySelector(".send-button");

const messages = document.querySelector(".messages");

// ================================
// НАВИГАЦИЯ МЕЖДУ ЭКРАНАМИ
// ================================

function switchScreen(name) {
  document.querySelectorAll(".main-screens > section").forEach((s) => {
    s.classList.remove("active");
  });

  // Особая логика для вкладки chat — там нужен chats-list-screen
  const targetName = name === "chat" ? "chats-list" : name;
  const target = document.querySelector(`.${targetName}-screen`);
  if (target) target.classList.add("active");

  navItems.forEach((item) => {
    item.classList.toggle("active", item.dataset.screen === name);
  });

  if (name === "chat") {
    // Открываем СПИСОК чатов
    mainScreens.style.display = "flex";
    chatScreen.style.display = "none";
    loadChats();
  } else {
    mainScreens.style.display = "flex";
    chatScreen.style.display = "none";
  }

  if (name === "plans & notes") {
    loadPlans();
  }
  if (name === "home") {
    renderHomePlans();
    renderHomeFriends();
    renderHomeShared();
  }
  if (name === "friends") {
    loadFriends();
  }
}

navItems.forEach((item) => {
  item.addEventListener("click", () => {
    switchScreen(item.dataset.screen);
  });
});

// ================================
// ПОКАЗ ЭКРАНОВ
// ================================

function showLogin() {
  document.querySelector(".login-screen").style.display = "flex";
  mainScreens.style.display = "none";
  chatScreen.style.display = "none";
}

function showApp() {
  document.querySelector(".login-screen").style.display = "none";
  mainScreens.style.display = "flex";

  updateGreeting();
  updateProfileUI();
  loadMoods();
  loadMeetup();
  loadPlans();
  loadFriends();
  loadSavedIds();
  loadUnreadFromStorage();
  // Первый показ home — без анимации
  const homeEl = document.querySelector(".home-screen");
  if (homeEl) homeEl.classList.add("no-anim");
  switchScreen("home");
  setTimeout(() => {
    if (homeEl) homeEl.classList.remove("no-anim");
  }, 50);
  connectWebSocket();
  loadUsers();
}

// ================================
// АВТОРИЗАЦИЯ — инициализация
// ================================

async function initAuth() {
  if (!authToken) {
    showLogin();
    return;
  }

  try {
    const res = await fetch("/api/me", {
      headers: { authorization: authToken },
    });

    if (!res.ok) throw new Error("bad token");

    const data = await res.json();
    currentUser = data.username;
    currentNickname = data.nickname || data.username;
    currentHandle = data.handle || data.username.toLowerCase();
    currentAvatarUrl = data.avatar_url || null;

    showApp();
  } catch {
    localStorage.removeItem("us_token");
    authToken = null;
    showLogin();
  }
}

// ================================
// WEBSOCKET
// ================================

let ws = null;

function connectWebSocket() {
  const wsProtocol = location.protocol === 'https:' ? 'wss://' : 'ws://';
ws = new WebSocket(`${wsProtocol}${location.host}?token=${encodeURIComponent(authToken || "")}`);

  ws.addEventListener("open", () => {
    console.log("✓ WebSocket подключён");
  });

  ws.addEventListener("message", async (event) => {
    const data = JSON.parse(event.data);

// ─── Пользователь обновил аватарку ───
if (data.type === "user_updated") {
  if (data.avatar_url) {
    userAvatarsMap[data.username] = data.avatar_url;
  } else {
    delete userAvatarsMap[data.username];
  }

  // Если это я — обновим свою карточку
  if (data.username === currentUser) {
    currentAvatarUrl = data.avatar_url || null;
    updateAvatarUI();
  }

  // Перерисуем всё, что видно
  renderChatsList();
  renderFriends();
  renderHomeFriends();
  if (currentChat && currentChat.type === "group") {
    renderGroupMembers(currentChat);
  }
}

    // ─── Новое сообщение ───
    if (data.type === "message") {
      const msgChatId = data.message.chat_id;

      // Если это НЕ текущий открытый чат — считаем непрочитанным
      if (msgChatId !== currentChatId || !isChatOpen()) {
        if (data.message.author !== currentUser) {
          incrementUnread(msgChatId);
          notifyNewMessage(data.message);
        }

        // Обновим список чатов, если он открыт
        if (chatsListScreen && chatsListScreen.style.display === "flex") {
          loadChats();
        }
        return;
      }

      // Если открыт именно этот чат — рисуем
      renderMessage(data.message);

      if (data.message.author !== currentUser) {
        notifyNewMessage(data.message);
        markAllMessagesAsRead();
      }
    }

    // ─── Онлайн ───
        // ─── Онлайн ───
    if (data.type === "online") {
      lastOnlineUsers = data.users;
      
      // Обязательно перезапрашиваем список пользователей, 
      // чтобы подтянуть их аватарки, если они изменились
      await loadUsers(); 
      
      updateChatHeader();
      loadFriends();
      renderHomeFriends();
    }

    // ─── Печатает ───
    if (data.type === "typing") {
      if (data.chat_id === currentChatId) {
        showTypingIndicator(data.username);
      }
    }

    // ─── Прочитано ───
    if (data.type === "read_update") {
      for (const id of data.message_ids) {
        addReader(id, data.reader);
        updateMessageTicks(id);
      }
    }
    // ─── Сообщение удалено ───
    if (data.type === "message_deleted") {
      // Если это сообщение в открытом чате — убираем
      if (data.chat_id === currentChatId) {
        removeMessageFromDOM(data.message_id);
      }
      // Обновим список чатов, если открыт
      if (allChats.length > 0) {
        loadChats();
      }
    }
    // ─── Новая заявка в друзья ───
    if (data.type === "friend_request") {
      loadFriends();
    }

        // ─── Заявка принята ───
    if (data.type === "friend_accepted") {
      loadFriends();
      renderHomeFriends();
      
      // Показываем красивое уведомление, кто принял заявку
      if (data.by) {
        const name = getNickname(data.by);
        // Создаем временное всплывающее окно
        const toast = document.createElement("div");
        toast.style.cssText = `
          position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
          background: #7a9c81; color: white; padding: 12px 24px;
          border-radius: 20px; font-size: 14px; z-index: 9999;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
          opacity: 0; transition: opacity 0.3s ease; pointer-events: none;
        `;
        toast.textContent = `${name} принял(а) твою заявку в друзья!`;
        document.body.appendChild(toast);
        
        // Плавно показываем и скрываем
        setTimeout(() => toast.style.opacity = "1", 100);
        setTimeout(() => {
          toast.style.opacity = "0";
          setTimeout(() => toast.remove(), 300);
        }, 3000);
      }
    }
    // ─── Чат удалён ───
    if (data.type === "chat_deleted") {
      if (currentChatId === data.chat_id) {
        currentChatId = null;
        currentChat = null;
        chatScreen.style.display = "none";
        mainScreens.style.display = "flex";
      }
      loadChats();
    }
    if (data.type === "chat_created") {
      loadChats();
    }
        // ─── Чат обновлён (участник добавлен / удалён / переименование) ───
    if (data.type === "chat_updated") {
      await loadChats();

      if (currentChatId === data.chat_id) {
        const chat = allChats.find((c) => c.id === data.chat_id);
        if (chat) {
          currentChat = chat;
          updateChatHeader();
        }
      }

      if (openedGroupChatId === data.chat_id) {
        const chat = allChats.find((c) => c.id === data.chat_id);
        if (chat) {
          renderGroupMembers(chat);
          if (groupModalTitle) {
            groupModalTitle.textContent = chat.title || "the three of us";
          }
        } else {
          closeGroupModal();
        }
      }
    }
    // ─── Общий план создан/изменён ───
    if (data.type === "plan_shared") {
      const plan = data.plan;
      if (!plan) return;

      // Если это мой план — пропускаем (не дублируем)
      if (plan.username === currentUser) return;

      // Обновляем или добавляем
      const idx = allPlans.findIndex((p) => p.id === plan.id);
      if (idx >= 0) {
        allPlans[idx] = plan;
      } else {
        allPlans.push(plan);
      }

      renderPlans();
      renderHomePlans();
      

      // Звук уведомления
      notifyNewMessage({ author: plan.username, text: plan.text });
    }
  });

  

  ws.addEventListener("close", () => {
    console.log("× WebSocket отключён");
  });

  ws.addEventListener("error", (err) => {
    console.error("WebSocket ошибка:", err);
  });
}

  // ================================
  // CHAT → HOME
  // ================================

  backButton.addEventListener("click", () => {
    // Возвращаемся к списку чатов
    chatScreen.style.display = "none";
    mainScreens.style.display = "flex";
    switchScreen("chat");
  });

  // ================================
  // ПРИВЕТСТВИЕ
  // ================================

  function updateGreeting() {
    const h1 = document.querySelector(".greeting h1");
    if (!h1) return;

    const name = currentNickname || currentUser;
    if (!name) return;

    const hour = new Date().getHours();
    let greeting;

    if (hour >= 23 || hour < 3) {
      greeting = "поздновато";
    } else if (hour < 6) {
      greeting = "не спится";
    } else if (hour < 12) {
      greeting = "доброе утро";
    } else if (hour < 18) {
      greeting = "уже день";
    } else {
      greeting = "уже вечер";
    }

    h1.innerHTML = `${greeting},<br>${name}.`;
  }

  // ================================
  // ВРЕМЯ И ДАТА
  // ================================

  function formatTime(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function formatDateLabel(timestamp) {
    const date = new Date(timestamp);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    if (date.toDateString() === today.toDateString()) return "TODAY";
    if (date.toDateString() === yesterday.toDateString()) return "YESTERDAY";

    return date
      .toLocaleDateString("en-US", { day: "numeric", month: "long" })
      .toUpperCase();
  }

  function updateDateLabels() {
    const now = new Date();

    const weekday = now
      .toLocaleDateString("en-US", { weekday: "long" })
      .toUpperCase();
    const day = now.getDate();
    const month = now
      .toLocaleDateString("en-US", { month: "long" })
      .toUpperCase();

    const eyebrow = document.querySelector(".eyebrow");
    if (eyebrow) {
      eyebrow.textContent = `${weekday} · ${day} ${month}`;
    }
  }

  updateDateLabels();

  // ================================
  // КАРТОЧКИ ПОЛЬЗОВАТЕЛЕЙ НА HOME
  // ================================

  const USER_STYLES = {
    Rina: { card: "person-rina", avatar: "avatar-r" },
    Vika: { card: "person-vika", avatar: "avatar-v" },
    Diana: { card: "person-third", avatar: "avatar-a" },
  };

  let ALL_USERS = [];

  // ================================
  // ГРУППИРОВКА СООБЩЕНИЙ
  // =================================

  // Сколько времени между сообщениями считается «одной группой»
  const GROUP_TIME_WINDOW = 5 * 60 * 1000; // 5 минут

  function isSameGroup(msg1, msg2) {
    if (!msg1 || !msg2) return false;
    if (msg1.author !== msg2.author) return false;
    return Math.abs(msg2.created_at - msg1.created_at) < GROUP_TIME_WINDOW;
  }

  // Находим последнее сообщение в DOM (по data-id)
  function getLastRenderedMessage() {
    const rows = messages.querySelectorAll(".message-row");
    if (rows.length === 0) return null;

    const lastRow = rows[rows.length - 1];
    const id = Number(lastRow.dataset.id);
    if (!id) return null;

    return {
      id,
      author: lastRow.classList.contains("own") ? currentUser : (lastRow.querySelector(".message-name")?.textContent || ""),
      created_at: Number(lastRow.dataset.timestamp) || 0,
    };
  }

  // ================================
  // ОТРИСОВКА ОДНОГО СООБЩЕНИЯ
  // ================================

  function renderMessage(msg) {
    const isOwn = msg.author === currentUser;

    const msgDate = new Date(msg.created_at).toDateString();

    const lastMessageRow = messages.querySelector(".message-row:last-of-type");
    const lastMsgDate = lastMessageRow
      ? new Date(Number(lastMessageRow.dataset.timestamp)).toDateString()
      : null;

    // Разделитель по дате
    if (msgDate !== lastMsgDate) {
      const divider = document.createElement("div");
      divider.className = "chat-date";
      divider.dataset.date = msgDate;
      divider.textContent = formatDateLabel(msg.created_at);
      messages.appendChild(divider);
    }

    // Определяем группировку
    const lastRow = messages.querySelector(".message-row:last-of-type");
    // Удаление сообщения из DOM
    function removeMessageFromDOM(messageId) {
      const row = messages.querySelector(`.message-row[data-id="${messageId}"]`);
      if (!row) return;

      // Запоминаем соседей до удаления
      const prevRow = row.previousElementSibling;
      const nextRow = row.nextElementSibling;

      // Убираем плавно
      row.style.transition = "opacity 0.2s ease, transform 0.2s ease";
      row.style.opacity = "0";
      row.style.transform = "scale(0.95)";

      setTimeout(() => {
        row.remove();

        // Если предшественник был group-end, а теперь после него ничего нет —
        // снимаем метку
        if (prevRow && prevRow.classList.contains("message-row")) {
          const hasNext = prevRow.nextElementSibling;
          if (!hasNext || !hasNext.classList.contains("message-row")) {
            prevRow.classList.remove("group-middle");
            prevRow.classList.add("group-end");
          }
        }

        // Если следующий был grouped и его автор больше не совпадает с предыдущим —
        // убираем grouped
        if (nextRow && nextRow.classList.contains("message-row")) {
          const nextPrev = nextRow.previousElementSibling;
          if (!nextPrev || !nextPrev.classList.contains("message-row")) {
            nextRow.classList.remove("grouped");
            nextRow.classList.add("group-start");
          } else if (nextPrev.dataset.author !== nextRow.dataset.author) {
            nextRow.classList.remove("grouped");
            nextRow.classList.add("group-start");
          }
        }
      }, 200);
    }
    let isGrouped = false;
    let groupStart = true;
    // Сброс старых меток у последнего сообщения
    const lastRowOld = messages.querySelector(".message-row:last-of-type");
    if (lastRowOld) {
      lastRowOld.classList.remove("group-end", "group-middle");
    }
    if (lastRow) {
      const lastAuthor = lastRow.dataset.author;
      const lastTime = Number(lastRow.dataset.timestamp) || 0;
      const lastDate = new Date(lastTime).toDateString();

      if (
        lastAuthor === msg.author &&
        msgDate === lastDate &&
        Math.abs(msg.created_at - lastTime) < GROUP_TIME_WINDOW
      ) {
        isGrouped = true;
        groupStart = false;
      }
    }

    const messageRow = document.createElement("div");
    messageRow.className = "message-row" + (isOwn ? " own" : "");
    // Анимируем появление, если это новое сообщение (не из истории)
    if (!window.__renderingHistory) {
      messageRow.classList.add("animate-in");
    }
    messageRow.dataset.id = msg.id;
    messageRow.dataset.timestamp = msg.created_at;
    messageRow.dataset.author = msg.author;

    if (groupStart) messageRow.classList.add("group-start");
    if (isGrouped) messageRow.classList.add("grouped");

    // Аватарка — только если не группировано
    if (!isOwn) {
      const avatar = document.createElement("div");
avatar.className = "message-avatar";
avatar.dataset.username = msg.author;
applyAvatar(avatar, msg.author);

      // Если сообщение в группе — делаем аватарку невидимой, но она занимает место
      if (isGrouped) {
        avatar.style.visibility = "hidden";
        avatar.dataset.username = "";   // чтобы клик не открывал профиль по пустой аве
      }

      messageRow.appendChild(avatar);
    }


    const content = document.createElement("div");
    content.className = "message-content";

    if (!isOwn && !isGrouped) {
      const name = document.createElement("div");
      name.className = "message-name";
      name.textContent = getNickname(msg.author);
      content.appendChild(name);
    }

    const bubble = document.createElement("div");
    bubble.className = "message-bubble " + (isOwn ? "outgoing" : "incoming");

    // Если это фото-сообщение — добавляем модификатор
    if (msg.photo_url) {
      bubble.classList.add("with-photo");
    }

    // Цитата (reply)
    if (msg.reply_to_id && msg.reply_to_text) {
      const quote = document.createElement("div");
      quote.className = "message-reply-quote";
      quote.dataset.replyToId = msg.reply_to_id;

      const quoteAuthor = document.createElement("div");
      quoteAuthor.className = "message-reply-quote-author";
      quoteAuthor.textContent = getNickname(msg.reply_to_author) || msg.reply_to_author;

      const quoteText = document.createElement("div");
      quoteText.className = "message-reply-quote-text";
      quoteText.textContent = msg.reply_to_text;

      quote.appendChild(quoteAuthor);
      quote.appendChild(quoteText);
      bubble.appendChild(quote);
    }

    // Фото (если есть)
    if (msg.photo_url) {
      const photo = document.createElement("img");
      photo.className = "chat-photo";
      photo.src = msg.photo_url;
      photo.alt = "photo";
      photo.loading = "lazy";
      bubble.appendChild(photo);
    }
    // Видео (если есть)
if (msg.video_url) {
  const video = document.createElement("video");
  video.className = "chat-video";
  video.src = msg.video_url;
  video.controls = true;
  video.preload = "metadata";
  video.playsInline = true;
  bubble.appendChild(video);
  bubble.classList.add("with-photo"); // переиспользуем стиль "без padding"
}
// Голосовое (если есть)
if (msg.voice_url) {
  const voiceBubble = document.createElement("div");
  voiceBubble.className = "voice-bubble";

  // Кнопка play
  const playBtn = document.createElement("button");
  playBtn.className = "voice-play";
  playBtn.innerHTML = `
    <svg class="icon-play" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z"/>
    </svg>
    <svg class="icon-pause" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="5" width="4" height="14" rx="1"/>
      <rect x="14" y="5" width="4" height="14" rx="1"/>
    </svg>
  `;

  // Тело — волна + время
  const body = document.createElement("div");
  body.className = "voice-body";

  const wave = document.createElement("div");
  wave.className = "voice-wave";
  // Случайные столбики
  for (let i = 0; i < 26; i++) {
    const bar = document.createElement("span");
    const h = 4 + Math.round(Math.random() * 16);
    bar.style.height = h + "px";
    wave.appendChild(bar);
  }

  const timeEl = document.createElement("div");
  timeEl.className = "voice-time";
  const dur = msg.voice_duration || 0;
  timeEl.textContent = formatDuration(dur);

  body.appendChild(wave);
  body.appendChild(timeEl);

  voiceBubble.appendChild(playBtn);
  voiceBubble.appendChild(body);

  bubble.appendChild(voiceBubble);
  bubble.classList.add("with-photo"); // без фона, как фото
  bubble.classList.add("voice-bubble-wrap");

    // Аудио-элемент
  const audio = document.createElement("audio");
  audio.src = msg.voice_url;
  audio.preload = "metadata";
  audio.style.display = "none";
  
  // Добавляем обработчик ошибок, чтобы понять, если что-то не так
  audio.addEventListener("error", (e) => {
    console.error("Ошибка аудио:", e);
    timeEl.textContent = "ошибка :(";
    timeEl.style.color = "red";
  });

  bubble.appendChild(audio);

  // Play/Pause
  playBtn.addEventListener("click", () => {
    if (audio.paused) {
      // Останавливаем все другие голосовые
      document.querySelectorAll("audio").forEach((a) => {
        if (a !== audio) {
          a.pause();
          a.currentTime = 0;
          const otherBubble = a.closest(".voice-bubble");
          if (otherBubble) otherBubble.classList.remove("playing");
        }
      });

      audio.play();
      voiceBubble.classList.add("playing");
      playBtn.classList.add("playing");
    } else {
      audio.pause();
      voiceBubble.classList.remove("playing");
      playBtn.classList.remove("playing");
    }
  });

  // Обновление таймера во время проигрывания
  audio.addEventListener("timeupdate", () => {
    const current = Math.round(audio.currentTime);
    const total = Math.round(audio.duration) || dur;
    timeEl.textContent = `${formatDuration(current)} / ${formatDuration(total)}`;
  });

  // По окончании — сбрасываем
  audio.addEventListener("ended", () => {
    voiceBubble.classList.remove("playing");
    playBtn.classList.remove("playing");
    timeEl.textContent = formatDuration(dur);
    audio.currentTime = 0;
  });

  audio.addEventListener("pause", () => {
    voiceBubble.classList.remove("playing");
    playBtn.classList.remove("playing");
  });
}

    // Текст (если есть)
    if (msg.text && msg.text.trim()) {
      const bubbleText = document.createElement("div");
      bubbleText.className = "message-bubble-text";
      bubbleText.textContent = msg.text;
      bubble.appendChild(bubbleText);
    }

    content.appendChild(bubble);

    // Мета — время и галочки
    const meta = document.createElement("div");
    meta.className = "message-meta";

    const timeStr = formatTime(msg.created_at);
    meta.dataset.time = timeStr;

    if (msg.read_by && Array.isArray(msg.read_by)) {
      setReadBy(msg.id, msg.read_by);
    } else {
      if (!messagesReadBy.has(msg.id)) {
        setReadBy(msg.id, []);
      }
    }

    if (isOwn) {
      if (isReadByAll(msg.id, msg.author)) {
        meta.innerHTML = `${timeStr} <span class="tick tick-read">✓✓</span>`;
      } else {
        meta.innerHTML = `${timeStr} <span class="tick tick-sent">✓</span>`;
      }
    } else {
      meta.textContent = timeStr;
    }

    content.appendChild(meta);

    messageRow.appendChild(content);
    messages.appendChild(messageRow);

    // Проставляем group-end предыдущему сообщению (если следующее не группируется)
    const prevRow = messageRow.previousElementSibling;
    if (prevRow && prevRow.classList.contains("message-row")) {
      const prevAuthor = prevRow.dataset.author;
      const prevTime = Number(prevRow.dataset.timestamp) || 0;

      const sameAuthor = prevAuthor === msg.author;
      const sameTime = Math.abs(msg.created_at - prevTime) < GROUP_TIME_WINDOW;

      if (!sameAuthor || !sameTime) {
        prevRow.classList.add("group-end");
      } else {
        prevRow.classList.add("group-middle");
      }
    }

    // Скролл
    const wasAtBottom =
      messages.scrollHeight - messages.scrollTop - messages.clientHeight < 100;

    if (wasAtBottom || isOwn) {
      messages.scrollTo({ top: messages.scrollHeight, behavior: "smooth" });
    }
  }
  // ================================
  // ОТПРАВКА СООБЩЕНИЯ
  // ================================

  function sendMessage() {
    const text = input.value.trim();
    if (text === "") return;

    if (!ws || ws.readyState !== 1) {
      console.warn("WebSocket не подключён, сообщение не отправлено");
      return;
    }

    ws.send(
      JSON.stringify({
        type: "message",
        text: text,
      })
    );

    input.value = "";
    input.focus();
    sendButton.classList.remove("ready");
  }

  // ================================
  // КНОПКА ОТПРАВКИ — активна при тексте
  // ================================

  // Переменная для ограничения отправки сигнала "печатает"
let sendTypingTimeout = null;

input.addEventListener("input", () => {
  if (input.value.trim() === "") {
    sendButton.classList.remove("ready");
  } else {
    sendButton.classList.add("ready");
  }

  // Отправляем сигнал "печатает", но не чаще раза в 1.5 секунды
  if (ws && ws.readyState === 1 && input.value.trim() !== "") {
    if (!sendTypingTimeout) {
      ws.send(JSON.stringify({ type: "typing", chat_id: currentChatId }));
      
      // Блокируем отправку следующих сигналов на 1.5 сек
      sendTypingTimeout = setTimeout(() => {
        sendTypingTimeout = null;
      }, 1500);
    }
  }
});

  // ================================
  // ATTACHMENT MENU
  // ================================

  const plusButton = document.querySelector(".plus-button");
  const attachmentMenu = document.querySelector(".attachment-menu");

  plusButton.addEventListener("click", (event) => {
    event.stopPropagation();
    attachmentMenu.classList.toggle("open");
    plusButton.classList.toggle("active");
  });

  document.addEventListener("click", () => {
    attachmentMenu.classList.remove("open");
    plusButton.classList.remove("active");
  });

  // ================================
  // PHOTO UPLOAD (через сервер)
  // ================================

  const photoInput = document.querySelector("#photo-input");

  photoInput.addEventListener("change", async () => {
    const file = photoInput.files[0];
    if (!file) return;

    // Закрываем меню вложений
    attachmentMenu.classList.remove("open");
    plusButton.classList.remove("active");

    // Проверки
    if (!currentChatId) {
      alert("Открой чат, чтобы отправить фото");
      photoInput.value = "";
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      alert("Фото слишком большое (макс. 10 МБ)");
      photoInput.value = "";
      return;
    }

    if (!file.type.startsWith("image/")) {
      alert("Можно отправлять только изображения");
      photoInput.value = "";
      return;
    }

    // Показать "плейсхолдер" пока грузится
    const tempRow = showPhotoUploading();

    try {
      // 1. Загружаем файл на сервер
      const formData = new FormData();
      formData.append("photo", file);
      formData.append("chat_id", currentChatId);

      const res = await fetch("/api/upload/photo", {
        method: "POST",
        headers: {
          authorization: authToken,
        },
        body: formData,
      });

      const data = await res.json();

      // Убираем плейсхолдер
      if (tempRow) tempRow.remove();

      if (!res.ok) {
        console.error("Не удалось загрузить фото:", data.error);
        alert(data.error || "Не удалось загрузить фото");
        photoInput.value = "";
        return;
      }

      // 2. Отправляем сообщение с ссылкой через WebSocket
      if (!ws || ws.readyState !== 1) {
        alert("Нет соединения с сервером");
        photoInput.value = "";
        return;
      }

      ws.send(JSON.stringify({
        type: "message",
        text: input.value.trim() || "",
        chat_id: currentChatId,
        photo_url: data.url,
        reply_to_id: replyToMessage ? replyToMessage.id : null,
      }));

      // Сбрасываем поле ввода и reply
      input.value = "";
      sendButton.classList.remove("ready");
      replyToMessage = null;
      replyBar.classList.remove("open");

    } catch (err) {
      console.error("Ошибка загрузки:", err);
      if (tempRow) tempRow.remove();
      alert("Сервер недоступен");
    }

    photoInput.value = "";
  });

  // Плейсхолдер "фото загружается"
  function showPhotoUploading() {
    if (!messages) return null;

    const row = document.createElement("div");
    row.className = "message-row own";

    const content = document.createElement("div");
    content.className = "message-content";

    const bubble = document.createElement("div");
    bubble.className = "message-bubble outgoing";
    bubble.style.opacity = "0.6";
    bubble.textContent = "загрузка фото...";

    const meta = document.createElement("div");
    meta.className = "message-meta";
    meta.textContent = formatTime(Date.now());

    content.appendChild(bubble);
    content.appendChild(meta);
    row.appendChild(content);

    messages.appendChild(row);
    messages.scrollTo({ top: messages.scrollHeight, behavior: "smooth" });

    return row;
  }
  // ================================
// VIDEO UPLOAD (через сервер)
// ================================

const videoInput = document.querySelector("#video-input");

videoInput.addEventListener("change", async () => {
  const file = videoInput.files[0];
  if (!file) return;

  // Закрываем меню вложений
  attachmentMenu.classList.remove("open");
  plusButton.classList.remove("active");

  // Проверки
  if (!currentChatId) {
    alert("Открой чат, чтобы отправить видео");
    videoInput.value = "";
    return;
  }

  if (file.size > 50 * 1024 * 1024) {
    alert("Видео слишком большое (макс. 50 МБ)");
    videoInput.value = "";
    return;
  }

  if (!file.type.startsWith("video/")) {
    alert("Можно отправлять только видео");
    videoInput.value = "";
    return;
  }

  // Показать "плейсхолдер" пока грузится
  const tempRow = showVideoUploading();

  try {
    // 1. Загружаем файл на сервер
    const formData = new FormData();
    formData.append("video", file);
    formData.append("chat_id", currentChatId);

    const res = await fetch("/api/upload/video", {
      method: "POST",
      headers: {
        authorization: authToken,
      },
      body: formData,
    });

    const data = await res.json();

    // Убираем плейсхолдер
    if (tempRow) tempRow.remove();

    if (!res.ok) {
      console.error("Не удалось загрузить видео:", data.error);
      alert(data.error || "Не удалось загрузить видео");
      videoInput.value = "";
      return;
    }

    // 2. Отправляем сообщение с ссылкой через WebSocket
    if (!ws || ws.readyState !== 1) {
      alert("Нет соединения с сервером");
      videoInput.value = "";
      return;
    }

    ws.send(JSON.stringify({
      type: "message",
      text: input.value.trim() || "",
      chat_id: currentChatId,
      video_url: data.url,
      reply_to_id: replyToMessage ? replyToMessage.id : null,
    }));

    // Сбрасываем поле ввода и reply
    input.value = "";
    sendButton.classList.remove("ready");
    replyToMessage = null;
    replyBar.classList.remove("open");

  } catch (err) {
    console.error("Ошибка загрузки:", err);
    if (tempRow) tempRow.remove();
    alert("Сервер недоступен");
  }

  videoInput.value = "";
});

// Плейсхолдер "видео загружается"
function showVideoUploading() {
  if (!messages) return null;

  const row = document.createElement("div");
  row.className = "message-row own";

  const content = document.createElement("div");
  content.className = "message-content";

  const bubble = document.createElement("div");
  bubble.className = "message-bubble outgoing";
  bubble.style.opacity = "0.6";
  bubble.textContent = "загрузка видео...";

  const meta = document.createElement("div");
  meta.className = "message-meta";
  meta.textContent = formatTime(Date.now());

  content.appendChild(bubble);
  content.appendChild(meta);
  row.appendChild(content);

  messages.appendChild(row);
  messages.scrollTo({ top: messages.scrollHeight, behavior: "smooth" });

  return row;
}
// ================================
// VOICE RECORDING (голосовые)
// ================================

const micButton = document.getElementById("mic-button");
const chatTextInput = document.getElementById("chat-text-input");
const recordingActive = document.getElementById("recording-active");
const recordingCancelBtn = document.getElementById("recording-cancel-btn");
const recordingTime = document.getElementById("recording-time");
const sendBtn = document.getElementById("send-btn"); // кнопка отправки

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

let currentStream = null;

// Начать запись
async function startVoiceRecording() {
  if (!currentChatId) {
    alert("Открой чат, чтобы записать голосовое");
    return;
  }

  try {
    currentStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    console.error("Микрофон недоступен:", err);
    alert("Не удалось получить доступ к микрофону");
    return;
  }

  let mimeType = "";
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
    mimeType = "audio/webm;codecs=opus";
  } else if (MediaRecorder.isTypeSupported("audio/webm")) {
    mimeType = "audio/webm";
  } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
    mimeType = "audio/mp4";
  }

  try {
    mediaRecorder = mimeType
      ? new MediaRecorder(currentStream, { mimeType })
      : new MediaRecorder(currentStream);
  } catch (err) {
    console.error("MediaRecorder не создан:", err);
    alert("Запись голоса не поддерживается в этом браузере");
    currentStream.getTracks().forEach((t) => t.stop());
    return;
  }

  recordedChunks = [];

  mediaRecorder.addEventListener("dataavailable", (e) => {
    if (e.data && e.data.size > 0) {
      recordedChunks.push(e.data);
    }
  });

  mediaRecorder.addEventListener("stop", () => {
    if (currentStream) {
      currentStream.getTracks().forEach((t) => t.stop());
      currentStream = null;
    }

    const blob = new Blob(recordedChunks, {
      type: mediaRecorder.mimeType || "audio/webm",
    });

    pendingVoiceBlob = blob;
    pendingVoiceDuration = Math.round((Date.now() - recordingStartTime) / 1000);

    // Меняем UI: поле ввода обратно, кнопка отправки обратно
    chatTextInput.style.display = "block";
    recordingActive.style.display = "none";
    sendBtn.classList.remove("is-send-voice");
    sendBtn.innerHTML = "↑";
    
    // Если запись меньше 1 секунды — отменяем
    if (pendingVoiceDuration < 1) {
      cancelVoiceRecording();
      return;
    }

    // Автоматически отправляем
    sendVoiceRecording();
  });

  // Показываем UI записи
  chatTextInput.style.display = "none";
  recordingActive.style.display = "flex";
  sendBtn.classList.add("is-send-voice");
  sendBtn.innerHTML = "✓"; // Галочка для отправки

  // Таймер
  recordingStartTime = Date.now();
  recordingTime.textContent = "0:00";

  clearInterval(recordingTimerInterval);
  recordingTimerInterval = setInterval(() => {
    const elapsed = Math.round((Date.now() - recordingStartTime) / 1000);
    recordingTime.textContent = formatDuration(elapsed);

    // Автостоп на 5 минутах
    if (elapsed >= 300) {
      stopVoiceRecording();
    }
  }, 200);

  mediaRecorder.start();
}

// Остановить запись (перейти в режим "отправить")
function stopVoiceRecording() {
  if (!mediaRecorder || mediaRecorder.state === "inactive") return;

  clearInterval(recordingTimerInterval);
  mediaRecorder.stop(); // Вызовет событие 'stop', которое само отправит сообщение
}

// Отмена записи
function cancelVoiceRecording() {
  clearInterval(recordingTimerInterval);

  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }

  if (currentStream) {
    currentStream.getTracks().forEach((t) => t.stop());
    currentStream = null;
  }

  mediaRecorder = null;
  recordedChunks = [];
  pendingVoiceBlob = null;
  pendingVoiceDuration = 0;

  // Возвращаем UI
  chatTextInput.style.display = "block";
  recordingActive.style.display = "none";
  sendBtn.classList.remove("is-send-voice");
  sendBtn.innerHTML = "↑";
}

// Отправить запись
async function sendVoiceRecording() {
  if (!pendingVoiceBlob) return;

  const blob = pendingVoiceBlob;
  const duration = pendingVoiceDuration;

  pendingVoiceBlob = null;
  pendingVoiceDuration = 0;

  const tempRow = showVoiceUploading();

  try {
    const formData = new FormData();
    const ext = blob.type.includes("mp4") ? ".mp4" : ".webm";
    formData.append("voice", blob, "voice" + ext);
    formData.append("chat_id", currentChatId);

    const res = await fetch("/api/upload/voice", {
      method: "POST",
      headers: { authorization: authToken },
      body: formData,
    });

    const data = await res.json();
    if (tempRow) tempRow.remove();

    if (!res.ok) {
      alert(data.error || "Не удалось отправить голосовое");
      return;
    }

    if (!ws || ws.readyState !== 1) {
      alert("Нет соединения с сервером");
      return;
    }

    ws.send(JSON.stringify({
      type: "message",
      text: "",
      chat_id: currentChatId,
      voice_url: data.url,
      voice_duration: duration,
      reply_to_id: replyToMessage ? replyToMessage.id : null,
    }));

    replyToMessage = null;
    replyBar.classList.remove("open");

  } catch (err) {
    console.error("Ошибка отправки голосового:", err);
    if (tempRow) tempRow.remove();
    alert("Сервер недоступен");
  }
}

// Плейсхолдер
function showVoiceUploading() {
  if (!messages) return null;

  const row = document.createElement("div");
  row.className = "message-row own";

  const content = document.createElement("div");
  content.className = "message-content";

  const bubble = document.createElement("div");
  bubble.className = "message-bubble outgoing";
  bubble.style.opacity = "0.6";
  bubble.textContent = "отправка голосового...";

  const meta = document.createElement("div");
  meta.className = "message-meta";
  meta.textContent = formatTime(Date.now());

  content.appendChild(bubble);
  content.appendChild(meta);
  row.appendChild(content);

  messages.appendChild(row);
  messages.scrollTo({ top: messages.scrollHeight, behavior: "smooth" });

  return row;
}

// --- Логика удержания для мыши и тача ---
let isRecordingHold = false;

function handleMicStart(e) {
  e.preventDefault(); // Предотвращаем выделение текста и клики
  if (!currentChatId) return;
  
  // Если уже идет запись, игнорируем
  if (mediaRecorder && mediaRecorder.state === "recording") return;
  
  isRecordingHold = true;
  micButton.classList.add("holding");
  startVoiceRecording();
}

function handleMicEnd(e) {
  e.preventDefault();
  if (!isRecordingHold) return;
  
  isRecordingHold = false;
  micButton.classList.remove("holding");
  
  // Если запись активна — останавливаем (и отправляем)
  if (mediaRecorder && mediaRecorder.state === "recording") {
    stopVoiceRecording();
  }
}

if (micButton) {
  // События мыши
  micButton.addEventListener("mousedown", handleMicStart);
  micButton.addEventListener("mouseup", handleMicEnd);
  micButton.addEventListener("mouseleave", handleMicEnd); // Если увели мышку

  // События тача (телефоны)
  micButton.addEventListener("touchstart", handleMicStart, { passive: false });
  micButton.addEventListener("touchend", handleMicEnd, { passive: false });
}

if (recordingCancelBtn) {
  recordingCancelBtn.addEventListener("click", cancelVoiceRecording);
}

// Кнопка отправки (галочка) во время записи
if (sendBtn) {
  // Перехватываем клик по кнопке отправки, если это голосовое
  sendBtn.addEventListener("click", (e) => {
    if (sendBtn.classList.contains("is-send-voice")) {
      e.preventDefault();
      e.stopPropagation();
      stopVoiceRecording(); // Останавливаем и сразу отправляем
    }
  }, true);
}

  // ================================
  // PHOTO VIEWER
  // ================================

  const mediaViewer = document.getElementById("media-viewer");
const mediaViewerImg = document.getElementById("media-viewer-img");
const mediaViewerVideo = document.getElementById("media-viewer-video");
const mediaViewerClose = document.getElementById("media-viewer-close");

document.addEventListener("click", (event) => {
  // Клик по фото в чате
  if (event.target.classList.contains("chat-photo")) {
    mediaViewerImg.src = event.target.src;
    mediaViewerImg.style.display = "block";
    mediaViewerVideo.style.display = "none";
    mediaViewerVideo.pause(); // На всякий случай
    mediaViewer.classList.add("open");
    return;
  }

  // Клик по видео в чате (игнорируем клики по кнопкам плеера)
  if (event.target.classList.contains("chat-video") && event.target.tagName === "VIDEO") {
    // Проверяем, что клик был не по элементам управления (play, перемотка)
    if (event.target.paused || event.target.ended) {
        // Если видео на паузе, открываем на весь экран
        mediaViewerVideo.src = event.target.src;
        mediaViewerVideo.style.display = "block";
        mediaViewerImg.style.display = "none";
        mediaViewer.classList.add("open");
    }
  }
});

mediaViewerClose.addEventListener("click", () => {
  mediaViewer.classList.remove("open");
  mediaViewerVideo.pause();
});

mediaViewer.addEventListener("click", (event) => {
  if (event.target === mediaViewer) {
    mediaViewer.classList.remove("open");
    mediaViewerVideo.pause();
  }
});

  // ================================
  // ЛОГИКА ЭКРАНА ВХОДА / РЕГИСТРАЦИИ
  // ================================

  // ─── Переключение вкладок ───
  const loginTabs = document.querySelectorAll(".login-tab");
  const loginPanels = document.querySelectorAll(".login-panel");

  loginTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.tab;

      loginTabs.forEach((t) => {
        t.classList.toggle("active", t === tab);
      });

      loginPanels.forEach((p) => {
        p.classList.toggle("active", p.dataset.panel === target);
      });
    });
  });

  // ─── Форма входа ───
  const loginPanel = document.querySelector(".login-panel-login");
  const loginUsername = document.getElementById("login-username");
  const loginPassword = document.getElementById("login-password");
  const loginError = document.getElementById("login-error");

  if (loginPanel) {
    loginPanel.addEventListener("submit", async (e) => {
      e.preventDefault();

      const username = loginUsername.value.trim();
      const password = loginPassword.value;

      if (!username || !password) {
        loginError.textContent = "Заполни все поля";
        return;
      }

      loginError.textContent = "";

      try {
        const res = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        });

        const data = await res.json();

        if (!res.ok) {
          loginError.textContent = data.error || "Ошибка входа";
          return;
        }

        authToken = data.token;
        currentUser = data.username;
        localStorage.setItem("us_token", authToken);
        location.reload();

      } catch (err) {
        loginError.textContent = "Сервер недоступен";
        console.error(err);
      }
    });
  }

  // ─── Форма регистрации ───
  const registerPanel = document.querySelector(".login-panel-register");
  const registerUsername = document.getElementById("register-username");
  const registerNickname = document.getElementById("register-nickname");
  const registerPassword = document.getElementById("register-password");
  const registerPassword2 = document.getElementById("register-password-2");
  const registerError = document.getElementById("register-error");

  if (registerPanel) {
    registerPanel.addEventListener("submit", async (e) => {
      e.preventDefault();

      const username = registerUsername.value.trim();
      const nickname = registerNickname.value.trim();
      const password = registerPassword.value;
      const password2 = registerPassword2.value;

      if (!username || !nickname || !password) {
        registerError.textContent = "Заполни все поля";
        return;
      }

      if (username.length < 3) {
        registerError.textContent = "Username минимум 3 символа";
        return;
      }

      if (password.length < 6) {
        registerError.textContent = "Пароль минимум 6 символов";
        return;
      }

      if (password !== password2) {
        registerError.textContent = "Пароли не совпадают";
        return;
      }

      registerError.textContent = "";

      try {
        const res = await fetch("/api/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, nickname, password }),
        });

        const data = await res.json();

        if (!res.ok) {
          registerError.textContent = data.error || "Ошибка регистрации";
          return;
        }

        authToken = data.token;
        currentUser = data.username;
        localStorage.setItem("us_token", authToken);

        location.reload();
      } catch (err) {
        registerError.textContent = "Сервер недоступен";
        console.error(err);
      }
    });
  }

  // ================================
  // ОНЛАЙН-СТАТУСЫ (в шапке чата)
  // ================================

  function updateOnlineStatuses(onlineUsers) {
    // Раньше рисовала Rina/Vika/Diana. Теперь не нужна —
    // шапку обновляет updateChatHeader() при онлайн-статусе.
    if (currentChat) {
      updateChatHeader();
    }
  }

  // ================================
  // ИНДИКАТОР «ПЕЧАТАЕТ»
  // ================================

  



// Переменная для скрытия текста "печатает" через 2 секунды
let typingDisplayTimeout = null;

function showTypingIndicator(username) {
  const el = document.querySelector(".chat-header-members");
  if (!el || !currentChat) return;

  // В группе — с именем. В личке — без имени
  let text;
  if (currentChat.type === "group") {
    text = `${getNickname(username)} печатает…`;
  } else {
    text = "печатает…";
  }

  el.textContent = text;
  el.classList.add("typing");

  // Сбрасываем таймер отображения
  clearTimeout(typingDisplayTimeout);
  typingDisplayTimeout = setTimeout(() => {
    el.classList.remove("typing");
    restoreChatHeaderMembers();
  }, 2000);
}

  // Возвращает шапку к «Rina · Vika · Diana» (или к личке)
  function restoreChatHeaderMembers() {
    if (!currentChat) return;

    const el = document.querySelector(".chat-header-members");
    if (!el) return;

    if (currentChat.type === "group") {
      el.textContent = currentChat.members
        .map((u) => getNickname(u))
        .join(" · ");
    } else {
      const otherUser = currentChat.members.find((u) => u !== currentUser);
      const isOnline = lastOnlineUsers.includes(otherUser);
      el.textContent = isOnline ? "online · now" : "offline";
    }
  }

  // ================================
  // ПРОФИЛЬ
  // ================================

  function updateProfileUI() {
    if (!currentUser) return;

    const avatarEl = document.getElementById("profile-avatar");
    const nameEl = document.getElementById("profile-name");
    const usernameEl = document.getElementById("profile-username");
    const settingsName = document.getElementById("settings-nickname-value");
    const settingsHandle = document.getElementById("settings-handle-value");

    const displayName = currentNickname || currentUser;
    const handle = currentHandle || currentUser.toLowerCase();

      if (avatarEl) {
    if (currentAvatarUrl) {
      avatarEl.textContent = "";
      avatarEl.style.backgroundImage = `url(${currentAvatarUrl})`;
      avatarEl.style.backgroundSize = "cover";
      avatarEl.style.backgroundPosition = "center";
      avatarEl.style.background = "transparent";
    } else {
      avatarEl.style.backgroundImage = "";
      avatarEl.textContent = displayName.charAt(0).toUpperCase();
      avatarEl.style.background = currentAvatarColor || "#c7d9e2";
      avatarEl.style.color = getContrastTextColor(currentAvatarColor || "#c7d9e2");
    }
  }

    if (nameEl) nameEl.textContent = displayName;
    if (usernameEl) usernameEl.textContent = "@" + handle;
    if (settingsName) settingsName.textContent = displayName;
    if (settingsHandle) settingsHandle.textContent = "@" + handle;
      // Обновляем и аватарку
  updateAvatarUI();
  }

  // Функция для определения — светлый или тёмный текст
  function getContrastTextColor(hexColor) {
  if (!hexColor) return "#171714";
  const hex = hexColor.replace("#", "");
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  // Полностью непрозрачные цвета — лучше читаются
  return brightness > 140 ? "#171714" : "#f5f1e7";
}

// Универсально применяет аватарку к элементу: фото или буква
function applyAvatar(el, username, fallbackName) {
  if (!el) return;

  const avatarUrl = userAvatarsMap[username];

  if (avatarUrl) {
    el.textContent = "";
    el.style.backgroundImage = `url(${avatarUrl})`;
    el.style.backgroundSize = "cover";
    el.style.backgroundPosition = "center";
    el.classList.add("has-photo");
  } else {
    el.style.backgroundImage = "";
    el.classList.remove("has-photo");

    const color = userColorsMap[username] || "#e8e5db";
    el.style.background = color;
    el.style.color = getContrastTextColor(color);
    el.textContent = (fallbackName || getNickname(username)).charAt(0).toUpperCase();
  }
}

  // ================================
// ВЫХОД
// ================================

const logoutButton = document.getElementById("logout-button");
const logoutConfirmModal = document.querySelector(".logout-confirm-modal");
const logoutCancel = document.getElementById("logout-cancel");
const logoutConfirm = document.getElementById("logout-confirm");

if (logoutButton) {
  logoutButton.addEventListener("click", () => {
    if (logoutConfirmModal) logoutConfirmModal.classList.add("open");
  });
}

if (logoutCancel) {
  logoutCancel.addEventListener("click", () => {
    if (logoutConfirmModal) logoutConfirmModal.classList.remove("open");
  });
}

if (logoutConfirmModal) {
  logoutConfirmModal.addEventListener("click", (e) => {
    if (e.target === logoutConfirmModal) {
      logoutConfirmModal.classList.remove("open");
    }
  });
}

if (logoutConfirm) {
  logoutConfirm.addEventListener("click", () => {
    // Стираем токен и все локальные данные
    localStorage.removeItem("us_token");
    authToken = null;
    currentUser = null;
    currentNickname = null;
    location.reload();
  });
}

  // ================================
  // РЕДАКТИРОВАНИЕ НИКА
  // ================================

  const editNicknameButton = document.getElementById("edit-nickname-button");
  const nicknameModal = document.querySelector(".nickname-modal");
  const nicknameInput = document.querySelector(".nickname-input");
  const nicknameSave = document.querySelector(".nickname-save");
  const nicknameCancel = document.querySelector(".nickname-cancel");
  const nicknameError = document.querySelector(".nickname-error");

  if (editNicknameButton) {
    editNicknameButton.addEventListener("click", () => {
      nicknameInput.value = currentNickname || currentUser || "";
      nicknameError.textContent = "";
      nicknameModal.classList.add("open");
      setTimeout(() => nicknameInput.focus(), 50);
    });
  }

  if (nicknameCancel) {
    nicknameCancel.addEventListener("click", () => {
      nicknameModal.classList.remove("open");
    });
  }

  if (nicknameModal) {
    nicknameModal.addEventListener("click", (e) => {
      if (e.target === nicknameModal) {
        nicknameModal.classList.remove("open");
      }
    });
  }

  async function saveNickname() {
    const newNick = nicknameInput.value.trim();

    if (!newNick) {
      nicknameError.textContent = "Ник не может быть пустым";
      return;
    }

    nicknameError.textContent = "";

    try {
      const res = await fetch("/api/profile/nickname", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          authorization: authToken,
        },
        body: JSON.stringify({ nickname: newNick }),
      });

      const data = await res.json();

      if (!res.ok) {
        nicknameError.textContent = data.error || "Ошибка сохранения";
        return;
      }

      currentNickname = data.nickname;
      usersMap[currentUser] = data.nickname;

      updateProfileUI();
      updateGreeting();


      nicknameModal.classList.remove("open");
    } catch (err) {
      nicknameError.textContent = "Сервер недоступен";
      console.error(err);
    }
  }

  if (nicknameSave) {
    nicknameSave.addEventListener("click", saveNickname);
  }

  if (nicknameInput) {
    nicknameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") saveNickname();
    });
  }

  // ================================
  // ПЕРЕКЛЮЧАТЕЛЬ ТЕМЫ
  // ================================

  const themeToggleButton = document.getElementById("theme-toggle-button");

  if (themeToggleButton) {
    themeToggleButton.addEventListener("click", () => {
      document.body.classList.toggle("dark");
      const isDark = document.body.classList.contains("dark");
      localStorage.setItem("us_theme", isDark ? "dark" : "light");
    });
  }
// ================================
// ПЕРЕКЛЮЧАТЕЛЬ ЗВУКА
// ================================

const soundToggleButton = document.getElementById("sound-toggle-button");

// Проверяем сохраненную настройку при загрузке
function updateSoundToggleUI() {
  if (!soundToggleButton) return;
  const isSoundOff = localStorage.getItem("us_sound_enabled") === "off";
  
  if (isSoundOff) {
    soundToggleButton.classList.add("active"); // Визуально выключен (или включен, зависит от стиля)
  } else {
    soundToggleButton.classList.remove("active");
  }
}

// Инициализация при старте
updateSoundToggleUI();

if (soundToggleButton) {
  soundToggleButton.addEventListener("click", () => {
    const isSoundOff = localStorage.getItem("us_sound_enabled") === "off";
    
    if (isSoundOff) {
      localStorage.setItem("us_sound_enabled", "on");
    } else {
      localStorage.setItem("us_sound_enabled", "off");
    }
    
    updateSoundToggleUI();
  });
}
  // ================================
  // НАСТРОЕНИЕ ДНЯ
  // ================================

  let allMoods = [];

  async function loadMoods() {
    try {
      const res = await fetch("/api/moods");
      const data = await res.json();
      allMoods = data.moods || [];
      renderMoodCard();
    } catch (err) {
      console.error("Не удалось загрузить настроения:", err);
    }
  }

  function renderMoodCard() {
    const titleEl = document.getElementById("mood-title");
    const authorEl = document.getElementById("mood-author");
    const iconEl = document.getElementById("mood-icon");

    if (!titleEl || !authorEl || !iconEl) return;

    let mood = allMoods.find((m) => m.username === currentUser);

    if (!mood) {
      mood = allMoods[0];
    }

    if (!mood) {
      iconEl.textContent = "✎";
      titleEl.textContent = "что у тебя сегодня?";
      titleEl.classList.add("empty");
      authorEl.textContent = "нажми, чтобы добавить";
      return;
    }

    titleEl.classList.remove("empty");
    iconEl.textContent = "☼";
    titleEl.textContent = mood.mood_text;

    const who = mood.username === currentUser
      ? "ты"
      : getNickname(mood.username);

    authorEl.textContent = `${who} · ${formatTime(mood.mood_updated_at)}`;

    updateProfileMoodCard();
  }

  const moodCard = document.getElementById("mood-card");
  const moodModal = document.querySelector(".mood-modal");
  const moodTextarea = document.querySelector(".mood-textarea");
  const moodCounter = document.querySelector(".mood-counter");
  const moodSave = document.querySelector(".mood-save");
  const moodCancel = document.querySelector(".mood-cancel");
  const moodError = document.querySelector(".mood-error");

  function updateMoodCounter() {
    if (moodCounter && moodTextarea) {
      moodCounter.textContent = `${moodTextarea.value.length} / 80`;
    }
  }

  function openMoodModal() {
    if (!moodModal) return;

    const myMood = allMoods.find((m) => m.username === currentUser);
    moodTextarea.value = myMood ? myMood.mood_text : "";
    moodError.textContent = "";
    updateMoodCounter();

    moodModal.classList.add("open");
    setTimeout(() => moodTextarea.focus(), 50);
  }

  if (moodCard) {
    moodCard.addEventListener("click", openMoodModal);
  }

  if (moodTextarea) {
    moodTextarea.addEventListener("input", updateMoodCounter);
  }

  if (moodCancel) {
    moodCancel.addEventListener("click", () => {
      moodModal.classList.remove("open");
    });
  }

  if (moodModal) {
    moodModal.addEventListener("click", (e) => {
      if (e.target === moodModal) {
        moodModal.classList.remove("open");
      }
    });
  }

  async function saveMood() {
    const text = moodTextarea.value.trim();

    moodError.textContent = "";

    try {
      const res = await fetch("/api/profile/mood", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          authorization: authToken,
        },
        body: JSON.stringify({ mood_text: text }),
      });

      const data = await res.json();

      if (!res.ok) {
        moodError.textContent = data.error || "Ошибка сохранения";
        return;
      }

      const idx = allMoods.findIndex((m) => m.username === currentUser);

      if (data.mood_text) {
        const newMood = {
          username: currentUser,
          nickname: currentNickname,
          mood_text: data.mood_text,
          mood_updated_at: data.mood_updated_at,
        };

        if (idx >= 0) {
          allMoods.splice(idx, 1);
        }
        allMoods.unshift(newMood);
      } else {
        if (idx >= 0) {
          allMoods.splice(idx, 1);
        }
      }

      renderMoodCard();
      moodModal.classList.remove("open");
    } catch (err) {
      moodError.textContent = "Сервер недоступен";
      console.error(err);
    }
  }

  if (moodSave) {
    moodSave.addEventListener("click", saveMood);
  }

  if (moodTextarea) {
    moodTextarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        saveMood();
      }
    });
  }


  // ================================
  // ВСТРЕЧА — следующая
  // ================================

  let currentMeetup = null;

  async function loadMeetup() {
    try {
      const res = await fetch("/api/meetup");
      const data = await res.json();
      currentMeetup = data.meetup || null;
      renderMeetupCard();
    } catch (err) {
      console.error("Не удалось загрузить встречу:", err);
    }
  }

  function formatMeetupCountdown(meetupAt) {
    const now = new Date();
    const target = new Date(meetupAt);
    const diffMs = target.getTime() - now.getTime();

    if (diffMs <= 0) return "сейчас";

    const minutes = Math.floor(diffMs / (1000 * 60));
    const hours = Math.floor(diffMs / (1000 * 60 * 60));

    // Меньше часа — минуты
    if (minutes < 60) {
      return `через ${minutes} мин`;
    }

    // Меньше 12 часов — часы
    if (hours < 12) {
      return `через ${hours} ч`;
    }

    // Считаем разницу по календарным дням
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const targetDay = new Date(target.getFullYear(), target.getMonth(), target.getDate());
    const daysDiff = Math.round((targetDay - today) / (1000 * 60 * 60 * 24));

    if (daysDiff === 0) return "сегодня";
    if (daysDiff === 1) return "завтра";

    return `через ${daysDiff} дн`;
  }

  function formatMeetupDate(meetupAt) {
    const date = new Date(meetupAt);

    const day = date.getDate();
    const monthNames = [
      "января", "февраля", "марта", "апреля", "мая", "июня",
      "июля", "августа", "сентября", "октября", "ноября", "декабря",
    ];
    const month = monthNames[date.getMonth()];

    const weekdayNames = [
      "воскресенье", "понедельник", "вторник", "среда",
      "четверг", "пятница", "суббота",
    ];
    const weekday = weekdayNames[date.getDay()];

    const hh = String(date.getHours()).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");

    return `${weekday}, ${day} ${month} · ${hh}:${mm}`;
  }

  function renderMeetupCard() {
    const countdownEl = document.getElementById("meetup-countdown");
    const titleEl = document.getElementById("meetup-title");
    const dateEl = document.getElementById("meetup-date");

    if (!countdownEl || !titleEl || !dateEl) return;

    if (!currentMeetup) {
      countdownEl.textContent = "—";
      countdownEl.classList.add("empty");
      titleEl.textContent = "пока не запланировано";
      dateEl.textContent = "нажми, чтобы выбрать дату";
      return;
    }

    countdownEl.textContent = formatMeetupCountdown(currentMeetup.meetup_at);
    countdownEl.classList.remove("empty");
    titleEl.textContent = currentMeetup.title;
    dateEl.textContent = formatMeetupDate(currentMeetup.meetup_at);
  }

  const meetupCard = document.getElementById("meetup-card");
  window.window.meetupModal = document.querySelector(".meetup-modal");
  const meetupInputTitle = document.querySelector(".meetup-input-title");
  const meetupInputDate = document.querySelector(".meetup-input-date");
  const meetupSave = document.querySelector(".meetup-save");
  const meetupCancel = document.querySelector(".meetup-cancel");
  const meetupError = document.querySelector(".meetup-modal-error");

  function openMeetupModal() {
    if (!window.meetupModal) return;

    const pad = (n) => String(n).padStart(2, "0");

    if (currentMeetup) {
      meetupInputTitle.value = currentMeetup.title;

      const d = new Date(currentMeetup.meetup_at);
      const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      meetupInputDate.value = local;
    } else {
      meetupInputTitle.value = "";

      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(18, 0, 0, 0);
      const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      meetupInputDate.value = local;
    }

    meetupError.textContent = "";
    window.meetupModal.classList.add("open");
    setTimeout(() => meetupInputTitle.focus(), 50);
  }

  function closeMeetupModal() {
    if (window.meetupModal) window.meetupModal.classList.remove("open");
  }

  async function saveMeetup() {
    const title = meetupInputTitle.value.trim();
    const dateValue = meetupInputDate.value;

    if (!title) {
      meetupError.textContent = "Напиши, что за встреча";
      return;
    }

    if (!dateValue) {
      meetupError.textContent = "Выбери дату и время";
      return;
    }

    const meetupAt = new Date(dateValue).getTime();

    if (isNaN(meetupAt)) {
      meetupError.textContent = "Неверная дата";
      return;
    }

    meetupError.textContent = "";

    try {
      const res = await fetch("/api/meetup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authorization: authToken,
        },
        body: JSON.stringify({ title, meetup_at: meetupAt }),
      });

      const data = await res.json();

      if (!res.ok) {
        meetupError.textContent = data.error || "Ошибка сохранения";
        return;
      }

      currentMeetup = data.meetup;
      renderMeetupCard();
      closeMeetupModal();
    } catch (err) {
      meetupError.textContent = "Сервер недоступен";
      console.error(err);
    }
  }

  if (meetupCard) {
    meetupCard.addEventListener("click", openMeetupModal);
  }

  if (meetupCancel) {
    meetupCancel.addEventListener("click", closeMeetupModal);
  }

  if (window.meetupModal) {
    window.meetupModal.addEventListener("click", (e) => {
      if (e.target === window.meetupModal) closeMeetupModal();
    });
  }

  if (meetupSave) {
    meetupSave.addEventListener("click", saveMeetup);
  }

  // Обновляем счётчик каждую минуту
  setInterval(() => {
    if (currentMeetup) {
      renderMeetupCard();
    }
  }, 60000);

  // ================================
  // ЗАПУСК
  // ================================

  // ================================
  // НЕПРОЧИТАННЫЕ (по чатам)
  // ================================

  const chatBadge = document.getElementById("chat-badge");
  const meBadge = document.getElementById("me-badge");

  function getUnreadStorageKey() {
    return `us_unread_${currentUser || "unknown"}`;
  }

  function loadUnreadFromStorage() {
    const saved = localStorage.getItem(getUnreadStorageKey());
    try {
      const parsed = saved ? JSON.parse(saved) : {};
      // Защита: если пришло число, массив или null — сбрасываем
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        unreadByChat = {};
      } else {
        unreadByChat = parsed;
      }
    } catch {
      unreadByChat = {};
    }
    updateChatBadge();
  }

  function saveUnreadToStorage() {
    if (currentUser) {
      localStorage.setItem(
        getUnreadStorageKey(),
        JSON.stringify(unreadByChat)
      );
    }
  }

  // Сумма всех непрочитанных
  function getTotalUnread() {
    return Object.values(unreadByChat).reduce((sum, n) => sum + n, 0);
  }

  // Обновляет бейдж на вкладке chat
  function updateChatBadge() {
    const total = getTotalUnread();

    if (chatBadge) {
      if (total > 0) {
        chatBadge.textContent = total > 99 ? "99+" : String(total);
        chatBadge.classList.add("visible");
      } else {
        chatBadge.classList.remove("visible");
      }
    }

    document.title = total > 0 ? "● us." : "us.";
  }

  // Прибавить непрочитанное в чат
  function incrementUnread(chatId) {
    if (!chatId) return;
    const key = String(chatId);
    unreadByChat[key] = (unreadByChat[key] || 0) + 1;
    saveUnreadToStorage();
    updateChatBadge();
    if (allChats.length > 0) {
      renderChatsList();
    }
  }

  function clearUnread(chatId) {
    if (!chatId) return;
    delete unreadByChat[String(chatId)];
    saveUnreadToStorage();
    updateChatBadge();
    renderChatsList();
  }

  // Проверяем, открыт ли сейчас чат
  function isChatOpen() {
    return chatScreen && chatScreen.style.display === "flex";
  }

  // ================================
  // NOTES & PLANS
  // ================================

  let openedPlanId = null;
  let deletingPlanId = null;
  let editingPlanId = null;
  let allPlans = [];
  let currentPlanFilter = "today";
  let selectedPlanMembers = new Set();

  const plansList = document.getElementById("plans-list");
  const plansAddButton = document.getElementById("plans-add-button");
  const planActionsSheet = document.querySelector(".plan-actions-sheet");
  const planActionEdit = document.getElementById("plan-action-edit");
  const planActionToggle = document.getElementById("plan-action-toggle");
  const planActionToggleLabel = document.getElementById("plan-action-toggle-label");
  const planActionDelete = document.getElementById("plan-action-delete");
  const planActionCancel = document.getElementById("plan-action-cancel");

  const planConfirmModal = document.querySelector(".plan-confirm-modal");
  const planConfirmCancel = document.getElementById("plan-confirm-cancel");
  const planConfirmDelete = document.getElementById("plan-confirm-delete");


  // Модалка
  const planModal = document.querySelector(".plan-modal");
  const planModalTitle = document.getElementById("plan-modal-title");
  const planTextarea = document.getElementById("plan-textarea");
  const planDate = document.getElementById("plan-date");
  const planTime = document.getElementById("plan-time");
  const planRepeat = document.getElementById("plan-repeat");
  const planDateGroup = document.getElementById("plan-date-group");
  const planRepeatGroup = document.getElementById("plan-repeat-group");
  const planModalError = document.getElementById("plan-modal-error");
  const planCancel = document.getElementById("plan-cancel");
  const planSave = document.getElementById("plan-save");
  const planTypeOptions = document.querySelectorAll(".plan-type-option");

  let selectedPlanType = "note";

  // ─── Загрузка ───
  async function loadPlans() {
    if (!authToken) return;

    try {
      const res = await fetch("/api/schedule", {
        headers: { authorization: authToken },
      });
      const data = await res.json();
      allPlans = data.items || [];
      renderPlans();
      renderHomePlans();
      renderHomeShared();
    } catch (err) {
      console.error("Не удалось загрузить записи:", err);
    }
  }

  // ─── Рендер ───
  function renderPlans() {
    if (!plansList) return;

    const today = new Date().toISOString().slice(0, 10);

    // Фильтрация
    let filtered = allPlans.slice();

    if (currentPlanFilter === "today") {
      filtered = filtered.filter((item) => {
        if (item.type === "reminder") return item.done_date !== today;
        if (item.type === "note") return false;
        return item.date === today;
      });
    } else if (currentPlanFilter === "upcoming") {
      filtered = filtered.filter((item) => {
        if (item.type === "reminder") return false;
        if (item.type === "note") return false;
        return item.date > today;
      });
    } else if (currentPlanFilter === "done") {
      filtered = filtered.filter((item) => item.done_date === today);
    }
    // "all" — все

    if (filtered.length === 0) {
      plansList.innerHTML = `
      <div class="plans-empty">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="4" y="5" width="16" height="16" rx="2"/>
          <path d="M8 3v4"/>
          <path d="M16 3v4"/>
          <path d="M4 11h16"/>
        </svg>
        <div class="plans-empty-title">пока пусто</div>
        <div class="plans-empty-subtitle">
          нажми <strong>+</strong> в шапке,<br>чтобы добавить первую запись
        </div>
      </div>
    `;
      return;
    }

    // Сортировка
    filtered.sort((a, b) => {
      const da = a.date || "9999-12-31";
      const db_ = b.date || "9999-12-31";
      if (da !== db_) return da.localeCompare(db_);
      const ta = a.time || "99:99";
      const tb = b.time || "99:99";
      return ta.localeCompare(tb);
    });

    plansList.innerHTML = "";

    let lastDivider = null;

    for (const item of filtered) {
      // Разделитель по дате (для todo / event; для reminder — по repeat)
      let dividerLabel = null;

      if (item.type === "reminder") {
        dividerLabel = "напоминания";
      } else if (item.type === "note") {
        dividerLabel = "заметки";
      } else if (item.date === today) {
        dividerLabel = "сегодня";
      } else if (item.date) {
        dividerLabel = formatPlanDate(item.date);
      }

      if (dividerLabel && dividerLabel !== lastDivider) {
        const divider = document.createElement("div");
        divider.className = "plans-date-divider";
        const span = document.createElement("span");
        span.textContent = dividerLabel;
        divider.appendChild(span);
        plansList.appendChild(divider);
        lastDivider = dividerLabel;
      }

      plansList.appendChild(createPlanRow(item, today));
    }
  }

  // ─── Создание строки записи ───
  function createPlanRow(item, today) {
    const row = document.createElement("div");
    row.className = "plan-item";
    row.dataset.id = item.id;

    const isDone = item.done_date === today;

    if (isDone) row.classList.add("done");

    // Чекбокс (для todo / reminder) или иконка (для event — позже)
    if (item.type === "todo" || item.type === "reminder") {
      const check = document.createElement("div");
      check.className = "plan-check";
      if (isDone) check.classList.add("done");
      check.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5 12l5 5 9-11"/>
      </svg>
    `;
      check.addEventListener("click", (e) => {
        e.stopPropagation();
        togglePlanDone(item.id);
      });
      row.appendChild(check);
    }

    // Контент
    const content = document.createElement("div");
    content.className = "plan-item-content";

    const text = document.createElement("div");
    text.className = "plan-item-text";
    text.textContent = item.text;
    content.appendChild(text);

    // Мета: время + повтор
    const meta = document.createElement("div");
    meta.className = "plan-item-meta";

    if (item.time) {
      const timeEl = document.createElement("span");
      timeEl.textContent = item.time;
      meta.appendChild(timeEl);
    }

    if (item.type === "reminder" && item.repeat) {
      const repeatEl = document.createElement("span");
      repeatEl.className = "plan-item-repeat";
      repeatEl.textContent = repeatLabel(item.repeat);
      meta.appendChild(repeatEl);
    }

    if (meta.children.length > 0) {
      content.appendChild(meta);
    }

    // ← НОВОЕ: участники, если это общий план
    if (item.members && item.members.length > 0) {
      const membersEl = document.createElement("div");
      membersEl.className = "plan-item-members";

      const avatars = document.createElement("div");
      avatars.className = "plan-item-members-avatars";

      // Показываем до 3-х аватарок
      const show = item.members.slice(0, 3);
      for (const m of show) {
        const av = document.createElement("div");
av.className = "home-shared-member-avatar";
applyAvatar(av, m);
        avatars.appendChild(av);
      }

      membersEl.appendChild(avatars);

      const names = document.createElement("span");
      names.textContent = item.members
        .map((m) => getNickname(m))
        .join(", ");
      membersEl.appendChild(names);

      content.appendChild(membersEl);
    }

    row.appendChild(content);

    // Клик по карточке — открыть меню действий (позже)
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (e.target.closest(".plan-check")) return;
      openPlanActions(item);
    });

    return row;
  }

  // ─── Формат даты ───
  function formatPlanDate(dateStr) {
    const d = new Date(dateStr + "T00:00:00");
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    if (d.getTime() === tomorrow.getTime()) return "завтра";

    return d.toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
    });
  }

  // ─── Название повтора ───
  function repeatLabel(repeat) {
    const map = {
      daily: "каждый день",
      weekdays: "по будням",
      weekends: "по выходным",
      weekly: "каждую неделю",
      monthly: "каждый месяц",
    };
    return map[repeat] || repeat;
  }

  // ─── Toggle выполнено ───
  async function togglePlanDone(id) {
    try {
      const res = await fetch(`/api/schedule/${id}/toggle`, {
        method: "PUT",
        headers: { authorization: authToken },
      });

      if (!res.ok) return;

      const data = await res.json();

      const idx = allPlans.findIndex((p) => p.id === id);
      if (idx >= 0) allPlans[idx] = data.item;

      renderPlans();
      renderHomePlans();
      renderHomeShared();
    } catch (err) {
      console.error("Ошибка toggle:", err);
    }
  }

  // ─── Модалка создания ───
  function openPlanModal() {
    if (!planModal) return;

    editingPlanId = null;

    // Сброс — дефолт "заметка"
    selectedPlanType = "note";
    planTypeOptions.forEach((b) => {
      b.classList.toggle("active", b.dataset.type === "note");
    });

    // Сброс выбранных друзей
    selectedPlanMembers.clear();
    renderPlanMembersList();

    planTextarea.value = "";
    planDate.value = new Date().toISOString().slice(0, 10);
    planTime.value = "";
    planRepeat.value = "daily";
    planModalError.textContent = "";

    updatePlanModalFields();

    planModal.classList.add("open");
    setTimeout(() => planTextarea.focus(), 50);
  }
  function openPlanModalEdit(item) {
    if (!planModal) return;

    editingPlanId = item.id;

    // Заполняем поля
    selectedPlanType = item.type;
    planTypeOptions.forEach((b) => {
      b.classList.toggle("active", b.dataset.type === item.type);
    });

    // Заполняем участников
    selectedPlanMembers.clear();
    if (Array.isArray(item.members)) {
      for (const m of item.members) {
        selectedPlanMembers.add(m);
      }
    }
    renderPlanMembersList();

    planTextarea.value = item.text || "";
    planDate.value = item.date || new Date().toISOString().slice(0, 10);
    planTime.value = item.time || "";
    planRepeat.value = item.repeat || "daily";
    planModalError.textContent = "";

    updatePlanModalFields();

    planModal.classList.add("open");
    setTimeout(() => planTextarea.focus(), 50);
  }

  function closePlanModal() {
    if (planModal) planModal.classList.remove("open");
    editingPlanId = null;
  }

  const planExtraFields = document.getElementById("plan-extra-fields");

  const planMembersSection = document.getElementById("plan-members");

  function updatePlanModalFields() {
    if (selectedPlanType === "note") {
      planExtraFields.style.display = "none";
      if (planMembersSection) planMembersSection.style.display = "none";
      planModalTitle.textContent = "новая заметка";
    } else {
      planExtraFields.style.display = "flex";
      if (planMembersSection) planMembersSection.style.display = "block";

      if (selectedPlanType === "reminder") {
        planDateGroup.style.display = "none";
        planRepeatGroup.style.display = "block";
        planModalTitle.textContent = "новое напоминание";
      } else {
        planDateGroup.style.display = "block";
        planRepeatGroup.style.display = "none";
        planModalTitle.textContent = "новое дело";
      }
    }
  }

  // Рендер списка друзей в модалке
  function renderPlanMembersList() {
    const list = document.getElementById("plan-members-list");
    if (!list) return;

    list.innerHTML = "";

    // Друзей нет
    if (!allFriends || allFriends.length === 0) {
      list.innerHTML = `
      <div class="plan-members-empty">
        у тебя пока нет друзей
      </div>
    `;
      return;
    }

    for (const friend of allFriends) {
      const row = document.createElement("div");
      row.className = "plan-member";
      if (selectedPlanMembers.has(friend.username)) {
        row.classList.add("selected");
      }

      // Чекбокс
      const check = document.createElement("div");
      check.className = "plan-member-check";
      check.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5 12l5 5 9-11"/>
      </svg>
    `;
      row.appendChild(check);

      // Аватарка
      const avatar = document.createElement("div");
      avatar.className = "plan-member-avatar";
      const color = friend.avatar_color || "#e8e5db";
      avatar.style.background = color;
      avatar.style.color = getContrastTextColor(color);
      avatar.textContent = (friend.nickname || friend.username).charAt(0).toUpperCase();
      row.appendChild(avatar);

      // Имя
      const name = document.createElement("div");
      name.className = "plan-member-name";
      name.textContent = friend.nickname || friend.username;
      row.appendChild(name);

      // Клик — toggle
      row.addEventListener("click", () => {
        if (selectedPlanMembers.has(friend.username)) {
          selectedPlanMembers.delete(friend.username);
          row.classList.remove("selected");
        } else {
          selectedPlanMembers.add(friend.username);
          row.classList.add("selected");
        }
      });

      list.appendChild(row);
    }
  }

  // Выбор типа
  planTypeOptions.forEach((btn) => {
    btn.addEventListener("click", () => {
      planTypeOptions.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      selectedPlanType = btn.dataset.type;
      updatePlanModalFields();
    });
  });

  // ─── Сохранение ───
  async function savePlan() {
    const text = planTextarea.value.trim();

    if (!text) {
      planModalError.textContent = "Напиши что-нибудь";
      return;
    }

    const payload = {
      type: selectedPlanType,
      text,
      time: planTime.value || null,
    };

    if (selectedPlanType === "reminder") {
      payload.repeat = planRepeat.value;
    } else if (selectedPlanType === "note") {
      payload.time = null;
    } else {
      payload.date = planDate.value;
      if (!payload.date) {
        planModalError.textContent = "Выбери дату";
        return;
      }
    }

    // Участники (только для todo / reminder)
    if (selectedPlanType !== "note") {
      payload.members = Array.from(selectedPlanMembers);
    }

    planModalError.textContent = "";

    const isEdit = editingPlanId !== null;
    const url = isEdit
      ? `/api/schedule/${editingPlanId}`
      : "/api/schedule";
    const method = isEdit ? "PUT" : "POST";

    try {
      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          authorization: authToken,
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        planModalError.textContent = data.error || "Ошибка сохранения";
        return;
      }

      if (isEdit) {
        const idx = allPlans.findIndex((p) => p.id === editingPlanId);
        if (idx >= 0) allPlans[idx] = data.item;
      } else {
        allPlans.push(data.item);
      }

      renderPlans();
      renderHomePlans();
      renderHomeShared();
      closePlanModal();
      editingPlanId = null;
    } catch (err) {
      planModalError.textContent = "Сервер недоступен";
      console.error(err);
    }
  }

  // ─── Обработчики ───
  if (plansAddButton) {
    plansAddButton.addEventListener("click", openPlanModal);
  }

  if (planCancel) {
    planCancel.addEventListener("click", closePlanModal);
  }

  if (planModal) {
    planModal.addEventListener("click", (e) => {
      if (e.target === planModal) closePlanModal();
    });
  }

  if (planSave) {
    planSave.addEventListener("click", savePlan);
  }

  // Табы
  document.querySelectorAll(".plans-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".plans-tab").forEach((t) => {
        t.classList.remove("active");
      });
      tab.classList.add("active");
      currentPlanFilter = tab.dataset.filter;
      renderPlans();
    });
  });

  // Заглушка для меню действий (сделаем позже)
  function openPlanActions(item) {
    openedPlanId = item.id;

    // Настраиваем toggle
    const today = new Date().toISOString().slice(0, 10);
    const isDone = item.done_date === today;

    if (item.type === "note") {
      // У заметок нет "выполнено" — скрываем toggle
      planActionToggle.style.display = "none";
    } else {
      planActionToggle.style.display = "flex";
      planActionToggleLabel.textContent = isDone
        ? "снять отметку"
        : "отметить выполненным";
    }

    planActionsSheet.classList.add("open");
  }
  // ─── Закрытие меню ───
  if (planActionCancel) {
    planActionCancel.addEventListener("click", () => {
      planActionsSheet.classList.remove("open");
      openedPlanId = null;
    });
  }

  if (planActionsSheet) {
    planActionsSheet.addEventListener("click", (e) => {
      if (e.target === planActionsSheet) {
        planActionsSheet.classList.remove("open");
        openedPlanId = null;
      }
    });
  }

  // ─── Toggle из меню ───
  if (planActionToggle) {
    planActionToggle.addEventListener("click", () => {
      if (!openedPlanId) return;
      planActionsSheet.classList.remove("open");
      togglePlanDone(openedPlanId);
      openedPlanId = null;
    });
  }

  // ─── Редактировать ───
  if (planActionEdit) {
    planActionEdit.addEventListener("click", () => {
      if (!openedPlanId) return;
      const item = allPlans.find((p) => p.id === openedPlanId);
      if (!item) return;

      planActionsSheet.classList.remove("open");
      openPlanModalEdit(item);
    });
  }

  // ─── Удалить ───
  if (planActionDelete) {
    planActionDelete.addEventListener("click", () => {
      if (!openedPlanId) return;
      deletingPlanId = openedPlanId;
      planActionsSheet.classList.remove("open");
      planConfirmModal.classList.add("open");
    });
  }

  if (planConfirmCancel) {
    planConfirmCancel.addEventListener("click", () => {
      planConfirmModal.classList.remove("open");
      deletingPlanId = null;
    });
  }

  if (planConfirmModal) {
    planConfirmModal.addEventListener("click", (e) => {
      if (e.target === planConfirmModal) {
        planConfirmModal.classList.remove("open");
        deletingPlanId = null;
      }
    });
  }

  if (planConfirmDelete) {
    planConfirmDelete.addEventListener("click", async () => {
      if (!deletingPlanId) return;

      try {
        const res = await fetch(`/api/schedule/${deletingPlanId}`, {
          method: "DELETE",
          headers: { authorization: authToken },
        });

        if (!res.ok) return;

        allPlans = allPlans.filter((p) => p.id !== deletingPlanId);
        renderPlans();

        planConfirmModal.classList.remove("open");
        deletingPlanId = null;
      } catch (err) {
        console.error("Не удалось удалить:", err);
      }
    });
  }

  // ================================
  // HOME — NOTES & PLANS
  // ================================

  const homePlansList = document.getElementById("home-plans-list");
  const homePlansAdd = document.getElementById("home-plans-add");
  const homePlansDate = document.getElementById("home-plans-date");

  // Рендер записей на home
  function renderHomePlans() {
  if (!homePlansList) return;

  const today = new Date().toISOString().slice(0, 10);

  // Фильтр: сегодняшние НЕВЫПОЛНЕННЫЕ todo + невыполненные напоминания
  const items = allPlans.filter((item) => {
    // Если это напоминание — показываем, только если оно еще не выполнено сегодня
    if (item.type === "reminder") {
      return item.done_date !== today;
    }
    // Если это обычное дело — показываем, если оно на сегодня И еще не выполнено
    if (item.type === "todo") {
      return item.date === today && item.done_date !== today;
    }
    return false; // note / event не показываем на home
  });

    // Сортировка по времени
    items.sort((a, b) => {
      const ta = a.time || "99:99";
      const tb = b.time || "99:99";
      return ta.localeCompare(tb);
    });

    if (items.length === 0) {
      homePlansList.innerHTML = `
    <div class="home-plans-empty">
      ничего не запланировано
    </div>
  `;
      return;
    }

    homePlansList.innerHTML = "";

    for (const item of items) {
      homePlansList.appendChild(createHomePlanRow(item, today));
    }
  }

// Рендер общих планов на home
function renderHomeShared() {
  const section = document.getElementById("home-shared");
  const list = document.getElementById("home-shared-list");

  if (!section || !list) return;

  const today = new Date().toISOString().slice(0, 10);

  // Все планы, где есть участники (общие), НО только невыполненные
  const shared = allPlans.filter((item) => {
    const isShared = Array.isArray(item.members) && item.members.length > 0;
    if (!isShared) return false;
    
    // Скрываем выполненные (если дата выполнения — сегодня)
    const isDone = item.done_date === today;
    return !isDone;
  });

  // Сортировка: сначала по дате (ближайшие), потом по времени
  shared.sort((a, b) => {
    const da = a.date || "9999-12-31";
    const db_ = b.date || "9999-12-31";
    if (da !== db_) return da.localeCompare(db_);
    const ta = a.time || "99:99";
    const tb = b.time || "99:99";
    return ta.localeCompare(tb);
  });

  // Если ничего нет — скрываем секцию
  if (shared.length === 0) {
    section.style.display = "none";
    return;
  }

  section.style.display = "block";
  list.innerHTML = "";

  for (const item of shared) {
    list.appendChild(createHomeSharedRow(item, today));
  }
}

// Строка общего плана на home
function createHomeSharedRow(item, today) {
  const row = document.createElement("div");
  row.className = "home-shared-item";
  row.dataset.id = item.id;

  const isDone = item.done_date === today;
  if (isDone) row.classList.add("done");

  // Чекбокс (для todo / reminder)
  if (item.type === "todo" || item.type === "reminder") {
    const check = document.createElement("div");
    check.className = "home-shared-check";
    if (isDone) check.classList.add("done");
    check.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5 12l5 5 9-11"/>
      </svg>
    `;
    check.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePlanDone(item.id).then(() => renderHomeShared());
    });
    row.appendChild(check);
  }

  // Контент
  const content = document.createElement("div");
  content.className = "home-shared-content";

  // Текст
  const text = document.createElement("div");
  text.className = "home-shared-text";
  text.textContent = item.text;
  content.appendChild(text);

  // Мета: дата + время
  const meta = document.createElement("div");
  meta.className = "home-shared-meta";

  if (item.date) {
    const dateEl = document.createElement("span");
    dateEl.textContent = formatHomeSharedDate(item.date);
    meta.appendChild(dateEl);
  }

  if (item.time) {
    const timeEl = document.createElement("span");
    timeEl.textContent = item.time;
    meta.appendChild(timeEl);
  }

  if (meta.children.length > 0) {
    content.appendChild(meta);
  }

    // С кем — аватарка + имя
  if (item.members && item.members.length > 0) {
    const membersEl = document.createElement("div");
    membersEl.className = "home-shared-members";

    for (const m of item.members) {
      const wrap = document.createElement("span");
      wrap.className = "home-shared-member";

      // Круглая аватарка
      const av = document.createElement("span");
      av.className = "home-shared-member-avatar";
      const color = userColorsMap[m] || "#e8e5db";
      av.style.background = color;
      av.style.color = getContrastTextColor(color);
      av.textContent = getNickname(m).charAt(0).toUpperCase();
      wrap.appendChild(av);

      // Имя
      const name = document.createElement("span");
      name.textContent = getNickname(m);
      wrap.appendChild(name);

      membersEl.appendChild(wrap);
    }

    content.appendChild(membersEl);
  }

  row.appendChild(content);

  // Клик — открыть plans
  row.addEventListener("click", (e) => {
    if (e.target.closest(".home-shared-check")) return;
    switchScreen("plans");
  });

  return row;
}

// Формат даты: сегодня / завтра / 12 октября
function formatHomeSharedDate(dateStr) {
  if (!dateStr) return "";

  const today = new Date().toISOString().slice(0, 10);

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);

  if (dateStr === today) return "сегодня";
  if (dateStr === tomorrowStr) return "завтра";

  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
  });
}

  // Создание строки для home
  function createHomePlanRow(item, today) {
    const row = document.createElement("div");
    row.className = "home-plan-item";
    row.dataset.id = item.id;

    const isDone = item.done_date === today;
    if (isDone) row.classList.add("done");

    // Чекбокс
    if (item.type === "todo" || item.type === "reminder") {
      const check = document.createElement("div");
      check.className = "home-plan-check";
      if (isDone) check.classList.add("done");
      check.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5 12l5 5 9-11"/>
      </svg>
    `;
      check.addEventListener("click", (e) => {
        e.stopPropagation();
        togglePlanDone(item.id).then(() => renderHomePlans());
      });
      row.appendChild(check);
    }

    // Контент — flex, текст слева, мета справа
    const content = document.createElement("div");
    content.className = "home-plan-content";

    const text = document.createElement("div");
    text.className = "home-plan-text";
    text.textContent = item.text;
    content.appendChild(text);

    // Мета: время + повтор
    const meta = document.createElement("div");
    meta.className = "home-plan-meta";

    if (item.time) {
      const timeEl = document.createElement("span");
      timeEl.textContent = item.time;
      meta.appendChild(timeEl);
    }

    if (item.type === "reminder" && item.repeat) {
      const repeatEl = document.createElement("span");
      repeatEl.className = "home-plan-repeat";
      repeatEl.textContent = repeatLabel(item.repeat);
      meta.appendChild(repeatEl);
    }

    if (meta.children.length > 0) {
      content.appendChild(meta);
    }

    row.appendChild(content);

    // Клик по строке — открыть plans
    row.addEventListener("click", (e) => {
      if (e.target.closest(".home-plan-check")) return;
      switchScreen("plans");
    });

    return row;
  }

  // Кнопка + на карточке — открыть модалку создания и перейти в plans
  if (homePlansAdd) {
    homePlansAdd.addEventListener("click", () => {
      switchScreen("plans");
      setTimeout(openPlanModal, 100);
    });
  }

  // Обновить дату на карточке
  function updateHomePlansDate() {
    if (!homePlansDate) return;

    const today = new Date();
    const weekday = today.toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
    const day = today.getDate();
    const month = today.toLocaleDateString("en-US", { month: "long" }).toLowerCase();

    homePlansDate.textContent = `${weekday} · ${day} ${month}`;
  }

  updateHomePlansDate();

  // ================================
  // REPLY В ЧАТЕ
  // ================================

  let replyToMessage = null; // { id, author, text }

  const messageActionsMenu = document.getElementById("message-actions-menu");
  const messageActionReply = document.getElementById("message-action-reply");
  const messageActionCopy = document.getElementById("message-action-copy");
  const messageActionDelete = document.getElementById("message-action-delete");

  const replyBar = document.getElementById("reply-bar");
  const replyBarName = document.getElementById("reply-bar-name");
  const replyBarText = document.getElementById("reply-bar-text");
  const replyBarClose = document.getElementById("reply-bar-close");

  let contextMessageId = null;

  // Правый клик по сообщению
  document.addEventListener("contextmenu", (e) => {
    const row = e.target.closest(".message-row");
    if (!row) return;

    if (!row.closest(".messages")) return;

    e.preventDefault();

    const id = Number(row.dataset.id);
    if (!id) return;

    contextMessageId = id;

    const msg = findMessageById(id);
    const isOwn = msg && msg.author === currentUser;
    messageActionDelete.style.display = isOwn ? "flex" : "none";


    updateSaveMenuButton(id);
    messageActionsMenu.classList.add("open");

    // Используем clientX / clientY — координаты относительно окна
    const menuWidth = messageActionsMenu.offsetWidth;
    const menuHeight = messageActionsMenu.offsetHeight;

    let x = e.clientX;
    let y = e.clientY;

    // Если меню не влезает справа — сдвигаем влево
    if (x + menuWidth > window.innerWidth - 10) {
      x = window.innerWidth - menuWidth - 10;
    }

    // Если не влезает снизу — сдвигаем вверх
    if (y + menuHeight > window.innerHeight - 10) {
      y = window.innerHeight - menuHeight - 10;
    }

    messageActionsMenu.style.left = x + "px";
    messageActionsMenu.style.top = y + "px";
  });

  // Закрытие меню по клику вне
  document.addEventListener("click", (e) => {
    if (!messageActionsMenu) return;
    if (!messageActionsMenu.contains(e.target)) {
      messageActionsMenu.classList.remove("open");
    }
  });

  // Скрываем меню при скролле
  if (messages) {
    messages.addEventListener("scroll", () => {
      if (messageActionsMenu) messageActionsMenu.classList.remove("open");
    });
  }

  // Находим сообщение в массиве (в памяти)
  // Все сообщения хранятся в DOM, но у нас нет к ним массива. Используем DOM.
  function findMessageById(id) {
    const row = messages.querySelector(`.message-row[data-id="${id}"]`);
    if (!row) return null;

    const bubble = row.querySelector(".message-bubble");
    const nameEl = row.querySelector(".message-name");

    const isOwn = row.classList.contains("own");
    const author = isOwn ? currentUser : (nameEl ? nameEl.textContent : "");

    // Для фото-сообщений bubble.textContent вернёт пустую строку,
    // потому что там только <img>. Пробуем найти текст в .message-bubble-text
    let text = "";
if (bubble) {
  const textEl = bubble.querySelector(".message-bubble-text");
  if (textEl) {
    text = textEl.textContent;
  } else if (bubble.querySelector(".chat-photo")) {
    text = "📷 фото";
  } else if (bubble.querySelector(".chat-video")) {
    text = "🎥 видео";
  } else if (bubble.querySelector(".voice-bubble")) {
    text = "🎤 голосовое";
  } else {
    text = bubble.textContent;
  }
}

    return {
      id,
      author,
      text,
    };
  }

  // Reply
  if (messageActionReply) {
    messageActionReply.addEventListener("click", () => {
      const msg = findMessageById(contextMessageId);
      if (!msg) return;

      replyToMessage = {
        id: msg.id,
        author: msg.author,
        text: msg.text,
      };

      // Показываем полосу
      replyBarName.textContent = replyToMessage.author;
      replyBarText.textContent = replyToMessage.text.length > 80
        ? replyToMessage.text.slice(0, 80) + "…"
        : replyToMessage.text;

      replyBar.classList.add("open");
      messageActionsMenu.classList.remove("open");
      input.focus();
    });
  }

  // Copy
  if (messageActionCopy) {
    messageActionCopy.addEventListener("click", async () => {
      const msg = findMessageById(contextMessageId);
      if (!msg) return;

      try {
        await navigator.clipboard.writeText(msg.text);
      } catch (err) {
        console.error("Не удалось скопировать:", err);
      }

      messageActionsMenu.classList.remove("open");
    });
  }

  // ================================
  // СОХРАНЁННЫЕ СООБЩЕНИЯ — ЛОГИКА
  // ================================

  let savedMessageIds = new Set();  // быстрый поиск "сохранено ли уже"

  // Загрузка списка id сохранённых (для проверки в меню)
  async function loadSavedIds() {
    if (!authToken) return;
    try {
      const res = await fetch("/api/saved", {
        headers: { authorization: authToken },
      });
      const data = await res.json();
      savedMessageIds.clear();
      for (const item of (data.items || [])) {
        savedMessageIds.add(item.id);
      }
      updateSavedCardValue();
    } catch (err) {
      console.error("Не удалось загрузить сохранённые id:", err);
    }
  }

  // Обновить текст карточки в me
  function updateSavedCardValue() {
    const el = document.getElementById("profile-saved-value");
    if (!el) return;

    const count = savedMessageIds.size;
    if (count === 0) {
      el.textContent = "пока пусто";
    } else {
      el.textContent = `${count} ${plural(count, "сообщение", "сообщения", "сообщений")}`;
    }
  }

  // Склонение русских слов
  function plural(n, one, few, many) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
  }

  // Обновить состояние кнопки "сохранить" в меню
  function updateSaveMenuButton(messageId) {
    const label = document.getElementById("message-action-save-label");
    if (!label) return;

    if (savedMessageIds.has(messageId)) {
      label.textContent = "убрать из сохранённых";
    } else {
      label.textContent = "сохранить";
    }
  }

  // Save / Unsave
  const messageActionSave = document.getElementById("message-action-save");

  if (messageActionSave) {
    messageActionSave.addEventListener("click", async () => {
      if (!contextMessageId) return;

      const isSaved = savedMessageIds.has(contextMessageId);

      messageActionsMenu.classList.remove("open");

      try {
        if (isSaved) {
          // Убрать
          const res = await fetch(`/api/saved/${contextMessageId}`, {
            method: "DELETE",
            headers: { authorization: authToken },
          });
          if (!res.ok) return;
          savedMessageIds.delete(contextMessageId);
        } else {
          // Сохранить
          const res = await fetch("/api/saved", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              authorization: authToken,
            },
            body: JSON.stringify({ message_id: contextMessageId }),
          });
          if (!res.ok) {
            const data = await res.json();
            console.error("Не удалось сохранить:", data.error);
            return;
          }
          savedMessageIds.add(contextMessageId);
        }

        updateSavedCardValue();
      } catch (err) {
        console.error("Ошибка сохранения:", err);
      }
    });
  }

  // Delete — реальное удаление
  if (messageActionDelete) {
    messageActionDelete.addEventListener("click", async () => {
      if (!contextMessageId) return;

      messageActionsMenu.classList.remove("open");

      try {
        const res = await fetch(`/api/messages/${contextMessageId}`, {
          method: "DELETE",
          headers: { authorization: authToken },
        });

        if (!res.ok) {
          const data = await res.json();
          console.error("Не удалось удалить:", data.error);
          return;
        }

        // Убираем сообщение из DOM сразу (не ждём WebSocket)
        removeMessageFromDOM(contextMessageId);
      } catch (err) {
        console.error("Сервер недоступен:", err);
      }
    });
  }

  // Закрыть полосу ответа
  if (replyBarClose) {
    replyBarClose.addEventListener("click", () => {
      replyToMessage = null;
      replyBar.classList.remove("open");
    });
  }

  // Переопределяем sendMessage с учётом reply
  function sendMessageWithReply() {
    const text = input.value.trim();
    if (text === "") return;

    if (!ws || ws.readyState !== 1) {
      console.warn("WebSocket не подключён, сообщение не отправлено");
      return;
    }

    const payload = {
      type: "message",
      text: text,
      chat_id: currentChatId,
    };

    if (replyToMessage) {
      payload.reply_to_id = replyToMessage.id;
    }

    ws.send(JSON.stringify(payload));

    input.value = "";
    input.focus();
    sendButton.classList.remove("ready");

    // Сбрасываем reply
    replyToMessage = null;
    replyBar.classList.remove("open");
  }

  // Перевешиваем обработчики
  sendButton.removeEventListener("click", sendMessage);
  sendButton.addEventListener("click", sendMessageWithReply);

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      sendMessageWithReply();
    }
  });
  // Клик по цитате — скролл к оригиналу
  document.addEventListener("click", (e) => {
    const quote = e.target.closest(".message-reply-quote");
    if (!quote) return;

    const originalId = Number(quote.dataset.replyToId);
    if (!originalId) return;

    const originalRow = messages.querySelector(
      `.message-row[data-id="${originalId}"]`
    );

    if (!originalRow) {
      console.warn("Оригинальное сообщение не найдено в DOM");
      return;
    }

    // Плавный скролл
    originalRow.scrollIntoView({ behavior: "smooth", block: "center" });

    // Подсветка на секунду
    originalRow.classList.add("flash");
    setTimeout(() => {
      originalRow.classList.remove("flash");
    }, 1500);
  });
  // ================================
  // КНОПКА "ВНИЗ" В ЧАТЕ
  // ================================

  const scrollBottomButton = document.getElementById("scroll-bottom-button");
  const scrollBadge = document.getElementById("scroll-badge");

  let newMessagesCount = 0; // сколько сообщений пришло, пока ты был не внизу

  function isMessagesAtBottom() {
    if (!messages) return true;
    return messages.scrollHeight - messages.scrollTop - messages.clientHeight < 100;
  }

  function updateScrollBottomButton() {
    if (!scrollBottomButton) return;

    const atBottom = isMessagesAtBottom();

    if (atBottom) {
      scrollBottomButton.classList.remove("visible");
      newMessagesCount = 0;
      updateScrollBadge();
    } else {
      scrollBottomButton.classList.add("visible");
    }
  }

  function updateScrollBadge() {
    if (!scrollBadge) return;

    if (newMessagesCount > 0) {
      scrollBadge.textContent = newMessagesCount > 99 ? "99+" : String(newMessagesCount);
      scrollBadge.classList.add("visible");
    } else {
      scrollBadge.classList.remove("visible");
    }
  }

  // Клик по кнопке — плавно вниз
  if (scrollBottomButton) {
    scrollBottomButton.addEventListener("click", () => {
      messages.scrollTo({ top: messages.scrollHeight, behavior: "smooth" });
      newMessagesCount = 0;
      updateScrollBadge();
    });
  }

  // Отслеживаем скролл
  if (messages) {
    messages.addEventListener("scroll", () => {
      updateScrollBottomButton();
    });
  }

  // Проверка после отрисовки сообщения — нужно ли показать кнопку или увеличить счётчик
  const originalRenderMessageForScroll = renderMessage;
  window.renderMessage = function (msg) {
    const wasAtBottom = isMessagesAtBottom();
    const isOwnMessage = msg.author === currentUser;

    originalRenderMessageForScroll(msg);

    if (!wasAtBottom && !isOwnMessage) {
      newMessagesCount += 1;
      updateScrollBadge();
    }

    updateScrollBottomButton();
  };

  // Перевешиваем вызовы, которые используют renderMessage
  // (WebSocket history, message и другие места)
  // ================================
  // ЗВУК УВЕДОМЛЕНИЯ
  // ================================

  let audioContext = null;

  function playNotificationSound() {
    try {
      if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
      }

      const now = audioContext.currentTime;

      // Основной тон
      const osc = audioContext.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(660, now + 0.12);

      // Громкость — плавно вверх, потом затухание
      const gain = audioContext.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.15, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

      osc.connect(gain);
      gain.connect(audioContext.destination);

      osc.start(now);
      osc.stop(now + 0.2);
    } catch (err) {
      console.warn("Не удалось воспроизвести звук:", err);
    }
  }

  // Проверка: не отключил ли пользователь звук
  function isSoundEnabled() {
    return localStorage.getItem("us_sound_enabled") !== "off";
  }

  // Воспроизводим звук при новом чужом сообщении
  function notifyNewMessage(msg) {
    if (msg.author === currentUser) return;   // свои не озвучиваем
    if (!isSoundEnabled()) return;

    playNotificationSound();
  }
  // При первом клике "разбудим" AudioContext
  document.addEventListener("click", () => {
    if (!audioContext) {
      try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
      } catch (err) { }
    }
    if (audioContext && audioContext.state === "suspended") {
      audioContext.resume();
    }
  }, { once: true });
  // ================================
  // ПРОЧТЕНИЕ СООБЩЕНИЙ
  // =================================

  // { messageId: Set([username1, username2]) }
  let messagesReadBy = new Map();

  function initReadsMap() {
    messagesReadBy = new Map();
  }

  function setReadBy(messageId, usernames) {
    messagesReadBy.set(messageId, new Set(usernames));
  }

  function addReader(messageId, username) {
    if (!messagesReadBy.has(messageId)) {
      messagesReadBy.set(messageId, new Set());
    }
    messagesReadBy.get(messageId).add(username);
  }

  // Все ли прочитали (кроме автора)?
  function isReadByAll(messageId, author) {
    const readers = messagesReadBy.get(messageId);
    if (!readers) return false;

    // Для группового чата — все участники, кроме автора
    // Для личного — собеседник
    if (!currentChat || !currentChat.members) return false;

    const otherMembers = currentChat.members.filter((u) => u !== author);
    if (otherMembers.length === 0) return false;

    return otherMembers.every((u) => readers.has(u));
  }
  // Обновляет галочки у сообщения по id
  function updateMessageTicks(messageId) {
    const row = messages.querySelector(`.message-row[data-id="${messageId}"]`);
    if (!row) return;

    // Только для своих
    if (!row.classList.contains("own")) return;

    const meta = row.querySelector(".message-meta");
    if (!meta) return;

    const time = meta.dataset.time || "";

    // Находим автора — свой всегда currentUser
    const author = currentUser;

    // Определяем состояние
    if (isReadByAll(messageId, author)) {
      meta.innerHTML = `${time} <span class="tick tick-read">✓✓</span>`;
    } else {
      meta.innerHTML = `${time} <span class="tick tick-sent">✓</span>`;
    }
  }
  // Отмечаем все чужие сообщения прочитанными
  async function markAllMessagesAsRead() {
    if (!authToken) return;

    // Собираем id чужих сообщений из DOM
    const rows = messages.querySelectorAll(".message-row:not(.own)");
    const ids = [];

    rows.forEach((row) => {
      const id = Number(row.dataset.id);
      if (id) ids.push(id);
    });

    if (ids.length === 0) return;

    try {
      await fetch("/api/messages/read", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authorization: authToken,
        },
        body: JSON.stringify({ message_ids: ids }),
      });
    } catch (err) {
      console.error("Не удалось отметить прочтение:", err);
    }
  }
  // ================================
  // ПРОФИЛЬ — ЦВЕТ И ДЕНЬ РОЖДЕНИЯ
  // ================================

  let selectedColor = null;

  const profileSettingsButton = document.getElementById("profile-settings-button");
  const profileModal = document.querySelector(".profile-modal");
  const colorPicker = document.getElementById("color-picker");
  const colorSwatches = document.querySelectorAll(".color-swatch");
  const birthdayDaySelect = document.getElementById("birthday-day");
  const birthdayMonthSelect = document.getElementById("birthday-month");
  const profileModalError = document.querySelector(".profile-modal-error");
  const profileModalCancel = document.querySelector(".profile-modal-cancel");
  const profileModalSave = document.querySelector(".profile-modal-save");

  // Открытие модалки
  function openProfileModal() {
    if (!profileModal) return;

    // Текущий цвет — из usersMap (или дефолт)
    selectedColor = currentAvatarColor || "#c7d9e2";

    // Подсвечиваем выбранный
    colorSwatches.forEach((sw) => {
      sw.classList.toggle("active", sw.dataset.color === selectedColor);
    });

    // ДР
    // ДР — разбираем MM-DD на месяц и день
    if (currentBirthday && /^\d{2}-\d{2}$/.test(currentBirthday)) {
      const [mm, dd] = currentBirthday.split("-");
      birthdayMonthSelect.value = mm;
      birthdayDaySelect.value = dd;
    } else {
      birthdayMonthSelect.value = "";
      birthdayDaySelect.value = "";
    }

    profileModalError.textContent = "";
    profileModal.classList.add("open");
  }

  // Закрытие
  function closeProfileModal() {
    if (profileModal) profileModal.classList.remove("open");
  }

  // Выбор цвета
  colorSwatches.forEach((sw) => {
    sw.addEventListener("click", () => {
      selectedColor = sw.dataset.color;
      colorSwatches.forEach((s) => {
        s.classList.toggle("active", s === sw);
      });
    });
  });

  // Сохранение
  async function saveProfileSettings() {
    profileModalError.textContent = "";

    // Проверка ДР
    // Собираем ДР из двух селектов
    const day = birthdayDaySelect.value;
    const month = birthdayMonthSelect.value;

    let birthday = "";

    // Если выбран только один — ошибка
    if ((day && !month) || (!day && month)) {
      profileModalError.textContent = "Выбери и день, и месяц";
      return;
    }

    // Если оба выбраны — собираем MM-DD
    if (day && month) {
      birthday = `${month}-${day}`;
    }

    try {
      // Сохраняем цвет
      const colorRes = await fetch("/api/profile/color", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          authorization: authToken,
        },
        body: JSON.stringify({ avatar_color: selectedColor }),
      });

      if (!colorRes.ok) {
        const data = await colorRes.json();
        profileModalError.textContent = data.error || "Ошибка цвета";
        return;
      }

      // Сохраняем ДР
      const bdRes = await fetch("/api/profile/birthday", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          authorization: authToken,
        },
        body: JSON.stringify({ birthday }),
      });

      if (!bdRes.ok) {
        const data = await bdRes.json();
        profileModalError.textContent = data.error || "Ошибка ДР";
        return;
      }

      // Обновляем локально
      currentAvatarColor = selectedColor;
      currentBirthday = birthday || null;

      // Обновляем всё, где показываются аватарки
      updateProfileUI();


      closeProfileModal();
    } catch (err) {
      profileModalError.textContent = "Сервер недоступен";
      console.error(err);
    }
  }

  // Обработчики
  if (profileSettingsButton) {
    profileSettingsButton.addEventListener("click", openProfileModal);
  }

  if (profileModalCancel) {
    profileModalCancel.addEventListener("click", closeProfileModal);
  }

  if (profileModal) {
    profileModal.addEventListener("click", (e) => {
      if (e.target === profileModal) closeProfileModal();
    });
  }

  if (profileModalSave) {
    profileModalSave.addEventListener("click", saveProfileSettings);
  }

  // ================================
// АВАТАРКА — ЛИЧНАЯ
// ================================

const avatarInput = document.getElementById("avatar-input");
const avatarUploadButton = document.getElementById("avatar-upload-button");
const avatarUploadLabel = document.getElementById("avatar-upload-label");
const avatarRemoveButton = document.getElementById("avatar-remove-button");



// Открыть диалог выбора файла
if (avatarUploadButton && avatarInput) {
  avatarUploadButton.addEventListener("click", () => {
    avatarInput.click();
  });
}

// Обработка выбранного файла
if (avatarInput) {
  avatarInput.addEventListener("change", async () => {
    const file = avatarInput.files[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      alert("Фото слишком большое (макс. 5 МБ)");
      avatarInput.value = "";
      return;
    }

    if (!file.type.startsWith("image/")) {
      alert("Только изображения");
      avatarInput.value = "";
      return;
    }

    // Меняем лейбл на «загрузка...»
    if (avatarUploadLabel) avatarUploadLabel.textContent = "загрузка...";

    try {
      const formData = new FormData();
      formData.append("avatar", file);

      const res = await fetch("/api/upload/avatar", {
        method: "POST",
        headers: { authorization: authToken },
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.error || "Не удалось загрузить");
        if (avatarUploadLabel) avatarUploadLabel.textContent = "загрузить фото";
        avatarInput.value = "";
        return;
      }

      currentAvatarUrl = data.url;

      // Обновляем локально
      updateAvatarUI();

      // Меняем лейбл
      if (avatarUploadLabel) avatarUploadLabel.textContent = "изменить фото";
      if (avatarRemoveButton) avatarRemoveButton.style.display = "block";

      avatarInput.value = "";
    } catch (err) {
      alert("Сервер недоступен");
      if (avatarUploadLabel) avatarUploadLabel.textContent = "загрузить фото";
      avatarInput.value = "";
      console.error(err);
    }
  });
}

// Удалить аватарку
if (avatarRemoveButton) {
  avatarRemoveButton.addEventListener("click", async () => {
    if (!confirm("Удалить аватарку?")) return;

    try {
      const res = await fetch("/api/profile/avatar", {
        method: "DELETE",
        headers: { authorization: authToken },
      });

      if (!res.ok) return;

      currentAvatarUrl = null;
      updateAvatarUI();

      if (avatarUploadLabel) avatarUploadLabel.textContent = "загрузить фото";
      avatarRemoveButton.style.display = "none";
    } catch (err) {
      console.error(err);
    }
  });
}

// Обновление UI профиля (аватарка в me)
function updateAvatarUI() {
  const avatarEl = document.getElementById("profile-avatar");
  if (!avatarEl) return;

  if (currentAvatarUrl) {
    avatarEl.textContent = "";
    avatarEl.style.backgroundImage = `url(${currentAvatarUrl})`;
    avatarEl.style.backgroundSize = "cover";
    avatarEl.style.backgroundPosition = "center";
  } else {
    avatarEl.style.backgroundImage = "";
    const displayName = currentNickname || currentUser;
    avatarEl.textContent = displayName.charAt(0).toUpperCase();
    avatarEl.style.background = currentAvatarColor || "#c7d9e2";
    avatarEl.style.color = getContrastTextColor(currentAvatarColor || "#c7d9e2");
  }

  // Кнопка «удалить» видна только если фото есть
  if (avatarRemoveButton) {
    avatarRemoveButton.style.display = currentAvatarUrl ? "block" : "none";
  }
  if (avatarUploadLabel) {
    avatarUploadLabel.textContent = currentAvatarUrl ? "изменить фото" : "загрузить фото";
  }
}

  // ================================
  // КАРТОЧКА ПРОФИЛЯ ПОЛЬЗОВАТЕЛЯ
  // ================================

  const userCardModal = document.querySelector(".user-card-modal");
  const userCardAvatar = document.getElementById("user-card-avatar");
  const userCardName = document.getElementById("user-card-name");
  const userCardStatus = document.getElementById("user-card-status");
  const userCardMoodSection = document.getElementById("user-card-mood-section");
  const userCardMood = document.getElementById("user-card-mood");
  const userCardBirthdaySection = document.getElementById("user-card-birthday-section");
  const userCardBirthday = document.getElementById("user-card-birthday");
  const userCardClose = document.querySelector(".user-card-close");
  const userCardOpenChat = document.getElementById("user-card-open-chat");

  // Формат месяца
  const MONTH_NAMES_RU = [
    "января", "февраля", "марта", "апреля", "мая", "июня",
    "июля", "августа", "сентября", "октября", "ноября", "декабря",
  ];

  // Форматируем ДР
  function formatBirthday(birthday) {
    if (!birthday) return null;

    const [mm, dd] = birthday.split("-").map(Number);
    if (!mm || !dd) return null;

    const day = Number(dd);
    const monthName = MONTH_NAMES_RU[mm - 1] || "";

    // Сегодня ли ДР?
    const today = new Date();
    const isToday = today.getDate() === day && (today.getMonth() + 1) === mm;

    return {
      text: `${day} ${monthName}`,
      isToday,
    };
  }

  // Открываем карточку
  function openUserCard(username) {
    if (!userCardModal || !username) return;

    // Ник
    userCardName.textContent = getNickname(username);

    // Цвет + буква
    applyAvatar(userCardAvatar, username);

    // Статус
    const isOnline = lastOnlineUsers.includes(username);
    if (username === currentUser) {
      userCardStatus.textContent = "that's you";
    } else if (isOnline) {
      userCardStatus.textContent = "online · now";
    } else {
      userCardStatus.textContent = "offline";
    }

    // Mood
    const mood = allMoods.find((m) => m.username === username);
    if (mood && mood.mood_text) {
      userCardMood.textContent = mood.mood_text;
      userCardMoodSection.style.display = "block";
    } else {
      userCardMoodSection.style.display = "none";
    }

    // ДР
    const bd = userBirthdaysMap[username];
    const formatted = formatBirthday(bd);
    if (formatted) {
      userCardBirthday.textContent = formatted.text + (formatted.isToday ? " 🎂" : "");
      userCardBirthdaySection.style.display = "block";
    } else {
      userCardBirthdaySection.style.display = "none";
    }

    // Кнопка «открыть чат» — только для чужих
    if (username === currentUser) {
      userCardOpenChat.style.display = "none";
      userCardClose.style.flex = "1";
    } else {
      userCardOpenChat.style.display = "block";
      userCardClose.style.flex = "1";
      userCardOpenChat.style.flex = "1";
    }

    // Запоминаем открытого
    userCardModal.dataset.username = username;

    // Кнопка "добавить в друзья"
    renderUserCardFriendAction(username);

    userCardModal.classList.add("open");
  }

  function closeUserCard() {
    if (userCardModal) userCardModal.classList.remove("open");
  }

  // Клик по карточке на home
  document.addEventListener("click", (e) => {
    const card = e.target.closest(".person-card");
    if (!card) return;

    const username = card.dataset.username;
    if (!username) return;

    openUserCard(username);
  });

  // Клик по аватарке в чате
  document.addEventListener("click", (e) => {
    const avatar = e.target.closest(".message-avatar");
    if (!avatar) return;

    const username = avatar.dataset.username;
    if (!username) return;

    // Не открываем для своих (у своих нет аватарки, но на всякий)
    if (username === currentUser) return;

    openUserCard(username);
  });

  // Закрытие
  if (userCardClose) {
    userCardClose.addEventListener("click", closeUserCard);
  }

  if (userCardModal) {
    userCardModal.addEventListener("click", (e) => {
      if (e.target === userCardModal) closeUserCard();
    });
  }

  // Открыть чат
  if (userCardOpenChat) {
    userCardOpenChat.addEventListener("click", async () => {
      const targetUser = userCardModal.dataset.username;

      closeUserCard();

      if (!targetUser || targetUser === currentUser) return;

      // Создаём/открываем личный чат с этим пользователем
      await createDirectChat(targetUser);
    });
  }
  // ================================
  // ЗАСТАВКА ПРИ ЗАГРУЗКЕ
  // ================================

  const splashScreen = document.getElementById("splash-screen");

  function hideSplash() {
    if (!splashScreen) return;
    splashScreen.classList.add("hidden");

    // Через 500 мс полностью убираем из DOM
    setTimeout(() => {
      splashScreen.style.display = "none";
    }, 500);
  }

  // Показываем заставку только раз за сессию (sessionStorage)
  if (splashScreen) {
    const splashShown = sessionStorage.getItem("us_splash_shown");

    if (splashShown === "1") {
      // Уже показывали — просто убираем сразу
      splashScreen.style.display = "none";
    } else {
      // Первый раз — показываем на 700 мс
      sessionStorage.setItem("us_splash_shown", "1");
      setTimeout(hideSplash, 700);
    }
  }
  // ================================
  // СПИСОК ЧАТОВ
  // ================================

  let allChats = [];
  let currentChatId = null;    // какой чат сейчас открыт
  let currentChat = null;      // объект чата (с members и т.д.)

  const chatsListScreen = document.querySelector(".chats-list-screen");
  const chatsList = document.getElementById("chats-list");
  const chatsAddButton = document.getElementById("chats-add-button");

  // Загрузка списка чатов с сервера
  async function loadChats() {
    if (!authToken) return;

    try {
      const res = await fetch("/api/chats", {
        headers: { authorization: authToken },
      });
      const data = await res.json();
      allChats = data.chats || [];
      renderChatsList();
    } catch (err) {
      console.error("Не удалось загрузить чаты:", err);
    }
  }

  // Отрисовка списка
  function renderChatsList() {
    if (!chatsList) return;

    if (allChats.length === 0) {
      chatsList.innerHTML = `
      <div class="chats-empty">
        <div class="empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 12a8.5 8.5 0 0 1-12.3 7.6L3 21l1.4-5.5A8.5 8.5 0 1 1 21 12z"/>
          </svg>
        </div>
        <div class="empty-title">пока пусто</div>
        <div class="empty-subtitle">нажми + в шапке, чтобы начать чат</div>
      </div>
    `;
      return;
    }

    chatsList.innerHTML = "";

    for (const chat of allChats) {
      const item = document.createElement("div");
      item.className = "chat-item";
      item.dataset.chatId = chat.id;

      // ─── Аватарка ───
      const avatar = document.createElement("div");
      avatar.className = "chat-item-avatar";

      if (chat.type === "group") {
  if (chat.avatar_url) {
    avatar.textContent = "";
    avatar.style.backgroundImage = `url(${chat.avatar_url})`;
    avatar.style.backgroundSize = "cover";
    avatar.style.backgroundPosition = "center";
    avatar.classList.add("has-photo");
  } else {
    avatar.style.backgroundImage = "";
    avatar.classList.remove("has-photo");

    const initials = chat.members
      .slice(0, 3)
      .map((u) => getNickname(u).charAt(0).toUpperCase())
      .join("");

    const firstColor = userColorsMap[chat.members[0]] || "#c5d0c5";
    avatar.style.background = firstColor;
    avatar.style.color = getContrastTextColor(firstColor);
    avatar.style.fontSize = "14px";
    avatar.fontWeight = "600";
    avatar.textContent = initials || "G";
  }
} else {
  const otherUser = chat.members.find((u) => u !== currentUser);
  applyAvatar(avatar, otherUser, getNickname(otherUser));
}

      // ─── Текст ───
      const content = document.createElement("div");
      content.className = "chat-item-content";

      const name = document.createElement("div");
      name.className = "chat-item-name";

      if (chat.type === "group") {
        name.textContent = chat.title || "the three of us";
      } else {
        const otherUser = chat.members.find((u) => u !== currentUser);
        name.textContent = getNickname(otherUser);
      }

      const last = document.createElement("div");
      last.className = "chat-item-last";

      if (chat.lastMessage) {
        const author = chat.lastMessage.author === currentUser
          ? "ты"
          : getNickname(chat.lastMessage.author);
        last.textContent = `${author}: ${chat.lastMessage.text}`;
      } else {
        last.textContent = "нет сообщений";
      }

      content.appendChild(name);
      content.appendChild(last);

      // ─── Время справа ───
      const meta = document.createElement("div");
      meta.className = "chat-item-meta";

      if (chat.lastMessage) {
        const time = document.createElement("div");
        time.className = "chat-item-time";
        time.textContent = formatTime(chat.lastMessage.created_at);
        meta.appendChild(time);
      }

      // ← НОВОЕ: бейдж с непрочитанными
      const unread = unreadByChat[String(chat.id)] || 0;
      if (unread > 0) {
        const badge = document.createElement("div");
        badge.className = "chat-item-badge";
        badge.textContent = unread > 99 ? "99+" : String(unread);
        meta.appendChild(badge);
      }

      // ─── Собираем ───
      item.appendChild(avatar);
      item.appendChild(content);
      item.appendChild(meta);

      // ─── Клик → открываем чат ───
      item.addEventListener("click", () => {
        openChat(chat.id);
      });

      chatsList.appendChild(item);
    }
  }

  // Открыть конкретный чат
  async function openChat(chatId) {
    const chat = allChats.find((c) => c.id === chatId);
    if (!chat) return;

    currentChatId = chatId;
    currentChat = chat;

    // Скрываем main-screens целиком, показываем конкретный чат
    mainScreens.style.display = "none";
    chatScreen.style.display = "flex";

    // Меняем название в шапке
    updateChatHeader();

    clearUnread(chatId);

    // Загружаем историю этого чата
    await loadMessagesForChat(chatId);

    messages.scrollTop = messages.scrollHeight;
  }

  // Обновляет шапку chat-screen: название и участники
  function updateChatHeader() {
    if (!currentChat) return;

    const titleEl = document.querySelector(".chat-header-title");
    const membersEl = document.querySelector(".chat-header-members");

    if (currentChat.type === "group") {
      // Группа: заголовок + список всех
      if (titleEl) titleEl.textContent = currentChat.title || "the three of us";
      if (membersEl) {
        membersEl.textContent = currentChat.members
          .map((u) => getNickname(u))
          .join(" · ");
        membersEl.classList.remove("typing");
      }
    } else {
      // Личка: заголовок — имя собеседника, статус — online/offline
      const otherUser = currentChat.members.find((u) => u !== currentUser);

      if (titleEl) titleEl.textContent = getNickname(otherUser);

      if (membersEl) {
        const isOnline = lastOnlineUsers.includes(otherUser);
        membersEl.textContent = isOnline ? "online · now" : "offline";
        membersEl.classList.remove("typing");
      }
    }
  }

  // Загружаем сообщения для конкретного чата
  async function loadMessagesForChat(chatId) {
    try {
      // Очищаем .messages
      messages
        .querySelectorAll(".message-row, .reaction-bubble, .chat-date")
        .forEach((el) => el.remove());

      const res = await fetch(`/api/messages?chat_id=${chatId}`, {
        headers: { authorization: authToken },
      });
      const data = await res.json();

      if (!data.messages) return;

      // Рендерим без анимации
      window.__renderingHistory = true;
      for (const msg of data.messages) {
        renderMessage(msg);
      }
      window.__renderingHistory = false;

      // Скролл к последнему сообщению (без анимации)
      messages.scrollTop = messages.scrollHeight;

      // Отмечаем прочитанными
      setTimeout(markAllMessagesAsRead, 100);
    } catch (err) {
      console.error("Не удалось загрузить сообщения чата:", err);
    }
  }
  // ================================
  // СОЗДАНИЕ НОВОГО ЧАТА
  // ================================

  const newChatModal = document.querySelector(".new-chat-modal");
  const newChatUsers = document.getElementById("new-chat-users");
  const newChatCancel = document.querySelector(".new-chat-cancel");

  // Групповой чат
  const newChatGroupUsers = document.getElementById("new-chat-group-users");
  const newChatGroupTitle = document.getElementById("new-chat-group-title");
  const newChatGroupError = document.getElementById("new-chat-group-error");
  const newChatCreateGroup = document.getElementById("new-chat-create-group");

  let selectedGroupMembers = new Set();

  // Вкладки
  document.querySelectorAll(".new-chat-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.tab;

      document.querySelectorAll(".new-chat-tab").forEach((t) => {
        t.classList.toggle("active", t === tab);
      });

      document.querySelectorAll(".new-chat-panel").forEach((p) => {
        p.classList.toggle("active", p.dataset.panel === target);
      });
    });
  });

  // Открыть модалку
  function openNewChatModal() {
    if (!newChatModal) return;

    // Сбрасываем вкладку на "личный"
    document.querySelectorAll(".new-chat-tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.tab === "direct");
    });
    document.querySelectorAll(".new-chat-panel").forEach((p) => {
      p.classList.toggle("active", p.dataset.panel === "direct");
    });

    // Сброс группы
    selectedGroupMembers.clear();
    newChatGroupTitle.value = "";
    newChatGroupError.textContent = "";

    // ─── Личный ───
    const alreadyChatting = allChats
      .filter((c) => c.type === "direct")
      .flatMap((c) => c.members)
      .filter((u) => u !== currentUser);

    const available = allFriends.filter(
      (u) => !alreadyChatting.includes(u.username)
    );

    newChatUsers.innerHTML = "";

    if (available.length === 0) {
      newChatUsers.innerHTML = `
      <div class="new-chat-empty">
        у тебя уже есть чаты со всеми
      </div>
    `;
    } else {
      for (const user of available) {
        newChatUsers.appendChild(createChatUserButton(user, false));
      }
    }

    // ─── Группа ───
    newChatGroupUsers.innerHTML = "";

    if (allFriends.length === 0) {
      newChatGroupUsers.innerHTML = `
      <div class="new-chat-empty">
        у тебя пока нет друзей
      </div>
    `;
      newChatCreateGroup.disabled = true;
    } else {
      newChatCreateGroup.disabled = false;
      for (const user of allFriends) {
        newChatGroupUsers.appendChild(createChatUserButton(user, true));
      }
    }

    newChatModal.classList.add("open");
  }

  // Создание кнопки пользователя (для обеих вкладок)
  function createChatUserButton(user, selectable) {
    const btn = document.createElement("button");
    btn.className = "new-chat-user";
    if (selectable) btn.classList.add("selectable");

    const avatar = document.createElement("div");
avatar.className = "new-chat-user-avatar";
applyAvatar(avatar, user.username, user.nickname);

    const nameWrap = document.createElement("div");
    nameWrap.style.flex = "1";
    nameWrap.style.minWidth = "0";

    const name = document.createElement("div");
    name.className = "new-chat-user-name";
    name.textContent = user.nickname || user.username;

    const hint = document.createElement("div");
    hint.className = "new-chat-user-hint";
    hint.textContent = selectable ? "@" + (user.handle || user.username.toLowerCase()) : "начать личный чат";

    nameWrap.appendChild(name);
    nameWrap.appendChild(hint);

    btn.appendChild(avatar);
    btn.appendChild(nameWrap);

    if (selectable) {
      const check = document.createElement("div");
      check.className = "new-chat-user-check";
      check.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5 12l5 5 9-11"/>
      </svg>
    `;
      btn.appendChild(check);

      btn.addEventListener("click", () => {
        if (selectedGroupMembers.has(user.username)) {
          selectedGroupMembers.delete(user.username);
          btn.classList.remove("selected");
        } else {
          selectedGroupMembers.add(user.username);
          btn.classList.add("selected");
        }
      });
    } else {
      btn.addEventListener("click", () => {
        createDirectChat(user.username);
      });
    }

    return btn;
  }

  function closeNewChatModal() {
    if (newChatModal) newChatModal.classList.remove("open");
  }

  // Создать личный чат через API
  async function createDirectChat(withUser) {
    if (!authToken) return;

    try {
      const res = await fetch("/api/chats", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authorization: authToken,
        },
        body: JSON.stringify({ with: withUser }),
      });

      const data = await res.json();

      if (!res.ok) {
        console.error("Не удалось создать чат:", data.error);
        return;
      }

      closeNewChatModal();

      await loadChats();
      openChat(data.chat.id);
    } catch (err) {
      console.error("Сервер недоступен:", err);
    }
  }

  // Создать групповой чат
  async function createGroupChat() {
    const title = newChatGroupTitle.value.trim();
    const members = Array.from(selectedGroupMembers);

    if (!title) {
      newChatGroupError.textContent = "Напиши название группы";
      return;
    }

    if (members.length === 0) {
      newChatGroupError.textContent = "Добавь хотя бы одного человека";
      return;
    }

    newChatGroupError.textContent = "";

    try {
      const res = await fetch("/api/chats/group", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authorization: authToken,
        },
        body: JSON.stringify({ title, members }),
      });

      const data = await res.json();

      if (!res.ok) {
        newChatGroupError.textContent = data.error || "Ошибка";
        return;
      }

      closeNewChatModal();
      await loadChats();
      openChat(data.chat.id);
    } catch (err) {
      newChatGroupError.textContent = "Сервер недоступен";
      console.error(err);
    }
  }

  // Обработчики
  if (chatsAddButton) {
    chatsAddButton.addEventListener("click", openNewChatModal);
  }

  if (newChatCancel) {
    newChatCancel.addEventListener("click", closeNewChatModal);
  }

  if (newChatModal) {
    newChatModal.addEventListener("click", (e) => {
      if (e.target === newChatModal) closeNewChatModal();
    });
  }

  if (newChatCreateGroup) {
    newChatCreateGroup.addEventListener("click", createGroupChat);
  }


  // ================================
  // УДАЛЕНИЕ ЧАТА
  // ================================

  const chatActionsMenu = document.getElementById("chat-actions-menu");
  const chatActionDelete = document.getElementById("chat-action-delete");
  const confirmChatModal = document.querySelector(".confirm-chat-modal");
  const confirmChatCancel = document.querySelector(".confirm-chat-cancel");
  const confirmChatDelete = document.querySelector(".confirm-chat-delete");

  let pendingDeleteChatId = null;

  // Правый клик по карточке чата
  document.addEventListener("contextmenu", (e) => {
    const item = e.target.closest(".chat-item");
    if (!item) return;

    e.preventDefault();

    const chatId = Number(item.dataset.chatId);
    if (!chatId) return;

    const chat = allChats.find((c) => c.id === chatId);
    if (!chat) return;

    // Группу не показываем — она защищена
    if (chat.type === "group") return;

    pendingDeleteChatId = chatId;

    // Показываем меню у курсора
    chatActionsMenu.classList.add("open");

    const menuWidth = chatActionsMenu.offsetWidth;
    const menuHeight = chatActionsMenu.offsetHeight;

    let x = e.clientX;
    let y = e.clientY;

    if (x + menuWidth > window.innerWidth - 10) {
      x = window.innerWidth - menuWidth - 10;
    }
    if (y + menuHeight > window.innerHeight - 10) {
      y = window.innerHeight - menuHeight - 10;
    }

    chatActionsMenu.style.left = x + "px";
    chatActionsMenu.style.top = y + "px";
  });

  // Закрытие меню при клике вне
  document.addEventListener("click", (e) => {
    if (!chatActionsMenu) return;
    if (!chatActionsMenu.contains(e.target)) {
      chatActionsMenu.classList.remove("open");
    }
  });

  // Скрываем меню при скролле списка
  if (chatsList) {
    chatsList.addEventListener("scroll", () => {
      if (chatActionsMenu) chatActionsMenu.classList.remove("open");
    });
  }

  // Клик по «удалить» в меню
  if (chatActionDelete) {
    chatActionDelete.addEventListener("click", () => {
      if (!pendingDeleteChatId) return;

      chatActionsMenu.classList.remove("open");
      confirmChatModal.classList.add("open");
    });
  }

  // Отмена
  if (confirmChatCancel) {
    confirmChatCancel.addEventListener("click", () => {
      confirmChatModal.classList.remove("open");
      pendingDeleteChatId = null;
    });
  }

  if (confirmChatModal) {
    confirmChatModal.addEventListener("click", (e) => {
      if (e.target === confirmChatModal) {
        confirmChatModal.classList.remove("open");
        pendingDeleteChatId = null;
      }
    });
  }

  // Подтверждение удаления
  if (confirmChatDelete) {
    confirmChatDelete.addEventListener("click", async () => {
      if (!pendingDeleteChatId) return;

      try {
        const res = await fetch(`/api/chats/${pendingDeleteChatId}`, {
          method: "DELETE",
          headers: { authorization: authToken },
        });

        if (!res.ok) {
          const data = await res.json();
          console.error("Не удалось удалить:", data.error);
          return;
        }

        // Если этот чат был открыт — вернёмся к списку
        if (currentChatId === pendingDeleteChatId) {
          currentChatId = null;
          currentChat = null;
          chatScreen.style.display = "none";
          mainScreens.style.display = "flex";
        }

        confirmChatModal.classList.remove("open");
        pendingDeleteChatId = null;

        // Перезагружаем список
        await loadChats();
      } catch (err) {
        console.error("Сервер недоступен:", err);
      }
    });
  }
  // ================================
  // КАРТОЧКА MOOD В ПРОФИЛЕ
  // ================================

  const profileMoodCard = document.getElementById("profile-mood-card");
  const profileMoodValue = document.getElementById("profile-mood-value");

  if (profileMoodCard) {
    profileMoodCard.addEventListener("click", () => {
      // Открываем ту же модалку mood, что и раньше
      if (moodModal) {
        openMoodModal();
      }
    });
  }

  // Обновляет текст карточки mood
  function updateProfileMoodCard() {
    if (!profileMoodValue) return;

    const myMood = allMoods.find((m) => m.username === currentUser);

    if (myMood && myMood.mood_text) {
      profileMoodValue.textContent = myMood.mood_text;
    } else {
      profileMoodValue.textContent = "— не выбрано";
    }
  }

  // ================================
  // @USERNAME (handle)
  // ================================

  const handleModal = document.querySelector(".handle-modal");
  const handleInput = document.querySelector(".handle-input");
  const handleSave = document.querySelector(".handle-save");
  const handleCancel = document.querySelector(".handle-cancel");
  const handleError = document.querySelector(".handle-error");

  const editHandleButton = document.getElementById("edit-handle-button");

  if (editHandleButton) {
    editHandleButton.addEventListener("click", () => {
      handleInput.value = currentHandle || "";
      handleError.textContent = "";
      handleModal.classList.add("open");
      setTimeout(() => handleInput.focus(), 50);
    });
  }

  if (handleCancel) {
    handleCancel.addEventListener("click", () => {
      handleModal.classList.remove("open");
    });
  }

  if (handleModal) {
    handleModal.addEventListener("click", (e) => {
      if (e.target === handleModal) handleModal.classList.remove("open");
    });
  }

  async function saveHandle() {
    const raw = handleInput.value.trim();
    if (!raw) {
      handleError.textContent = "Введи username";
      return;
    }

    handleError.textContent = "";

    try {
      const res = await fetch("/api/profile/handle", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          authorization: authToken,
        },
        body: JSON.stringify({ handle: raw }),
      });

      const data = await res.json();

      if (!res.ok) {
        handleError.textContent = data.error || "Ошибка";
        return;
      }

      currentHandle = data.handle;
      updateProfileUI();
      handleModal.classList.remove("open");
    } catch (err) {
      handleError.textContent = "Сервер недоступен";
      console.error(err);
    }
  }

  if (handleSave) handleSave.addEventListener("click", saveHandle);

  if (handleInput) {
    handleInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") saveHandle();
    });
  }
  // ================================
  // ДРУЗЬЯ
  // ================================

  let allFriends = [];       // принятые
  let friendIncoming = [];   // входящие заявки
  let friendOutgoing = [];   // мои отправленные

  const friendsScreen = document.querySelector(".friends-screen");
  const friendsList = document.getElementById("friends-list");
  const friendsBackButton = document.getElementById("friends-back-button");
  const friendsAddButton = document.getElementById("friends-add-button");
  const friendsButton = document.getElementById("friends-button");
  const friendsCountValue = document.getElementById("friends-count-value");

  const friendsSearch = document.getElementById("friends-search");
  const friendsSearchInput = document.getElementById("friends-search-input");
  const friendsSearchCancel = document.getElementById("friends-search-cancel");

  // ─── Загрузка ───
  async function loadFriends() {
    if (!authToken) return;

    try {
      const res = await fetch("/api/friends", {
        headers: { authorization: authToken },
      });
      const data = await res.json();

      allFriends = data.friends || [];
      friendIncoming = data.incoming || [];
      friendOutgoing = data.outgoing || [];

      // Счётчик в me
      if (friendsCountValue) {
        friendsCountValue.textContent = allFriends.length;
      }

      // Бейдж заявок
      updateFriendBadges();

      renderFriends();
      renderHomeFriends();
    } catch (err) {
      console.error("Не удалось загрузить друзей:", err);
    }
  }

  function updateFriendBadges() {
    const count = friendIncoming.length;

    // Бейдж рядом со счётчиком friends в me
    const badge = document.getElementById("friends-badge");
    if (badge) {
      if (count > 0) {
        badge.textContent = count > 99 ? "99+" : String(count);
        badge.classList.add("visible");
      } else {
        badge.classList.remove("visible");
      }
    }

    // Бейдж на вкладке me в навигации
    const meBadge = document.getElementById("me-badge");
    if (meBadge) {
      if (count > 0) {
        meBadge.textContent = count > 99 ? "99+" : String(count);
        meBadge.classList.add("visible");
      } else {
        meBadge.classList.remove("visible");
      }
    }
  }

  // ─── Рендер ───
  function renderFriends() {
    if (!friendsList) return;

    friendsList.innerHTML = "";

    const total =
      friendIncoming.length + allFriends.length + friendOutgoing.length;

    if (total === 0) {
      friendsList.innerHTML = `
      <div class="friends-empty">
        пока никого нет<br>
        нажми 🔍 в шапке, чтобы найти людей
      </div>
    `;
      return;
    }

    // Входящие заявки
    if (friendIncoming.length > 0) {
      addFriendsSection("заявки", friendIncoming, "incoming");
    }

    // Друзья
    if (allFriends.length > 0) {
      addFriendsSection("друзья", allFriends, "friend");
    }

    // Отправленные
    if (friendOutgoing.length > 0) {
      addFriendsSection("отправлено", friendOutgoing, "outgoing");
    }
  }

  // ─── Секция списка ───
  function addFriendsSection(label, users, type) {
    const div = document.createElement("div");
    div.className = "friends-section-label";
    div.textContent = label;
    friendsList.appendChild(div);

    for (const u of users) {
      friendsList.appendChild(createFriendRow(u, type));
    }
  }

  // ─── Строка друга / заявки ───
  function createFriendRow(user, type) {
    const row = document.createElement("div");
    row.className = "friend-item";

    // Аватарка
    const avatar = document.createElement("div");
avatar.className = "friend-avatar";
applyAvatar(avatar, user.username, user.nickname);

    // Онлайн-точка
    if (lastOnlineUsers.includes(user.username)) {
      avatar.classList.add("online");
    }

    row.appendChild(avatar);

    // Инфо
    const info = document.createElement("div");
    info.className = "friend-info";

    const name = document.createElement("div");
    name.className = "friend-name";
    name.textContent = user.nickname || user.username;
    info.appendChild(name);

    const handle = document.createElement("div");
    handle.className = "friend-handle";
    handle.textContent = "@" + (user.handle || user.username.toLowerCase());
    info.appendChild(handle);

    row.appendChild(info);

    // Действия
    const actions = document.createElement("div");
    actions.className = "friend-actions";

    if (type === "incoming") {
      // Принять / отклонить
      const acceptBtn = document.createElement("button");
      acceptBtn.className = "friend-action-btn primary";
      acceptBtn.textContent = "принять";
      acceptBtn.addEventListener("click", () => acceptFriend(user.username));
      actions.appendChild(acceptBtn);

      const declineBtn = document.createElement("button");
      declineBtn.className = "friend-action-btn danger";
      declineBtn.textContent = "отклонить";
      declineBtn.addEventListener("click", () => removeFriend(user.username));
      actions.appendChild(declineBtn);
    } else if (type === "outgoing") {
      // Отменить
      const cancelBtn = document.createElement("button");
      cancelBtn.className = "friend-action-btn";
      cancelBtn.textContent = "отменить";
      cancelBtn.addEventListener("click", () => removeFriend(user.username));
      actions.appendChild(cancelBtn);
    } else if (type === "friend") {
      // Написать / удалить
      const chatBtn = document.createElement("button");
      chatBtn.className = "friend-action-btn primary";
      chatBtn.textContent = "написать";
      chatBtn.addEventListener("click", () => openChatWithUser(user.username));
      actions.appendChild(chatBtn);

      const removeBtn = document.createElement("button");
      removeBtn.className = "friend-action-btn danger";
      removeBtn.textContent = "×";
      removeBtn.title = "удалить из друзей";
      removeBtn.addEventListener("click", () => {
        if (confirm(`Удалить ${user.nickname || user.username} из друзей?`)) {
          removeFriend(user.username);
        }
      });
      actions.appendChild(removeBtn);
    }

    row.appendChild(actions);

    return row;
  }

  // ─── API-вызовы ───
  async function sendFriendRequest(username) {
    try {
      const res = await fetch("/api/friends/request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authorization: authToken,
        },
        body: JSON.stringify({ username }),
      });

      const data = await res.json();

      if (!res.ok) {
        console.error("Ошибка заявки:", data.error);
        alert(data.error || "Не удалось отправить заявку");
        return;
      }

      await loadFriends();

      // Если открыта карточка пользователя — обновим кнопку
      if (userCardModal && userCardModal.dataset.username === username) {
        renderUserCardFriendAction(username);
      }
    } catch (err) {
      console.error("Сервер недоступен:", err);
    }
  }

  async function acceptFriend(username) {
    try {
      const res = await fetch("/api/friends/accept", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authorization: authToken,
        },
        body: JSON.stringify({ username }),
      });

      if (!res.ok) return;

      await loadFriends();

      if (userCardModal && userCardModal.dataset.username === username) {
        renderUserCardFriendAction(username);
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function removeFriend(username) {
    try {
      const res = await fetch("/api/friends/remove", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authorization: authToken,
        },
        body: JSON.stringify({ username }),
      });

      if (!res.ok) return;

      await loadFriends();

      if (userCardModal && userCardModal.dataset.username === username) {
        renderUserCardFriendAction(username);
      }
    } catch (err) {
      console.error(err);
    }
  }

  // ─── Открыть чат с пользователем ───
  async function openChatWithUser(username) {
    if (!username) return;
    // Используем существующую функцию из чатов
    await createDirectChat(username);
  }

  // ─── Кнопка «назад» на экране друзей ───
  if (friendsBackButton) {
    friendsBackButton.addEventListener("click", () => {
      switchScreen("me");
    });
  }

  // ─── Открытие экрана друзей ───
  if (friendsButton) {
    friendsButton.addEventListener("click", () => {
      switchScreen("friends");
      loadFriends();
    });
  }

  // ─── Поиск ───
  if (friendsAddButton) {
    friendsAddButton.addEventListener("click", () => {
      friendsSearch.style.display = "flex";
      friendsSearchInput.value = "";
      friendsSearchInput.focus();
      friendsList.innerHTML = "";
    });
  }

  if (friendsSearchCancel) {
    friendsSearchCancel.addEventListener("click", () => {
      friendsSearch.style.display = "none";
      friendsSearchInput.value = "";
      renderFriends();
    });
  }

  if (friendsSearchInput) {
    let searchTimer = null;

    friendsSearchInput.addEventListener("input", () => {
      clearTimeout(searchTimer);

      searchTimer = setTimeout(async () => {
        const q = friendsSearchInput.value.trim();

        if (q.length < 2) {
          friendsList.innerHTML = `
          <div class="friends-empty">
            введи минимум 2 символа
          </div>
        `;
          return;
        }

        try {
          const res = await fetch(
            `/api/users/search?q=${encodeURIComponent(q)}`,
            { headers: { authorization: authToken } }
          );
          const data = await res.json();

          renderSearchResults(data.users || []);
        } catch (err) {
          console.error("Ошибка поиска:", err);
        }
      }, 300);
    });
  }

  function renderSearchResults(users) {
    if (!friendsList) return;

    friendsList.innerHTML = "";

    if (users.length === 0) {
      friendsList.innerHTML = `
      <div class="friends-empty">
        никого не нашли
      </div>
    `;
      return;
    }

    const label = document.createElement("div");
    label.className = "friends-section-label";
    label.textContent = "нашли";
    friendsList.appendChild(label);

    for (const u of users) {
      friendsList.appendChild(createSearchResultRow(u));
    }
  }

  function createSearchResultRow(user) {
    const row = document.createElement("div");
    row.className = "friend-item";

    // Аватарка
    const avatar = document.createElement("div");
    avatar.className = "friend-avatar";
    const color = user.avatar_color || "#e8e5db";
    avatar.style.background = color;
    avatar.style.color = getContrastTextColor(color);
    avatar.textContent = (user.nickname || user.username).charAt(0).toUpperCase();
    row.appendChild(avatar);

    // Инфо
    const info = document.createElement("div");
    info.className = "friend-info";

    const name = document.createElement("div");
    name.className = "friend-name";
    name.textContent = user.nickname || user.username;
    info.appendChild(name);

    const handle = document.createElement("div");
    handle.className = "friend-handle";
    handle.textContent = "@" + (user.handle || user.username.toLowerCase());
    info.appendChild(handle);

    row.appendChild(info);

    // Кнопка — в зависимости от статуса
    const actions = document.createElement("div");
    actions.className = "friend-actions";

    const isFriend = allFriends.some((f) => f.username === user.username);
    const isOutgoing = friendOutgoing.some((f) => f.username === user.username);
    const isIncoming = friendIncoming.some((f) => f.username === user.username);

    if (isFriend) {
      const btn = document.createElement("button");
      btn.className = "friend-action-btn";
      btn.textContent = "друзья";
      btn.disabled = true;
      actions.appendChild(btn);
    } else if (isOutgoing) {
      const btn = document.createElement("button");
      btn.className = "friend-action-btn";
      btn.textContent = "заявка";
      btn.disabled = true;
      actions.appendChild(btn);
    } else if (isIncoming) {
      const btn = document.createElement("button");
      btn.className = "friend-action-btn primary";
      btn.textContent = "принять";
      btn.addEventListener("click", async () => {
        await acceptFriend(user.username);
        // Обновим результаты поиска
        friendsSearchInput.dispatchEvent(new Event("input"));
      });
      actions.appendChild(btn);
    } else {
      const btn = document.createElement("button");
      btn.className = "friend-action-btn primary";
      btn.textContent = "добавить";
      btn.addEventListener("click", async () => {
        await sendFriendRequest(user.username);
        // Обновим результаты поиска
        friendsSearchInput.dispatchEvent(new Event("input"));
      });
      actions.appendChild(btn);
    }

    row.appendChild(actions);

    return row;
  }

  // ─── Кнопка в карточке пользователя ───
  function renderUserCardFriendAction(username) {
    const container = document.getElementById("user-card-friend-action");
    if (!container) return;

    container.innerHTML = "";

    if (!username || username === currentUser) return;

    const isFriend = allFriends.some((f) => f.username === username);
    const isOutgoing = friendOutgoing.some((f) => f.username === username);
    const isIncoming = friendIncoming.some((f) => f.username === username);

    const btn = document.createElement("button");

    if (isFriend) {
      btn.className = "secondary";
      btn.textContent = "удалить из друзей";
      btn.addEventListener("click", async () => {
        await removeFriend(username);
      });
    } else if (isOutgoing) {
      btn.className = "secondary";
      btn.textContent = "отменить заявку";
      btn.addEventListener("click", async () => {
        await removeFriend(username);
      });
    } else if (isIncoming) {
      btn.className = "primary";
      btn.textContent = "принять заявку";
      btn.addEventListener("click", async () => {
        await acceptFriend(username);
      });
    } else {
      btn.className = "primary";
      btn.textContent = "добавить в друзья";
      btn.addEventListener("click", async () => {
        await sendFriendRequest(username);
      });
    }

    container.appendChild(btn);
  }
  // ================================
  // HOME — ONLINE FRIENDS
  // ================================

  const homeFriends = document.getElementById("home-friends");
  const homeFriendsList = document.getElementById("home-friends-list");

  function renderHomeFriends() {
    if (!homeFriends || !homeFriendsList) return;

    // Друзья, которые сейчас онлайн
    const onlineFriends = allFriends.filter((f) =>
      lastOnlineUsers.includes(f.username)
    );

    // Если никого нет — скрываем секцию полностью
    if (onlineFriends.length === 0) {
      homeFriends.style.display = "none";
      return;
    }

    homeFriends.style.display = "block";
    homeFriendsList.innerHTML = "";

    for (const f of onlineFriends) {
      const avatar = document.createElement("div");
avatar.className = "home-friend-avatar";
avatar.title = f.nickname || f.username;
applyAvatar(avatar, f.username, f.nickname);

      avatar.addEventListener("click", () => {
        openUserCard(f.username);
      });

      homeFriendsList.appendChild(avatar);
    }
  }
  // ================================
  // ЭКРАН SAVED MESSAGES
  // ================================

  const savedScreen = document.querySelector(".saved-screen");
  const savedList = document.getElementById("saved-list");
  const savedBackButton = document.getElementById("saved-back-button");
  const profileSavedCard2 = document.getElementById("profile-saved-card");

  let allSaved = [];

  // Открыть экран
  async function openSaved() {
    switchScreen("saved");
    await loadSavedFull();
  }

  // Закрыть экран
  if (savedBackButton) {
    savedBackButton.addEventListener("click", () => {
      switchScreen("me");
    });
  }

  // Клик по карточке в me
  if (profileSavedCard2) {
    profileSavedCard2.addEventListener("click", openSaved);
  }

  // Загрузка полных данных сохранённых
  async function loadSavedFull() {
    if (!authToken) return;

    try {
      const res = await fetch("/api/saved", {
        headers: { authorization: authToken },
      });
      const data = await res.json();
      allSaved = data.items || [];

      // Обновим id-сет
      savedMessageIds.clear();
      for (const item of allSaved) {
        savedMessageIds.add(item.id);
      }
      updateSavedCardValue();

      renderSaved();
    } catch (err) {
      console.error("Не удалось загрузить сохранённые:", err);
    }
  }

  // Рендер
  function renderSaved() {
    if (!savedList) return;

    if (allSaved.length === 0) {
      savedList.innerHTML = `
      <div class="saved-empty">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
        </svg>
        <div class="saved-empty-title">пока пусто</div>
        <div class="saved-empty-subtitle">
          нажми ПКМ на сообщение<br>
          и выбери «сохранить»
        </div>
      </div>
    `;
      return;
    }

    savedList.innerHTML = "";

    for (const item of allSaved) {
      savedList.appendChild(createSavedRow(item));
    }
  }

  // Создание карточки сохранённого
  function createSavedRow(item) {
    const row = document.createElement("div");
    row.className = "saved-item";
    row.dataset.id = item.id;

    // Шапка: автор + дата
    const head = document.createElement("div");
    head.className = "saved-item-head";

    const author = document.createElement("div");
    author.className = "saved-item-author";

    const avatar = document.createElement("div");
    avatar.className = "saved-item-avatar";
    const color = userColorsMap[item.author] || "#e8e5db";
    avatar.style.background = color;
    avatar.style.color = getContrastTextColor(color);
    avatar.textContent = getNickname(item.author).charAt(0).toUpperCase();
    author.appendChild(avatar);

    const name = document.createElement("span");
    name.className = "saved-item-name";
    name.textContent = getNickname(item.author);
    author.appendChild(name);

    head.appendChild(author);

    const date = document.createElement("div");
    date.className = "saved-item-date";
    date.textContent = formatTime(item.created_at);
    head.appendChild(date);

    row.appendChild(head);

    // Цитата reply (если есть)
    if (item.reply_to_id && item.reply_to_text) {
      const quote = document.createElement("div");
      quote.className = "saved-item-quote";

      const qAuthor = document.createElement("div");
      qAuthor.className = "saved-item-quote-author";
      qAuthor.textContent = getNickname(item.reply_to_author) || item.reply_to_author;

      const qText = document.createElement("div");
      qText.className = "saved-item-quote-text";
      qText.textContent = item.reply_to_text;

      quote.appendChild(qAuthor);
      quote.appendChild(qText);
      row.appendChild(quote);
    }

    // Текст
    if (item.text && item.text.trim()) {
      const text = document.createElement("div");
      text.className = "saved-item-text";
      text.textContent = item.text;
      row.appendChild(text);
    }

    // Фото
    if (item.photo_url) {
      const img = document.createElement("img");
      img.className = "saved-item-photo";
      img.src = item.photo_url;
      img.loading = "lazy";
      row.appendChild(img);
    }

    // Клик — открыть оригинал
    row.addEventListener("click", async () => {
      await openSavedOriginal(item.chat_id, item.id);
    });

    // ПКМ — убрать из сохранённых
    row.addEventListener("contextmenu", async (e) => {
      e.preventDefault();

      if (!confirm("Убрать из сохранённых?")) return;

      try {
        const res = await fetch(`/api/saved/${item.id}`, {
          method: "DELETE",
          headers: { authorization: authToken },
        });
        if (!res.ok) return;

        allSaved = allSaved.filter((s) => s.id !== item.id);
        savedMessageIds.delete(item.id);
        updateSavedCardValue();
        renderSaved();
      } catch (err) {
        console.error(err);
      }
    });

    return row;
  }

  // Открыть оригинал — перейти в чат и подсветить
  async function openSavedOriginal(chatId, messageId) {
    // Закрыть экран saved
    switchScreen("chat");

    // Загрузить чаты, если ещё не
    if (!allChats.length) {
      await loadChats();
    }

    // Открыть чат
    await openChat(chatId);

    // Найти сообщение и подсветить
    setTimeout(() => {
      const row = messages.querySelector(`.message-row[data-id="${messageId}"]`);
      if (!row) return;

      row.scrollIntoView({ behavior: "smooth", block: "center" });
      row.classList.add("flash");
      setTimeout(() => row.classList.remove("flash"), 1500);
    }, 300);
  }

  // ================================
  // ЦИТАТА ДНЯ
  // ================================

  const QUOTES = [
    "делай что можешь, с тем что есть",
    "маленькие шаги тоже шаги",
    "начни — остальное приложится",
    "отдых — тоже часть работы",
    "лучшее время — сейчас",
    "не сравнивай свой путь с чужим",
    "то, что ты ищешь, тоже ищет тебя",
    "один раз живём — не забывай",
    "сначала успокойся, потом решай",
    "ты справишься — уже справлялся",
    "маленькие радости — самые настоящие",
    "всё меняется, и это хорошо",
    "позволь себе быть не идеальной",
    "хорошо там, где ты внимателен",
    "одиночество — тоже компания",
    "темп не важен, важно направление",
    "ничего не поздно, если ещё дышишь",
    "всё, что нужно, уже внутри тебя",
    "тревога врёт, ты сильнее",
    "позволь дню случиться",
    "то, что было, уже не вернётся — и хорошо",
    "устал — значит сделал много",
    "смотри по сторонам — там интересно",
    "не все мысли — правда",
    "слова важны, но тишина тоже",
    "выбери себя — хоть раз",
  ];

  function renderDailyQuote() {
    const textEl = document.getElementById("home-quote-text");
    if (!textEl) return;

    // Номер дня с 1970 года — стабильный «случайный» индекс
    const today = new Date();
    const dayNumber = Math.floor(today.getTime() / (1000 * 60 * 60 * 24));
    const index = dayNumber % QUOTES.length;

    textEl.textContent = "«" + QUOTES[index] + "»";
  }

  renderDailyQuote();
  // ================================
// УПРАВЛЕНИЕ ГРУППОЙ
// ================================

const chatHeaderInfoButton = document.getElementById("chat-header-info-button");

const groupModal = document.querySelector(".group-modal");
const groupModalBack = document.getElementById("group-modal-back");
const groupModalTitle = document.getElementById("group-modal-title");
const groupModalEditTitle = document.getElementById("group-modal-edit-title");
const groupMembersList = document.getElementById("group-members-list");
const groupModalAddMember = document.getElementById("group-modal-add-member");
const groupModalLeave = document.getElementById("group-modal-leave");

const addMemberModal = document.querySelector(".add-member-modal");
const addMemberList = document.getElementById("add-member-list");
const addMemberCancel = document.getElementById("add-member-cancel");

const renameModal = document.querySelector(".rename-modal");
const renameInput = document.getElementById("rename-input");
const renameError = document.getElementById("rename-modal-error");
const renameCancel = document.getElementById("rename-cancel");
const renameSave = document.getElementById("rename-save");

let openedGroupChatId = null;   // какой групповой чат сейчас открыт в модалке
let pendingRemoveMember = null; // username, которого будем удалять

// ─── Открытие модалки группы ───
if (chatHeaderInfoButton) {
  chatHeaderInfoButton.addEventListener("click", () => {
    if (!currentChat) return;
    if (currentChat.type !== "group") return;   // только для групп

    openGroupModal(currentChat);
  });
}

function openGroupModal(chat) {
  if (!groupModal) return;

  openedGroupChatId = chat.id;

  // Название
  if (groupModalTitle) {
    groupModalTitle.textContent = chat.title || "the three of us";
  }

  // Список участников
  renderGroupMembers(chat);

  groupModal.classList.add("open");
}

function closeGroupModal() {
  if (groupModal) groupModal.classList.remove("open");
  openedGroupChatId = null;
}

if (groupModalBack) {
  groupModalBack.addEventListener("click", closeGroupModal);
}

if (groupModal) {
  groupModal.addEventListener("click", (e) => {
    if (e.target === groupModal) closeGroupModal();
  });
}

// ─── Отрисовка участников ───
function renderGroupMembers(chat) {
  if (!groupMembersList) return;

  groupMembersList.innerHTML = "";

  for (const username of chat.members) {
    const row = document.createElement("div");
    row.className = "group-member";
    row.dataset.username = username;

    // Аватарка
   const avatar = document.createElement("div");
avatar.className = "group-member-avatar";
applyAvatar(avatar, username);
    row.appendChild(avatar);

    // Имя
    const name = document.createElement("div");
    name.className = "group-member-name";
    name.textContent = getNickname(username);

    if (username === currentUser) {
      const you = document.createElement("span");
      you.className = "group-member-you";
      you.textContent = "(ты)";
      name.appendChild(you);
    }

    row.appendChild(name);

    // ПКМ — удалить (кроме себя)
    if (username !== currentUser) {
      row.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        removeGroupMember(username);
      });
    }
    renderGroupAvatarPreview(chat);
    groupMembersList.appendChild(row);
  }
}

// ─── Удалить участника ───
async function removeGroupMember(username) {
  if (!openedGroupChatId) return;

  const ok = confirm(`Удалить ${getNickname(username)} из группы?`);
  if (!ok) return;

  try {
    const res = await fetch(
      `/api/chats/${openedGroupChatId}/members/${encodeURIComponent(username)}`,
      {
        method: "DELETE",
        headers: { authorization: authToken },
      }
    );

    if (!res.ok) {
      const data = await res.json();
      alert(data.error || "Не удалось удалить");
      return;
    }

    // Обновим список чатов (там изменится состав)
    await loadChats();

    // Обновим открытую модалку
    const chat = allChats.find((c) => c.id === openedGroupChatId);
    if (chat) {
      renderGroupMembers(chat);
    } else {
      // Меня самого удалили или я вышел
      closeGroupModal();
    }
  } catch (err) {
    console.error("Ошибка удаления:", err);
  }
}

// ─── Переименование группы ───
if (groupModalEditTitle) {
  groupModalEditTitle.addEventListener("click", () => {
    const chat = allChats.find((c) => c.id === openedGroupChatId);
    if (!chat) return;

    if (renameInput) renameInput.value = chat.title || "";
    if (renameError) renameError.textContent = "";

    if (renameModal) {
      renameModal.classList.add("open");
      setTimeout(() => renameInput && renameInput.focus(), 50);
    }
  });
}

if (renameCancel) {
  renameCancel.addEventListener("click", () => {
    if (renameModal) renameModal.classList.remove("open");
  });
}

if (renameModal) {
  renameModal.addEventListener("click", (e) => {
    if (e.target === renameModal) renameModal.classList.remove("open");
  });
}

async function saveRename() {
  if (!openedGroupChatId) return;

  const title = renameInput.value.trim();
  if (!title) {
    renameError.textContent = "Название не может быть пустым";
    return;
  }

  renameError.textContent = "";

  try {
    const res = await fetch(`/api/chats/${openedGroupChatId}/title`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        authorization: authToken,
      },
      body: JSON.stringify({ title }),
    });

    if (!res.ok) {
      const data = await res.json();
      renameError.textContent = data.error || "Ошибка";
      return;
    }

    // Обновим в модалке
    if (groupModalTitle) groupModalTitle.textContent = title;

    // Обновим локально
    const chat = allChats.find((c) => c.id === openedGroupChatId);
    if (chat) chat.title = title;

    if (currentChat && currentChat.id === openedGroupChatId) {
      currentChat.title = title;
      updateChatHeader();
    }

    renderChatsList();
    renameModal.classList.remove("open");
  } catch (err) {
    renameError.textContent = "Сервер недоступен";
    console.error(err);
  }
}

if (renameSave) {
  renameSave.addEventListener("click", saveRename);
}

if (renameInput) {
  renameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") saveRename();
  });
}

// ─── Добавить участника ───
if (groupModalAddMember) {
  groupModalAddMember.addEventListener("click", () => {
    openAddMemberModal();
  });
}

function openAddMemberModal() {
  if (!addMemberModal) return;

  const chat = allChats.find((c) => c.id === openedGroupChatId);
  if (!chat) return;

  // Список друзей, которых ещё нет в группе
  const available = allFriends.filter(
    (f) => !chat.members.includes(f.username)
  );

  addMemberList.innerHTML = "";

  if (available.length === 0) {
    addMemberList.innerHTML = `
      <div class="add-member-empty">
        все друзья уже в группе
      </div>
    `;
  } else {
    for (const friend of available) {
      const btn = document.createElement("button");
      btn.className = "add-member-item";

      // Аватарка
      const avatar = document.createElement("div");
avatar.className = "add-member-item-avatar";
applyAvatar(avatar, friend.username, friend.nickname);
      btn.appendChild(avatar);

      // Имя + ник
      const info = document.createElement("div");
      const name = document.createElement("div");
      name.className = "add-member-item-name";
      name.textContent = friend.nickname || friend.username;

      const hint = document.createElement("div");
      hint.className = "add-member-item-hint";
      hint.textContent = "@" + (friend.handle || friend.username.toLowerCase());

      info.appendChild(name);
      info.appendChild(hint);
      btn.appendChild(info);

      btn.addEventListener("click", () => addMemberToGroup(friend.username));

      addMemberList.appendChild(btn);
    }
  }

  addMemberModal.classList.add("open");
}

function closeAddMemberModal() {
  if (addMemberModal) addMemberModal.classList.remove("open");
}

if (addMemberCancel) {
  addMemberCancel.addEventListener("click", closeAddMemberModal);
}

if (addMemberModal) {
  addMemberModal.addEventListener("click", (e) => {
    if (e.target === addMemberModal) closeAddMemberModal();
  });
}

async function addMemberToGroup(username) {
  if (!openedGroupChatId) return;

  try {
    const res = await fetch(`/api/chats/${openedGroupChatId}/members`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authorization: authToken,
      },
      body: JSON.stringify({ username }),
    });

    if (!res.ok) {
      const data = await res.json();
      alert(data.error || "Не удалось добавить");
      return;
    }

    // Обновим список чатов
    await loadChats();

    // Обновим модалку
    const chat = allChats.find((c) => c.id === openedGroupChatId);
    if (chat) renderGroupMembers(chat);

    // Закроем модалку «добавить участника»
    closeAddMemberModal();

    // Если это открытый чат — обновим шапку
    if (currentChat && currentChat.id === openedGroupChatId) {
      const updated = allChats.find((c) => c.id === openedGroupChatId);
      if (updated) {
        currentChat = updated;
        updateChatHeader();
      }
    }
  } catch (err) {
    console.error("Ошибка добавления:", err);
  }
}

// ─── Выйти из группы ───
if (groupModalLeave) {
  groupModalLeave.addEventListener("click", async () => {
    if (!openedGroupChatId) return;

    const ok = confirm("Выйти из группы?");
    if (!ok) return;

    try {
      const res = await fetch(`/api/chats/${openedGroupChatId}/leave`, {
        method: "POST",
        headers: { authorization: authToken },
      });

      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Не удалось выйти");
        return;
      }

      // Закроем модалку и выйдем из чата
      closeGroupModal();

      if (currentChatId === openedGroupChatId) {
        currentChatId = null;
        currentChat = null;
        chatScreen.style.display = "none";
        mainScreens.style.display = "flex";
        switchScreen("chat");
      }

      await loadChats();
    } catch (err) {
      console.error("Ошибка выхода:", err);
    }
  });
}
// ─── Аватарка группы ───
const groupAvatarInput = document.getElementById("group-avatar-input");
const groupAvatarButton = document.getElementById("group-avatar-button");
const groupAvatarPreview = document.getElementById("group-avatar-preview");

if (groupAvatarButton && groupAvatarInput) {
  groupAvatarButton.addEventListener("click", () => {
    groupAvatarInput.click();
  });
}

if (groupAvatarInput) {
  groupAvatarInput.addEventListener("change", async () => {
    const file = groupAvatarInput.files[0];
    if (!file) return;

    if (!openedGroupChatId) return;

    if (file.size > 5 * 1024 * 1024) {
      alert("Файл слишком большой (макс. 5 МБ)");
      groupAvatarInput.value = "";
      return;
    }

    if (!file.type.startsWith("image/")) {
      alert("Только изображения");
      groupAvatarInput.value = "";
      return;
    }

    try {
      const formData = new FormData();
      formData.append("avatar", file);

      const res = await fetch(`/api/chats/${openedGroupChatId}/avatar`, {
        method: "POST",
        headers: { authorization: authToken },
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Не удалось загрузить");
        groupAvatarInput.value = "";
        return;
      }

      await loadChats();

      // Обновим превью в модалке
      const chat = allChats.find((c) => c.id === openedGroupChatId);
      if (chat) renderGroupAvatarPreview(chat);

      groupAvatarInput.value = "";
    } catch (err) {
      alert("Сервер недоступен");
      groupAvatarInput.value = "";
      console.error(err);
    }
  });
}

// Отрисовка превью аватарки группы
function renderGroupAvatarPreview(chat) {
  if (!groupAvatarPreview) return;

  if (chat.avatar_url) {
    groupAvatarPreview.textContent = "";
    groupAvatarPreview.style.backgroundImage = `url(${chat.avatar_url})`;
    groupAvatarPreview.style.backgroundSize = "cover";
    groupAvatarPreview.style.backgroundPosition = "center";
  } else {
    groupAvatarPreview.style.backgroundImage = "";
    const initials = chat.members
      .slice(0, 2)
      .map((u) => getNickname(u).charAt(0).toUpperCase())
      .join("");
    const color = userColorsMap[chat.members[0]] || "#c5d0c5";
    groupAvatarPreview.style.background = color;
    groupAvatarPreview.style.color = getContrastTextColor(color);
    groupAvatarPreview.textContent = initials || "G";
  }
}
// ================================
// ГЛОБАЛЬНЫЙ ПЕРЕХВАТЧИК ОШИБОК СЕССИИ
// ================================

const originalFetch = window.fetch;
window.fetch = async function(...args) {
  const response = await originalFetch.apply(this, args);
  
  // Если сервер вернул 401 (Нет токена или Сессия не найдена)
  if (response.status === 401) {
    // Показываем уведомление
    alert("Твоя сессия устарела (возможно, база данных обновилась). Пожалуйста, войди заново.");
    
    // Стираем токен и перезагружаем страницу
    localStorage.removeItem("us_token");
    authToken = null;
    currentUser = null;
    window.location.reload();
    
    // Возвращаем ответ, чтобы код не упал с ошибкой
    return response;
  }
  
  return response;
};
  initAuth();