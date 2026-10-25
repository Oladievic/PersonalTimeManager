/* Пробка — модель данных: сферы, задачи, доски, история, автосохранение */
(function () {
  "use strict";

  const TB = window.TB;
  const U = TB.util;
  const uid = U.uid;

  const DEFAULT_NOTE = {
    boardId: null,
    x: 120, y: 120, w: 215, h: 165, rot: 0, z: 1,
    color: "lemon", font: "hand", fontSize: 16, align: "left",
    html: "", tags: [], due: null, priority: 0, done: false,
    pin: "tape", shadow: "soft", bold: false, italic: false,
    checklist: [], attachments: [], archived: false, archivedAt: null,
    created: 0, updated: 0,
    /* ядро тайм-менеджмента */
    kind: "task", sphere: "work", status: "today",
    reminder: null, estimate: 0, repeat: "none",
    projectId: null, subject: "", url: "", source: "",
    usage: 0, favorite: false, top3: false, important: false,
    focusMinutes: 0, postponedCount: 0, completedAt: null, spawnedId: null,
    meta: {},
  };

  function localISO(daysFromNow, hours, minutes) {
    const d = new Date();
    d.setDate(d.getDate() + daysFromNow);
    if (hours != null) d.setHours(hours, minutes || 0, 0, 0);
    const pad = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function defaultDoc() {
    const now = Date.now();
    const board = {
      id: uid("b"), name: "Моя доска", color: "#B5432F", bg: "cork",
      sphere: null, inbox: false, view: null, created: now,
    };
    return {
      version: 1,
      createdAt: now,
      boards: [board],
      notes: [],
      threads: [],
      focusLog: [],
      tombstones: { notes: {}, boards: {}, threads: {} },
      settings: {
        theme: "light", snap: true, lastBoard: board.id, view: "board",
        lastSphere: "work", weeklyGoals: "", digestDate: "", reminders: false,
      },
    };
  }

  function seedDoc() {
    const doc = defaultDoc();
    const now = Date.now();
    const boards = {};
    const mkBoard = (id, name, color, bg, sphere, inbox) => {
      const b = {
        id: uid("b"), name, color, bg: bg || "cork", sphere: sphere || null,
        inbox: !!inbox, view: null, created: now,
      };
      doc.boards.push(b);
      boards[id] = b;
      return b;
    };

    // первая доска из defaultDoc переиспользуется как «Неделя»
    const week = doc.boards[0];
    week.name = "Неделя";
    boards.week = week;
    const work = mkBoard("work", "Работа", "#4E7FA6", "linen", "work");
    const study = mkBoard("study", "Учёба", "#6E9C83", "kraft", "study");
    const projects = mkBoard("projects", "Проекты", "#8A6FA8", "felt", "projects");
    const life = mkBoard("life", "Личное", "#C4718E", "cork", "life");
    const inbox = mkBoard("inbox", "Входящие", "#8B7A63", "linen", null, true);
    doc.settings.inboxBoardId = inbox.id;
    doc.settings.lastBoard = week.id;

    const made = {};
    const mk = (key, board, patch) => {
      const n = Object.assign({}, DEFAULT_NOTE, {
        id: uid("n"),
        boardId: board.id,
        created: now,
        updated: now,
        sphere: patch.sphere !== undefined ? patch.sphere : board.sphere || null,
      }, patch);
      n.checklist = (patch.checklist || []).map((c) => ({
        id: uid("c"), text: typeof c === "string" ? c : c.text, done: !!(c && c.done),
      }));
      n.meta = Object.assign({}, patch.meta || {});
      doc.notes.push(n);
      made[key] = n;
      return n;
    };

    /* ----------------------------- Неделя ----------------------------- */
    const report = mk("report", week, {
      x: 70, y: 105, w: 252, h: 205, rot: -2, z: 2, color: "lemon", pin: "pin",
      priority: 3, tags: ["отчёт", "смены"], due: localISO(0, 18, 0), top3: true,
      estimate: 60, kind: "task", sphere: "work", html: "<div>Сдать отчёт по сменам</div><div>за октябрь, до вечера</div>",
      checklist: [{ text: "Выгрузить тикеты", done: true }, { text: "Свести часы", done: false }, { text: "Отправить руководителю", done: false }],
    });
    const hw = mk("hw", week, {
      x: 400, y: 80, w: 226, h: 185, rot: 2.2, z: 3, color: "mint", pin: "tape",
      priority: 2, tags: ["дз", "математика"], due: localISO(2, 23, 59), top3: true,
      kind: "homework", sphere: "study", subject: "Дискретная математика", estimate: 90,
      html: "<div>ДЗ: дискретная математика</div><div>задачи 4–9, глава 3</div>",
      checklist: ["Разобрать теорию", "Решить 4–9", "Оформить в PDF"],
    });
    const call = mk("call", week, {
      x: 690, y: 140, w: 208, h: 152, rot: -3.2, z: 4, color: "sky", pin: "tape",
      priority: 2, tags: ["встречи", "работа"], due: localISO(1, 15, 0),
      kind: "event", sphere: "work", estimate: 45,
      html: "<div>Созвон с Аней</div><div>обсудить смены и отпуск</div>",
      meta: { duration: 45, link: "https://meet.google.com/" },
    });
    const onboarding = mk("onboarding", week, {
      x: 155, y: 400, w: 222, h: 170, rot: 1.4, z: 5, color: "lilac", pin: "tape",
      priority: 2, tags: ["макет", "приложение"], due: localISO(4, 19, 0), top3: true,
      kind: "task", sphere: "projects", estimate: 60, projectId: null,
      html: "<div>Макет онбординга</div><div>три экрана + пустое состояние</div>",
      checklist: ["Экран 1", "Экран 2", "Прототип в Figma"],
    });
    const birthday = mk("birthday", week, {
      x: 470, y: 390, w: 208, h: 162, rot: -1.7, z: 6, color: "rose", pin: "pin",
      priority: 3, tags: ["семья"], due: localISO(12, 9, 0), important: true,
      kind: "date", sphere: "life", repeat: "yearly", reminder: 4320,
      html: "<div>День рождения мамы</div><div>подарок и открытка</div>",
      checklist: ["Выбрать подарок", "Заказать доставку"],
    });
    doc.threads.push(
      { id: uid("t"), boardId: week.id, from: report.id, to: call.id, color: "#B5432F", width: 2, style: "solid", arrow: true, label: "сначала" },
      { id: uid("t"), boardId: week.id, from: hw.id, to: onboarding.id, color: "#6E9C83", width: 2, style: "dashed", arrow: false, label: "вечером" },
      { id: uid("t"), boardId: week.id, from: birthday.id, to: onboarding.id, color: "#C4718E", width: 1.7, style: "dotted", arrow: false, label: "" }
    );

    /* ----------------------------- Работа ----------------------------- */
    mk("vpn", work, {
      x: 80, y: 100, w: 262, h: 205, rot: -2, z: 2, color: "sky", pin: "pin",
      tags: ["vpn", "ios", "подключение"], kind: "template", sphere: "work", favorite: true,
      usage: 12, html: "<div>VPN не подключается — iOS</div><div>Шаблон ответа</div><div>Здравствуйте, {имя}! Проверьте, пожалуйста: 1) обновлён ли профиль…</div>",
      status: "today",
    });
    mk("pay", work, {
      x: 400, y: 120, w: 238, h: 178, rot: 2.4, z: 3, color: "amber", pin: "tape",
      tags: ["оплата", "подписка"], kind: "template", sphere: "work", usage: 7,
      html: "<div>Как продлить подписку</div><div>Шаблон ответа</div><div>Здравствуйте! Продлить подписку можно в личном кабинете…</div>",
      status: "today",
    });
    mk("tickets", work, {
      x: 105, y: 385, w: 218, h: 152, rot: 1.2, z: 4, color: "paper", pin: "tape",
      tags: ["смена"], due: localISO(0, 10, 0), estimate: 15, priority: 2,
      kind: "task", sphere: "work", html: "<div>Проверить тикеты за утро</div>",
      checklist: ["Новые за ночь", "Просроченные"],
    });
    mk("docs", work, {
      x: 395, y: 370, w: 214, h: 155, rot: -2.6, z: 5, color: "mint", pin: "tape",
      tags: ["база знаний"], due: localISO(5, 18, 0), priority: 1, status: "doing",
      kind: "task", sphere: "work", html: "<div>Обновить базу шаблонов</div><div>добавить 3 частых ответа</div>",
    });
    doc.threads.push(
      { id: uid("t"), boardId: work.id, from: made.tickets.id, to: made.docs.id, color: "#4E7FA6", width: 2, style: "dashed", arrow: true, label: "после смены" }
    );

    /* ----------------------------- Учёба ----------------------------- */
    const lab = mk("lab", study, {
      x: 90, y: 110, w: 246, h: 194, rot: -2.1, z: 2, color: "mint", pin: "pin",
      priority: 3, tags: ["бд", "лаба"], due: localISO(1, 23, 59), status: "doing",
      kind: "homework", sphere: "study", subject: "Базы данных", estimate: 120,
      html: "<div>Лабораторная по базам данных</div><div>нормализация и запросы</div>",
      checklist: ["Схема БД", "5 запросов", "Отчёт"],
    });
    const olymp = mk("olymp", study, {
      x: 400, y: 90, w: 232, h: 196, rot: 2.3, z: 3, color: "amber", pin: "tape",
      priority: 2, tags: ["олимпиада", "алгоритмы"], due: localISO(6, 20, 0),
      kind: "contest", sphere: "study", subject: "Алгоритмы", reminder: 1440,
      html: "<div>Олимпиада по алгоритмам</div><div>подача заявки и отбор</div>",
      checklist: ["Зарегистрироваться", "Повторить графы", "Решить 3 задачи"],
      meta: { stage: "prep", eventDate: localISO(14, 10, 0), link: "https://contest.example" },
    });
    mk("portfolio", study, {
      x: 110, y: 375, w: 220, h: 162, rot: 1.6, z: 4, color: "lilac", pin: "tape",
      tags: ["портфолио", "kotlin"], kind: "portfolio", sphere: "study",
      html: "<div>Портфолио: приложение на Kotlin</div><div>что показать в резюме</div>",
      url: "https://github.com/",
    });
    mk("notes", study, {
      x: 405, y: 355, w: 214, h: 152, rot: -2.2, z: 5, color: "paper", pin: "tape",
      tags: ["сети", "конспект"], kind: "link", sphere: "study",
      html: "<div>Конспект: сети</div><div>OSI, TCP/IP</div>",
      url: "https://docs.google.com/", meta: { why: "к экзамену" },
    });
    doc.threads.push(
      { id: uid("t"), boardId: study.id, from: lab.id, to: olymp.id, color: "#6E9C83", width: 1.8, style: "dotted", arrow: false, label: "" }
    );

    /* ----------------------------- Проекты ----------------------------- */
    const project = mk("project", projects, {
      x: 90, y: 100, w: 252, h: 194, rot: -2, z: 2, color: "lilac", pin: "pin",
      priority: 3, tags: ["android", "приложение"], due: localISO(20, 0, 0),
      kind: "project", sphere: "projects", status: "doing",
      html: "<div>Трекер привычек</div><div>цель: 100 активных пользователей</div>",
      meta: { stage: "dev" },
    });
    const stats = mk("stats", projects, {
      x: 400, y: 110, w: 208, h: 154, rot: 2, z: 3, color: "sky", pin: "tape",
      tags: ["android"], due: localISO(3, 19, 0), priority: 2, status: "doing",
      kind: "task", sphere: "projects", projectId: project.id, estimate: 60,
      html: "<div>Экран статистики</div><div>график недели и серия</div>",
      meta: { roadmap: "now" },
    });
    const idea = mk("idea", projects, {
      x: 400, y: 325, w: 214, h: 162, rot: -2.5, z: 4, color: "lemon", pin: "tape",
      tags: ["идеи", "виджет"], kind: "idea", sphere: "projects",
      html: "<div>Виджет на главный экран</div><div>серия и ближайшая привычка</div>",
      meta: { stage: "new" },
    });
    mk("release", projects, {
      x: 105, y: 355, w: 212, h: 152, rot: 1.8, z: 5, color: "rose", pin: "tape",
      tags: ["релиз"], due: localISO(9, 12, 0), priority: 2,
      kind: "release", sphere: "projects", html: "<div>Релиз 0.3</div><div>статистика + виджеты</div>",
    });
    doc.threads.push(
      { id: uid("t"), boardId: projects.id, from: project.id, to: stats.id, color: "#8A6FA8", width: 2, style: "solid", arrow: true, label: "сейчас" },
      { id: uid("t"), boardId: projects.id, from: idea.id, to: project.id, color: "#C49A57", width: 1.8, style: "dashed", arrow: false, label: "может быть" }
    );

    /* ----------------------------- Личное ----------------------------- */
    mk("doctor", life, {
      x: 105, y: 115, w: 212, h: 160, rot: -2, z: 2, color: "rose", pin: "pin",
      priority: 2, tags: ["здоровье"], due: localISO(3, 12, 0),
      kind: "task", sphere: "life", html: "<div>Записаться к врачу</div>",
    });
    mk("journal", life, {
      x: 390, y: 100, w: 242, h: 194, rot: 2.2, z: 3, color: "paper", pin: "tape",
      tags: ["журнал"], kind: "journal", sphere: "life", status: "doing",
      html: "<div>Как прошёл день</div><div>Хорошо: закрыл отчёт. Мешало: мало спал.</div>",
      meta: { mood: "спокойно" },
    });
    mk("gift", life, {
      x: 120, y: 360, w: 212, h: 152, rot: 1.2, z: 4, color: "amber", pin: "tape",
      priority: 1, tags: ["семья"], due: localISO(10, 18, 0),
      kind: "task", sphere: "life", html: "<div>Купить подарок маме</div>",
    });

    /* ----------------------------- Входящие ----------------------------- */
    mk("inbox1", inbox, {
      x: 110, y: 120, w: 214, h: 145, rot: -2, z: 2, color: "paper", pin: "tape",
      kind: "note", sphere: null, status: "inbox", tags: [],
      html: "<div>Проверить новую фичу в Notion</div>",
    });
    mk("inbox2", inbox, {
      x: 380, y: 150, w: 206, h: 145, rot: 2.4, z: 3, color: "lemon", pin: "tape",
      kind: "idea", sphere: null, status: "inbox", tags: [],
      html: "<div>Идея подарка: книга</div>",
    });

    return doc;
  }

  function normalizeDoc(raw) {
    if (!raw || typeof raw !== "object") return null;
    const doc = raw;
    doc.version = 1;
    doc.createdAt = doc.createdAt || Date.now();
    doc.settings = Object.assign({
      theme: "light", snap: true, lastBoard: null, view: "board",
      lastSphere: "work", weeklyGoals: "", digestDate: "", reminders: false,
    }, doc.settings || {});
    doc.focusLog = Array.isArray(doc.focusLog) ? doc.focusLog : [];
    const rawTombs = doc.tombstones && typeof doc.tombstones === "object" ? doc.tombstones : {};
    doc.tombstones = { notes: {}, boards: {}, threads: {} };
    ["notes", "boards", "threads"].forEach((kind) => {
      const src = rawTombs[kind];
      if (!src || typeof src !== "object") return;
      Object.keys(src).forEach((id) => {
        const ts = Number(src[id]);
        if (Number.isFinite(ts) && ts > 0) doc.tombstones[kind][id] = ts;
      });
    });
    doc.boards = (Array.isArray(doc.boards) ? doc.boards : []).map((b, i) => ({
      id: b.id || uid("b"),
      name: b.name || "Доска " + (i + 1),
      color: b.color || "#B5432F",
      bg: b.bg || "cork",
      sphere: b.sphere || null,
      inbox: !!b.inbox,
      view: b.view && typeof b.view.z === "number" ? b.view : null,
      created: b.created || Date.now(),
      updated: Number(b.updated) || Number(b.created) || Date.now(),
    }));
    if (!doc.boards.length) {
      doc.boards.push({ id: uid("b"), name: "Моя доска", color: "#B5432F", bg: "cork", sphere: null, inbox: false, view: null, created: Date.now() });
    }
    let inbox = doc.boards.find((b) => b.inbox);
    if (!inbox) {
      inbox = { id: uid("b"), name: "Входящие", color: "#8B7A63", bg: "linen", sphere: null, inbox: true, view: null, created: Date.now() };
      doc.boards.push(inbox);
    }
    doc.settings.inboxBoardId = inbox.id;

    const boardIds = new Set(doc.boards.map((b) => b.id));
    doc.notes = (Array.isArray(doc.notes) ? doc.notes : []).map((n) => {
      const note = Object.assign({}, DEFAULT_NOTE, n);
      note.id = n.id || uid("n");
      if (!boardIds.has(note.boardId)) note.boardId = doc.boards[0].id;
      note.w = U.clamp(Number(note.w) || 215, 120, 1400);
      note.h = U.clamp(Number(note.h) || 165, 90, 1200);
      note.rot = U.clamp(Number(note.rot) || 0, -45, 45);
      note.fontSize = U.clamp(Number(note.fontSize) || 16, 11, 34);
      note.checklist = Array.isArray(note.checklist) ? note.checklist.map((c) => ({ id: c.id || uid("c"), text: String(c.text || ""), done: !!c.done })) : [];
      note.attachments = Array.isArray(note.attachments) ? note.attachments : [];
      note.tags = Array.isArray(note.tags) ? note.tags.map(String) : [];
      note.html = U.sanitizeHtml(typeof note.html === "string" ? note.html : "");
      note.url = U.safeUrl(note.url);
      note.meta = note.meta && typeof note.meta === "object" ? note.meta : {};
      note.archived = !!note.archived;
      note.kind = note.kind || "task";
      note.sphere = note.sphere || null;
      note.status = ["inbox", "today", "doing", "done"].includes(note.status)
        ? note.status
        : note.archived ? "done" : note.done ? "done" : "today";
      note.done = note.status === "done";
      note.priority = U.clamp(Number(note.priority) || 0, 0, 3);
      note.estimate = Math.max(0, Number(note.estimate) || 0);
      note.focusMinutes = Math.max(0, Number(note.focusMinutes) || 0);
      note.postponedCount = Math.max(0, Number(note.postponedCount) || 0);
      note.created = note.created || Date.now();
      note.updated = note.updated || note.created;
      if (!note.sphere) {
        const b = doc.boards.find((x) => x.id === note.boardId);
        if (b && b.sphere) note.sphere = b.sphere;
      }
      return note;
    });
    const noteIds = new Set(doc.notes.map((n) => n.id));
    doc.threads = (Array.isArray(doc.threads) ? doc.threads : [])
      .filter((t) => t && noteIds.has(t.from) && noteIds.has(t.to))
      .map((t) => ({
        id: t.id || uid("t"),
        boardId: boardIds.has(t.boardId) ? t.boardId : doc.notes.find((n) => n.id === t.from).boardId,
        from: t.from, to: t.to,
        color: t.color || "#B5432F",
        width: U.clamp(Number(t.width) || 2, 1, 6),
        style: t.style || "solid",
        arrow: !!t.arrow,
        label: t.label || "",
        updated: Number(t.updated) || 0,
      }));
    if (!doc.settings.lastBoard || !boardIds.has(doc.settings.lastBoard)) doc.settings.lastBoard = doc.boards[0].id;
    if (!["today", "board", "tasks", "calendar", "inbox", "work", "study", "projects", "life", "review", "search"].includes(doc.settings.view)) {
      doc.settings.view = "board";
    }
    return doc;
  }

  function nextDue(due, repeat) {
    const d = U.parseDue(due) || new Date();
    const next = new Date(d.getTime());
    if (repeat === "daily") next.setDate(next.getDate() + 1);
    else if (repeat === "weekdays") {
      do { next.setDate(next.getDate() + 1); } while (next.getDay() === 0 || next.getDay() === 6);
    } else if (repeat === "weekly") next.setDate(next.getDate() + 7);
    else if (repeat === "monthly") {
      // 31 января → 28/29 февраля, а не 3 марта.
      const day = d.getDate();
      next.setDate(1);
      next.setMonth(next.getMonth() + 1);
      const last = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
      next.setDate(Math.min(day, last));
    } else if (repeat === "yearly") {
      // 29 февраля → 28 февраля, а не 1 марта.
      const day = d.getDate();
      const month = d.getMonth();
      next.setDate(1);
      next.setFullYear(next.getFullYear() + 1);
      next.setMonth(month);
      const last = new Date(next.getFullYear(), month + 1, 0).getDate();
      next.setDate(Math.min(day, last));
    } else return null;
    const pad = (n) => String(n).padStart(2, "0");
    return next.getFullYear() + "-" + pad(next.getMonth() + 1) + "-" + pad(next.getDate()) + "T" + pad(next.getHours()) + ":" + pad(next.getMinutes());
  }

  const model = {
    doc: null,
    ui: {
      boardId: null,
      selectedId: null,
      selectedThread: null,
      filterTag: null,
      editing: null,
      linking: null,
      search: "",
      view: "board",
    },
    history: [],
    redoStack: [],
    _saveTimer: null,
    _status: "saved",

    init(doc) {
      this.doc = doc;
      this.ui.boardId = doc.settings.lastBoard || doc.boards[0].id;
      this.ui.view = doc.settings.view || "board";
      this.ui.selectedId = null;
      this.history = [];
      this.redoStack = [];
      this.setSaveState("saved");
    },

    seed() {
      return normalizeDoc(seedDoc());
    },

    /* ----------------------------- доски ----------------------------- */

    board(id) {
      return this.doc.boards.find((b) => b.id === (id || this.ui.boardId)) || this.doc.boards[0];
    },

    boards() {
      return this.doc.boards.filter((b) => !b.inbox);
    },

    allBoards() {
      return this.doc.boards;
    },

    inboxBoard() {
      let b = this.doc.boards.find((x) => x.inbox);
      if (!b) {
        b = { id: uid("b"), name: "Входящие", color: "#8B7A63", bg: "linen", sphere: null, inbox: true, view: null, created: Date.now() };
        this.doc.boards.push(b);
        this.doc.settings.inboxBoardId = b.id;
      }
      return b;
    },

    addBoard(name, color, bg, sphere) {
      this.snapshot();
      const b = {
        id: uid("b"),
        name: name || "Новая доска",
        color: color || "#B5432F",
        bg: bg || "cork",
        sphere: sphere || null,
        inbox: false,
        view: null,
        created: Date.now(),
        updated: Date.now(),
      };
      this.doc.boards.push(b);
      this.setView("board");
      this.setBoard(b.id);
      this.changed("all");
      return b;
    },

    updateBoard(id, patch) {
      const b = this.doc.boards.find((x) => x.id === id);
      if (!b) return;
      this.snapshot();
      Object.assign(b, patch, { updated: Date.now() });
      this.changed("all");
    },

    deleteBoard(id) {
      if (this.doc.boards.filter((b) => !b.inbox).length <= 1) return false;
      const idx = this.doc.boards.findIndex((b) => b.id === id);
      if (idx < 0 || this.doc.boards[idx].inbox) return false;
      this.snapshot();
      this._tombstone("boards", id);
      const noteIds = new Set(this.doc.notes.filter((n) => n.boardId === id).map((n) => n.id));
      this.doc.notes.filter((n) => n.boardId === id).forEach((n) => this._dropFiles(n));
      noteIds.forEach((nid) => this._tombstone("notes", nid));
      this.doc.threads.filter((t) => t.boardId === id || noteIds.has(t.from) || noteIds.has(t.to))
        .forEach((t) => this._tombstone("threads", t.id));
      this.doc.notes = this.doc.notes.filter((n) => n.boardId !== id);
      this.doc.threads = this.doc.threads.filter((t) => t.boardId !== id && !noteIds.has(t.from) && !noteIds.has(t.to));
      this.doc.boards.splice(idx, 1);
      const next = this.doc.boards.find((b) => !b.inbox) || this.doc.boards[0];
      this.setBoard(next.id);
      this.ui.selectedId = null;
      this.changed("all");
      return true;
    },

    setBoard(id) {
      if (!this.doc.boards.some((b) => b.id === id)) return;
      this.ui.boardId = id;
      this.doc.settings.lastBoard = id;
      this.ui.selectedId = null;
      this.ui.selectedThread = null;
      this.ui.linking = null;
      this.ui.filterTag = null;
      this.saveSoon();
      if (TB.board) TB.board.onBoardChanged();
      else if (TB.refresh) TB.refresh("board");
    },

    setView(view) {
      const allowed = ["today", "board", "tasks", "calendar", "inbox", "work", "study", "projects", "life", "review", "search"];
      if (!allowed.includes(view)) return;
      this.ui.view = view;
      this.doc.settings.view = view;
      this.ui.selectedId = null;
      this.ui.selectedThread = null;
      this.saveSoon();
      if (TB.board) TB.board.commitEditor();
      if (TB.refresh) TB.refresh("all");
      if (TB.panels) TB.panels.closeDetails();
    },

    /* ------------------------------ записи ------------------------------ */

    notes(boardId, opts) {
      const includeArchived = opts && opts.archived;
      return this.doc.notes.filter(
        (n) => n.boardId === (boardId || this.ui.boardId) && (includeArchived || !n.archived)
      );
    },

    note(id) {
      return this.doc.notes.find((n) => n.id === id) || null;
    },

    selectedNote() {
      return this.note(this.ui.selectedId);
    },

    maxZ(boardId) {
      return this.notes(boardId, { archived: true }).reduce((m, n) => Math.max(m, n.z || 0), 0);
    },

    addNote(patch) {
      this.snapshot();
      const now = Date.now();
      const p = patch || {};
      const status = p.status || "today";
      let boardId = p.boardId;
      if (!boardId) boardId = status === "inbox" ? this.inboxBoard().id : this.ui.boardId;
      const note = Object.assign({}, DEFAULT_NOTE, {
        id: uid("n"),
        boardId,
        x: 160 + Math.round(Math.random() * 60),
        y: 140 + Math.round(Math.random() * 60),
        z: this.maxZ(boardId) + 1,
        created: now,
        updated: now,
        sphere: this.doc.settings.lastSphere || "work",
        status,
      }, p);
      note.html = U.sanitizeHtml(note.html || "");
      note.checklist = (note.checklist || []).map((c) => ({ id: uid("c"), text: String(c.text || ""), done: !!c.done }));
      note.meta = note.meta || {};
      note.done = note.status === "done";
      if (note.sphere) this.doc.settings.lastSphere = note.sphere;
      this.doc.notes.push(note);
      if (this.ui.view === "board") this.ui.selectedId = note.id;
      this.changed("all");
      if (TB.panels) TB.panels.onSelectionChanged();
      return note;
    },

    updateNote(id, patch, opts) {
      const note = this.note(id);
      if (!note) return null;
      if (!(opts && opts.silentUndo)) this.snapshot();
      Object.assign(note, patch, { updated: Date.now() });
      if (patch && typeof patch.html === "string") note.html = U.sanitizeHtml(patch.html);
      if (patch && patch.url !== undefined) note.url = U.safeUrl(patch.url);
      if (patch && patch.status) note.done = patch.status === "done";
      if (patch && patch.sphere) this.doc.settings.lastSphere = patch.sphere;
      this.changed((opts && opts.scope) || "all");
      return note;
    },

    bringToFront(id) {
      const note = this.note(id);
      if (!note) return;
      const top = this.maxZ(note.boardId) + 1;
      if (note.z !== top) {
        note.z = top;
        const el = TB.board && TB.board.els.get(id);
        if (el) el.style.setProperty("--z", top);
      }
    },

    _tombstone(kind, id, ts) {
      if (!this.doc.tombstones) this.doc.tombstones = { notes: {}, boards: {}, threads: {} };
      if (!this.doc.tombstones[kind]) this.doc.tombstones[kind] = {};
      this.doc.tombstones[kind][id] = ts || Date.now();
    },

    deleteNote(id) {
      const note = this.note(id);
      if (!note) return;
      this.snapshot();
      this._tombstone("notes", id);
      (this.doc.threads || []).filter((t) => t.from === id || t.to === id)
        .forEach((t) => this._tombstone("threads", t.id));
      this._dropFiles(note);
      this.doc.notes = this.doc.notes.filter((n) => n.id !== id);
      this.doc.threads = this.doc.threads.filter((t) => t.from !== id && t.to !== id);
      if (this.ui.selectedId === id) this.ui.selectedId = null;
      if (TB.panels && TB.panels.isDetailsOpen()) TB.panels.closeDetails();
      this.changed("all");
      if (TB.panels) TB.panels.onSelectionChanged();
    },

    duplicateNote(id) {
      const note = this.note(id);
      if (!note) return null;
      this.snapshot();
      const now = Date.now();
      const copy = JSON.parse(JSON.stringify(note));
      copy.id = uid("n");
      copy.x = note.x + 26;
      copy.y = note.y + 26;
      copy.z = this.maxZ(note.boardId) + 1;
      copy.rot = note.rot + (Math.random() * 2 - 1) * 1.6;
      copy.created = now;
      copy.updated = now;
      copy.spawnedId = null;
      copy.attachments = note.attachments.map((a) => Object.assign({}, a, { id: uid("a") }));
      this.doc.notes.push(copy);
      this.ui.selectedId = copy.id;
      this.changed("all");
      if (TB.panels) TB.panels.onSelectionChanged();
      return copy;
    },

    archiveNote(id, archived) {
      const note = this.note(id);
      if (!note) return;
      this.snapshot();
      note.archived = archived == null ? !note.archived : !!archived;
      note.archivedAt = note.archived ? Date.now() : null;
      note.updated = Date.now();
      if (note.archived && this.ui.selectedId === id) this.ui.selectedId = null;
      if (TB.panels && TB.panels.isDetailsOpen()) TB.panels.closeDetails();
      this.changed("all");
      if (TB.panels) TB.panels.onSelectionChanged();
    },

    setStatus(id, status, opts) {
      const note = this.note(id);
      if (!note) return;
      if (!(opts && opts.silentUndo)) this.snapshot();
      const wasDone = note.done;
      note.meta = note.meta && typeof note.meta === "object" ? note.meta : {};
      if (status === "done" && !wasDone) {
        // Запоминаем, откуда пришли: «Входящие» должны вернуться во
        // «Входящие», а не в «Сегодня».
        note.meta.prevStatus = ["inbox", "today", "doing"].includes(note.status) ? note.status : "today";
      } else if (status !== "done") {
        delete note.meta.prevStatus;
      }
      note.status = status;
      note.done = status === "done";
      note.completedAt = note.done ? Date.now() : null;
      note.updated = Date.now();
      if (note.done && !wasDone && note.repeat && note.repeat !== "none") {
        this._spawnNext(note);
      }
      this.changed("all");
      if (TB.panels) TB.panels.onNoteChanged(note);
    },

    toggleDone(id) {
      const note = this.note(id);
      if (!note) return;
      if (!note.done) {
        this.setStatus(id, "done");
        return;
      }
      const back = (note.meta && note.meta.prevStatus) || "today";
      this.setStatus(id, ["inbox", "today", "doing"].includes(back) ? back : "today");
    },

    _spawnNext(note) {
      if (note.spawnedId && this.note(note.spawnedId)) return;
      const due = nextDue(note.due, note.repeat);
      if (!due) return;
      const now = Date.now();
      const copy = JSON.parse(JSON.stringify(note));
      copy.id = uid("n");
      copy.due = due;
      copy.done = false;
      copy.status = "today";
      copy.completedAt = null;
      copy.created = now;
      copy.updated = now;
      copy.spawnedId = null;
      copy.postponedCount = 0;
      copy.archived = false;
      copy.archivedAt = null;
      copy.z = this.maxZ(note.boardId) + 1;
      copy.checklist = (copy.checklist || []).map((c) => ({ id: uid("c"), text: c.text, done: false }));
      copy.meta = Object.assign({}, copy.meta || {});
      delete copy.meta.prevStatus;
      note.spawnedId = copy.id;
      this.doc.notes.push(copy);
    },

    postpone(id, days) {
      const note = this.note(id);
      if (!note) return;
      this.snapshot();
      const base = U.parseDue(note.due);
      const d = base ? new Date(base.getTime()) : new Date();
      if (!base) d.setHours(18, 0, 0, 0);
      d.setDate(d.getDate() + days);
      const pad = (n) => String(n).padStart(2, "0");
      note.due = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
      note.postponedCount = (note.postponedCount || 0) + 1;
      if (note.status === "inbox") note.status = "today";
      note.updated = Date.now();
      this.changed("all");
      U.toast("Перенесено на " + (days === 1 ? "завтра" : "+" + days + " дн."));
    },

    setSphere(id, sphere) {
      const note = this.note(id);
      if (!note) return;
      this.snapshot();
      note.sphere = sphere;
      this.doc.settings.lastSphere = sphere;
      note.updated = Date.now();
      if (note.status === "inbox") note.status = "today";
      this.changed("all");
    },

    assignSphere(id, sphere) {
      const note = this.note(id);
      if (!note) return;
      this.snapshot();
      note.sphere = sphere;
      note.status = note.status === "inbox" ? "today" : note.status;
      note.updated = Date.now();
      const target = this.doc.boards.find((b) => b.sphere === sphere && !b.inbox);
      if (target && this.board(note.boardId).inbox) {
        note.boardId = target.id;
        note.z = this.maxZ(target.id) + 1;
      }
      this.changed("all");
      U.toast("Сфера: " + (TB.sphereOf(sphere) || {}).name);
    },

    moveNoteToBoard(id, boardId) {
      const note = this.note(id);
      if (!note || !this.doc.boards.some((b) => b.id === boardId)) return;
      this.snapshot();
      note.boardId = boardId;
      note.z = this.maxZ(boardId) + 1;
      note.updated = Date.now();
      this.ui.selectedId = null;
      this.changed("all");
      if (TB.panels) TB.panels.closeDetails();
    },

    capture(text, opts) {
      const raw = String(text || "").trim();
      if (!raw) return null;
      const hashtags = (raw.match(/(^|\s)#[^\s#]+/g) || []).map((x) => x.trim());
      const withoutTags = raw.replace(/(^|\s)#[^\s#]+/g, " ").replace(/\s+/g, " ").trim() || raw;
      const parsed = U.extractWhen(withoutTags);
      const clean = parsed.text || withoutTags;
      const inbox = this.inboxBoard();
      const count = this.notes(inbox.id).length;
      const col = count % 3;
      const row = Math.floor(count / 3);
      const patch = Object.assign({
        boardId: inbox.id,
        x: 100 + col * 250 + (row % 2) * 14,
        y: 100 + row * 190,
        w: 215, h: 150,
        rot: (Math.random() * 5 - 2.5),
        html: "<div>" + U.escapeHtml(clean) + "</div>",
        status: "inbox",
        sphere: null,
        kind: "note",
        pin: "tape",
        color: "paper",
        tags: (opts && opts.tags) || U.tagsFrom(hashtags.join(",")),
      }, opts || {});
      if (parsed.due && !(opts && opts.due)) patch.due = parsed.due;
      return this.addNote(patch);
    },

    logFocus(noteId, minutes) {
      if (!minutes || minutes < 0.1) return;
      const note = this.note(noteId);
      const sphere = (note && note.sphere) || null;
      this.doc.focusLog.push({ id: uid("f"), at: Date.now(), minutes: Math.round(minutes), sphere, noteId: noteId || null });
      if (note) {
        note.focusMinutes = (note.focusMinutes || 0) + Math.round(minutes);
        note.updated = Date.now();
      }
      this.changed("all");
    },

    _dropFiles(note) {
      (note.attachments || []).forEach((a) => {
        if (a.fileId && TB.store) TB.store.deleteFile(a.fileId);
      });
    },

    /* ------------------------------ нити ------------------------------ */

    threads(boardId) {
      return this.doc.threads.filter((t) => t.boardId === (boardId || this.ui.boardId));
    },

    addThread(from, to, patch) {
      if (!from || !to || from === to) return null;
      const a = this.note(from), b = this.note(to);
      if (!a || !b || a.boardId !== b.boardId) return null;
      const existing = this.doc.threads.find(
        (t) => (t.from === from && t.to === to) || (t.from === to && t.to === from)
      );
      if (existing) {
        U.toast("Эти заметки уже связаны");
        return null;
      }
      this.snapshot();
      const t = Object.assign({
        id: uid("t"), boardId: a.boardId, from, to,
        color: "#B5432F", width: 2, style: "solid", arrow: true, label: "",
        created: Date.now(), updated: Date.now(),
      }, patch || {}, { updated: Date.now() });
      this.doc.threads.push(t);
      this.changed("board");
      return t;
    },

    updateThread(id, patch) {
      const t = this.doc.threads.find((x) => x.id === id);
      if (!t) return;
      this.snapshot();
      Object.assign(t, patch, { updated: Date.now() });
      this.changed("board");
    },

    deleteThread(id) {
      this.snapshot();
      this._tombstone("threads", id);
      this.doc.threads = this.doc.threads.filter((t) => t.id !== id);
      if (this.ui.selectedThread === id) this.ui.selectedThread = null;
      this.changed("board");
    },

    /* ------------------------------ выборки ------------------------------ */

    active() {
      return this.doc.notes.filter((n) => !n.archived);
    },

    inboxItems() {
      return this.active().filter((n) => n.status === "inbox");
    },

    todayItems() {
      const key = dayKey(new Date());
      return this.active().filter((n) => !n.done && (n.status === "today" || (n.due && dayKey(new Date(n.due)) === key)));
    },

    overdueItems() {
      const start = new Date(); start.setHours(0, 0, 0, 0);
      return this.active().filter((n) => !n.done && n.due && new Date(n.due) < start);
    },

    top3Items() {
      return this.active().filter((n) => n.top3 && !n.done).slice(0, 3);
    },

    eventsToday() {
      const key = dayKey(new Date());
      return this.active().filter((n) => n.kind === "event" && !n.done && n.due && dayKey(new Date(n.due)) === key)
        .sort((a, b) => new Date(a.due) - new Date(b.due));
    },

    upcomingEvents(days) {
      const now = new Date();
      const limit = new Date(now.getTime() + (days || 14) * 86400000);
      return this.active().filter((n) => n.kind === "event" && !n.done && n.due && new Date(n.due) >= now && new Date(n.due) <= limit)
        .sort((a, b) => new Date(a.due) - new Date(b.due));
    },

    byKind(kind) {
      return this.active().filter((n) => n.kind === kind);
    },

    bySphere(sphere) {
      return this.active().filter((n) => n.sphere === sphere);
    },

    templates() {
      return this.active().filter((n) => n.kind === "template");
    },

    ideas() {
      return this.active().filter((n) => n.kind === "idea");
    },

    projects() {
      return this.active().filter((n) => n.kind === "project");
    },

    tasksForProject(projectId) {
      return this.active().filter((n) => n.projectId === projectId && n.kind === "task");
    },

    upcomingDates(days) {
      const now = new Date(); now.setHours(0, 0, 0, 0);
      return this.active()
        .filter((n) => (n.kind === "date" || n.repeat === "yearly") && n.due && !n.done)
        .map((n) => {
          let due = new Date(n.due);
          if (n.repeat === "yearly") {
            const next = new Date(now.getFullYear(), due.getMonth(), due.getDate(), due.getHours(), due.getMinutes());
            if (next < now) next.setFullYear(next.getFullYear() + 1);
            due = next;
          }
          return { note: n, due };
        })
        .filter((x) => x.due.getTime() - now.getTime() <= (days || 30) * 86400000)
        .sort((a, b) => a.due - b.due);
    },

    tags() {
      const map = new Map();
      this.active().forEach((n) => {
        (n.tags || []).forEach((t) => {
          const cur = map.get(t) || { name: t, count: 0, boards: new Set() };
          cur.count += 1;
          cur.boards.add(n.boardId);
          map.set(t, cur);
        });
      });
      return Array.from(map.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    },

    agenda() {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const groups = { overdue: [], today: [], tomorrow: [], week: [], later: [] };
      this.active().forEach((n) => {
        if (n.done) return;
        const d = U.parseDue(n.due);
        if (!d) return;
        const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        const diff = Math.round((day - today) / 86400000);
        if (diff < 0) groups.overdue.push(n);
        else if (diff === 0) groups.today.push(n);
        else if (diff === 1) groups.tomorrow.push(n);
        else if (diff < 7) groups.week.push(n);
        else groups.later.push(n);
      });
      Object.keys(groups).forEach((k) => groups[k].sort((a, b) => new Date(a.due) - new Date(b.due)));
      return groups;
    },

    agendaCount() {
      const g = this.agenda();
      return g.overdue.length + g.today.length;
    },

    allTagsFlat() {
      return this.tags().map((t) => t.name);
    },

    daysWithItems(year, month) {
      const map = new Map();
      const push = (key, n) => {
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(n);
      };
      this.active().forEach((n) => {
        if (n.due) {
          const d = new Date(n.due);
          if (d.getFullYear() === year && d.getMonth() === month) push(dayKey(d), n);
        }
      });
      return map;
    },

    stats(days) {
      const now = Date.now();
      const from = now - (days || 7) * 86400000;
      const done = this.doc.notes.filter((n) => n.done && n.completedAt && n.completedAt >= from).length;
      const overdue = this.overdueItems().length;
      const postponed = this.active().filter((n) => (n.postponedCount || 0) > 0 && n.updated >= from);
      const focusBySphere = { work: 0, study: 0, projects: 0, life: 0, none: 0 };
      this.doc.focusLog.filter((f) => f.at >= from).forEach((f) => {
        const k = f.sphere || "none";
        focusBySphere[k] = (focusBySphere[k] || 0) + f.minutes;
      });
      const topTemplates = this.templates().slice().sort((a, b) => (b.usage || 0) - (a.usage || 0)).slice(0, 5);
      return { done, overdue, postponed, focusBySphere, topTemplates, totalFocus: Object.values(focusBySphere).reduce((a, b) => a + b, 0) };
    },

    /* ------------------------------ история ------------------------------ */

    snapshot() {
      try {
        this.history.push(JSON.stringify(this.doc));
        if (this.history.length > 60) this.history.shift();
        this.redoStack = [];
      } catch (e) {
        console.warn("Пробка: снимок истории не создан", e);
      }
    },

    undo() {
      if (!this.history.length) {
        U.toast("Нечего отменять");
        return;
      }
      this.redoStack.push(JSON.stringify(this.doc));
      this.doc = JSON.parse(this.history.pop());
      this._afterRestore();
      U.toast("Отменено");
    },

    redo() {
      if (!this.redoStack.length) {
        U.toast("Нечего повторять");
        return;
      }
      this.history.push(JSON.stringify(this.doc));
      this.doc = JSON.parse(this.redoStack.pop());
      this._afterRestore();
      U.toast("Повторено");
    },

    _afterRestore() {
      if (!this.doc.boards.some((b) => b.id === this.ui.boardId)) {
        this.ui.boardId = this.doc.boards[0].id;
      }
      if (this.ui.selectedId && !this.note(this.ui.selectedId)) this.ui.selectedId = null;
      if (TB.board) TB.board.onDocRestored();
      if (TB.panels) TB.panels.onDocRestored();
      this.changed("all");
      this.saveSoon();
    },

    /* ------------------------------ сохранение ------------------------------ */

    changed(scope) {
      this.saveSoon();
      if (TB.refresh) TB.refresh(scope || "all");
    },

    touch() {
      this.saveSoon();
    },

    saveSoon() {
      this._status = "saving";
      this.setSaveState("saving");
      clearTimeout(this._saveTimer);
      this._saveTimer = setTimeout(() => this.saveNow(), 420);
      if (TB.sync && !TB.sync.isApplying()) TB.sync.schedulePush();
      if (TB.refreshChrome) TB.refreshChrome();
    },

    async saveNow() {
      clearTimeout(this._saveTimer);
      try {
        await TB.store.saveDoc(this.doc);
        this._status = "saved";
        this.setSaveState("saved", new Date());
        if (TB.refreshChrome) TB.refreshChrome();
        return true;
      } catch (err) {
        console.error("Пробка: ошибка сохранения", err);
        this._status = "error";
        this.setSaveState("error");
        U.toast("Не удалось сохранить: " + (err.message || "ошибка хранилища"), "error");
        return false;
      }
    },

    setSaveState(state, date) {
      const el = document.getElementById("saveState");
      if (!el) return;
      el.classList.remove("saving", "error");
      if (state === "saving") {
        el.classList.add("saving");
        el.lastElementChild.textContent = "Сохраняю…";
      } else if (state === "error") {
        el.classList.add("error");
        el.lastElementChild.textContent = "Ошибка сохранения";
      } else {
        const t = date || new Date();
        el.lastElementChild.textContent = "Сохранено " + t.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
      }
    },
  };

  function dayKey(d) {
    const pad = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  TB.model = model;
  TB.seedDoc = seedDoc;
  TB.normalizeDoc = normalizeDoc;
  TB.defaultDoc = defaultDoc;
  TB.dayKey = dayKey;
  TB.nextDue = nextDue;
})();
