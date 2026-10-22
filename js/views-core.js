/* Пробка — оболочка разделов, Сегодня, Задачи, Календарь, Входящие, Поиск */
(function () {
  "use strict";

  const TB = window.TB;
  const U = TB.util;
  const $ = U.$;
  const $$ = U.$$;

  const root = $("#viewRoot");
  const actions = {};
  const forms = {};
  const state = {
    taskFilter: "all",
    taskMode: "list",
    taskSphere: "",
    calMonth: startOfMonth(new Date()),
    calSelected: TB.dayKey(new Date()),
    searchQuery: "",
    searchSphere: "",
  };
  let raf = null;
  let lastView = null;

  const META = {
    today: { title: "Сегодня", eyebrow: "Главное на день" },
    tasks: { title: "Задачи", eyebrow: "Всё, что требует действия" },
    calendar: { title: "Календарь", eyebrow: "Дедлайны и встречи" },
    inbox: { title: "Входящие", eyebrow: "Сначала поймать, потом разобрать" },
    work: { title: "Работа", eyebrow: "Поддержка Pipster · база ответов" },
    study: { title: "Учёба", eyebrow: "ДЗ, конкурсы, портфолио" },
    projects: { title: "Проекты", eyebrow: "Своё приложение и идеи" },
    life: { title: "Личное", eyebrow: "Журнал, дела, важные даты" },
    review: { title: "Обзор", eyebrow: "Итоги и план недели" },
    search: { title: "Поиск", eyebrow: "По всем записям и сферам" },
  };

  const views = {
    state,
    META,
    init,
    render,
    schedule,
    openNote,
    setState(patch) {
      Object.assign(state, patch);
      render();
    },
    registerAction(name, fn) { actions[name] = fn; },
    registerForm(name, fn) { forms[name] = fn; },
    meta(view) { return META[view] || { title: "Пробка", eyebrow: "" }; },
    title(view) { return (META[view] || {}).title || "Пробка"; },
  };

  /* ------------------------------ инициализация ------------------------------ */

  function init() {
    document.addEventListener("click", (e) => {
      const dock = e.target.closest("[data-dock]");
      if (dock) {
        const v = dock.dataset.dock;
        if (v === "capture") TB.tools.openCapture();
        else TB.model.setView(v);
        closeSidebar();
        return;
      }
      const nav = e.target.closest("[data-view-link]");
      if (nav) {
        e.preventDefault();
        const v = nav.dataset.viewLink;
        if (v && META[v]) TB.model.setView(v);
        closeSidebar();
      }
    });

    root.addEventListener("click", onClick);
    root.addEventListener("submit", onSubmit);
    root.addEventListener("keydown", onKeydown);
    root.addEventListener("input", onInput);

    window.addEventListener("resize", U.debounce(() => {
      // keep layout stable; nothing to relayout manually
    }, 200));

    actions.open = (el) => { openNote(el.dataset.id); return false; };
    actions["close-details"] = () => { TB.panels.closeDetails(); return false; };

    render();
  }

  /* ------------------------------ маршрутизация ------------------------------ */

  function render() {
    const view = TB.model.ui.view;
    const isBoard = view === "board";
    document.body.classList.toggle("view-mode", !isBoard);

    const titleEl = $("#boardTitle");
    const addLabel = $("#btnAddLabel");
    if (isBoard) {
      const b = TB.model.board();
      if (titleEl) {
        titleEl.readOnly = false;
        titleEl.value = b ? b.name : "Доска";
      }
      if (addLabel) addLabel.textContent = "Заметка";
      root.hidden = true;
      lastView = view;
      if (TB.refreshChrome) TB.refreshChrome();
      return;
    }

    if (titleEl) {
      titleEl.readOnly = true;
      titleEl.value = views.title(view);
    }
    if (addLabel) addLabel.textContent = "Записать";
    root.hidden = false;

    const prevTop = lastView === view ? root.scrollTop : 0;
    let content = "";
    try {
      if (view === "today") content = renderToday();
      else if (view === "tasks") content = renderTasks();
      else if (view === "calendar") content = renderCalendar();
      else if (view === "inbox") content = renderInbox();
      else if (view === "search") content = renderSearch();
      else if (TB.viewsLife) content = TB.viewsLife.render(view);
      else content = '<div class="v-empty">Раздел скоро появится.</div>';
    } catch (err) {
      console.error("Пробка: ошибка раздела", view, err);
      content = '<div class="v-empty"><b>Не удалось построить раздел.</b><br>' +
        U.escapeHtml(err.message || String(err)) + "</div>";
    }

    root.innerHTML = '<div class="view-page">' + content + "</div>";
    lastView = view;
    root.scrollTop = prevTop;
    bindView(view);
    if (view === "search") {
      const input = root.querySelector("#searchPageInput");
      if (input && !input.value) {
        // focus only when the section was opened deliberately
        if (state.searchFocus !== false) input.focus({ preventScroll: true });
      }
    }
    if (TB.refreshChrome) TB.refreshChrome();
  }

  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = null;
      render();
    });
  }

  function bindView(view) {
    if (view === "search") {
      const input = root.querySelector("#searchPageInput");
      if (input) {
        input.addEventListener("input", U.debounce(() => {
          state.searchQuery = input.value;
          updateSearchResults();
        }, 100));
      }
    }
    TB.viewsLife && TB.viewsLife.bind && TB.viewsLife.bind(view, root);
  }

  function openNote(id) {
    const n = TB.model.note(id);
    if (!n) return;
    TB.panels.openDetails(id);
    if (window.innerWidth <= 860) closeSidebar();
  }

  function closeSidebar() {
    const side = $("#sidebar");
    if (side) side.classList.remove("open");
  }

  /* ------------------------------ события ------------------------------ */

  function onClick(e) {
    const actEl = e.target.closest("[data-act]");
    if (actEl) {
      e.preventDefault();
      e.stopPropagation();
      const name = actEl.dataset.act;
      const fn = actions[name];
      if (fn) {
        let doRender = true;
        try {
          doRender = fn(actEl, actEl.dataset, e);
        } catch (err) {
          console.error("Пробка: действие " + name, err);
          U.toast("Не получилось: " + (err.message || "ошибка"), "error");
        }
        if (doRender !== false) render();
        return;
      }
    }

    const nav = e.target.closest("[data-view]");
    if (nav && nav.dataset.view && META[nav.dataset.view]) {
      e.preventDefault();
      TB.model.setView(nav.dataset.view);
      return;
    }

    const open = e.target.closest("[data-open]");
    if (open && open.dataset.open) {
      e.preventDefault();
      openNote(open.dataset.open);
    }
  }

  function onSubmit(e) {
    const form = e.target.closest("[data-form]");
    if (!form) return;
    e.preventDefault();
    const name = form.dataset.form;
    const fn = forms[name];
    if (!fn) return;
    try {
      if (fn(form, form.querySelector("input, textarea, select")) !== false) render();
    } catch (err) {
      console.error("Пробка: форма " + name, err);
      U.toast("Не получилось: " + (err.message || "ошибка"), "error");
    }
  }

  function onKeydown(e) {
    if (e.key !== "Enter" && e.key !== "Escape") return;
    const input = e.target.closest("[data-quick]");
    if (!input) return;
    if (e.key === "Escape") {
      input.value = "";
      input.blur();
    }
  }

  function onInput() { /* reserved for inline filters */ }

  /* ------------------------------ данные ------------------------------ */

  function activeNotes() { return TB.model.active(); }

  function taskKinds() {
    return ["task", "homework", "contest", "release", "event", "date"];
  }

  function taskPool() {
    return activeNotes().filter((n) => taskKinds().includes(n.kind));
  }

  function filteredTasks() {
    let list = taskPool().slice();
    const f = state.taskFilter;
    if (state.taskSphere) list = list.filter((n) => n.sphere === state.taskSphere);
    if (f === "done") {
      return list.filter((n) => n.done)
        .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
    }
    list = list.filter((n) => !n.done);
    if (f === "today") list = list.filter((n) => n.status === "today" || dayDiff(n.due) === 0);
    else if (f === "week") {
      const diff = dayDiff(n0(n));
      list = list.filter((n) => {
        const d = dayDiff(n.due);
        return d !== null && d >= 0 && d <= 7;
      });
    } else if (f === "overdue") list = list.filter((n) => dayDiff(n.due) !== null && dayDiff(n.due) < 0);
    return sortTasks(list);
  }

  function n0() { return null; }

  function sortTasks(list) {
    return list.sort((a, b) => {
      const da = dayDiff(a.due), db = dayDiff(b.due);
      const ra = da === null ? 9999 : da;
      const rb = db === null ? 9999 : db;
      if (ra !== rb) return ra - rb;
      if ((b.priority || 0) !== (a.priority || 0)) return (b.priority || 0) - (a.priority || 0);
      return (a.created || 0) - (b.created || 0);
    });
  }

  function dayDiff(due) {
    const d = U.parseDue(due);
    if (!d) return null;
    const now = new Date();
    const a = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const b = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return Math.round((b - a) / 86400000);
  }

  function doneToday() {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    return TB.model.doc.notes.filter((n) => n.done && n.completedAt && n.completedAt >= start.getTime());
  }

  function focusToday() {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const log = (TB.model.doc.focusLog || []).filter((f) => f.at >= start.getTime());
    const by = { work: 0, study: 0, projects: 0, life: 0, none: 0 };
    let total = 0;
    log.forEach((f) => {
      const k = f.sphere || "none";
      by[k] = (by[k] || 0) + f.minutes;
      total += f.minutes;
    });
    return { by, total, log };
  }

  function boardName(boardId) {
    const b = TB.model.doc.boards.find((x) => x.id === boardId);
    return b ? b.name : "";
  }

  function projectName(id) {
    const p = id ? TB.model.note(id) : null;
    return p ? U.titleOfNote(p) : "";
  }

  /* ------------------------------ html-кусочки ------------------------------ */

  function esc(s) { return U.escapeHtml(s == null ? "" : s); }

  function sphereStyle(sphere) {
    const sp = TB.sphereOf(sphere);
    return sp ? ' style="--sc:' + sp.color + '"' : ' style="--sc:#8B7A63"';
  }

  function sphereTag(sphere) {
    const sp = TB.sphereOf(sphere);
    if (!sp) return "";
    return '<span class="sphere-tag" style="--sc:' + sp.color + '"><i></i>' + esc(sp.short) + "</span>";
  }

  function dueChip(n) {
    const info = U.dueInfo(n.due);
    if (!info) return "";
    let cls = "";
    if (info.diff < 0) cls = "overdue";
    else if (info.diff === 0) cls = "today";
    else if (info.diff <= 2) cls = "soon";
    return '<span class="due-chip ' + cls + (n.done ? " done" : "") + '" title="' + esc(info.full) + '">' + esc(info.label) + "</span>";
  }

  function kindChip(kind) {
    if (!kind || kind === "task") return "";
    const k = TB.kindOf(kind);
    return '<span class="kind-chip"><svg class="ic"><use href="#' + k.icon + '"/></svg>' + esc(k.name) + "</span>";
  }

  function checkRow(n) {
    return '<button class="task-check' + (n.done ? " checked" : "") + '" data-act="toggle" data-id="' + esc(n.id) + '" aria-label="' + (n.done ? "Вернуть" : "Отметить готово") + '"></button>';
  }

  function taskRow(n, opts) {
    const o = opts || {};
    const title = U.titleOfNote(n);
    const project = projectName(n.projectId);
    const checks = (n.checklist || []);
    const doneChecks = checks.filter((c) => c.done).length;
    return (
      '<div class="task-row' + (n.done ? " done" : "") + (o.noBorder ? " no-border" : "") + '" data-open="' + esc(n.id) + '"' + sphereStyle(n.sphere) + ">" +
        checkRow(n) +
        '<div class="task-main">' +
          '<div class="task-title">' + esc(title) + (n.top3 ? ' <span class="lock" title="3 главных">★</span>' : "") + "</div>" +
          '<div class="task-meta">' +
            sphereTag(n.sphere) +
            (n.subject ? '<span class="kind-chip">' + esc(n.subject) + "</span>" : "") +
            (project && !o.hideProject ? '<span class="proj">' + esc(project) + "</span>" : "") +
            (checks.length ? '<span class="kind-chip">✓ ' + doneChecks + "/" + checks.length + "</span>" : "") +
            dueChip(n) +
          "</div>" +
        "</div>" +
        '<div class="task-end">' +
          (!n.done ? '<button class="task-quick" data-act="focus" data-id="' + esc(n.id) + '" title="Фокус на задаче"><svg class="ic"><use href="#i-play"/></svg></button>' : "") +
          (!n.done ? '<button class="task-quick postpone" data-act="postpone" data-id="' + esc(n.id) + '" data-days="1" title="Перенести на завтра">+1д</button>' : "") +
          (!o.plain && !n.done ? '<button class="task-quick" data-act="top3" data-id="' + esc(n.id) + '" title="В 3 главных">★</button>' : "") +
        "</div>" +
      "</div>"
    );
  }

  function groupedTaskList(list) {
    const groups = [
      { id: "overdue", name: "Просрочено", items: [] },
      { id: "today", name: "Сегодня", items: [] },
      { id: "tomorrow", name: "Завтра", items: [] },
      { id: "week", name: "На неделе", items: [] },
      { id: "later", name: "Позже", items: [] },
      { id: "none", name: "Без срока", items: [] },
    ];
    list.forEach((n) => {
      const d = dayDiff(n.due);
      if (d === null) groups[5].items.push(n);
      else if (d < 0) groups[0].items.push(n);
      else if (d === 0) groups[1].items.push(n);
      else if (d === 1) groups[2].items.push(n);
      else if (d <= 7) groups[3].items.push(n);
      else groups[4].items.push(n);
    });
    return groups.filter((g) => g.items.length).map((g) =>
      '<div class="task-group">' +
        '<div class="task-group-head ' + (g.id === "overdue" ? "overdue" : "") + '">' + g.name +
          ' <span class="n">' + g.items.length + "</span></div>" +
        g.items.map((n) => taskRow(n)).join("") +
      "</div>"
    ).join("");
  }

  function emptyState(text, actionLabel, action) {
    return '<div class="v-empty">' + text +
      (actionLabel ? '<br><button class="v-btn small" data-act="' + action + '">' + actionLabel + "</button>" : "") +
      "</div>";
  }

  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return n + " " + one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return n + " " + few;
    return n + " " + many;
  }

  /* ------------------------------ Сегодня ------------------------------ */

  function renderToday() {
    const now = new Date();
    const today = TB.model.todayItems().filter((n) => !n.done);
    const overdue = TB.model.overdueItems();
    const top3 = TB.model.top3Items();
    const events = TB.model.eventsToday();
    const inbox = TB.model.inboxItems();
    const done = doneToday();
    const focus = focusToday();
    const week = activeNotes()
      .filter((n) => {
        if (n.done || !n.due) return false;
        const d = dayDiff(n.due);
        return d !== null && d >= 0 && d <= 7;
      })
      .sort((a, b) => new Date(a.due) - new Date(b.due))
      .slice(0, 7);
    const dates = TB.model.upcomingDates(45).slice(0, 4);
    const dayTotal = today.length + done.length + overdue.length;
    const pct = dayTotal ? Math.round((done.length / dayTotal) * 100) : 0;
    const hour = now.getHours();
    const greet = hour < 5 ? "Доброй ночи" : hour < 12 ? "Доброе утро" : hour < 18 ? "Добрый день" : "Добрый вечер";
    const dateLine = capitalize(now.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" }));

    return (
      '<div class="v-head">' +
        '<div class="v-head-main"><div class="v-eyebrow">' + greet + "</div>" +
          '<h1 class="v-title">' + dateLine + "</h1>" +
          '<div class="v-sub">' + summaryLine(today.length, overdue.length, inbox.length, done.length) + "</div>" +
        "</div>" +
        '<div class="v-actions">' +
          '<button class="v-btn" data-act="open-inbox"><svg class="ic"><use href="#i-inbox"/></svg> Входящие' + (inbox.length ? " · " + inbox.length : "") + "</button>" +
          '<button class="v-btn primary" data-act="capture"><svg class="ic"><use href="#i-capture"/></svg> Захват</button>' +
        "</div>" +
      "</div>" +

      '<div class="today-hero">' +
        '<div class="today-stats">' +
          '<div class="stat-pill wax"><b>' + (today.length + overdue.length) + "</b><span>на день</span></div>" +
          '<div class="stat-pill mint"><b>' + done.length + "</b><span>сделано</span></div>" +
          '<div class="stat-pill brass"><b>' + focus.total + '</b><span>мин фокуса</span></div>' +
          '<div class="stat-pill"><b>' + inbox.length + "</b><span>во входящих</span></div>" +
        "</div>" +
        '<div class="day-ring" style="--p:' + pct + '" title="Прогресс дня"><b>' + pct + "%</b></div>" +
      "</div>" +

      '<div class="v-grid">' +
        '<div class="v-col">' +
          (overdue.length ? overdueCard(overdue) : "") +
          top3Card(top3) +
          '<div class="v-card">' +
            '<div class="v-card-head"><h2>Сегодня</h2>' +
              '<button class="v-card-link" data-view="tasks">все задачи →</button></div>' +
            '<form class="task-add" data-form="today-task">' +
              '<svg class="ic"><use href="#i-plus"/></svg>' +
              '<input name="title" placeholder="Добавить дело на сегодня…" autocomplete="off" data-quick />' +
              '<button class="v-btn small" type="submit">Добавить</button>' +
            "</form>" +
            (today.length ? today.slice(0, 9).map((n) => taskRow(n)).join("") +
              (today.length > 9 ? '<div class="v-empty">и ещё ' + (today.length - 9) + "…</div>" : "") :
              emptyState("На сегодня задач нет. Это тоже результат.", "Открыть все задачи", "go-tasks")) +
          "</div>" +
          eventsCard(events) +
        "</div>" +
        '<div class="v-col">' +
          quickCaptureCard() +
          inboxCard(inbox) +
          deadlinesCard(week) +
          focusCard(focus) +
          datesCard(dates) +
        "</div>" +
      "</div>"
    );
  }

  function summaryLine(today, overdue, inbox, done) {
    if (overdue) return plural(overdue, "просроченное дело", "просроченных дела", "просроченных дел") + " требует решения";
    if (!today && !inbox) return "Чисто. Можно заняться важным или отдохнуть.";
    return plural(today, "дело", "дела", "дел") + " на сегодня · " + done + " уже закрыто";
  }

  function overdueCard(list) {
    return (
      '<div class="v-card" style="border-color:rgba(181,67,47,.45)">' +
        '<div class="v-card-head"><h2 style="color:var(--wax)">Просрочено · ' + list.length + "</h2>" +
          '<button class="v-card-link" data-act="postpone-all" data-days="1">всё на завтра →</button></div>' +
        list.map((n) => taskRow(n)).join("") +
      "</div>"
    );
  }

  function top3Card(list) {
    const any = list.length > 0;
    return (
      '<div class="v-card">' +
        '<div class="v-card-head"><h2>3 главных</h2>' +
          '<button class="v-card-link" data-view="tasks">выбрать →</button></div>' +
        (any ? list.map((n, i) =>
          '<div class="top3-row" data-open="' + esc(n.id) + '">' +
            '<span class="num">' + (i + 1) + "</span>" +
            '<span class="t">' + esc(U.titleOfNote(n)) + "</span>" +
            '<span class="m">' + esc(sphereShort(n.sphere)) + (n.due ? " · " + esc(U.dueInfo(n.due).label) : "") + "</span>" +
          "</div>").join("")
          : '<div class="top3-empty">Звёздочка ★ в задаче ставит её в тройку главных. Три — максимум, чтобы день был честным.</div>') +
      "</div>"
    );
  }

  function eventsCard(events) {
    if (!events.length) return "";
    return (
      '<div class="v-card">' +
        '<div class="v-card-head"><h2>Встречи сегодня</h2><span class="v-card-sub">' + events.length + "</span></div>" +
        events.map((n) => {
          const d = U.parseDue(n.due);
          const time = d ? String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") : "";
          return '<div class="mini-row" data-open="' + esc(n.id) + '">' +
            "<time>" + time + "</time>" +
            '<span class="tt">' + esc(U.titleOfNote(n)) +
              "<small>" + esc(n.meta && n.meta.duration ? n.meta.duration + " мин · " + boardName(n.boardId) : boardName(n.boardId)) + "</small>" +
            "</span></div>";
        }).join("") +
      "</div>"
    );
  }

  function quickCaptureCard() {
    return (
      '<div class="v-card">' +
        '<div class="v-card-head"><h3>Поймать мысль</h3><span class="v-card-sub">Enter — во Входящие</span></div>' +
        '<form class="quick-capture-box" data-form="quick-capture">' +
          '<input name="title" placeholder="что не забыть…" autocomplete="off" data-quick />' +
          '<button class="v-btn small primary" type="submit">→</button>' +
        "</form>" +
        '<div class="v-sub" style="margin-top:7px">Только название. Сфера, срок и тип — потом, в карточке.</div>' +
      "</div>"
    );
  }

  function inboxCard(inbox) {
    return (
      '<div class="v-card">' +
        '<div class="v-card-head"><h3>Входящие</h3>' +
          '<button class="v-card-link" data-act="open-inbox">разобрать →</button></div>' +
        (inbox.length ? inbox.slice(0, 3).map((n) =>
          '<div class="mini-row" data-open="' + esc(n.id) + '" style="grid-template-columns:1fr">' +
            '<span class="tt">' + esc(U.titleOfNote(n)) + "<small>" + esc(boardName(n.boardId)) + "</small></span></div>"
        ).join("") + (inbox.length > 3 ? '<div class="v-sub" style="padding-top:4px">и ещё ' + (inbox.length - 3) + "…</div>" : "")
          : '<div class="v-sub">Пусто — это хороший знак.</div>') +
      "</div>"
    );
  }

  function deadlinesCard(week) {
    return (
      '<div class="v-card">' +
        '<div class="v-card-head"><h3>Дедлайны недели</h3><span class="v-card-sub">' + week.length + "</span></div>" +
        (week.length ? week.map((n) => {
          const d = U.dueInfo(n.due);
          return '<div class="mini-row" data-open="' + esc(n.id) + '"' + sphereStyle(n.sphere) + ">" +
            "<time>" + esc(d ? d.label.split(" · ")[0] : "") + "</time>" +
            '<span class="tt">' + esc(U.titleOfNote(n)) + "<small>" + esc(sphereShort(n.sphere)) + "</small></span></div>";
        }).join("") : '<div class="v-sub">На семь дней вперёд дедлайнов нет.</div>') +
      "</div>"
    );
  }

  function focusCard(focus) {
    const rows = TB.SPHERES.map((s) => {
      const v = focus.by[s.id] || 0;
      const max = Math.max(1, ...Object.values(focus.by));
      return '<div class="focus-bar" style="--sc:' + s.color + '">' +
        '<span class="lbl">' + esc(s.short) + "</span>" +
        '<span class="track"><i class="fill" style="width:' + Math.round((v / max) * 100) + '%"></i></span>' +
        '<span class="val">' + (v || "—") + "</span></div>";
    }).join("");
    return (
      '<div class="v-card">' +
        '<div class="v-card-head"><h3>Фокус дня</h3><span class="v-card-sub">' + (focus.total || 0) + " мин</span></div>" +
        '<div class="focus-bars">' + rows + "</div>" +
        '<div class="v-sub" style="margin-top:8px">Таймер — в левой панели, под «Фокус».</div>' +
      "</div>"
    );
  }

  function datesCard(dates) {
    if (!dates.length) return "";
    return (
      '<div class="v-card">' +
        '<div class="v-card-head"><h3>Важные даты</h3><button class="v-card-link" data-view="life">жизнь →</button></div>' +
        dates.map((x) => {
          const d = x.due;
          const diff = Math.ceil((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date().setHours(0, 0, 0, 0)) / 86400000);
          return '<div class="mini-row" data-open="' + esc(x.note.id) + '">' +
            "<time>" + d.getDate() + " " + U.MONTHS_SHORT[d.getMonth()] + "</time>" +
            '<span class="tt">' + esc(U.titleOfNote(x.note)) + "<small>" +
              (diff === 0 ? "сегодня" : diff === 1 ? "завтра" : "через " + diff + " дн.") +
            "</small></span></div>";
        }).join("") +
      "</div>"
    );
  }

  function sphereShort(sphere) {
    const sp = TB.sphereOf(sphere);
    return sp ? sp.short : "Без сферы";
  }

  function capitalize(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }

  /* ------------------------------ Задачи ------------------------------ */

  function renderTasks() {
    const all = taskPool();
    const counts = {
      all: all.filter((n) => !n.done).length,
      today: all.filter((n) => !n.done && (n.status === "today" || dayDiff(n.due) === 0)).length,
      week: all.filter((n) => !n.done && dayDiff(n.due) !== null && dayDiff(n.due) >= 0 && dayDiff(n.due) <= 7).length,
      overdue: all.filter((n) => !n.done && dayDiff(n.due) !== null && dayDiff(n.due) < 0).length,
      done: all.filter((n) => n.done).length,
    };
    const list = filteredTasks();
    const tabs = [
      ["all", "Все"],
      ["today", "Сегодня"],
      ["week", "Неделя"],
      ["overdue", "Просрочено"],
      ["done", "Сделано"],
    ];

    const sphereChips = TB.SPHERES.map((s) =>
      '<button class="filter-chip' + (state.taskSphere === s.id ? " active" : "") + '" data-act="task-sphere" data-sphere="' + s.id + '">' +
        '<i class="sphere-stripe" style="--sc:' + s.color + '"></i>' + esc(s.short) + "</button>"
    ).join("");

    return (
      '<div class="v-head">' +
        '<div class="v-head-main"><div class="v-eyebrow">Задачи и дедлайны</div>' +
          '<h1 class="v-title">Задачи</h1>' +
          '<div class="v-sub">' + plural(counts.all, "активная запись", "активные записи", "активных записей") +
            (counts.overdue ? " · " + counts.overdue + " просрочено" : "") + "</div>" +
        "</div>" +
        '<div class="v-actions">' +
          '<button class="v-btn' + (state.taskMode === "list" ? " active" : "") + '" data-act="task-mode" data-mode="list">Списком</button>' +
          '<button class="v-btn' + (state.taskMode === "matrix" ? " active" : "") + '" data-act="task-mode" data-mode="matrix">Матрица</button>' +
          '<button class="v-btn primary" data-act="capture"><svg class="ic"><use href="#i-plus"/></svg> Задача</button>' +
        "</div>" +
      "</div>" +

      '<div class="v-tabs">' + tabs.map(([id, name]) =>
        '<button class="v-tab' + (state.taskFilter === id ? " active" : "") + '" data-act="task-filter" data-filter="' + id + '">' +
          name + '<span class="n">' + counts[id] + "</span></button>"
      ).join("") + "</div>" +

      '<div class="v-row" style="margin-bottom:12px">' + sphereChips +
        (state.taskSphere ? '<button class="filter-chip" data-act="task-sphere" data-sphere="">все сферы ×</button>' : "") +
      "</div>" +

      (state.taskFilter !== "done" ?
        '<form class="task-add" data-form="task-quick">' +
          '<svg class="ic"><use href="#i-plus"/></svg>' +
          '<input name="title" placeholder="Новая задача — только название, остальное потом…" autocomplete="off" data-quick />' +
          '<button class="v-btn small" type="submit">Добавить</button>' +
        "</form>" : "") +

      (state.taskMode === "matrix" ? renderMatrix(list.filter((n) => !n.done)) :
        (list.length ? groupedTaskList(list) :
          emptyState(state.taskFilter === "done" ? "Пока ничего не закрыто." : "Здесь пусто. Добавьте первое дело выше.", "", "")))
    );
  }

  function renderMatrix(list) {
    const q = { ui: [], ni: [], un: [], nn: [] };
    list.forEach((n) => {
      const info = U.dueInfo(n.due);
      const urgent = !!(info && info.diff <= 1);
      const important = n.priority >= 2 || n.top3 || n.important;
      const key = (urgent ? "u" : "n") + (important ? "i" : "n");
      q[key].push(n);
    });
    const cell = (id, title, hint) => {
      const items = q[id];
      return '<div class="matrix-cell ' + cellClass(id) + '">' +
        "<h3>" + title + "</h3><div class='hint'>" + hint + " · " + items.length + "</div>" +
        (items.length ? items.slice(0, 6).map((n) => taskRow(n, { plain: true })).join("") : '<div class="kanban-empty">пусто</div>') +
        (items.length > 6 ? '<div class="v-sub">и ещё ' + (items.length - 6) + "…</div>" : "") +
      "</div>";
    };
    return '<div class="matrix">' +
      cell("ui", "Срочно и важно", "сделать первым") +
      cell("ni", "Важно, не срочно", "планировать") +
      cell("un", "Срочно, не важно", "делегировать / быстро") +
      cell("nn", "Не срочно, не важно", "когда-нибудь") +
    "</div>";
  }

  function cellClass(id) {
    return id === "ui" ? "urgent-important" : id === "ni" ? "not-urgent-important" :
      id === "un" ? "urgent-not-important" : "not-urgent-not-important";
  }

  /* ------------------------------ Календарь ------------------------------ */

  function renderCalendar() {
    const month = state.calMonth;
    const year = month.getFullYear();
    const m = month.getMonth();
    const monthTitle = capitalize(month.toLocaleDateString("ru-RU", { month: "long", year: "numeric" }));
    const first = new Date(year, m, 1);
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(year, m, 1 - offset);
    const todayKey = TB.dayKey(new Date());
    const selected = parseKey(state.calSelected) || new Date();

    const byDay = new Map();
    activeNotes().forEach((n) => {
      if (!n.due) return;
      const d = U.parseDue(n.due);
      if (!d) return;
      const key = TB.dayKey(d);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(n);
    });
    byDay.forEach((list) => list.sort((a, b) => new Date(a.due) - new Date(b.due)));

    let cells = "";
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const key = TB.dayKey(d);
      const items = byDay.get(key) || [];
      const other = d.getMonth() !== m;
      const isToday = key === todayKey;
      const isSel = key === state.calSelected;
      const colors = Array.from(new Set(items.map((n) => (TB.sphereOf(n.sphere) || {}).color || "#8B7A63"))).slice(0, 4);
      cells +=
        '<button type="button" class="cal-cell' + (other ? " other" : "") + (isToday ? " today" : "") + (isSel ? " selected" : "") +
          '" data-act="cal-select" data-date="' + key + '" aria-label="' + key + '">' +
          '<span class="cal-num">' + d.getDate() + "</span>" +
          '<span class="cal-items">' +
            items.slice(0, 2).map((n) =>
              '<span class="cal-item' + (n.done ? " done" : "") + '" style="--sc:' + ((TB.sphereOf(n.sphere) || {}).color || "#8B7A63") + '">' +
                esc(U.titleOfNote(n)) + "</span>"
            ).join("") +
            (items.length > 2 ? '<span class="cal-more">+' + (items.length - 2) + "</span>" : "") +
          "</span>" +
          '<span class="cal-dots">' + colors.map((c) => '<i style="background:' + c + '"></i>').join("") + "</span>" +
        "</button>";
    }

    const dayItems = byDay.get(state.calSelected) || [];
    const dayTitle = selected.toLocaleDateString("ru-RU", { weekday: "long", day: "numeric", month: "long" });
    const isPast = state.calSelected < todayKey;

    return (
      '<div class="v-head">' +
        '<div class="v-head-main"><div class="v-eyebrow">Общий обзор</div>' +
          '<h1 class="v-title">Календарь</h1>' +
          '<div class="v-sub">Все дедлайны сфер — на одном листе. День открывается справа.</div>' +
        "</div>" +
        '<div class="v-actions"><button class="v-btn" data-act="open-agenda"><svg class="ic"><use href="#i-calendar"/></svg> Повестка</button>' +
          '<button class="v-btn primary" data-act="capture"><svg class="ic"><use href="#i-plus"/></svg> Запись</button></div>' +
      "</div>" +

      '<div class="cal-toolbar">' +
        '<button class="v-btn small" data-act="cal-nav" data-months="-1" aria-label="Предыдущий месяц">←</button>' +
        '<div class="cal-month">' + monthTitle + "</div>" +
        '<button class="v-btn small" data-act="cal-nav" data-months="1" aria-label="Следующий месяц">→</button>' +
        '<button class="v-btn small" data-act="cal-today">Сегодня</button>' +
        '<span class="spacer"></span>' +
        '<span class="v-card-sub">' + plural(byDay.size, "день", "дня", "дней") + " со сроками</span>" +
      "</div>" +

      '<div class="cal-layout">' +
        '<div class="cal-grid">' +
          ["пн", "вт", "ср", "чт", "пт", "сб", "вс"].map((d) => '<div class="cal-dow">' + d + "</div>").join("") +
          cells +
        "</div>" +
        '<div class="cal-day-panel">' +
          '<div class="v-card">' +
            '<div class="cal-day-head"><h3>' + capitalize(dayTitle) + "</h3><span class='v-card-sub'>" + dayItems.length + "</span></div>" +
            (dayItems.length ? dayItems.map((n) => {
              const d = U.parseDue(n.due);
              const time = d && (d.getHours() || d.getMinutes()) ? String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") : "весь день";
              return '<div class="cal-event" data-open="' + esc(n.id) + '" style="--sc:' + ((TB.sphereOf(n.sphere) || {}).color || "#8B7A63") + '">' +
                "<b>" + esc(U.titleOfNote(n)) + "</b>" +
                "<span>" + time + " · " + esc(sphereShort(n.sphere)) + (n.kind !== "task" ? " · " + esc(TB.kindOf(n.kind).name) : "") + "</span>" +
              "</div>";
            }).join("") : '<div class="v-empty">На этот день ничего нет.</div>') +
            '<form class="task-add" style="margin-top:9px" data-form="calendar-add">' +
              '<svg class="ic"><use href="#i-plus"/></svg>' +
              '<input name="title" placeholder="' + (isPast ? "Запись задним числом…" : "Добавить на день…") + '" autocomplete="off" data-quick />' +
              '<button class="v-btn small" type="submit">+</button>' +
            "</form>" +
          "</div>" +
          '<div class="v-card tight" style="margin-top:10px">' +
            '<div class="v-sub">Клик по дню — показать. Клик по записи — открыть карточку. Дедлайн можно поставить любой записи.</div>' +
          "</div>" +
        "</div>" +
      "</div>"
    );
  }

  function parseKey(key) {
    if (!key) return null;
    const p = key.split("-").map(Number);
    if (p.length !== 3) return null;
    const d = new Date(p[0], p[1] - 1, p[2]);
    return isNaN(d.getTime()) ? null : d;
  }

  /* ------------------------------ Входящие ------------------------------ */

  function renderInbox() {
    const items = TB.model.inboxItems().slice().sort((a, b) => (b.created || 0) - (a.created || 0));
    return (
      '<div class="v-head">' +
        '<div class="v-head-main"><div class="v-eyebrow">Inbox · без сортировки на входе</div>' +
          '<h1 class="v-title">Входящие</h1>' +
          '<div class="v-sub">Сюда падает всё. Разбирать — порциями, по 5 минут.</div>' +
        "</div>" +
        '<div class="v-actions"><button class="v-btn primary" data-act="capture"><svg class="ic"><use href="#i-capture"/></svg> Захват</button></div>' +
      "</div>" +

      '<div class="inbox-intro">' +
        "<p><b>" + (items.length ? plural(items.length, "запись ждёт", "записи ждут", "записей ждут") + " разбора." : "Входящие пусты.") +
          "</b> Выберите сферу — запись переедет на нужную доску. Или задайте срок и оставьте в работе.</p>" +
        (items.length ? '<button class="v-btn" data-act="inbox-first">Разобрать первую</button>' : "") +
      "</div>" +

      '<form class="inbox-add" data-form="inbox-add">' +
        '<input name="title" placeholder="Что ещё нужно не забыть?" autocomplete="off" data-quick />' +
        '<button class="v-btn primary" type="submit">Поймать</button>' +
      "</form>" +

      (items.length ? items.map((n) =>
        '<div class="inbox-row" data-open="' + esc(n.id) + '">' +
          '<div class="tt"><b>' + esc(U.titleOfNote(n)) + "</b>" +
            "<span>" + esc(TB.kindOf(n.kind).name) + " · " + esc(relativeDay(n.created)) + "</span></div>" +
          '<div class="acts">' +
            TB.SPHERES.map((s) =>
              '<button class="sphere-btn" style="--sc:' + s.color + '" data-act="assign" data-id="' + esc(n.id) + '" data-sphere="' + s.id + '" title="В ' + esc(s.name) + '"><i></i>' + esc(s.short) + "</button>"
            ).join("") +
            '<button class="sphere-btn" data-act="inbox-today" data-id="' + esc(n.id) + '" title="Оставить на сегодня">сегодня</button>' +
            '<button class="sphere-btn" data-act="archive" data-id="' + esc(n.id) + '" title="В архив">×</button>' +
          "</div>" +
        "</div>").join("")
        : '<div class="v-empty" style="padding:42px 0"><b>Чистый стол.</b><br>Новая мысль появится здесь, когда вы нажмёте «Захват».<br>' +
          '<button class="v-btn small" data-act="capture">Записать мысль</button></div>')
    );
  }

  function relativeDay(ts) {
    if (!ts) return "только что";
    const diff = Math.floor((Date.now() - ts) / 86400000);
    if (diff <= 0) return "сегодня";
    if (diff === 1) return "вчера";
    return diff + " дн. назад";
  }

  /* ------------------------------ Поиск ------------------------------ */

  function renderSearch() {
    return (
      '<div class="v-head">' +
        '<div class="v-head-main"><div class="v-eyebrow">Сквозной поиск</div>' +
          '<h1 class="v-title">Поиск</h1>' +
          '<div class="v-sub">Названия, заметки, теги, предметы, ссылки. Ctrl+K — быстрая палитра.</div>' +
        "</div>" +
      "</div>" +
      '<div class="search-page-box">' +
        '<svg class="ic"><use href="#i-search"/></svg>' +
        '<input id="searchPageInput" placeholder="начать вводить…" value="' + esc(state.searchQuery) + '" autocomplete="off" spellcheck="false" />' +
        '<span class="v-card-sub" id="searchCount"></span>' +
      "</div>" +
      '<div class="search-filters">' +
        '<button class="filter-chip' + (!state.searchSphere ? " active" : "") + '" data-act="search-sphere" data-sphere="">Все сферы</button>' +
        TB.SPHERES.map((s) => '<button class="filter-chip' + (state.searchSphere === s.id ? " active" : "") +
          '" data-act="search-sphere" data-sphere="' + s.id + '"><i class="sphere-stripe" style="--sc:' + s.color + '"></i>' + esc(s.short) + "</button>").join("") +
      "</div>" +
      '<div class="search-results-list" id="searchResults"></div>'
    );
  }

  function searchMatches() {
    const q = state.searchQuery.trim().toLowerCase();
    let list = activeNotes();
    if (state.searchSphere) list = list.filter((n) => n.sphere === state.searchSphere);
    if (!q) {
      return list.slice().sort((a, b) => (b.updated || 0) - (a.updated || 0)).slice(0, 30)
        .map((n) => ({ n, score: 0 }));
    }
    const scored = [];
    list.forEach((n) => {
      const title = U.titleOfNote(n).toLowerCase();
      const text = U.plainText(n.html).toLowerCase();
      const tags = (n.tags || []).join(" ").toLowerCase();
      const subject = String(n.subject || "").toLowerCase();
      const url = String(n.url || "").toLowerCase();
      const meta = Object.values(n.meta || {}).join(" ").toLowerCase();
      let score = 0;
      if (title === q) score = 120;
      else if (title.startsWith(q)) score = 100;
      else if (title.includes(q)) score = 80;
      else if (tags.includes(q)) score = 55;
      else if (subject.includes(q)) score = 45;
      else if (text.includes(q)) score = 30;
      else if (url.includes(q) || meta.includes(q)) score = 20;
      if (score) scored.push({ n, score });
    });
    return scored.sort((a, b) => b.score - a.score || (b.n.updated || 0) - (a.n.updated || 0)).slice(0, 100);
  }

  function renderSearchResults() {
    const matches = searchMatches();
    const box = $("#searchResults");
    const count = $("#searchCount");
    if (count) count.textContent = matches.length ? matches.length + " найдено" : "";
    if (!box) return;
    if (!matches.length) {
      box.innerHTML = '<div class="v-empty"><b>Ничего не найдено.</b><br>Попробуйте другое слово или сбросьте фильтр сферы.</div>';
      return;
    }
    box.innerHTML = matches.map(({ n }) => {
      const info = U.dueInfo(n.due);
      const excerpt = U.plainText(n.html);
      return '<div class="search-result" data-open="' + esc(n.id) + '">' +
        '<div class="tt"><b>' + mark(U.titleOfNote(n), state.searchQuery) + "</b>" +
          "<span>" + mark(excerpt.slice(0, 130), state.searchQuery) + "</span></div>" +
        '<div class="meta">' + sphereTag(n.sphere) + kindChip(n.kind) +
          (info ? '<span class="due-chip ' + (info.diff < 0 ? "overdue" : info.diff === 0 ? "today" : "") + '">' + esc(info.label) + "</span>" : "") +
          '<span class="kind-chip">' + esc(boardName(n.boardId)) + "</span>" +
        "</div></div>";
    }).join("");
  }

  function updateSearchResults() {
    renderSearchResults();
  }

  function mark(text, query) {
    const safe = esc(text);
    const q = String(query || "").trim();
    if (!q) return safe;
    const pattern = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    try {
      return safe.replace(new RegExp("(" + pattern + ")", "gi"), '<mark class="search-highlight">$1</mark>');
    } catch (e) {
      return safe;
    }
  }

  /* ------------------------------ формы и действия ------------------------------ */

  function todayDue(hour) {
    const d = new Date();
    d.setHours(hour == null ? 18 : hour, 0, 0, 0);
    const pad = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function dateDue(key, hour) {
    const d = parseKey(key);
    if (!d) return null;
    d.setHours(hour == null ? 18 : hour, 0, 0, 0);
    const pad = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function quickTask(title, patch) {
    const clean = String(title || "").trim();
    if (!clean) return null;
    const sphere = (patch && patch.sphere) || state.taskSphere || TB.model.doc.settings.lastSphere || "work";
    return TB.model.addNote(Object.assign({
      html: "<div>" + esc(clean) + "</div>",
      kind: "task",
      sphere,
      status: "today",
      boardId: TB.model.ui.boardId,
    }, patch || {}));
  }

  forms["today-task"] = (form, input) => {
    const n = quickTask(input.value, { due: todayDue(18) });
    if (!n) return false;
    input.value = "";
    U.toast("Добавлено на сегодня");
    requestAnimationFrame(() => { const el = root.querySelector('[data-form="today-task"] input'); if (el) el.focus(); });
    return true;
  };

  forms["task-quick"] = (form, input) => {
    const due = state.taskFilter === "today" ? todayDue(18) : null;
    const n = quickTask(input.value, due ? { due } : {});
    if (!n) return false;
    input.value = "";
    U.toast("Задача добавлена");
    requestAnimationFrame(() => { const el = root.querySelector('[data-form="task-quick"] input'); if (el) el.focus(); });
    return true;
  };

  forms["quick-capture"] = (form, input) => {
    const n = TB.model.capture(input.value);
    if (!n) return false;
    input.value = "";
    U.toast("Во Входящие");
    requestAnimationFrame(() => { const el = root.querySelector('[data-form="quick-capture"] input'); if (el) el.focus(); });
    return true;
  };

  forms["inbox-add"] = (form, input) => {
    if (!TB.model.capture(input.value)) return false;
    input.value = "";
    U.toast("Поймано");
    requestAnimationFrame(() => { const el = root.querySelector('[data-form="inbox-add"] input'); if (el) el.focus(); });
    return true;
  };

  forms["calendar-add"] = (form, input) => {
    const clean = input.value.trim();
    if (!clean) return false;
    const n = quickTask(clean, { due: dateDue(state.calSelected, 18) });
    if (!n) return false;
    input.value = "";
    U.toast("Запись на " + parseKey(state.calSelected).toLocaleDateString("ru-RU", { day: "numeric", month: "long" }));
    return true;
  };

  actions["go-tasks"] = () => { TB.model.setView("tasks"); return false; };
  actions["capture"] = () => { TB.tools.openCapture(); return false; };
  actions["open-inbox"] = () => { TB.model.setView("inbox"); return false; };
  actions["open-agenda"] = () => { TB.tools.openAgenda(); return false; };

  actions.toggle = (el) => {
    TB.model.toggleDone(el.dataset.id);
    return true;
  };

  actions.top3 = (el) => {
    const n = TB.model.note(el.dataset.id);
    if (!n) return false;
    const top = TB.model.top3Items();
    if (!n.top3 && top.length >= 3) {
      U.toast("В тройке уже три дела. Снимите звезду с другого.", "warn");
      return false;
    }
    TB.model.updateNote(n.id, { top3: !n.top3 });
    U.toast(n.top3 ? "В главных" : "Убрано из главных");
    return true;
  };

  actions.postpone = (el) => {
    TB.model.postpone(el.dataset.id, Number(el.dataset.days || 1));
    return true;
  };

  actions["postpone-all"] = (el) => {
    const days = Number(el.dataset.days || 1);
    const overdue = TB.model.overdueItems();
    if (!overdue.length) return false;
    TB.model.snapshot();
    overdue.forEach((n) => {
      const base = U.parseDue(n.due) || new Date();
      base.setDate(base.getDate() + days);
      const pad = (x) => String(x).padStart(2, "0");
      n.due = base.getFullYear() + "-" + pad(base.getMonth() + 1) + "-" + pad(base.getDate()) + "T" + pad(base.getHours()) + ":" + pad(base.getMinutes());
      n.postponedCount = (n.postponedCount || 0) + 1;
      n.updated = Date.now();
    });
    TB.model.changed("all");
    U.toast("Просроченное перенесено на завтра");
    return true;
  };

  actions.focus = (el) => {
    TB.tools.focusNote(el.dataset.id);
    return false;
  };

  actions["task-filter"] = (el) => {
    state.taskFilter = el.dataset.filter;
    return true;
  };
  actions["task-mode"] = (el) => {
    state.taskMode = el.dataset.mode;
    return true;
  };
  actions["task-sphere"] = (el) => {
    state.taskSphere = el.dataset.sphere || "";
    return true;
  };
  actions["search-sphere"] = (el) => {
    state.searchSphere = el.dataset.sphere || "";
    return true;
  };

  actions["cal-nav"] = (el) => {
    const delta = Number(el.dataset.months || 1);
    state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() + delta, 1);
    const now = new Date();
    if (state.calMonth.getFullYear() === now.getFullYear() && state.calMonth.getMonth() === now.getMonth()) {
      state.calSelected = TB.dayKey(now);
    } else {
      state.calSelected = TB.dayKey(state.calMonth);
    }
    return true;
  };
  actions["cal-today"] = () => {
    state.calMonth = startOfMonth(new Date());
    state.calSelected = TB.dayKey(new Date());
    return true;
  };
  actions["cal-select"] = (el) => {
    state.calSelected = el.dataset.date;
    const d = parseKey(state.calSelected);
    if (d && d.getMonth() !== state.calMonth.getMonth()) state.calMonth = startOfMonth(d);
    return true;
  };

  actions.assign = (el) => {
    TB.model.assignSphere(el.dataset.id, el.dataset.sphere);
    return true;
  };
  actions["inbox-today"] = (el) => {
    const n = TB.model.note(el.dataset.id);
    if (!n) return false;
    TB.model.updateNote(n.id, { status: "today", due: todayDue(18) });
    U.toast("Оставлено на сегодня");
    return true;
  };
  actions["inbox-first"] = () => {
    const first = TB.model.inboxItems()[0];
    if (!first) return false;
    openNote(first.id);
    return false;
  };
  actions.archive = (el) => {
    TB.model.archiveNote(el.dataset.id, true);
    U.toast("В архиве");
    return true;
  };

  function startOfMonth(d) {
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }

  /* разбор входящих прямо из палитры поиска — экспорт для tools */
  views.searchMatches = searchMatches;
  views.renderSearchResults = renderSearchResults;
  views.searchState = state;

  TB.views = views;
  window.TB.views = views;
})();
