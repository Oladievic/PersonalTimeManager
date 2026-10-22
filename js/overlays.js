/* Пробка — модальные окна, меню, настройки, установка PWA */
(function () {
  "use strict";

  const TB = window.TB;
  const U = TB.util;
  const $ = U.$;
  const $$ = U.$$;

  const root = $("#modalRoot");
  const scrim = $("#scrim");
  const menuPop = $("#menuPop");
  const stack = [];
  let lastFocus = null;

  const overlays = {
    init() {
      $("#btnMenu").addEventListener("click", (e) => {
        e.stopPropagation();
        this.toggleMenu();
      });
      $("#btnSearch").addEventListener("click", () => TB.tools.openSearch());
      $("#btnCapture").addEventListener("click", () => TB.tools.openCapture());
      $("#btnSidebar").addEventListener("click", () => {
        if (window.innerWidth <= 860) $("#sidebar").classList.add("open");
      });

      scrim.addEventListener("pointerdown", () => {
        if (stack.length) closeTop();
        else hideMenu();
      });

      document.addEventListener("pointerdown", (e) => {
        if (menuPop.hidden) return;
        if (e.target.closest("#menuPop") || e.target.closest("#btnMenu")) return;
        hideMenu();
      });

      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          if (!menuPop.hidden) {
            hideMenu();
            return;
          }
          if (stack.length) {
            const top = stack[stack.length - 1];
            if (top.dismissible) {
              e.preventDefault();
              closeTop();
            }
          }
        }
        if (e.key === "Tab" && stack.length) {
          const top = stack[stack.length - 1];
          trapFocus(e, top.el);
        }
      });

      window.addEventListener("beforeinstallprompt", (e) => {
        e.preventDefault();
        TB.installPrompt = e;
      });
      window.addEventListener("appinstalled", () => {
        TB.installPrompt = null;
        U.toast("Пробка установлена");
      });

      $("#importInput").addEventListener("change", (e) => {
        const file = e.target.files && e.target.files[0];
        e.target.value = "";
        if (file) TB.tools.importFile(file);
      });
    },

    toast: U.toast,

    showModal(opts) {
      const options = opts || {};
      const el = document.createElement("div");
      el.className = "modal" + (options.className ? " " + options.className : "") + (options.sheet ? " sheet" : "");
      if (options.width) el.style.width = "min(" + options.width + ", 100%)";
      el.setAttribute("role", "dialog");
      el.setAttribute("aria-modal", "true");

      const head = document.createElement("div");
      head.className = "modal-head";
      const h = document.createElement("h2");
      h.textContent = options.title || "";
      head.appendChild(h);
      const x = document.createElement("button");
      x.type = "button";
      x.className = "icon-btn ink";
      x.setAttribute("aria-label", "Закрыть");
      x.innerHTML = '<svg class="ic"><use href="#i-close"/></svg>';
      x.addEventListener("click", () => closeModal(record));
      head.appendChild(x);
      el.appendChild(head);

      if (options.sub) {
        const sub = document.createElement("div");
        sub.className = "modal-sub";
        sub.textContent = options.sub;
        el.appendChild(sub);
      }

      if (options.headExtra) {
        el.appendChild(options.headExtra);
      }

      const body = document.createElement("div");
      body.className = "modal-body";
      if (typeof options.body === "string") body.innerHTML = options.body;
      else if (options.body instanceof Node) body.appendChild(options.body);
      el.appendChild(body);

      const record = {
        el,
        body,
        dismissible: options.dismissible !== false,
        close() { closeModal(this); },
      };

      if (Array.isArray(options.footer) && options.footer.length) {
        const foot = document.createElement("div");
        foot.className = "modal-foot";
        options.footer.forEach((cfg) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "modal-btn" + (cfg.kind ? " " + cfg.kind : "");
          b.textContent = cfg.label;
          b.addEventListener("click", () => {
            let keep = false;
            try {
              keep = cfg.onClick ? cfg.onClick(record) === false : false;
            } finally {
              if (!keep && options.closeOnAction !== false) closeModal(record);
            }
          });
          foot.appendChild(b);
        });
        el.appendChild(foot);
      }

      if (!stack.length) {
        lastFocus = document.activeElement;
        scrim.hidden = false;
      }
      stack.push(record);
      root.appendChild(el);
      requestAnimationFrame(() => {
        const target = el.querySelector("[autofocus]") || el.querySelector("input, textarea, select, button");
        if (target) {
          try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
        }
      });
      return record;
    },

    closeAll() {
      while (stack.length) closeTop();
    },

    confirm(opts) {
      const o = opts || {};
      return new Promise((resolve) => {
        const body = document.createElement("div");
        body.className = "confirm-text";
        body.textContent = o.text || "Это действие нельзя отменить.";
        let done = false;
        const modal = this.showModal({
          title: o.title || "Подтвердить",
          body,
          footer: [
            { label: o.cancel || "Отмена", onClick: () => { done = true; resolve(false); } },
            { label: o.ok || "Удалить", kind: o.danger === false ? "primary" : "danger", onClick: () => { done = true; resolve(true); } },
          ],
        });
        const origClose = modal.close.bind(modal);
        modal.close = () => {
          if (!done) { done = true; resolve(false); }
          origClose();
        };
        modal.el.addEventListener("click", (e) => {
          if (e.target.closest(".modal-head .icon-btn")) {
            if (!done) { done = true; resolve(false); }
          }
        });
      });
    },

    /* ------------------------------ меню ------------------------------ */

    toggleMenu() {
      if (!menuPop.hidden) {
        hideMenu();
        return;
      }
      this.renderMenu();
      menuPop.hidden = false;
    },

    renderMenu() {
      const s = TB.model.doc.settings;
      const items = [];
      const add = (cfg) => items.push(cfg);

      add({
        icon: s.theme === "dark" ? "i-sun" : "i-moon",
        label: s.theme === "dark" ? "Светлая тема" : "Тёмная тема",
        hint: "сейчас " + (s.theme === "dark" ? "тёмная" : "светлая"),
        run: () => { if (TB.setTheme) TB.setTheme(s.theme === "dark" ? "light" : "dark"); },
      });
      add({
        icon: "i-bell",
        label: "Напоминания",
        hint: s.reminders ? "вкл" : "выкл",
        run: () => TB.tools.toggleReminders(),
      });
      add({
        icon: "i-calendar",
        label: "Повестка",
        hint: String(TB.model.agendaCount()),
        run: () => TB.tools.openAgenda(),
      });
      add({
        icon: "i-archive",
        label: "Архив",
        run: () => TB.tools.openArchive(),
      });
      add({ sep: true });
      add({
        icon: "i-download",
        label: "Экспорт данных",
        run: () => TB.tools.exportData(),
      });
      add({
        icon: "i-upload",
        label: "Импорт данных",
        run: () => $("#importInput").click(),
      });
      add({
        icon: "i-folder",
        label: "Резервные копии",
        run: () => TB.tools.openBackups(),
      });
      add({ sep: true });
      add({
        icon: "i-plug",
        label: "ChatGPT и MCP",
        hint: TB.sync && TB.sync.enabled() ? "вкл" : "выкл",
        run: () => TB.sync.openPanel(),
      });
      add({
        icon: "i-settings",
        label: "Настройки",
        run: () => this.openSettings(),
      });
      if (TB.installPrompt) {
        add({
          icon: "i-download",
          label: "Установить приложение",
          hint: "PWA",
          run: () => this.install(),
        });
      }
      add({
        icon: "i-capture",
        label: "Горячие клавиши",
        hint: "?",
        run: () => this.openShortcuts(),
      });
      add({
        icon: "i-file",
        label: "О приложении",
        run: () => this.openAbout(),
      });

      menuPop.innerHTML = "";
      const label = document.createElement("div");
      label.className = "menu-label";
      label.textContent = "ПРОБКА · ДОСКА ВРЕМЕНИ";
      menuPop.appendChild(label);

      items.forEach((item) => {
        if (item.sep) {
          const sep = document.createElement("div");
          sep.className = "menu-sep";
          menuPop.appendChild(sep);
          return;
        }
        const b = document.createElement("button");
        b.type = "button";
        b.className = "menu-item";
        b.innerHTML = '<svg class="ic"><use href="#' + item.icon + '"/></svg><span></span>' +
          (item.hint ? '<span class="hint"></span>' : "");
        b.querySelector("span").textContent = item.label;
        if (item.hint) b.querySelector(".hint").textContent = item.hint;
        b.addEventListener("click", () => {
          hideMenu();
          item.run();
        });
        menuPop.appendChild(b);
      });
    },

    /* ------------------------------ доски ------------------------------ */

    boardModal(boardId) {
      const isNew = !boardId;
      const board = isNew
        ? { name: "", color: TB.BOARD_COLORS[0], bg: "cork", sphere: null }
        : TB.model.doc.boards.find((b) => b.id === boardId);
      if (!board) return;
      if (board.inbox) {
        U.toast("Доска «Входящие» встроена — её нельзя переименовать", "warn");
        return;
      }

      const body = document.createElement("div");
      body.className = "board-form";
      body.innerHTML =
        '<label>Название<input type="text" data-name maxlength="60" placeholder="Например: Неделя" autofocus></label>' +
        '<label>Сфера<select data-sphere>' +
          '<option value="">Без сферы</option>' +
          TB.SPHERES.map((s) => '<option value="' + s.id + '">' + U.escapeHtml(s.name) + "</option>").join("") +
        "</select></label>" +
        '<label>Цвет<select data-color>' +
          TB.BOARD_COLORS.map((c) => '<option value="' + c + '">' + c + "</option>").join("") +
        "</select></label>" +
        '<label>Фон</label><div class="bg-options" data-bgs></div>';

      const name = body.querySelector("[data-name]");
      const sphere = body.querySelector("[data-sphere]");
      const color = body.querySelector("[data-color]");
      name.value = board.name || "";
      sphere.value = board.sphere || "";
      color.value = board.color || TB.BOARD_COLORS[0];
      color.type = "color";
      color.style.height = "34px";
      color.style.width = "100%";
      color.style.padding = "2px";
      color.style.border = "1px solid rgba(120,92,58,.3)";
      color.style.background = "transparent";

      const bgs = body.querySelector("[data-bgs]");
      let bg = board.bg || "cork";
      const bgColors = { cork: "#bb8a5c", linen: "#c9b89a", felt: "#7c8f79", kraft: "#c9a877" };
      TB.BOARD_BGS.forEach((opt) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "bg-option" + (opt.id === bg ? " active" : "");
        b.innerHTML = "<i></i><span></span>";
        b.querySelector("i").style.background = bgColors[opt.id] || "#bb8a5c";
        b.querySelector("span").textContent = opt.name;
        b.addEventListener("click", () => {
          bg = opt.id;
          $$(".bg-option", bgs).forEach((x) => x.classList.toggle("active", x === b));
        });
        bgs.appendChild(b);
      });

      const footer = [
        { label: "Отмена" },
        { label: isNew ? "Создать" : "Сохранить", kind: "primary", onClick: () => {
          const clean = name.value.trim();
          if (!clean) {
            name.focus();
            U.toast("У доски должно быть название", "warn");
            return false;
          }
          if (isNew) {
            const created = TB.model.addBoard(clean, color.value, bg, sphere.value || null);
            TB.model.setView("board");
            TB.model.setBoard(created.id);
          } else {
            TB.model.updateBoard(board.id, {
              name: clean,
              color: color.value,
              bg,
              sphere: sphere.value || null,
            });
          }
          U.toast(isNew ? "Доска создана" : "Доска обновлена");
        } },
      ];
      if (!isNew) {
        footer.unshift({
          label: "Удалить", kind: "danger", onClick: (modal) => {
            const id = board.id;
            this.confirm({
              title: "Удалить доску?",
              text: "Заметки этой доски будут удалены вместе с нитями. Это действие можно отменить через Ctrl+Z, пока приложение открыто.",
              ok: "Удалить доску",
            }).then((yes) => {
              if (!yes) return;
              if (TB.model.deleteBoard(id)) {
                modal.close();
                U.toast("Доска удалена");
              } else {
                U.toast("Нельзя удалить последнюю доску", "warn");
              }
            });
            return false;
          },
        });
      }

      this.showModal({
        title: isNew ? "Новая доска" : "Настройки доски",
        sub: isNew ? "Пробковый холст для одной темы или сферы" : "Название, сфера и материал",
        body,
        footer,
      });
    },

    /* ------------------------------ настройки ------------------------------ */

    openSettings() {
      const s = TB.model.doc.settings;
      const body = document.createElement("div");
      body.className = "settings-list";
      body.innerHTML =
        '<div class="settings-row">' +
          '<div><b>Тёмная тема</b><span>Беречь глаза вечером</span></div>' +
          '<button class="switch" data-theme aria-label="Тёмная тема"></button>' +
        "</div>" +
        '<div class="settings-row">' +
          '<div><b>Магнитная сетка</b><span>Наклейки выравниваются по 8 px</span></div>' +
          '<button class="switch" data-snap aria-label="Магнитная сетка"></button>' +
        "</div>" +
        '<div class="settings-row">' +
          '<div><b>Напоминания</b><span>Пока приложение открыто · без фоновых пушей</span></div>' +
          '<button class="switch" data-reminders aria-label="Напоминания"></button>' +
        "</div>" +
        '<div class="settings-row">' +
          '<div><b>Утренний дайджест</b><span>Один раз в день: просроченное и планы</span></div>' +
          '<button class="switch" data-digest aria-label="Утренний дайджест"></button>' +
        "</div>" +
        '<div class="settings-row">' +
          '<div><b>ChatGPT и MCP</b><span>Внешний чат создаёт и правит дела через локальный сервер</span></div>' +
          '<button class="v-btn" data-mcp>Настроить</button>' +
        "</div>" +
        '<div class="settings-sep"></div>' +
        '<div class="settings-data">' +
          '<button class="v-btn" data-export><svg class="ic"><use href="#i-download"/></svg> Экспорт .probka</button>' +
          '<button class="v-btn" data-import><svg class="ic"><use href="#i-upload"/></svg> Импорт</button>' +
          '<button class="v-btn" data-backups><svg class="ic"><use href="#i-folder"/></svg> Копии</button>' +
        "</div>" +
        '<div class="settings-note" data-storage>Данные хранятся только на этом устройстве.</div>' +
        '<div class="settings-sep"></div>' +
        '<div class="settings-danger">' +
          '<div><b>Демо-данные</b><span>Заменит всё текущее содержимое примерами. Сначала сделайте экспорт.</span></div>' +
          '<button class="v-btn danger" data-demo>Сбросить</button>' +
        "</div>";

      const themeBtn = body.querySelector("[data-theme]");
      const snapBtn = body.querySelector("[data-snap]");
      const remBtn = body.querySelector("[data-reminders]");
      const digBtn = body.querySelector("[data-digest]");
      const paint = () => {
        themeBtn.classList.toggle("on", TB.model.doc.settings.theme === "dark");
        snapBtn.classList.toggle("on", !!TB.model.doc.settings.snap);
        remBtn.classList.toggle("on", !!TB.model.doc.settings.reminders);
        digBtn.classList.toggle("on", !!TB.model.doc.settings.digest);
      };
      paint();

      themeBtn.addEventListener("click", () => {
        if (TB.setTheme) TB.setTheme(TB.model.doc.settings.theme === "dark" ? "light" : "dark");
        paint();
      });
      snapBtn.addEventListener("click", () => {
        TB.model.doc.settings.snap = !TB.model.doc.settings.snap;
        TB.model.saveSoon();
        paint();
        U.toast(TB.model.doc.settings.snap ? "Сетка включена" : "Сетка выключена");
      });
      remBtn.addEventListener("click", async () => {
        const ok = await TB.tools.toggleReminders();
        if (ok) paint();
      });
      digBtn.addEventListener("click", () => {
        TB.model.doc.settings.digest = !TB.model.doc.settings.digest;
        TB.model.saveSoon();
        paint();
        U.toast(TB.model.doc.settings.digest ? "Дайджест включён" : "Дайджест выключен");
      });
      body.querySelector("[data-mcp]").addEventListener("click", () => {
        this.closeAll();
        setTimeout(() => TB.sync.openPanel(), 30);
      });
      body.querySelector("[data-export]").addEventListener("click", () => TB.tools.exportData());
      body.querySelector("[data-import]").addEventListener("click", () => $("#importInput").click());
      body.querySelector("[data-backups]").addEventListener("click", () => TB.tools.openBackups());
      body.querySelector("[data-demo]").addEventListener("click", () => {
        this.confirm({
          title: "Заменить всё демо-данными?",
          text: "Текущие доски, заметки и файлы будут заменены примерами. Отменить это нельзя — сначала сделайте экспорт.",
          ok: "Заменить",
        }).then((yes) => {
          if (!yes) return;
          if (TB.tools && TB.tools.resetDemo) TB.tools.resetDemo();
        });
      });

      TB.store.estimate().then((est) => {
        const el = body.querySelector("[data-storage]");
        if (!el) return;
        const used = est && est.usage ? U.fmtBytes(est.usage) : "—";
        const quota = est && est.quota ? U.fmtBytes(est.quota) : "—";
        el.textContent = "Хранилище: " + used + " из " + quota + " · " +
          (TB.store.mode === "idb" ? "IndexedDB" : "localStorage") +
          (navigator.onLine ? "" : " · офлайн");
      });

      this.showModal({
        title: "Настройки",
        sub: "Всё локально, без аккаунта и облака",
        body,
        footer: [{ label: "Готово", kind: "primary" }],
      });
    },

    openShortcuts() {
      const rows = [
        ["Ctrl + K", "Поиск по всему"],
        ["Ctrl + Shift + A", "Быстрый захват"],
        ["N", "Новая заметка / запись"],
        ["Ctrl + Z", "Отменить"],
        ["Ctrl + Shift + Z", "Повторить"],
        ["Ctrl + S", "Сохранить сейчас"],
        ["Esc", "Закрыть окно или карточку"],
        ["Двойной клик", "Новая наклейка на доске"],
        ["Пробел", "Панорама доски (перетаскивание)"],
        ["?", "Эта подсказка"],
      ];
      const body = document.createElement("div");
      body.className = "shortcut-list";
      rows.forEach(([k, v]) => {
        const row = document.createElement("div");
        row.className = "shortcut-row";
        const keys = document.createElement("span");
        keys.className = "shortcut-keys";
        k.split(" + ").forEach((part) => {
          const kb = document.createElement("kbd");
          kb.textContent = part;
          keys.appendChild(kb);
        });
        const label = document.createElement("span");
        label.textContent = v;
        row.append(keys, label);
        body.appendChild(row);
      });
      const note = document.createElement("p");
      note.className = "settings-note";
      note.textContent = "Глобальные горячие клавиши ОС из браузера недоступны: приложение должно быть открыто. Для системного хоткея нужна нативная обёртка.";
      body.appendChild(note);
      this.showModal({ title: "Горячие клавиши", body, footer: [{ label: "Понятно", kind: "primary" }] });
    },

    openAbout() {
      const body = document.createElement("div");
      body.className = "about-box";
      body.innerHTML =
        '<div class="about-mark"><span class="brand-pin"></span><b>Пробка</b></div>' +
        '<p class="about-tag">доска времени · личный второй мозг</p>' +
        '<p>Четыре сферы, дедлайны, входящие, шаблоны Pipster, учёба, проекты и личное — на одном пробковом холсте. Данные не покидают устройство.</p>' +
        '<div class="about-grid">' +
          '<div><b>Версия</b><span>1.0.0 · офлайн</span></div>' +
          '<div><b>Хранение</b><span>' + (TB.store.mode === "idb" ? "IndexedDB" : "localStorage") + "</span></div>" +
          '<div><b>Записей</b><span>' + TB.model.active().length + "</span></div>" +
          '<div><b>Досок</b><span>' + TB.model.boards().length + "</span></div>" +
        "</div>" +
        '<p class="settings-note">Напоминания работают, пока приложение открыто. Фоновые уведомления потребовали бы сервера или нативной обёртки. Синхронизация между устройствами — через экспорт .probka.</p>';
      this.showModal({ title: "О приложении", body, footer: [{ label: "Закрыть", kind: "primary" }] });
    },

    async install() {
      if (TB.installPrompt) {
        TB.installPrompt.prompt();
        const choice = await TB.installPrompt.userChoice;
        TB.installPrompt = null;
        if (choice && choice.outcome === "accepted") U.toast("Устанавливаю…");
        return;
      }
      const body = document.createElement("div");
      body.innerHTML =
        "<p style='font-size:13px;line-height:1.6'>Установка зависит от браузера:</p>" +
        "<ul style='font-size:12.5px;line-height:1.6;padding-left:18px;margin:8px 0'>" +
        "<li><b>Android / Chrome:</b> меню ⋮ → «Установить приложение» или «Добавить на главный экран».</li>" +
        "<li><b>Windows / Chrome или Edge:</b> иконка установки в адресной строке.</li>" +
        "<li>Приложение должно открываться по <b>http://localhost</b> или <b>https</b>, не через file://.</li>" +
        "</ul>";
      this.showModal({ title: "Установка", body, footer: [{ label: "Понятно", kind: "primary" }] });
    },
  };

  function closeTop() {
    const rec = stack[stack.length - 1];
    if (rec) closeModal(rec);
  }

  function closeModal(rec) {
    const idx = stack.indexOf(rec);
    if (idx < 0) return;
    stack.splice(idx, 1);
    rec.el.remove();
    if (!stack.length) {
      scrim.hidden = true;
      if (lastFocus && document.contains(lastFocus)) {
        try { lastFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
      }
      lastFocus = null;
    }
  }

  function hideMenu() {
    menuPop.hidden = true;
  }

  function trapFocus(e, modal) {
    const nodes = $$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', modal)
      .filter((el) => !el.disabled && el.offsetParent !== null);
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  TB.overlays = overlays;
})();
