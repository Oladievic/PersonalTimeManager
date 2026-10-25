/* Пробка — разделы: Работа, Учёба, Проекты, Личное, Обзор */
(function () {
  "use strict";

  const TB = window.TB;
  const U = TB.util;
  const $ = U.$;

  const state = {
    workQuery: "",
    studyQuery: "",
    projectFilter: "all",
  };

  const esc = (s) => U.escapeHtml(s == null ? "" : s);

  function meta(view) {
    return TB.views.meta(view);
  }

  function head(view, sub, actions) {
    const m = meta(view);
    return '<div class="v-head"><div class="v-head-main">' +
      '<div class="v-eyebrow">' + esc(m.eyebrow) + "</div>" +
      '<h1 class="v-title">' + esc(m.title) + "</h1>" +
      (sub ? '<div class="v-sub">' + sub + "</div>" : "") +
      '</div><div class="v-actions">' + (actions || "") + "</div></div>";
  }

  function btn(label, act, opts) {
    const o = opts || {};
    return '<button class="v-btn' + (o.kind ? " " + o.kind : "") + '" type="button" data-act="' + act + '"' +
      (o.id ? ' data-id="' + esc(o.id) + '"' : "") +
      (o.extra || "") + ">" +
      (o.icon ? '<svg class="ic"><use href="#' + o.icon + '"/></svg>' : "") + esc(label) + "</button>";
  }

  function sphereTag(sphere) {
    const sp = TB.sphereOf(sphere);
    if (!sp) return "";
    return '<span class="sphere-tag" style="--sc:' + sp.color + '"><i></i>' + esc(sp.name) + "</span>";
  }

  function dueChip(n) {
    const info = U.dueInfo(n.due);
    if (!info) return "";
    let cls = info.cls;
    if (info.diff === 0) cls = "today";
    return '<span class="due-chip ' + cls + '">' + esc(info.label) + "</span>";
  }

  function kindChip(n) {
    const k = TB.kindOf(n.kind);
    return '<span class="kind-chip"><svg class="ic"><use href="#' + k.icon + '"/></svg>' + esc(k.name) + "</span>";
  }

  function progress(n) {
    const c = n.checklist || [];
    if (!c.length) return "";
    const done = c.filter((x) => x.done).length;
    return '<span class="v-card-sub">' + done + "/" + c.length + "</span>";
  }

  function taskLine(n) {
    const title = U.titleOfNote(n);
    const checks = n.checklist || [];
    const doneChecks = checks.filter((c) => c.done).length;
    return '<div class="task-row' + (n.done ? " done" : "") + '" data-open="' + esc(n.id) + '">' +
      '<button class="task-check" type="button" data-act="toggle" data-id="' + esc(n.id) + '" aria-label="Готово"></button>' +
      '<div class="task-main"><div class="task-title">' + esc(title) + (n.important ? ' <span class="lock">важно</span>' : "") + "</div>" +
        '<div class="task-meta">' + sphereTag(n.sphere) +
          (n.subject ? '<span class="proj">' + esc(n.subject) + "</span>" : "") +
          (checks.length ? '<span class="proj">' + doneChecks + "/" + checks.length + "</span>" : "") +
        "</div></div>" +
      '<div class="task-end">' + dueChip(n) +
        (n.due ? '<button class="task-quick postpone" type="button" data-act="postpone" data-id="' + esc(n.id) + '" data-days="1" title="+1 день">+1</button>' : "") +
      "</div></div>";
  }

  function empty(text) {
    return '<div class="v-empty">' + text + "</div>";
  }

  function section(title, sub, body, right) {
    return '<section class="v-card"><div class="v-card-head"><div><h2>' + esc(title) + "</h2>" +
      (sub ? '<div class="v-card-sub">' + esc(sub) + "</div>" : "") + "</div>" + (right || "") + "</div>" + body + "</section>";
  }

  /* ------------------------------ диалог создания ------------------------------ */

  function createDialog(opts) {
    const o = opts || {};
    const body = document.createElement("div");
    body.className = "board-form create-form";
    const dueValue = o.due === undefined ? "" : o.due;
    body.innerHTML =
      '<label>Название<input type="text" data-title maxlength="180" autofocus placeholder="' + esc(o.placeholder || "Коротко, по делу") + '"></label>' +
      '<label>Детали<textarea data-notes rows="3" placeholder="описание, ссылки, шаги…"></textarea></label>' +
      '<div class="row-2">' +
        (o.subject === false ? "" : '<label>Предмет / тема<input type="text" data-subject placeholder="необязательно"></label>') +
        '<label>Срок<input type="datetime-local" data-due value="' + esc(dueValue) + '"></label>' +
      "</div>" +
      (o.stage ? '<label>Этап<select data-stage>' + o.stage.map((s) => '<option value="' + s.id + '">' + esc(s.name) + "</option>").join("") + "</select></label>" : "") +
      '<label>Теги<input type="text" data-tags placeholder="через запятую"></label>';

    const save = () => {
      const title = body.querySelector("[data-title]").value.trim();
      if (!title) {
        body.querySelector("[data-title]").focus();
        U.toast("Название обязательно", "warn");
        return false;
      }
      const notes = body.querySelector("[data-notes]").value.trim();
      const due = body.querySelector("[data-due]").value || null;
      const subject = body.querySelector("[data-subject]") ? body.querySelector("[data-subject]").value.trim() : "";
      const tags = U.tagsFrom(body.querySelector("[data-tags]").value);
      const stageEl = body.querySelector("[data-stage]");
      const patch = {
        html: '<div>' + esc(title) + "</div>" + (notes ? "<div>" + esc(notes).replace(/\n/g, "</div><div>") + "</div>" : ""),
        kind: o.kind || "task",
        sphere: o.sphere || TB.model.doc.settings.lastSphere || "work",
        status: o.status || "today",
        due,
        subject,
        tags,
        meta: Object.assign({}, o.meta || {}),
      };
      if (stageEl) patch.meta.stage = stageEl.value;
      const targetBoard = TB.model.doc.boards.find((b) => !b.inbox && b.sphere === patch.sphere);
      if (targetBoard && (o.sphere || TB.model.board().inbox)) patch.boardId = targetBoard.id;
      const n = TB.model.addNote(patch);
      U.toast("Добавлено");
      if (n && (o.open === false) === false) setTimeout(() => TB.panels.openDetails(n.id), 30);
      return true;
    };

    TB.overlays.showModal({
      title: o.title || "Новая запись",
      sub: o.sub || "Только название обязательно",
      body,
      footer: [
        { label: "Отмена" },
        { label: o.saveLabel || "Создать", kind: "primary", onClick: save },
      ],
    });
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        resolve();
      } catch (e) { reject(e); }
    });
  }

  function templateDialog(n) {
    const lines = U.noteText(n).split("\n").filter(Boolean);
    const raw = lines.join("\n");
    const names = Array.from(new Set((raw.match(/\{([^{}]+)\}/g) || []).map((s) => s.slice(1, -1))));
    const body = document.createElement("div");
    body.className = "board-form";
    body.innerHTML =
      (names.length
        ? '<div class="copy-fields">' + names.map((name) => '<label>' + esc(name) +
            '<input type="text" data-field="' + esc(name) + '" placeholder="подставить…"></label>').join("") + "</div>"
        : '<div class="settings-note">В шаблоне нет полей вида {имя} — можно просто скопировать текст.</div>') +
      '<div class="tpl-copy-note" data-preview style="margin-top:10px"></div>';
    const preview = body.querySelector("[data-preview]");
    const fill = () => {
      let text = raw;
      body.querySelectorAll("[data-field]").forEach((input) => {
        text = text.split("{" + input.dataset.field + "}").join(input.value || "{" + input.dataset.field + "}");
      });
      preview.textContent = text;
    };
    fill();
    body.addEventListener("input", fill);

    TB.overlays.showModal({
      title: U.titleOfNote(n),
      sub: "Шаблон ответа · поля подставляются на лету",
      body,
      footer: [
        { label: "Отмена" },
        { label: "Создать задачу", onClick: () => {
          const text = preview.textContent;
          TB.model.addNote({
            html: "<div>" + esc(U.titleOfNote(n)) + "</div><div>" + esc(text).replace(/\n/g, "</div><div>") + "</div>",
            kind: "task", sphere: n.sphere || "work", status: "today", tags: (n.tags || []).slice(),
            boardId: n.boardId,
          });
          U.toast("Задача из шаблона создана");
        } },
        { label: "Скопировать", kind: "primary", onClick: () => {
          copyText(preview.textContent).then(() => {
            TB.model.updateNote(n.id, { usage: (n.usage || 0) + 1 }, { scope: "all" });
            U.toast("Скопировано · шаблон использован");
          }).catch(() => U.toast("Не удалось скопировать", "warn"));
        } },
      ],
    });
  }

  /* ------------------------------ работа ------------------------------ */

  function templateCard(n) {
    const text = U.noteText(n);
    const tags = (n.tags || []).slice(0, 3).map((t) => '<span class="kind-chip">#' + esc(t) + "</span>").join("");
    return '<article class="tpl-card" data-open="' + esc(n.id) + '" data-filter-item data-search="' +
      esc((U.titleOfNote(n) + " " + text + " " + (n.tags || []).join(" ")).toLowerCase()) + '" style="--sc:' +
      (TB.sphereOf(n.sphere) || {}).color + '">' +
      '<div class="tpl-card-head"><h3>' + esc(U.titleOfNote(n)) + "</h3>" +
        '<button class="tpl-fav' + (n.favorite ? " active" : "") + '" type="button" data-act="tpl-fav" data-id="' + esc(n.id) + '" title="Избранное" aria-label="Избранное">' +
        '<svg class="ic"><use href="#i-star"/></svg></button></div>' +
      '<div class="tpl-excerpt">' + esc(text.slice(0, 260)) + "</div>" +
      '<div class="tpl-foot"><div class="tags">' + tags + '</div><span class="usage">' +
        (n.usage || 0) + " исп.</span>" +
        '<button class="tpl-copy" type="button" data-act="use-template" data-id="' + esc(n.id) + '">' +
        '<svg class="ic"><use href="#i-copy"/></svg> Копировать</button></div></article>';
  }

  function renderWork() {
    const work = TB.model.bySphere("work");
    const active = work.filter((n) => !n.done && n.kind !== "template");
    const templates = work.filter((n) => n.kind === "template")
      .sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) || (b.usage || 0) - (a.usage || 0));
    const overdue = active.filter((n) => {
      const info = U.dueInfo(n.due);
      return info && info.diff < 0;
    });
    const today = active.filter((n) => n.status === "today" || (U.dueInfo(n.due) || {}).diff === 0);
    const done7 = work.filter((n) => n.done && n.completedAt && n.completedAt > Date.now() - 7 * 86400000).length;

    return head("work", "VPN Pipster, смены и база готовых ответов — всё под рукой",
      btn("Новый шаблон", "new-template", { icon: "i-plus", kind: "primary" })) +
      '<div class="review-kpis" style="grid-template-columns:repeat(4,1fr)">' +
        '<div class="kpi"><b>' + active.length + '</b><span>в работе</span></div>' +
        '<div class="kpi wax"><b>' + today.length + '</b><span>на сегодня</span></div>' +
        '<div class="kpi brass"><b>' + templates.length + '</b><span>шаблонов</span></div>' +
        '<div class="kpi mint"><b>' + done7 + '</b><span>закрыто за 7 дней</span></div>' +
      "</div>" +
      '<div class="v-grid"><div class="v-col">' +
        section("База ответов", "Скопировать готовый ответ или подставить поля",
          '<div class="tpl-search"><svg class="ic"><use href="#i-search"/></svg>' +
          '<input type="search" data-tpl-search placeholder="Найти шаблон: vpn, оплата, подписка…" value="' + esc(state.workQuery) + '">' +
          '<kbd>/</kbd></div><div class="tpl-grid" data-tpl-grid>' +
          (templates.length ? templates.map(templateCard).join("") : empty("Шаблонов пока нет. Создайте первый — он пригодится в смене.")) +
          "</div>") +
        section("Смена и задачи", "Активные дела сферы «Работа»",
          overdue.length ? '<div class="v-card-sub" style="color:var(--wax);margin-bottom:4px">Просрочено: ' + overdue.length + "</div>" : "" +
          (active.length ? active.slice(0, 18).map(taskLine).join("") : empty("На работе пока тихо."))) +
      "</div><div class=\"v-col\">" +
        section("Повестка", "Ближайшие дедлайны",
          (active.filter((n) => n.due).sort((a, b) => new Date(a.due) - new Date(b.due)).slice(0, 8)
            .map((n) => '<div class="mini-row" data-open="' + esc(n.id) + '"><time>' +
              esc((U.dueInfo(n.due) || {}).label || "") + '</time><div class="tt">' + esc(U.titleOfNote(n)) +
              '<small>' + esc(TB.kindOf(n.kind).name) + "</small></div></div>").join("")) ||
          empty("Дедлайнов на работе нет.")) +
        section("Быстрый ответ", "Шаблон можно скопировать в чат поддержки",
          '<div class="settings-note">Совет: в шаблоне пишите поля вроде <b>{имя}</b> или <b>{тариф}</b> — форма подставит их сама.</div>' +
          btn("Создать шаблон", "new-template", { icon: "i-plus" })) +
        section("Смена Pipster", "Поддержка VPN · быстрые ссылки",
          '<div class="link-row" data-act="open-url" data-url="https://pipster.example"><div class="tt"><b>Панель поддержки</b><span>тикеты и смены</span></div><span>↗</span></div>' +
          '<div class="link-row" data-act="open-url" data-url="https://meet.google.com/"><div class="tt"><b>Созвон с командой</b><span>Google Meet</span></div><span>↗</span></div>' +
          '<div class="settings-note">Ссылки можно заменить в настройках/заметках. Приложение не отправляет данные наружу.</div>') +
      "</div></div>";
  }

  /* ------------------------------ учёба ------------------------------ */

  function renderStudy() {
    const items = TB.model.bySphere("study");
    const homework = items.filter((n) => n.kind === "homework" && !n.done);
    const contests = items.filter((n) => n.kind === "contest" && !n.done);
    const portfolio = items.filter((n) => n.kind === "portfolio" && !n.done);
    const links = items.filter((n) => n.kind === "link" && !n.done);
    const subjects = Array.from(new Set(homework.map((n) => n.subject || "Без предмета")));
    const upcoming = items.filter((n) => n.due && !n.done).sort((a, b) => new Date(a.due) - new Date(b.due)).slice(0, 8);

    const subjectsHtml = subjects.map((subject) => {
      const list = homework.filter((n) => (n.subject || "Без предмета") === subject);
      return '<div class="subject-block"><div class="subject-head"><h3>' + esc(subject) + "</h3><span>" +
        list.length + " " + plural(list.length, "работа", "работы", "работ") + "</span></div>" +
        list.map(taskLine).join("") + "</div>";
    }).join("");

    const contestHtml = TB.CONTEST_STAGES.map((stage) => {
      const list = contests.filter((n) => (n.meta || {}).stage === stage.id);
      return '<div class="contest-col"><h3>' + esc(stage.name) + '</h3><div class="n">' + list.length + " шт.</div>" +
        list.map((n) => '<div class="contest-card" data-open="' + esc(n.id) + '"><b>' + esc(U.titleOfNote(n)) + "</b><span>" +
          esc(n.subject || "конкурс") + (n.due ? " · " + esc((U.dueInfo(n.due) || {}).label || "") : "") + "</span></div>").join("") +
        "</div>";
    }).join("");

    return head("study", "ДЗ по предметам, конкурсы и портфолио — без лишних ритуалов",
      btn("Добавить ДЗ", "new-homework", { icon: "i-plus", kind: "primary" }) +
      btn("Конкурс", "new-contest", { icon: "i-flag" })) +
      '<div class="v-grid"><div class="v-col">' +
        section("Домашние задания", "Сгруппировано по предметам",
          (subjectsHtml || empty("ДЗ нет. Добавьте первое — предмет и срок.")) +
          '<div class="task-add"><svg class="ic"><use href="#i-plus"/></svg><input data-quick-study placeholder="Новое ДЗ: предмет и задача…"><button class="v-btn" type="button" data-act="new-homework">Добавить</button></div>') +
        section("Конкурсы и олимпиады", "Воронка: заметить → подготовиться → участвовать → результат",
          '<div class="contest-grid">' + contestHtml + "</div>") +
      "</div><div class=\"v-col\">" +
        section("Ближайшие сроки", "Учёба",
          upcoming.length ? upcoming.map((n) => '<div class="mini-row" data-open="' + esc(n.id) + '"><time>' +
            esc((U.dueInfo(n.due) || {}).label || "") + '</time><div class="tt">' + esc(U.titleOfNote(n)) +
            "<small>" + esc(n.subject || TB.kindOf(n.kind).name) + "</small></div></div>").join("") : empty("Сроков пока нет.")) +
        section("Портфолио", "Проекты и работы для резюме",
          (portfolio.length ? '<div class="portfolio-grid">' + portfolio.map((n) =>
            '<div class="portfolio-card" data-open="' + esc(n.id) + '" style="--sc:#6E9C83"><h3>' + esc(U.titleOfNote(n)) +
            "</h3><p>" + esc(U.noteText(n).slice(0, 140)) + "</p>" +
            (n.url ? '<a href="' + esc(n.url) + '" target="_blank" rel="noopener">' + esc(n.url) + "</a>" : "") + "</div>").join("") + "</div>"
            : empty("Портфолио пустое. Добавьте проект или ссылку.")) +
          btn("Добавить работу", "new-portfolio", { icon: "i-plus" })) +
        section("Конспекты и ссылки", "Быстрый доступ к материалам",
          (links.length ? links.map((n) => '<div class="link-row" data-open="' + esc(n.id) + '"><div class="tt"><b>' +
            esc(U.titleOfNote(n)) + "</b><span>" + esc(U.noteText(n).slice(0, 90)) + "</span></div><span>↗</span></div>").join("")
            : empty("Ссылок нет."))) +
      "</div></div>";
  }

  /* ------------------------------ проекты ------------------------------ */

  function projectCard(p) {
    const tasks = TB.model.tasksForProject(p.id);
    const done = tasks.filter((n) => n.done).length;
    const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
    const stage = (TB.PROJECT_STAGES.find((s) => s.id === (p.meta || {}).stage) || TB.PROJECT_STAGES[0]).name;
    return '<article class="proj-card" data-open="' + esc(p.id) + '" style="--sc:#8A6FA8">' +
      '<div class="proj-card-head"><h3>' + esc(U.titleOfNote(p)) + '</h3><span class="proj-stage">' + esc(stage) + "</span></div>" +
      '<div class="proj-goal">' + esc(U.noteText(p).split("\n").slice(1).join(" ") || "Без описания") + "</div>" +
      '<div class="proj-progress"><i style="width:' + pct + '%"></i></div>' +
      '<div class="proj-foot"><span>' + done + " / " + tasks.length + " задач</span><span>" +
      (p.due ? esc((U.dueInfo(p.due) || {}).label || "") : "без срока") + "</span></div></article>";
  }

  function renderProjects() {
    const projects = TB.model.projects();
    const allTasks = TB.model.bySphere("projects").filter((n) => n.kind !== "project" && n.kind !== "idea" && n.kind !== "release");
    const ideas = TB.model.ideas();
    const releases = TB.model.bySphere("projects").filter((n) => n.kind === "release");
    const stages = [
      { id: "now", name: "Сейчас" },
      { id: "next", name: "Дальше" },
      { id: "later", name: "Потом" },
      { id: "done", name: "Готово" },
    ];
    const kanban = stages.map((st) => {
      const list = allTasks.filter((n) => st.id === "done" ? n.done : ((n.meta || {}).roadmap || "now") === st.id && !n.done);
      return '<div class="kanban-col"><div class="kanban-head"><h3>' + esc(st.name) + "</h3><span>" + list.length + "</span></div>" +
        (list.length ? list.map((n) => '<div class="kanban-card" data-open="' + esc(n.id) + '" style="--sc:#8A6FA8"><b>' +
          esc(U.titleOfNote(n)) + "</b><span>" + esc((n.projectId ? projectName(n.projectId) : "") || "без проекта") +
          (n.due ? " · " + esc((U.dueInfo(n.due) || {}).label || "") : "") + "</span></div>").join("")
          : '<div class="kanban-empty">пусто</div>') + "</div>";
    }).join("");

    return head("projects", "Своё Android-приложение, релизы и идеи, которые ждут своей очереди",
      btn("Новый проект", "new-project", { icon: "i-plus", kind: "primary" }) +
      btn("Идея", "new-idea", { icon: "i-flag" })) +
      '<div class="proj-grid">' + (projects.length ? projects.map(projectCard).join("") :
        '<div class="v-empty" style="grid-column:1/-1">Проектов нет. Создайте первый — например, «Трекер привычек».</div>') + "</div>" +
      '<div class="v-grid" style="margin-top:16px"><div class="v-col">' +
        section("Дорожная карта", "Задачи проекта по этапам", '<div class="kanban">' + kanban + "</div>") +
      "</div><div class=\"v-col\">" +
        section("Идеи", "Сначала поймать, потом решать",
          (ideas.length ? '<div class="idea-grid">' + ideas.map((n) => '<div class="idea-card" data-open="' + esc(n.id) + '"><h3>' +
            esc(U.titleOfNote(n)) + '</h3><div class="meta">' + kindChip(n) +
            '<span class="v-card-sub">' + esc((TB.IDEA_STAGES.find((s) => s.id === (n.meta || {}).stage) || {}).name || "новая") + "</span></div>" +
            '<div class="actions"><button class="v-btn small" type="button" data-act="idea-project" data-id="' + esc(n.id) + '">В проект</button></div></div>').join("") + "</div>"
            : empty("Идей нет. Добавьте одну."))) +
        section("Релизы", "Что уже вышло и что готовится",
          (releases.length ? releases.sort((a, b) => new Date(a.due || 0) - new Date(b.due || 0)).map((n) =>
            '<div class="release-row" data-open="' + esc(n.id) + '"><span class="ver">' + esc(U.titleOfNote(n).match(/\d+(\.\d+)*/)?.[0] || "·") +
            '</span><div class="tt"><b>' + esc(U.titleOfNote(n)) + "</b><span>" + esc((U.dueInfo(n.due) || {}).label || "без даты") +
            "</span></div><span>" + (n.done ? "вышел" : "план") + "</span></div>").join("")
            : empty("Релизов пока нет."))) +
      "</div></div>";
  }

  function projectName(id) {
    const p = TB.model.note(id);
    return p ? U.titleOfNote(p) : "";
  }

  /* ------------------------------ личное ------------------------------ */

  function renderLife() {
    const items = TB.model.bySphere("life");
    const tasks = items.filter((n) => !n.done && n.kind !== "journal" && n.kind !== "date").sort((a, b) => {
      const da = U.dueInfo(a.due), db = U.dueInfo(b.due);
      return (da ? da.diff : 999) - (db ? db.diff : 999);
    });
    const journal = items.filter((n) => n.kind === "journal").sort((a, b) => (b.updated || 0) - (a.updated || 0));
    const dates = TB.model.upcomingDates(90);
    const moodCount = {};
    journal.forEach((n) => {
      const m = String((n.meta || {}).mood || "").trim();
      if (m) moodCount[m] = (moodCount[m] || 0) + 1;
    });

    return head("life", "Журнал, важные даты и личные дела — без давления",
      btn("Записать день", "new-journal", { icon: "i-edit", kind: "primary" }) +
      btn("Дата", "new-date", { icon: "i-calendar" })) +
      '<div class="v-grid"><div class="v-col">' +
        section("Личные дела", "Дом, здоровье, семья",
          (tasks.length ? tasks.map(taskLine).join("") : empty("Личных дел нет.")) +
          '<div class="task-add"><svg class="ic"><use href="#i-plus"/></svg><input data-quick-life placeholder="Новое личное дело…"><button class="v-btn" type="button" data-act="new-life-task">Добавить</button></div>') +
        section("Журнал", "Короткие записи о дне и настроении",
          (journal.length ? '<div class="journal-list">' + journal.slice(0, 12).map((n) => '<div class="journal-card" data-open="' + esc(n.id) + '" style="--sc:#C4718E">' +
            '<div class="when">' + esc(U.fmtDate(n.updated || n.created)) +
            ((n.meta || {}).mood ? ' · <span class="mood">' + esc(n.meta.mood) + "</span>" : "") + "</div>" +
            '<div class="txt">' + esc(U.noteText(n).slice(0, 260)) + "</div></div>").join("") + "</div>"
            : empty("Журнал пуст. Одна строка в день — уже привычка."))) +
      "</div><div class=\"v-col\">" +
        section("Важные даты", "Повторяются каждый год", dates.length
          ? dates.map(({ note, due }) => {
            const d = due;
            return '<div class="date-row" data-open="' + esc(note.id) + '"><div class="d">' + d.getDate() +
              "<small>" + esc(U.MONTHS_SHORT[d.getMonth()]) + '</small></div><div class="tt"><b>' + esc(U.titleOfNote(note)) +
              "</b><span>" + esc((note.meta || {}).note || "") + '</span></div><span class="in">через ' +
              Math.max(0, Math.ceil((d - new Date()) / 86400000)) + " дн.</span></div>";
          }).join("")
          : empty("Дат нет. Добавьте дни рождения и годовщины.")) +
        section("Настроение", "Что чаще всего в записях",
          Object.keys(moodCount).length
            ? Object.entries(moodCount).sort((a, b) => b[1] - a[1]).map(([m, c]) => '<div class="focus-bar"><span class="lbl">' +
              esc(m) + '</span><div class="track"><div class="fill" style="width:' + Math.min(100, c * 18) + '%;background:#C4718E"></div></div><span class="val">' +
              c + "</span></div>").join("")
            : empty("Добавьте настроение в запись журнала.")) +
        section("Итог недели", "Один взгляд назад",
          '<div class="settings-note">' + (journal.length ? "Записей в журнале: " + journal.length + ". Последняя — " + esc(U.fmtDate(journal[0].updated)) + "." : "Начните с одной записи.") + "</div>" +
          btn("Открыть обзор", "go-review", { icon: "i-chart" })) +
      "</div></div>";
  }

  /* ------------------------------ обзор ------------------------------ */

  function renderReview() {
    const stats = TB.model.stats(7);
    const active = TB.model.active().filter((n) => !n.done);
    const overdue = TB.model.overdueItems();
    const inbox = TB.model.inboxItems();
    const top3 = TB.model.top3Items();
    const focusHours = Math.round(stats.totalFocus / 60 * 10) / 10;
    const doneToday = TB.model.active().filter((n) => n.done && n.completedAt && TB.dayKey(new Date(n.completedAt)) === TB.dayKey(new Date())).length;
    const goals = TB.model.doc.settings.weeklyGoals || "";

    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = TB.dayKey(d);
      const count = TB.model.doc.notes.filter((n) => n.completedAt && TB.dayKey(new Date(n.completedAt)) === key).length;
      days.push({ d, count });
    }
    const max = Math.max(1, ...days.map((x) => x.count));

    const focusBars = TB.SPHERES.map((s) => {
      const v = stats.focusBySphere[s.id] || 0;
      const maxFocus = Math.max(1, ...Object.values(stats.focusBySphere));
      return '<div class="focus-bar" style="--sc:' + s.color + '"><span class="lbl">' + esc(s.name) +
        '</span><div class="track"><div class="fill" style="width:' + (v / maxFocus * 100) + '%"></div></div><span class="val">' +
        Math.round(v / 60 * 10) / 10 + "ч</span></div>";
    }).join("");

    const steps = [
      { done: inbox.length === 0, title: "Разобрать входящие", sub: inbox.length ? inbox.length + " записей ждут" : "пусто" },
      { done: overdue.length === 0, title: "Закрыть просроченное", sub: overdue.length ? overdue.length + " задач" : "чисто" },
      { done: top3.length >= 3, title: "Выбрать 3 главных на день", sub: top3.length + "/3" },
      { done: false, title: "Свериться с целями недели", sub: goals ? "цели записаны" : "пока без целей" },
    ];

    return head("review", "Короткий обзор недели: что сделано, где застрял, куда дальше",
      btn("Повестка", "open-agenda", { icon: "i-calendar" }) +
      btn("Скопировать итоги", "review-copy", { icon: "i-copy", kind: "primary" })) +
      '<div class="review-kpis">' +
        '<div class="kpi"><b>' + active.length + '</b><span>активных</span></div>' +
        '<div class="kpi mint"><b>' + stats.done + '</b><span>сделано за 7 дней</span></div>' +
        '<div class="kpi wax"><b>' + (overdue.length || 0) + '</b><span>просрочено</span></div>' +
        '<div class="kpi brass"><b>' + focusHours + '</b><span>часов фокуса</span></div>' +
      "</div>" +
      '<div class="review-grid">' +
        '<section class="v-card"><div class="v-card-head"><div><h2>Ритм недели</h2><div class="v-card-sub">Сколько задач закрыто по дням</div></div></div>' +
          '<div class="chart-bars">' + days.map(({ d, count }) => '<div class="chart-bar"><span class="v">' + count +
            '</span><div class="col" style="height:' + Math.max(3, count / max * 88) + '%;background:#6E9C83"></div><span class="lbl">' +
            esc(U.WEEKDAYS[d.getDay()]) + "</span></div>").join("") + "</div></section>" +
        section("Фокус по сферам", "За последние 7 дней", focusBars) +
        section("Цели недели", "Своими словами — что важно успеть",
          '<textarea class="goals-area" data-weekly-goals placeholder="Например: закрыть отчёт, доделать макет, 3 тренировки…">' + esc(goals) + "</textarea>" +
          '<div class="v-row" style="margin-top:7px"><span class="v-card-sub" data-goals-state>Сохраняется автоматически</span></div>') +
        section("Чек-лист обзора", "Четыре шага, чтобы не утонуть",
          '<div class="review-steps">' + steps.map((s, i) => '<div class="review-step' + (s.done ? " done" : "") +
            '"><span class="n">' + (s.done ? "✓" : i + 1) + '</span><div class="tt"><b>' + esc(s.title) +
            "</b><span>" + esc(s.sub) + "</span></div>" +
            (i === 0 ? '<button class="v-btn small" type="button" data-act="go-inbox">Открыть</button>' :
              i === 1 ? '<button class="v-btn small" type="button" data-act="go-tasks">Открыть</button>' :
              i === 2 ? '<button class="v-btn small" type="button" data-act="go-today">Открыть</button>' : "") +
            "</div>").join("") + "</div>") +
        section("Просроченное", "Разобрать или перенести осознанно",
          overdue.length ? overdue.slice(0, 10).map(taskLine).join("") + '<div class="v-row" style="margin-top:8px">' +
            btn("Перенести всё на завтра", "postpone-all", { extra: ' data-days="1"' }) + "</div>"
            : empty("Просроченного нет.")) +
        section("Входящие", "Сначала поймать, потом решить",
          inbox.length ? inbox.slice(0, 8).map((n) => '<div class="inbox-row" data-open="' + esc(n.id) + '"><div class="tt"><b>' +
            esc(U.titleOfNote(n)) + "</b><span>" + esc(TB.kindOf(n.kind).name) + "</span></div></div>").join("")
            : empty("Входящие пусты.")) +
        section("Частые шаблоны", "Что экономит время",
          stats.topTemplates.length ? stats.topTemplates.map((n) => '<div class="link-row" data-open="' + esc(n.id) + '"><div class="tt"><b>' +
            esc(U.titleOfNote(n)) + "</b><span>использован " + (n.usage || 0) + " раз</span></div><span>↗</span></div>").join("")
            : empty("Шаблонов пока нет.")) +
        section("Сегодня", "Один короткий итог",
          '<div class="settings-note">Сделано сегодня: <b>' + doneToday + "</b>. В тройке главных: <b>" + top3.length +
          "/3</b>. Следующий шаг — выбрать одно дело и запустить фокус.</div>" +
          btn("Смотреть сегодня", "go-today", { icon: "i-sun" })) +
      "</div>";
  }

  /* ------------------------------ действия ------------------------------ */

  const actions = {
    "new-template": () => {
      createDialog({ title: "Новый шаблон", sub: "Ответ, который можно использовать много раз", kind: "template", sphere: "work", subject: false, placeholder: "Например: VPN не подключается — iOS" });
      return false;
    },
    "tpl-fav": (el) => {
      const n = TB.model.note(el.dataset.id);
      if (!n) return false;
      TB.model.updateNote(n.id, { favorite: !n.favorite });
      U.toast(n.favorite ? "Убрано из избранного" : "В избранном");
      return true;
    },
    "use-template": (el) => {
      const n = TB.model.note(el.dataset.id);
      if (n) templateDialog(n);
      return false;
    },
    "new-homework": () => {
      createDialog({ title: "Новое ДЗ", sub: "Предмет и срок — остальное потом", kind: "homework", sphere: "study", placeholder: "Лабораторная по базам данных" });
      return false;
    },
    "new-contest": () => {
      createDialog({ title: "Новый конкурс", sub: "Олимпиада, хакатон, конкурс", kind: "contest", sphere: "study", stage: TB.CONTEST_STAGES, placeholder: "Олимпиада по алгоритмам" });
      return false;
    },
    "new-portfolio": () => {
      createDialog({ title: "Работа в портфолио", sub: "Проект, ссылка, что показать", kind: "portfolio", sphere: "study", subject: false, placeholder: "Приложение на Kotlin" });
      return false;
    },
    "new-project": () => {
      createDialog({ title: "Новый проект", sub: "Цель и этап можно уточнить позже", kind: "project", sphere: "projects", stage: TB.PROJECT_STAGES, placeholder: "Трекер привычек" });
      return false;
    },
    "new-idea": () => {
      createDialog({ title: "Новая идея", sub: "Поймать мысль, пока она свежая", kind: "idea", sphere: "projects", subject: false, stage: TB.IDEA_STAGES, placeholder: "Виджет на главный экран" });
      return false;
    },
    "idea-project": (el) => {
      const n = TB.model.note(el.dataset.id);
      if (!n) return false;
      TB.model.updateNote(n.id, { kind: "project", status: "doing", meta: Object.assign({}, n.meta, { stage: "idea" }) });
      U.toast("Идея стала проектом");
      return true;
    },
    "new-journal": () => {
      const body = document.createElement("div");
      body.className = "board-form";
      body.innerHTML =
        '<label>Как прошёл день<textarea data-text rows="4" autofocus placeholder="Хорошо… Мешало…"></textarea></label>' +
        '<label>Настроение<input data-mood placeholder="спокойно, бодро, устал…"></label>';
      TB.overlays.showModal({
        title: "Запись в журнал",
        sub: "Одна честная строка лучше идеальной тишины",
        body,
        footer: [{ label: "Отмена" }, { label: "Сохранить", kind: "primary", onClick: () => {
          const text = body.querySelector("[data-text]").value.trim();
          if (!text) return false;
          const mood = body.querySelector("[data-mood]").value.trim();
          TB.model.addNote({
            html: "<div>Как прошёл день</div><div>" + esc(text).replace(/\n/g, "</div><div>") + "</div>",
            kind: "journal", sphere: "life", status: "doing",
            boardId: (TB.model.doc.boards.find((b) => !b.inbox && b.sphere === "life") || TB.model.board()).id,
            meta: mood ? { mood } : {},
          });
          U.toast("Запись сохранена");
        } }],
      });
      return false;
    },
    "new-date": () => {
      createDialog({ title: "Важная дата", sub: "День рождения, годовщина, событие", kind: "date", sphere: "life", subject: false, placeholder: "День рождения мамы" });
      return false;
    },
    "new-life-task": () => {
      createDialog({ title: "Личное дело", sub: "Дом, здоровье, семья", kind: "task", sphere: "life", placeholder: "Записаться к врачу" });
      return false;
    },
    "go-review": () => { TB.model.setView("review"); return false; },
    "go-inbox": () => { TB.model.setView("inbox"); return false; },
    "go-tasks": () => { TB.model.setView("tasks"); return false; },
    "go-today": () => { TB.model.setView("today"); return false; },
    "open-url": (el) => {
      if (el.dataset.url) window.open(el.dataset.url, "_blank", "noopener");
      return false;
    },
    "review-copy": () => {
      const stats = TB.model.stats(7);
      const text = "Пробка · итоги недели\n" +
        "Активных задач: " + TB.model.active().filter((n) => !n.done).length + "\n" +
        "Сделано за 7 дней: " + stats.done + "\n" +
        "Просрочено: " + TB.model.overdueItems().length + "\n" +
        "Фокус: " + Math.round(stats.totalFocus / 60 * 10) / 10 + " ч\n\nЦели:\n" +
        (TB.model.doc.settings.weeklyGoals || "—");
      copyText(text).then(() => U.toast("Итоги скопированы")).catch(() => U.toast("Не удалось скопировать", "warn"));
      return false;
    },
  };

  Object.keys(actions).forEach((name) => TB.views.registerAction(name, actions[name]));

  TB.views.registerForm("study-quick", (form, input) => {
    const text = input.value.trim();
    if (!text) return false;
    TB.model.addNote({
      html: "<div>" + esc(text) + "</div>", kind: "homework", sphere: "study",
      status: "today", boardId: (TB.model.doc.boards.find((b) => !b.inbox && b.sphere === "study") || TB.model.board()).id,
    });
    input.value = "";
    U.toast("ДЗ добавлено");
    return true;
  });
  TB.views.registerForm("life-quick", (form, input) => {
    const text = input.value.trim();
    if (!text) return false;
    TB.model.addNote({
      html: "<div>" + esc(text) + "</div>", kind: "task", sphere: "life",
      status: "today", boardId: (TB.model.doc.boards.find((b) => !b.inbox && b.sphere === "life") || TB.model.board()).id,
    });
    input.value = "";
    U.toast("Добавлено");
    return true;
  });

  function render(view) {
    if (view === "work") return renderWork();
    if (view === "study") return renderStudy();
    if (view === "projects") return renderProjects();
    if (view === "life") return renderLife();
    if (view === "review") return renderReview();
    return head(view, "", "");
  }

  function bind(view, root) {
    if (view === "work") {
      const search = root.querySelector("[data-tpl-search]");
      if (search) {
        search.addEventListener("input", U.debounce(() => {
          state.workQuery = search.value;
          const q = search.value.trim().toLowerCase();
          root.querySelectorAll("[data-filter-item]").forEach((card) => {
            card.hidden = q && !String(card.dataset.search || "").includes(q);
          });
        }, 80));
      }
    }
    if (view === "study") {
      const q = root.querySelector("[data-quick-study]");
      if (q) {
        q.addEventListener("keydown", (e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          const text = q.value.trim();
          if (!text) return;
          TB.model.addNote({
            html: "<div>" + esc(text) + "</div>", kind: "homework", sphere: "study",
            status: "today", boardId: (TB.model.doc.boards.find((b) => !b.inbox && b.sphere === "study") || TB.model.board()).id,
          });
          q.value = "";
          U.toast("ДЗ добавлено");
        });
      }
    }
    if (view === "life") {
      const q = root.querySelector("[data-quick-life]");
      if (q) {
        q.addEventListener("keydown", (e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          const text = q.value.trim();
          if (!text) return;
          TB.model.addNote({
            html: "<div>" + esc(text) + "</div>", kind: "task", sphere: "life",
            status: "today", boardId: (TB.model.doc.boards.find((b) => !b.inbox && b.sphere === "life") || TB.model.board()).id,
          });
          q.value = "";
          U.toast("Добавлено");
        });
      }
    }
    if (view === "review") {
      const goals = root.querySelector("[data-weekly-goals]");
      if (goals) {
        let timer = null;
        goals.addEventListener("input", () => {
          TB.model.doc.settings.weeklyGoals = goals.value;
          TB.model.saveSoon();
          clearTimeout(timer);
          timer = setTimeout(() => {
            const status = root.querySelector("[data-goals-state]");
            if (status) status.textContent = "Сохранено";
          }, 500);
        });
      }
    }
  }

  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  TB.viewsLife = { render, bind };
})();
