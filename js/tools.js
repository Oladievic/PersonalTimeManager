/* Пробка — захват, поиск, повестка, архив, копии, экспорт, напоминания, фокус */
(function () {
  "use strict";

  const TB = window.TB;
  const U = TB.util;
  const $ = U.$;
  const esc = (s) => U.escapeHtml(s == null ? "" : s);

  let captureOpen = false;
  let captureSphere = "";
  let reminderTimer = null;
  let digestTimer = null;

  const tools = {
    init() {
      this.startReminders();
      this.startBackups();
      try { this.installDock(); } catch (e) { /* not critical */ }
      window.addEventListener("online", () => this.startReminders());
    },

    startBackups() {
      const check = () => this.maybeAutoBackup();
      setTimeout(check, 6000);
      setInterval(check, 6 * 3600 * 1000);
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) check();
      });
    },

    async maybeAutoBackup(force) {
      if (!TB.store || TB.store.mode !== "idb") return false;
      let last = 0;
      try { last = Number(localStorage.getItem("probka.autoBackupAt") || 0) || 0; } catch (e) { last = 0; }
      if (!force && Date.now() - last < 24 * 3600 * 1000) return false;
      try {
        await TB.store.createBackup(TB.model.doc, "авто за 24 часа");
        try { localStorage.setItem("probka.autoBackupAt", String(Date.now())); } catch (e) { /* ignore */ }
        return true;
      } catch (err) {
        console.warn("Пробка: авто-копия не создана", err);
        return false;
      }
    },

    /* ------------------------------ захват ------------------------------ */

    openCapture(preset) {
      if (captureOpen) {
        const ta = $("#captureRoot textarea");
        if (ta) ta.focus();
        return;
      }
      captureOpen = true;
      const root = $("#captureRoot");
      root.hidden = false;
      root.innerHTML =
        '<div class="capture-note" role="dialog" aria-modal="true" aria-label="Быстрый захват">' +
          '<div class="capture-label">Поймать мысль</div>' +
          '<textarea placeholder="Что нужно не забыть?" maxlength="4000"></textarea>' +
          '<div class="capture-foot">' +
            '<div class="capture-sphere" aria-label="Сфера">' +
              '<button type="button" data-cap-sphere="" title="Во Входящие" style="--sc:#8B7A63"></button>' +
              TB.SPHERES.map((s) => '<button type="button" data-cap-sphere="' + s.id + '" title="' + esc(s.name) + '" style="--sc:' + s.color + '"></button>').join("") +
            "</div>" +
            '<span class="spacer"></span>' +
            '<button class="v-btn primary" type="button" data-cap-save>Поймать ⏎</button>' +
            '<button class="v-btn" type="button" data-cap-close>Закрыть</button>' +
          "</div>" +
          '<div class="capture-hint"><span>Enter — поймать</span><span>Shift+Enter — новая строка</span><span>#тег — добавить тег</span><span>Esc — закрыть</span></div>' +
        "</div>";
      const ta = root.querySelector("textarea");
      captureSphere = (preset && preset.sphere) || "";
      const paint = () => {
        root.querySelectorAll("[data-cap-sphere]").forEach((b) => {
          b.classList.toggle("active", b.dataset.capSphere === captureSphere);
        });
      };
      paint();
      root.querySelectorAll("[data-cap-sphere]").forEach((b) => {
        b.addEventListener("click", () => {
          captureSphere = b.dataset.capSphere;
          paint();
        });
      });
      const close = () => {
        root.hidden = true;
        root.innerHTML = "";
        captureOpen = false;
        document.removeEventListener("keydown", escHandler, true);
      };
      const save = () => {
        const raw = ta.value.trim();
        if (!raw) {
          ta.focus();
          return;
        }
        const hashtags = (raw.match(/(^|\s)#[^\s#]+/g) || []).map((x) => x.trim());
        const clean = raw.replace(/(^|\s)#[^\s#]+/g, " ").replace(/\s+/g, " ").trim() || raw;
        const n = TB.model.capture(clean, { tags: U.tagsFrom(hashtags.join(",")) });
        if (n && captureSphere) TB.model.assignSphere(n.id, captureSphere);
        ta.value = "";
        ta.focus();
        U.toast(captureSphere ? "Поймано → " + (TB.sphereOf(captureSphere) || {}).name : "Поймано во Входящие");
      };
      const escHandler = (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
      };
      root.querySelector("[data-cap-save]").addEventListener("click", save);
      root.querySelector("[data-cap-close]").addEventListener("click", close);
      root.addEventListener("pointerdown", (e) => {
        if (e.target === root) close();
      });
      ta.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          save();
        }
      });
      document.addEventListener("keydown", escHandler, true);
      requestAnimationFrame(() => ta.focus());
    },

    installDock() {
      const dock = $("#dock");
      if (!dock) return;
      dock.addEventListener("click", (e) => {
        if (e.target.closest("[data-dock='capture']")) {
          e.preventDefault();
          e.stopPropagation();
          this.openCapture();
        }
      }, true);
    },

    /* ------------------------------ поиск ------------------------------ */

    openSearch() {
      const body = document.createElement("div");
      body.className = "search-modal";
      body.innerHTML =
        '<div class="search-page-box"><svg class="ic"><use href="#i-search"/></svg>' +
          '<input type="search" data-q placeholder="Найти задачу, заметку, тег…" autocomplete="off" spellcheck="false" autofocus>' +
          '<kbd>Esc</kbd></div>' +
        '<div class="search-modal-hint" data-hint>Начните печатать. ↑↓ — выбор, Enter — открыть.</div>' +
        '<div class="search-results-list" data-results></div>' +
        '<div class="search-modal-foot"><span>Ctrl+K — в любом месте</span>' +
          '<button class="v-btn" type="button" data-new>Новая заметка</button></div>';
      const modal = TB.overlays.showModal({
        title: "Поиск",
        sub: "По всем сферам, доскам и тегам",
        body,
        width: "620px",
      });
      const input = body.querySelector("[data-q]");
      const results = body.querySelector("[data-results]");
      const hint = body.querySelector("[data-hint]");
      let items = [];
      let selected = 0;

      const commands = [
        { label: "Сегодня", hint: "главное на день", icon: "i-sun", run: () => TB.model.setView("today") },
        { label: "Входящие", hint: "разобрать", icon: "i-inbox", run: () => TB.model.setView("inbox") },
        { label: "Задачи", hint: "все дела", icon: "i-check-square", run: () => TB.model.setView("tasks") },
        { label: "Календарь", hint: "дедлайны", icon: "i-calendar", run: () => TB.model.setView("calendar") },
        { label: "Обзор недели", hint: "итоги", icon: "i-chart", run: () => TB.model.setView("review") },
        { label: "Доски", hint: "пробка", icon: "i-board", run: () => TB.model.setView("board") },
        { label: "ChatGPT и MCP", hint: "внешний чат", icon: "i-plug", run: () => TB.sync.openPanel() },
      ];

      const render = () => {
        const q = input.value.trim().toLowerCase();
        selected = 0;
        if (!q) {
          items = commands;
          results.innerHTML = commands.map((c, i) => '<div class="search-cmd' + (i === 0 ? " active" : "") + '" data-i="' + i + '">' +
            '<svg class="ic"><use href="#' + c.icon + '"/></svg><b>' + esc(c.label) + '</b><span>' + esc(c.hint) + "</span></div>").join("") +
            '<div class="search-modal-sep">Или начните печатать запрос</div>';
          hint.textContent = "Быстрые переходы";
          return;
        }
        const found = TB.model.doc.notes.filter((n) => !n.archived).map((n) => {
          const title = U.titleOfNote(n).toLowerCase();
          const text = U.noteText(n).toLowerCase();
          const tags = (n.tags || []).join(" ").toLowerCase();
          let score = 0;
          if (title === q) score = 120;
          else if (title.startsWith(q)) score = 100;
          else if (title.includes(q)) score = 80;
          else if (tags.includes(q)) score = 60;
          else if (text.includes(q)) score = 30;
          return { n, score };
        }).filter((x) => x.score).sort((a, b) => b.score - a.score || (b.n.updated || 0) - (a.n.updated || 0)).slice(0, 20);
        items = found.map((x) => x.n);
        if (!items.length) {
          results.innerHTML = '<div class="v-empty" style="padding:26px 8px">Ничего не найдено.<br><span>Попробуйте слово из названия или тега.</span></div>';
          hint.textContent = "0 результатов";
          return;
        }
        results.innerHTML = items.map((n, i) => {
          const info = U.dueInfo(n.due);
          return '<div class="search-result' + (i === 0 ? " active" : "") + '" data-i="' + i + '">' +
            '<div class="tt"><b>' + esc(U.titleOfNote(n)) + '</b><span>' + esc(U.noteText(n).replace(/\s+/g, " ").slice(0, 120)) + "</span></div>" +
            '<div class="meta">' + (info ? '<span class="due-chip ' + (info.diff < 0 ? "overdue" : info.diff === 0 ? "today" : "") + '">' + esc(info.label) + "</span>" : "") +
            (n.done ? '<span class="kind-chip">готово</span>' : "") + "</div></div>";
        }).join("");
        hint.textContent = items.length + " результатов";
      };

      const openItem = (i) => {
        const item = items[i];
        if (!item) return;
        if (item.run) {
          modal.close();
          item.run();
        } else {
          modal.close();
          TB.panels.openDetails(item.id);
        }
      };

      const move = (delta) => {
        if (!items.length) return;
        selected = (selected + delta + items.length) % items.length;
        results.querySelectorAll("[data-i]").forEach((el) => el.classList.toggle("active", Number(el.dataset.i) === selected));
        const el = results.querySelector('[data-i="' + selected + '"]');
        if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
      };

      input.addEventListener("input", U.debounce(render, 40));
      input.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
        else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
        else if (e.key === "Enter") { e.preventDefault(); openItem(selected); }
      });
      results.addEventListener("click", (e) => {
        const row = e.target.closest("[data-i]");
        if (!row) return;
        openItem(Number(row.dataset.i));
      });
      body.querySelector("[data-new]").addEventListener("click", () => {
        modal.close();
        this.createNoteDialog();
      });
      render();
      setTimeout(() => input.focus(), 20);
    },

    /* ------------------------------ повестка ------------------------------ */

    openAgenda() {
      const body = document.createElement("div");
      const render = () => {
        const g = TB.model.agenda();
        const overdue = g.overdue;
        const rows = (list) => list.map((n) => '<div class="agenda-row" data-id="' + esc(n.id) + '">' +
          '<button class="task-check" type="button" data-check="' + esc(n.id) + '" aria-label="Готово"></button>' +
          '<div class="tt"><b>' + esc(U.titleOfNote(n)) + '</b><span>' +
          esc([(TB.sphereOf(n.sphere) || {}).name, U.plainText(n.html).replace(/\s+/g, " ").slice(0, 70)].filter(Boolean).join(" · ")) + "</span></div>" +
          '<div class="en">' + (U.dueInfo(n.due) || {}).label + '</div></div>').join("");
        const group = (title, list, cls) => list.length ? '<div class="agenda-group ' + (cls || "") + '"><h3>' + esc(title) +
          ' <span>' + list.length + "</span></h3>" + rows(list) + "</div>" : "";
        body.innerHTML = '<div class="agenda-top">' +
          '<span>Просрочено: <b>' + overdue.length + "</b> · Сегодня: <b>" + g.today.length + "</b> · Завтра: <b>" + g.tomorrow.length + "</b></span>" +
          (overdue.length ? '<button class="v-btn" type="button" data-postpone-all>Перенести всё на завтра</button>' : "") +
          "</div>" +
          group("Просрочено", overdue, "overdue") + group("Сегодня", g.today) +
          group("Завтра", g.tomorrow) + group("На неделе", g.week) +
          group("Позже", g.later) +
          (!overdue.length && !g.today.length && !g.tomorrow.length && !g.week.length && !g.later.length
            ? '<div class="v-empty" style="padding:24px">На повестке пусто. Хороший момент, чтобы выдохнуть.</div>' : "");
        body.querySelector("[data-postpone-all]") && body.querySelector("[data-postpone-all]").addEventListener("click", (e) => {
          e.stopPropagation();
          TB.model.snapshot();
          overdue.forEach((n) => {
            const base = U.parseDue(n.due) || new Date();
            base.setDate(base.getDate() + 1);
            n.due = U.toLocalInput(base);
            n.postponedCount = (n.postponedCount || 0) + 1;
            n.updated = Date.now();
          });
          TB.model.changed("all");
          U.toast("Просроченное перенесено на завтра");
          render();
        });
        body.querySelectorAll("[data-id]").forEach((row) => {
          row.addEventListener("click", (e) => {
            if (e.target.closest("[data-check]")) return;
            modal.close();
            TB.panels.openDetails(row.dataset.id);
          });
        });
        body.querySelectorAll("[data-check]").forEach((btn) => {
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            TB.model.toggleDone(btn.dataset.check);
            render();
          });
        });
      };
      const modal = TB.overlays.showModal({
        title: "Повестка",
        sub: "Просроченное и ближайшие дни",
        body,
        footer: [{ label: "Календарь", onClick: () => { TB.model.setView("calendar"); } }, { label: "Закрыть", kind: "primary" }],
      });
      render();
    },

    /* ------------------------------ архив ------------------------------ */

    openArchive() {
      const notes = TB.model.doc.notes.filter((n) => n.archived)
        .sort((a, b) => (b.archivedAt || b.updated || 0) - (a.archivedAt || a.updated || 0));
      const body = document.createElement("div");
      body.className = "archive-list";
      if (!notes.length) {
        body.innerHTML = '<div class="v-empty" style="padding:24px">Архив пуст.<br><span>Сюда попадают выполненные и убранные записи — ничего не теряется.</span></div>';
      } else {
        body.innerHTML = notes.map((n) => '<div class="archive-row" data-id="' + esc(n.id) + '">' +
          '<div class="tt"><b>' + esc(U.titleOfNote(n)) + '</b><span>' +
          esc(TB.kindOf(n.kind).name + " · " + (TB.sphereOf(n.sphere) || {}).name + " · " + U.fmtDate(n.archivedAt || n.updated)) + "</span></div>" +
          '<div class="acts"><button class="v-btn small" type="button" data-restore="' + esc(n.id) + '">Вернуть</button>' +
          '<button class="v-btn small danger" type="button" data-del="' + esc(n.id) + '">Удалить</button></div></div>').join("");
      }
      const modal = TB.overlays.showModal({
        title: "Архив",
        sub: "Удаление записи — только осознанно",
        body,
        footer: [{ label: "Закрыть", kind: "primary" }],
      });
      body.querySelectorAll("[data-restore]").forEach((btn) => {
        btn.addEventListener("click", () => {
          TB.model.archiveNote(btn.dataset.restore, false);
          U.toast("Запись возвращена");
          modal.close();
          setTimeout(() => tools.openArchive(), 50);
        });
      });
      body.querySelectorAll("[data-del]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const n = TB.model.note(btn.dataset.del);
          if (!n) return;
          TB.overlays.confirm({
            title: "Удалить навсегда?",
            text: "«" + U.titleOfNote(n) + "» и её нити исчезнут. Это нельзя отменить.",
            ok: "Удалить",
          }).then((yes) => {
            if (!yes) return;
            TB.model.deleteNote(n.id);
            modal.close();
            U.toast("Запись удалена");
            setTimeout(() => tools.openArchive(), 50);
          });
        });
      });
    },

    /* ------------------------------ копии ------------------------------ */

    openBackups() {
      const body = document.createElement("div");
      body.className = "backup-list";
      body.innerHTML = '<div class="v-empty">Загружаю копии…</div>';
      const modal = TB.overlays.showModal({
        title: "Резервные копии",
        sub: "Локальные снимки данных · хранятся 8 последних",
        body,
        footer: [
          { label: "Создать копию", kind: "primary", onClick: () => {
            TB.store.createBackup(TB.model.doc, "вручную").then(() => {
              U.toast("Копия создана");
              modal.close();
              setTimeout(() => tools.openBackups(), 50);
            }).catch((err) => U.toast("Копии недоступны: " + err.message, "warn"));
          } },
          { label: "Закрыть" },
        ],
      });
      TB.store.listBackups().then((list) => {
        if (!list.length) {
          body.innerHTML = '<div class="v-empty" style="padding:22px">Копий пока нет.<br><span>Они создаются автоматически перед рискованными изменениями, но можно сделать вручную.</span></div>';
          return;
        }
        body.innerHTML = list.map((b) => '<div class="backup-row" data-id="' + esc(b.id) + '">' +
          '<div class="tt"><b>' + esc(new Date(b.at).toLocaleString("ru-RU")) + '</b><span>' +
          esc(b.reason || "авто") + " · " + (b.doc && b.doc.notes ? b.doc.notes.length : 0) + " записей</span></div>" +
          '<div class="acts"><button class="v-btn small" type="button" data-open-bk="' + esc(b.id) + '">Открыть</button>' +
          '<button class="v-btn small" type="button" data-dl-bk="' + esc(b.id) + '">Скачать</button>' +
          '<button class="v-btn small danger" type="button" data-del-bk="' + esc(b.id) + '">×</button></div></div>').join("");
        body.querySelectorAll("[data-open-bk]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const b = list.find((x) => x.id === btn.dataset.openBk);
            if (!b) return;
            TB.overlays.confirm({
              title: "Восстановить копию?",
              text: "Текущее состояние сначала сохранится в новую копию. Затем данные заменятся снимком от " + new Date(b.at).toLocaleString("ru-RU") + ".",
              ok: "Восстановить",
            }).then(async (yes) => {
              if (!yes) return;
              await TB.store.createBackup(TB.model.doc, "перед восстановлением");
              TB.model.doc = TB.normalizeDoc(JSON.parse(JSON.stringify(b.doc)));
              TB.model.history = [];
              TB.model.ui.boardId = TB.model.doc.boards.some((x) => x.id === TB.model.ui.boardId) ? TB.model.ui.boardId : TB.model.doc.boards[0].id;
              TB.model._afterRestore();
              await TB.model.saveNow();
              modal.close();
              U.toast("Копия восстановлена");
            });
          });
        });
        body.querySelectorAll("[data-dl-bk]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const b = list.find((x) => x.id === btn.dataset.dlBk);
            if (!b) return;
            U.downloadBlob("probka-backup-" + b.id + ".json", new Blob([JSON.stringify({ app: "Пробка", doc: b.doc }, null, 2)], { type: "application/json" }));
          });
        });
        body.querySelectorAll("[data-del-bk]").forEach((btn) => {
          btn.addEventListener("click", () => {
            TB.store.deleteBackup(btn.dataset.delBk).then(() => {
              modal.close();
              setTimeout(() => tools.openBackups(), 50);
            });
          });
        });
      });
    },

    /* ------------------------------ экспорт / импорт ------------------------------ */

    async exportData() {
      U.toast("Собираю данные…");
      try {
        const files = await TB.store.listFiles();
        let total = 0;
        const included = [];
        let skipped = 0;
        for (const rec of files) {
          const size = rec.size || (rec.blob && rec.blob.size) || 0;
          if (size > 12 * 1024 * 1024 || total + size > 80 * 1024 * 1024) {
            skipped += 1;
            continue;
          }
          let data = null;
          try {
            if (rec.blob) data = await blobToDataUrl(rec.blob);
            total += size;
          } catch (e) {
            skipped += 1;
            continue;
          }
          included.push({ id: rec.id, name: rec.name, type: rec.type, size: rec.size, at: rec.at, data });
        }
        const payload = {
          app: "Пробка",
          format: "probka",
          version: 1,
          exportedAt: new Date().toISOString(),
          doc: TB.model.doc,
          files: included,
        };
        const name = "probka-" + new Date().toISOString().slice(0, 10) + ".probka";
        U.downloadBlob(name, new Blob([JSON.stringify(payload)], { type: "application/json" }));
        U.toast("Экспорт готов" + (skipped ? " · файлов пропущено: " + skipped : ""));
      } catch (err) {
        U.toast("Не удалось экспортировать: " + (err.message || "ошибка"), "error");
      }
    },

    async importFile(file) {
      let payload;
      try {
        const text = await file.text();
        payload = JSON.parse(text);
      } catch (err) {
        U.toast("Это не файл «Пробки»: " + (err.message || "не JSON"), "error");
        return;
      }
      const doc = payload && payload.doc ? payload.doc : payload;
      if (!doc || !Array.isArray(doc.boards) || !Array.isArray(doc.notes)) {
        U.toast("В файле нет данных «Пробки»", "error");
        return;
      }
      const yes = await TB.overlays.confirm({
        title: "Импортировать данные?",
        text: "В файле " + doc.notes.length + " записей и " + doc.boards.length + " досок. Текущее содержимое заменится. Перед импортом будет создана резервная копия.",
        ok: "Импортировать",
        danger: false,
      });
      if (!yes) return;
      try {
        await TB.store.createBackup(TB.model.doc, "перед импортом").catch(() => {});
        if (Array.isArray(payload.files)) {
          for (const rec of payload.files) {
            if (!rec || !rec.data) continue;
            try {
              const blob = await (await fetch(rec.data)).blob();
              await TB.store.putFile({ id: rec.id || U.uid("f"), name: rec.name || "file", type: rec.type || blob.type, size: rec.size || blob.size, at: rec.at || Date.now(), blob });
            } catch (e) { /* файл пропущен, заметки останутся */ }
          }
        }
        TB.model.doc = TB.normalizeDoc(doc);
        TB.model.history = [];
        TB.model.redoStack = [];
        TB.model.ui.boardId = TB.model.doc.settings.lastBoard && TB.model.doc.boards.some((b) => b.id === TB.model.doc.settings.lastBoard)
          ? TB.model.doc.settings.lastBoard : TB.model.doc.boards[0].id;
        TB.model.ui.view = TB.model.doc.settings.view || "today";
        TB.model._afterRestore();
        await TB.model.saveNow();
        U.toast("Импорт завершён");
      } catch (err) {
        U.toast("Ошибка импорта: " + (err.message || "не удалось"), "error");
      }
    },

    /* ------------------------------ напоминания ------------------------------ */

    async toggleReminders() {
      const s = TB.model.doc.settings;
      const on = !s.reminders;
      if (on && "Notification" in window && Notification.permission === "default") {
        try { await Notification.requestPermission(); } catch (e) { /* ignore */ }
      }
      s.reminders = on;
      TB.model.saveSoon();
      if (on) {
        this.startReminders();
        U.toast("Напоминания включены — пока приложение открыто");
      } else {
        U.toast("Напоминания выключены");
      }
      return on;
    },

    startReminders() {
      clearInterval(reminderTimer);
      reminderTimer = setInterval(() => this.checkReminders(), 60000);
      setTimeout(() => this.checkReminders(), 1800);
    },

    checkReminders() {
      const s = TB.model.doc.settings;
      if (s.reminders) {
        const now = Date.now();
        const sent = readSent();
        let changed = false;
        TB.model.active().forEach((n) => {
          if (n.done || !n.due || n.reminder == null || n.reminder === "") return;
          const due = U.parseDue(n.due);
          if (!due) return;
          const at = due.getTime() - Number(n.reminder) * 60000;
          const key = n.id + ":" + n.due + ":" + n.reminder;
          if (now >= at && now - due.getTime() < 7 * 86400000 && !sent[key]) {
            sent[key] = now;
            changed = true;
            notify("Пробка · «" + U.titleOfNote(n) + "»", "Срок: " + (U.dueInfo(n.due) || {}).full, n.id);
          }
        });
        if (changed) writeSent(sent);
      }
      // утренний дайджест
      if (s.digest) {
        const today = TB.dayKey(new Date());
        const hour = new Date().getHours();
        if (hour >= 9 && s.digestDate !== today) {
          s.digestDate = today;
          TB.model.saveSoon();
          const overdue = TB.model.overdueItems().length;
          const todayList = TB.model.todayItems().filter((n) => !n.done).length;
          const text = "Сегодня: " + todayList + " дел" + (overdue ? " · просрочено: " + overdue : "") + ". Выберите три главных.";
          notify("Пробка · доброе утро", text, "digest");
        }
      }
    },

    /* ------------------------------ фокус ------------------------------ */

    focusNote(id) {
      const n = TB.model.note(id);
      if (!n) return;
      TB.model.ui.selectedId = id;
      TB.focusTarget = id;
      if (TB.setFocusTarget) TB.setFocusTarget(id);
      const label = $("#focusTarget");
      if (label) {
        label.textContent = U.titleOfNote(n);
        label.title = "Фокус: " + U.titleOfNote(n);
      }
      if (TB.board) TB.board.select(id);
      TB.panels.openDetails(id);
      if (typeof TB.focusReset === "function") TB.focusReset();
      U.toast("Задача выбрана для фокуса");
    },

    /* ------------------------------ прочее ------------------------------ */

    createNoteDialog() {
      const body = document.createElement("div");
      body.className = "board-form";
      body.innerHTML =
        '<label>Название<input type="text" data-title autofocus maxlength="200" placeholder="Что нужно сделать?"></label>' +
        '<label>Детали<textarea data-notes rows="3" placeholder="необязательно"></textarea></label>' +
        '<div class="row-2"><label>Сфера<select data-sphere>' +
          '<option value="">Без сферы</option>' + TB.SPHERES.map((s) => '<option value="' + s.id + '">' + esc(s.name) + "</option>").join("") +
        "</select></label><label>Срок<input type=\"datetime-local\" data-due></label></div>" +
        '<div class="row-2"><label>Тип<select data-kind>' + TB.KINDS.map((k) => '<option value="' + k.id + '">' + esc(k.name) + "</option>").join("") + "</select></label>" +
        '<label>Приоритет<select data-priority><option value="0">нет</option><option value="1">низкий</option><option value="2">средний</option><option value="3">высокий</option></select></label></div>';
      TB.overlays.showModal({
        title: "Новая заметка",
        sub: "Только название обязательно",
        body,
        footer: [{ label: "Отмена" }, { label: "Создать", kind: "primary", onClick: () => {
          const title = body.querySelector("[data-title]").value.trim();
          if (!title) { body.querySelector("[data-title]").focus(); return false; }
          const notes = body.querySelector("[data-notes]").value.trim();
          const sphere = body.querySelector("[data-sphere]").value || null;
          const due = body.querySelector("[data-due]").value || null;
          const kind = body.querySelector("[data-kind]").value;
          const priority = Number(body.querySelector("[data-priority]").value);
          const boardId = sphere ? (TB.model.doc.boards.find((b) => !b.inbox && b.sphere === sphere) || {}).id : null;
          const n = TB.model.addNote({
            html: "<div>" + esc(title) + "</div>" + (notes ? "<div>" + esc(notes).replace(/\n/g, "</div><div>") + "</div>" : ""),
            sphere, due, kind, priority, status: "today",
            boardId: boardId || TB.model.ui.boardId,
          });
          if (n) {
            U.toast("Заметка создана");
            setTimeout(() => TB.panels.openDetails(n.id), 30);
          }
        } }],
      });
    },

    resetDemo() {
      TB.model.doc = TB.model.seed();
      TB.model.history = [];
      TB.model.redoStack = [];
      TB.model.ui.boardId = TB.model.doc.settings.lastBoard;
      TB.model.ui.view = "today";
      TB.model._afterRestore();
      TB.model.saveNow();
      U.toast("Демо-данные восстановлены");
    },
  };

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("чтение файла"));
      reader.readAsDataURL(blob);
    });
  }

  function notify(title, text, id) {
    try {
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification(title, { body: text, tag: "probka-" + id, icon: "assets/icon-192.png" });
        return;
      }
    } catch (e) { /* fall through */ }
    U.toast(title + " · " + text);
    U.beep();
  }

  function readSent() {
    try { return JSON.parse(localStorage.getItem("probka.notified") || "{}") || {}; } catch (e) { return {}; }
  }
  function writeSent(obj) {
    try {
      const keys = Object.keys(obj).sort((a, b) => obj[b] - obj[a]).slice(0, 300);
      const out = {};
      keys.forEach((k) => { out[k] = obj[k]; });
      localStorage.setItem("probka.notified", JSON.stringify(out));
    } catch (e) { /* ignore */ }
  }

  TB.tools = tools;
})();
