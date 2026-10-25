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
    endAt: 0,
    spent: 0,
    runStartedAt: 0,
  };
  const FOCUS_KEY = "probka.focus.v1";

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

  function saveFocusState() {
    try {
      localStorage.setItem(FOCUS_KEY, JSON.stringify({
        total: focus.total,
        left: Math.max(0, Math.round(focus.left)),
        running: !!focus.running,
        targetId: focus.targetId || null,
        endAt: focus.endAt || 0,
        spent: Math.max(0, Math.round(focus.spent)),
        updatedAt: Date.now(),
      }));
    } catch (e) { /* private mode */ }
  }

  function currentSpent() {
    const live = focus.running && focus.runStartedAt ? (Date.now() - focus.runStartedAt) / 1000 : 0;
    return Math.max(0, (focus.spent || 0) + live);
  }

  function pauseFocus() {
    if (!focus.running) return;
    focus.left = Math.max(0, Math.ceil((focus.endAt - Date.now()) / 1000));
    focus.spent = currentSpent();
    focus.running = false;
    focus.runStartedAt = 0;
    focus.endAt = 0;
    clearInterval(focus.timer);
    focus.timer = null;
    paintFocus();
    saveFocusState();
  }

  function focusTick() {
    if (!focus.running) return;
    const remaining = Math.max(0, Math.ceil((focus.endAt - Date.now()) / 1000));
    if (remaining <= 0) {
      focus.left = 0;
      focusDone();
      return;
    }
    if (remaining !== focus.left) {
      focus.left = remaining;
      paintFocus();
      saveFocusState();
    }
  }

  function focusDone(restored) {
    const minutes = Math.max(1, Math.round((focus.total || 1) / 60));
    const targetId = focus.targetId;
    focus.running = false;
    focus.left = 0;
    focus.spent = focus.total;
    focus.runStartedAt = 0;
    focus.endAt = 0;
    clearInterval(focus.timer);
    focus.timer = null;
    saveFocusState();
    if (targetId) TB.model.logFocus(targetId, minutes);
    paintFocus();
    if (!restored) {
      U.beep();
      U.toast("Фокус " + minutes + " мин завершён. Сделайте паузу.");
    } else {
      U.toast("Фокус завершился, пока приложение было закрыто.");
    }
    try {
      if (!restored && "Notification" in window && Notification.permission === "granted") {
        new Notification("Пробка · фокус завершён", { body: minutes + " минут позади. Пора размяться.", icon: "assets/icon-192.png" });
      }
    } catch (e) { /* ignore */ }
    setTimeout(() => {
      if (focus.running) return;
      focus.left = focus.total;
      focus.spent = 0;
      focus.startedAt = 0;
      paintFocus();
      saveFocusState();
    }, 1200);
  }

  function focusStart() {
    if (focus.running) {
      pauseFocus();
      U.toast("Фокус на паузе");
      return;
    }
    const selected = TB.model.selectedNote();
    if (!focus.targetId && TB.focusTarget) focus.targetId = TB.focusTarget;
    if (!focus.targetId && selected) focus.targetId = selected.id;
    if (!focus.targetId) {
      U.toast("Сначала выберите заметку или нажмите «Фокус» в карточке", "warn");
      return;
    }
    if (focus.left <= 0) {
      focus.left = focus.total;
      focus.spent = 0;
    }
    focus.running = true;
    focus.startedAt = focus.startedAt || Date.now();
    focus.runStartedAt = Date.now();
    focus.endAt = Date.now() + Math.max(1, focus.left) * 1000;
    clearInterval(focus.timer);
    focus.timer = setInterval(focusTick, 500);
    paintFocus();
    saveFocusState();
  }

  function focusReset() {
    if ((focus.running || focus.spent > 0) && focus.targetId) {
      const mins = Math.round(currentSpent() / 60);
      if (mins >= 1) TB.model.logFocus(focus.targetId, mins);
    }
    focus.running = false;
    clearInterval(focus.timer);
    focus.timer = null;
    const preset = $("#focusPreset");
    focus.total = (Number(preset && preset.value) || 25) * 60;
    focus.left = focus.total;
    focus.startedAt = 0;
    focus.endAt = 0;
    focus.runStartedAt = 0;
    focus.spent = 0;
    paintFocus();
    saveFocusState();
  }

  function restoreFocus() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(FOCUS_KEY) || "null"); } catch (e) { saved = null; }
    if (!saved || !Number.isFinite(Number(saved.total)) || Number(saved.total) <= 0) {
      focusReset();
      return;
    }
    focus.total = Math.max(60, Math.round(Number(saved.total)));
    focus.left = U.clamp(Number(saved.left) || focus.total, 0, focus.total);
    focus.spent = U.clamp(Number(saved.spent) || 0, 0, focus.total);
    focus.targetId = saved.targetId && TB.model.note(saved.targetId) ? saved.targetId : null;
    const preset = $("#focusPreset");
    if (preset) {
      const minutes = Math.round(focus.total / 60);
      if (Array.from(preset.options).some((o) => Number(o.value) === minutes)) preset.value = String(minutes);
    }
    focus.running = false;
    focus.timer = null;
    focus.runStartedAt = 0;
    focus.startedAt = 0;
    focus.endAt = 0;
    if (saved.running && Number(saved.endAt) > Date.now()) {
      focus.left = Math.max(1, Math.ceil((Number(saved.endAt) - Date.now()) / 1000));
      const elapsed = Math.max(0, (focus.total - focus.left) - focus.spent);
      focus.spent += elapsed;
      focus.running = true;
      focus.runStartedAt = Date.now() - elapsed * 1000;
      focus.endAt = Number(saved.endAt);
      focus.timer = setInterval(focusTick, 500);
    } else if (saved.running) {
      focus.left = 0;
      focus.spent = focus.total;
      setTimeout(() => focusDone(true), 30);
    } else if (focus.left <= 0) {
      // Приложение закрыли между завершением и авто-сбросом.
      focus.left = focus.total;
      focus.spent = 0;
    }
    paintFocus();
  }

  TB.focusReset = focusReset;
  TB.getFocusState = () => ({
    total: focus.total, left: focus.left, running: focus.running,
    targetId: focus.targetId, endAt: focus.endAt, spent: currentSpent(),
  });

  function bindFocus() {
    $("#focusStart").addEventListener("click", focusStart);
    $("#focusReset").addEventListener("click", focusReset);
    $("#focusPreset").addEventListener("change", () => {
      if (focus.running) return;
      focus.total = (Number($("#focusPreset").value) || 25) * 60;
      focus.left = focus.total;
      focus.spent = 0;
      focus.startedAt = 0;
      focus.endAt = 0;
      paintFocus();
      saveFocusState();
    });
    paintFocus();
    restoreFocus();
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
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        TB.model.saveNow().then((ok) => {
          if (!ok) return;
          U.toast("Сохранено");
          if (TB.sync && TB.sync.enabled && TB.sync.enabled()) TB.sync.push(true);
        });
        return;
      }
      if (typing) return;
      if (!mod && !e.altKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        if (TB.model.ui.view === "board") {
          const r = $("#boardFrame").getBoundingClientRect();
          TB.board.addNoteAt(r.left + r.width / 2, r.top + r.height / 2);
        } else {
          TB.tools.createNoteDialog();
        }
        return;
      }
      if (e.key === " " && TB.model.ui.view === "board") {
        e.preventDefault();
        if (TB.board && TB.board.setSpacePan) TB.board.setSpacePan(true);
        return;
      }
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

    document.addEventListener("keyup", (e) => {
      if (e.key === " " && TB.board && TB.board.setSpacePan) TB.board.setSpacePan(false);
    });
    window.addEventListener("blur", () => {
      if (TB.board && TB.board.setSpacePan) TB.board.setSpacePan(false);
    });

    window.addEventListener("beforeunload", () => {
      if (focus.running) {
        focus.left = Math.max(0, Math.ceil((focus.endAt - Date.now()) / 1000));
        focus.spent = currentSpent();
      }
      saveFocusState();
      TB.model.saveNow();
    });
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && focus.running) focusTick();
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

  async function consumeShare() {
    let params;
    try { params = new URLSearchParams(location.search); } catch (e) { return; }
    if (params.get("shared") !== "1") return;
    try {
      if (!("caches" in window)) return;
      const key = new URL("__probka_share__", location.href.replace(/[?#].*$/, "")).href;
      const cache = await caches.open("probka-share");
      const res = await cache.match(key);
      await cache.delete(key);
      if (!res) return;
      const data = await res.json();
      const parts = [];
      if (data.title && data.title !== data.text) parts.push(data.title);
      if (data.text) parts.push(data.text);
      if (data.url && !parts.some((x) => x.includes(data.url))) parts.push(data.url);
      const text = parts.join("\n").trim();
      if (!text) return;
      TB.model.capture(text);
      U.toast("Поделились → во Входящие");
    } catch (err) {
      console.warn("Пробка: не удалось принять share-target", err);
    } finally {
      try {
        params.delete("shared");
        const q = params.toString();
        history.replaceState(null, "", location.pathname + (q ? "?" + q : "") + location.hash);
      } catch (e) { /* ignore */ }
    }
  }

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
    await consumeShare();
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
