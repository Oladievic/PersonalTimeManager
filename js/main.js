/* Пробка — запуск приложения, маршрутизация, фокус, горячие клавиши */
(function () {
  "use strict";

  const TB = window.TB;
  const U = TB.util;
  const $ = U.$;
  const $$ = U.$$;

  let focus = {
    total: 25 * 60,
    left: 25 * 60,
    running: false,
    timer: null,
    targetId: null,
    startedAt: 0,
  };

  function setTheme(theme) {
    const next = theme === "dark" ? "dark" : "light";
    TB.model.doc.settings.theme = next;
    document.body.classList.toggle("dark", next === "dark");
    document.documentElement.style.colorScheme = next;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", next === "dark" ? "#1B1713" : "#2E2119");
    try { localStorage.setItem("probka.theme", next); } catch (e) { /* ignore */ }
    TB.model.saveSoon();
  }

  function refreshChrome() {
    if (!TB.model.doc) return;
    const view = TB.model.ui.view;
    $$("#mainNav [data-view]").forEach((b) => {
      b.classList.toggle("active", b.dataset.view === view);
    });

    const today = TB.model.todayItems().filter((n) => !n.done).length;
    const inbox = TB.model.inboxItems().length;
    const agenda = TB.model.overdueItems().filter((n) => !n.done).length + today;
    const setBadge = (sel, value) => {
      const el = $(sel);
      if (!el) return;
      el.hidden = !value;
      el.textContent = value ? String(value) : "";
    };
    setBadge("#navToday", today);
    setBadge("#navInbox", inbox);
    setBadge("#agendaBadge", agenda);

    const isBoard = view === "board";
    const board = TB.model.board();
    const title = $("#boardTitle");
    if (title) {
      title.readOnly = !isBoard;
      if (document.activeElement !== title) title.value = isBoard ? (board ? board.name : "Доска") : (TB.views ? TB.views.title(view) : "Пробка");
    }
    const sub = $("#boardSub");
    if (sub && isBoard) {
      const notes = TB.model.notes().length;
      const threads = TB.model.threads().length;
      sub.textContent = plural(notes, "заметка", "заметки", "заметок") + " · " + plural(threads, "нить", "нити", "нитей");
    } else if (sub && !isBoard) {
      sub.textContent = "Пробка · доска времени";
    }
    const zoom = $("#zoomCluster");
    if (zoom) zoom.hidden = !isBoard;
    const status = $("#saveState");
    if (status && TB.model._status === "saving") {
      status.classList.add("saving");
      status.lastElementChild.textContent = "Сохраняю…";
    }
    if (TB.sync) TB.sync.paintChrome();
    const storage = $("#storageInfo");
    if (storage && !TB.sync) storage.textContent = TB.store.mode === "idb" ? "Локально · IndexedDB" : "Локально · localStorage";
  }

  TB.refreshChrome = refreshChrome;

  function refresh(scope) {
    if (!TB.model.doc) return;
    const view = TB.model.ui.view;
    const isBoard = view === "board";
    const viewRoot = $("#viewRoot");
    const frame = $("#boardFrame");
    const hint = $("#boardHint");
    const tray = $("#toolTray");
    document.body.classList.toggle("view-mode", !isBoard);
    if (viewRoot) viewRoot.hidden = isBoard;
    if (frame) frame.hidden = !isBoard;
    if (hint) hint.hidden = !isBoard;
    if (tray && !isBoard) tray.hidden = true;

    if (isBoard) {
      if (TB.board) TB.board.render();
    } else if (TB.views) {
      if (scope === "board") TB.views.schedule();
      else TB.views.render();
    }
    refreshChrome();
  }

  TB.refresh = refresh;

  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return n + " " + one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return n + " " + few;
    return n + " " + many;
  }

  /* ------------------------------ фокус ------------------------------ */

  function paintFocus() {
    const dial = $("#focusDial");
    const time = $("#focusTime");
    const button = $("#focusStart");
    const pct = focus.total ? Math.max(0, Math.min(100, (1 - focus.left / focus.total) * 100)) : 0;
    if (dial) dial.style.setProperty("--p", String(pct));
    if (time) time.textContent = Math.floor(Math.max(0, focus.left) / 60) + ":" + String(Math.max(0, focus.left) % 60).padStart(2, "0");
    if (button) {
      button.innerHTML = focus.running
        ? '<svg class="ic"><use href="#i-pause"/></svg>'
        : '<svg class="ic"><use href="#i-play"/></svg>';
      button.setAttribute("aria-label", focus.running ? "Пауза" : "Старт");
      button.classList.toggle("running", focus.running);
    }
    const label = $("#focusTarget");
    if (label) {
      const n = TB.model.note(focus.targetId);
      if (n) {
        label.textContent = U.titleOfNote(n);
        label.title = "Фокус: " + U.titleOfNote(n);
      } else {
        const selected = TB.model.selectedNote();
        if (selected && !focus.running) {
          label.textContent = U.titleOfNote(selected);
          label.title = "Выбрано: " + U.titleOfNote(selected);
        } else if (!focus.running) {
          label.textContent = "без задачи";
          label.title = "Выберите заметку, чтобы привязать фокус";
        }
      }
    }
  }

  TB.setFocusTarget = function (id) {
    focus.targetId = id || null;
    paintFocus();
  };

  function focusTick() {
    if (!focus.running) return;
    focus.left -= 1;
    if (focus.left <= 0) {
      focus.left = 0;
      focusDone();
      return;
    }
    paintFocus();
  }

  function focusDone() {
    const minutes = Math.round(focus.total / 60);
    if (focus.targetId) TB.model.logFocus(focus.targetId, minutes);
    focus.running = false;
    clearInterval(focus.timer);
    focus.timer = null;
    paintFocus();
    U.beep();
    U.toast("Фокус " + minutes + " мин завершён. Сделайте паузу.");
    try {
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("Пробка · фокус завершён", { body: minutes + " минут позади. Пора размяться.", icon: "assets/icon-192.png" });
      }
    } catch (e) { /* ignore */ }
    setTimeout(() => {
      focus.left = focus.total;
      paintFocus();
    }, 1200);
  }

  function focusStart() {
    if (focus.running) {
      focus.running = false;
      clearInterval(focus.timer);
      focus.timer = null;
      paintFocus();
      return;
    }
    const selected = TB.model.selectedNote();
    if (!focus.targetId && TB.focusTarget) focus.targetId = TB.focusTarget;
    if (!focus.targetId && selected) focus.targetId = selected.id;
    if (!focus.targetId) {
      U.toast("Сначала выберите заметку или нажмите «Фокус» в карточке", "warn");
      return;
    }
    if (focus.left <= 0) focus.left = focus.total;
    focus.running = true;
    focus.startedAt = Date.now();
    clearInterval(focus.timer);
    focus.timer = setInterval(focusTick, 1000);
    paintFocus();
  }

  function focusReset() {
    if (focus.running && focus.startedAt && Date.now() - focus.startedAt > 60000 && focus.targetId) {
      const mins = Math.round((Date.now() - focus.startedAt) / 60000);
      if (mins >= 1) TB.model.logFocus(focus.targetId, mins);
    }
    focus.running = false;
    clearInterval(focus.timer);
    focus.timer = null;
    const preset = $("#focusPreset");
    focus.total = (Number(preset && preset.value) || 25) * 60;
    focus.left = focus.total;
    focus.startedAt = 0;
    paintFocus();
  }

  TB.focusReset = focusReset;

  function bindFocus() {
    $("#focusStart").addEventListener("click", focusStart);
    $("#focusReset").addEventListener("click", focusReset);
    $("#focusPreset").addEventListener("change", () => {
      if (focus.running) return;
      focus.total = (Number($("#focusPreset").value) || 25) * 60;
      focus.left = focus.total;
      paintFocus();
    });
    paintFocus();
  }

  /* ------------------------------ оболочка ------------------------------ */

  function bindChrome() {
    $$("#mainNav [data-view]").forEach((b) => {
      b.addEventListener("click", () => {
        TB.model.setView(b.dataset.view);
        if (window.innerWidth <= 860) $("#sidebar").classList.remove("open");
      });
    });

    $("#btnAddNote").addEventListener("click", () => {
      if (TB.model.ui.view === "board") {
        const r = $("#boardFrame").getBoundingClientRect();
        TB.board.addNoteAt(r.left + r.width / 2, r.top + r.height / 2);
      } else {
        TB.tools.createNoteDialog();
      }
    });

    $("#btnUndo").addEventListener("click", () => TB.model.undo());
    $("#btnRedo").addEventListener("click", () => TB.model.redo());

    $("#zoomCluster").addEventListener("click", (e) => {
      const b = e.target.closest("[data-zoom]");
      if (!b) return;
      if (b.dataset.zoom === "in") TB.board.zoomBy(1.15);
      else if (b.dataset.zoom === "out") TB.board.zoomBy(1 / 1.15);
      else if (b.dataset.zoom === "reset") TB.board.resetZoom();
      else if (b.dataset.zoom === "fit") TB.board.fit();
    });

    const boardTitle = $("#boardTitle");
    boardTitle.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); boardTitle.blur(); }
      if (e.key === "Escape") { boardTitle.value = TB.model.board().name; boardTitle.blur(); }
    });
    boardTitle.addEventListener("blur", () => {
      if (TB.model.ui.view !== "board") {
        boardTitle.value = TB.views ? TB.views.title(TB.model.ui.view) : "Пробка";
        return;
      }
      const next = boardTitle.value.trim();
      if (!next) {
        boardTitle.value = TB.model.board().name;
        return;
      }
      if (next !== TB.model.board().name) {
        TB.model.updateBoard(TB.model.ui.boardId, { name: next });
        TB.panels.renderSidebar();
      }
    });

    $("#boardFrame").addEventListener("dblclick", (e) => {
      if (TB.model.ui.view !== "board") return;
      if (e.target.closest(".note, .thread-hit, .board-hint")) return;
    });

    document.addEventListener("keydown", (e) => {
      const typing = U.isTypingTarget(e.target);
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        TB.tools.openSearch();
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        TB.tools.openCapture();
        return;
      }
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) TB.model.redo();
        else TB.model.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        TB.model.redo();
        return;
      }
      if (typing) return;
      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        e.preventDefault();
        TB.overlays.openShortcuts();
      } else if (e.key === "Escape") {
        if (TB.panels && TB.panels.isDetailsOpen()) TB.panels.closeDetails();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        const n = TB.model.selectedNote();
        if (n && TB.model.ui.view === "board") {
          e.preventDefault();
          TB.overlays.confirm({
            title: "Удалить заметку?",
            text: "«" + U.titleOfNote(n) + "» и её нити исчезнут. Ctrl+Z вернёт.",
            ok: "Удалить",
          }).then((yes) => {
            if (yes) TB.model.deleteNote(n.id);
          });
        }
      }
    });

    window.addEventListener("beforeunload", () => {
      TB.model.saveNow();
    });

    window.addEventListener("resize", U.debounce(() => {
      const zl = $("#zoomLabel");
      if (zl && TB.board && TB.board.applyView) TB.board.applyView();
    }, 150));
  }

  function updateZoomLabel() {
    const zl = $("#zoomLabel");
    if (!zl) return;
    const value = zl.textContent;
    if (!/^\d+%$/.test(value)) zl.textContent = "100%";
  }

  /* ------------------------------ запуск ------------------------------ */

  async function boot() {
    let raw = null;
    try {
      const loaded = await TB.store.init();
      raw = loaded ? loaded.doc : null;
    } catch (err) {
      console.warn("Пробка: хранилище недоступно", err);
    }
    let doc = raw ? TB.normalizeDoc(raw) : null;
    if (!doc) doc = TB.model.seed();

    TB.model.init(doc);
    try {
      const params = new URLSearchParams(location.search);
      const urlView = params.get("view");
      const allowed = ["today", "board", "tasks", "calendar", "inbox", "work", "study", "projects", "life", "review", "search"];
      if (urlView && allowed.includes(urlView)) {
        doc.settings.view = urlView;
        TB.model.ui.view = urlView;
        history.replaceState(null, "", location.pathname + location.hash);
      } else if (TB.model.ui.view !== "board") {
        doc.settings.view = "board";
        TB.model.ui.view = "board";
      }
    } catch (e) { /* ignore bad URL */ }
    try { localStorage.setItem("probka.seen", "1"); } catch (e) { /* ignore */ }

    const savedTheme = (() => {
      try { return localStorage.getItem("probka.theme"); } catch (e) { return null; }
    })();
    const theme = savedTheme || doc.settings.theme || "light";
    doc.settings.theme = theme;
    document.body.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;

    TB.panels.init();
    TB.board.init();
    TB.views.init();
    TB.tools.init();
    TB.overlays.init();
    bindChrome();
    bindFocus();
    TB.sync.init();

    refresh("all");
    updateZoomLabel();
    requestAnimationFrame(() => {
      if (TB.model.ui.view === "board") {
        const b = TB.model.board();
        if (!b.view) TB.board.fit();
      }
      TB.model.saveNow();
    });

    if ("serviceWorker" in navigator && (location.protocol === "http:" || location.protocol === "https:")) {
      navigator.serviceWorker.register("sw.js").catch((err) => {
        console.warn("Пробка: service worker не зарегистрирован", err.message || err);
      });
    }
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }
  }

  TB.setTheme = setTheme;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
