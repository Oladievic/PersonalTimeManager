/* Пробка — мост к локальному серверу и MCP (ChatGPT / Claude) */
(function () {
  "use strict";

  const TB = window.TB;
  const U = TB.util;
  const $ = U.$;
  const KEY = "probka.sync.v1";
  const POLL_MS = 7000;
  const PUSH_MS = 1600;

  function defaultUrl() {
    if (location.protocol === "http:" || location.protocol === "https:") {
      // если приложение открыто с того же сервера — он и есть сервер
      if (location.port && location.port !== "8000" && location.port !== "8080") return location.origin;
      return location.origin;
    }
    return "http://localhost:8765";
  }

  function loadConfig() {
    let cfg = {};
    try { cfg = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { cfg = {}; }
    return Object.assign({
      url: defaultUrl(),
      token: "",
      enabled: false,
      revision: 0,
      lastSync: 0,
    }, cfg);
  }

  const sync = {
    cfg: loadConfig(),
    _timer: null,
    _pollTimer: null,
    _pushTimer: null,
    _retryTimer: null,
    _retryDelay: 0,
    _busy: false,
    _applying: false,
    _dirty: false,
    _localSeq: 0,
    _status: "off",
    _message: "",

    init() {
      this.paintChrome();
      if (this.cfg.enabled && this.cfg.token) {
        this.start();
        setTimeout(() => this.push(true), 1200);
      }
      window.addEventListener("online", () => {
        if (!this.cfg.enabled) return;
        this._status = "connecting";
        this.paintChrome();
        if (this._dirty) this.push(false, this._localSeq);
        else this.poll();
      });
      window.addEventListener("offline", () => {
        this._status = this.cfg.enabled ? "offline" : "off";
        this._message = this.cfg.enabled ? "Нет сети — изменения ждут отправки" : "";
        this.paintChrome();
      });
      document.addEventListener("visibilitychange", () => {
        if (document.hidden || !this.cfg.enabled) return;
        if (this._dirty) this.push(false, this._localSeq);
        else this.poll();
      });
    },

    saveConfig() {
      try {
        localStorage.setItem(KEY, JSON.stringify(this.cfg));
      } catch (e) { /* приватный режим — просто не запомним */ }
    },

    isApplying() { return this._applying; },

    baseUrl() {
      return String(this.cfg.url || "").trim().replace(/\/+$/, "");
    },

    mcpUrl() {
      const base = this.baseUrl();
      if (!base) return "";
      return base + "/mcp/" + encodeURIComponent(this.cfg.token || "");
    },

    enabled() {
      return !!(this.cfg.enabled && this.cfg.token && this.baseUrl());
    },

    start() {
      this.cfg.enabled = true;
      this.saveConfig();
      clearInterval(this._pollTimer);
      this._pollTimer = setInterval(() => this.poll(), POLL_MS);
      this._status = "connecting";
      this.paintChrome();
      setTimeout(() => this.poll(true), 500);
    },

    stop() {
      this.cfg.enabled = false;
      this.saveConfig();
      clearInterval(this._pollTimer);
      clearTimeout(this._pushTimer);
      clearTimeout(this._retryTimer);
      this._pushTimer = null;
      this._retryTimer = null;
      this._retryDelay = 0;
      this._status = "off";
      this._message = "Выключено";
      this.paintChrome();
    },

    schedulePush() {
      if (!this.enabled() || !TB.model.doc || this._applying) return;
      this._dirty = true;
      this._localSeq += 1;
      clearTimeout(this._pushTimer);
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
      const seq = this._localSeq;
      this._pushTimer = setTimeout(() => {
        this._pushTimer = null;
        this.push(false, seq);
      }, PUSH_MS);
      this._message = "Есть изменения — отправлю автоматически";
      this.paintChrome();
    },

    _scheduleRetry(message) {
      if (!this.enabled() || !this._dirty) return;
      this._retryDelay = Math.min(60000, Math.max(2000, (this._retryDelay || 2000) * 2));
      clearTimeout(this._retryTimer);
      const seq = this._localSeq;
      this._retryTimer = setTimeout(() => {
        this._retryTimer = null;
        this.push(false, seq);
      }, this._retryDelay);
      this._message = (message || "Нет связи") + " · повтор через " + Math.round(this._retryDelay / 1000) + " с";
      this._status = navigator.onLine === false ? "offline" : "error";
      this.paintChrome();
      this.paintPanel();
    },

    async request(path, options) {
      const base = this.baseUrl();
      if (!base) throw new Error("Не указан адрес сервера");
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 9000);
      try {
        const res = await fetch(base + path, Object.assign({
          cache: "no-store",
          signal: ctrl.signal,
          headers: {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + this.cfg.token,
            "X-Probka-Token": this.cfg.token,
          },
        }, options || {}));
        const text = await res.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        if (!res.ok) {
          if (res.status === 401) throw new Error("Неверный токен");
          if (res.status === 404) throw new Error("Сервер не найден по этому адресу");
          throw new Error((data && (data.error || data.message)) || ("HTTP " + res.status));
        }
        return data || {};
      } finally {
        clearTimeout(timer);
      }
    },

    async probe() {
      const base = this.baseUrl();
      if (!base) throw new Error("Укажите адрес сервера");
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      try {
        const res = await fetch(base + "/api/health", { cache: "no-store", signal: ctrl.signal });
        if (!res.ok) throw new Error("Сервер ответил HTTP " + res.status);
        const health = await res.json();
        if (!this.cfg.token) throw new Error("Вставьте токен из окна server.py");
        const doc = await this.request("/api/doc");
        return { health, revision: doc.revision, doc: doc.doc };
      } finally {
        clearTimeout(timer);
      }
    },

    async check() {
      this._status = "connecting";
      this._message = "Проверяю…";
      this.paintChrome();
      try {
        const info = await this.probe();
        this.cfg.revision = Number(info.revision) || 0;
        this.saveConfig();
        this._status = "ok";
        this._message = "Сервер отвечает";
        this.paintChrome();
        this.paintPanel();
        return true;
      } catch (err) {
        this._status = "error";
        this._message = err.message || "Нет связи";
        this.paintChrome();
        this.paintPanel();
        return false;
      }
    },

    async poll(force) {
      if (!this.enabled() || this._busy || this._applying) return;
      if (this._pushTimer || this._dirty) return;
      try {
        const res = await fetch(this.baseUrl() + "/api/health", { cache: "no-store" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        const health = await res.json();
        if (!force && Number(health.revision) <= Number(this.cfg.revision || 0)) {
          if (this._status !== "ok") {
            this._status = "ok";
            this._message = "Синхронизировано";
            this.paintChrome();
            this.paintPanel();
          }
          return;
        }
        const data = await this.request("/api/doc");
        if (!data.doc) return;
        this.cfg.revision = Number(data.revision) || 0;
        this.cfg.lastSync = Date.now();
        this.saveConfig();
        await this.applyRemote(data.doc);
        this._status = "ok";
        this._message = "Получено с сервера";
        this.paintChrome();
        this.paintPanel();
      } catch (err) {
        if (navigator.onLine === false) {
          this._status = "offline";
          this._message = "Нет сети";
        } else {
          this._status = "error";
          this._message = err.message || "Нет связи";
        }
        this.paintChrome();
        this.paintPanel();
      }
    },

    async push(force, seqAtStart) {
      if (!this.enabled() || !TB.model.doc) return false;
      if (this._busy) {
        this._scheduleRetry("Синхронизация уже идёт");
        return false;
      }
      if (this._applying) return false;
      clearTimeout(this._pushTimer);
      this._pushTimer = null;
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
      this._busy = true;
      this._status = "sync";
      this._message = "Отправляю…";
      this.paintChrome();
      const seq = seqAtStart == null ? this._localSeq : seqAtStart;
      try {
        const data = await this.request("/api/doc", {
          method: "PUT",
          body: JSON.stringify({ baseRevision: this.cfg.revision || 0, doc: TB.model.doc }),
        });
        this.cfg.revision = Number(data.revision) || this.cfg.revision || 0;
        this.cfg.lastSync = Date.now();
        this.saveConfig();
        if (data.conflict && data.doc) {
          // Слияние уже выполнено на сервере, но пользователь должен знать,
          // что данные пришли с другого устройства.  Перед применением —
          // локальная копия на случай неожиданного merge.
          try { await TB.store.createBackup(TB.model.doc, "перед слиянием с сервером"); } catch (e) { /* ignore */ }
          U.toast("Данные объединены с сервером — проверьте записи", "warn");
        }
        if (data.doc && seq === this._localSeq) {
          this._dirty = false;
          this._retryDelay = 0;
          await this.applyRemote(data.doc);
        } else if (data.doc) {
          this._dirty = true;
          this.schedulePush();
        }
        this._status = "ok";
        this._retryDelay = 0;
        this._message = data.conflict ? "Синхронизировано с объединением" : "Синхронизировано";
        this.paintChrome();
        this.paintPanel();
        return true;
      } catch (err) {
        this._status = navigator.onLine === false ? "offline" : "error";
        this._message = err.message || "Не удалось отправить";
        this._scheduleRetry(this._message);
        return false;
      } finally {
        this._busy = false;
      }
    },

    async pullNow() {
      let yes = true;
      if (TB.overlays && TB.overlays.confirm) {
        yes = await TB.overlays.confirm({
          title: "Скачать данные с сервера?",
          text: "Локальные данные будут заменены серверной версией. Перед этим создам резервную копию — её можно будет восстановить в настройках.",
          ok: "Скачать",
          danger: true,
        });
      }
      if (!yes) return false;
      const ok = await this.check();
      if (!ok) return false;
      try {
        await TB.store.createBackup(TB.model.doc, "перед загрузкой с сервера");
      } catch (err) {
        U.toast("Не удалось создать копию: " + (err.message || "хранилище"), "error");
        return false;
      }
      return this.poll(true);
    },

    async applyRemote(raw) {
      if (!raw) return;
      this._applying = true;
      try {
        const prevView = TB.model.ui.view;
        const prevBoard = TB.model.ui.boardId;
        const selected = TB.model.ui.selectedId;
        const doc = TB.normalizeDoc(raw);
        if (!doc) return;
        TB.model.doc = doc;
        TB.model.ui.view = prevView;
        TB.model.ui.boardId = doc.boards.some((b) => b.id === prevBoard) ? prevBoard : doc.boards[0].id;
        doc.settings.view = prevView;
        doc.settings.lastBoard = TB.model.ui.boardId;
        TB.model.ui.selectedId = selected && TB.model.note(selected) ? selected : null;
        TB.model.history = [];
        TB.model.redoStack = [];
        if (TB.board) TB.board.onDocRestored();
        if (TB.panels) TB.panels.onDocRestored();
        if (TB.refresh) TB.refresh("all");
        await TB.model.saveNow();
      } finally {
        this._applying = false;
      }
    },

    statusLabel() {
      if (!this.cfg.enabled) return "";
      if (this._dirty) return "MCP: есть изменения";
      const labels = {
        off: "MCP выкл",
        connecting: "MCP: проверка…",
        sync: "MCP: отправка…",
        ok: "MCP: на связи",
        offline: "MCP: офлайн",
        error: "MCP: ошибка",
      };
      return labels[this._status] || "MCP";
    },

    paintChrome(forced) {
      const storage = $("#storageInfo");
      if (storage) {
        const base = TB.store && TB.store.mode === "idb" ? "Локально · IndexedDB" : "Локально · localStorage";
        const mcp = this.statusLabel();
        storage.textContent = base + (mcp ? " · " + mcp : "");
      }
      const dot = $("#mcpStatusDot");
      if (dot) {
        dot.className = "mcp-dot " + (this._status || "off");
        dot.title = this._message || this.statusLabel() || "MCP выключен";
      }
      if (forced === "ok") this._status = "ok";
    },

    paintPanel() {
      const root = $("#mcpPanel");
      if (!root) return;
      const chip = root.querySelector("[data-mcp-state]");
      if (chip) {
        chip.textContent = this._status === "ok" ? "на связи" :
          this._status === "sync" ? "синхронизация" :
          this._status === "error" ? "ошибка" :
          this._status === "offline" ? "офлайн" :
          this._status === "connecting" ? "проверка" : "выключено";
        chip.className = "mcp-state " + this._status;
      }
      const note = root.querySelector("[data-mcp-message]");
      if (note) note.textContent = this._message || "URL и токен хранятся только на этом устройстве.";
      const mcpInput = root.querySelector("[data-mcp-url]");
      if (mcpInput) mcpInput.value = this.mcpUrl() || "—";
      const on = root.querySelector("[data-mcp-enabled]");
      if (on) on.classList.toggle("on", !!this.cfg.enabled);
      const last = root.querySelector("[data-mcp-last]");
      if (last) {
        last.textContent = this.cfg.lastSync
          ? "Последняя синхронизация: " + new Date(this.cfg.lastSync).toLocaleString("ru-RU")
          : "Ещё не синхронизировались";
      }
    },

    openPanel() {
      if (!TB.overlays) {
        U.toast("Модальные окна ещё загружаются", "warn");
        return;
      }
      const body = document.createElement("div");
      body.className = "mcp-panel";
      body.id = "mcpPanel";
      body.innerHTML =
        '<div class="mcp-head">' +
          '<span class="mcp-dot ' + (this._status || "off") + '"></span>' +
          '<div><b>Локальный сервер «Пробки»</b><span data-mcp-message></span></div>' +
          '<span class="mcp-state" data-mcp-state>выключено</span>' +
        '</div>' +
        '<div class="mcp-form">' +
          '<label>Адрес сервера' +
            '<input type="url" data-mcp-server placeholder="http://localhost:8765" autocomplete="off" spellcheck="false">' +
          '</label>' +
          '<label>Токен' +
            '<div class="input-with-btn">' +
              '<input type="password" data-mcp-token placeholder="из окна server.py" autocomplete="off" spellcheck="false">' +
              '<button type="button" class="mini-open" data-mcp-eye title="Показать токен">👁</button>' +
            '</div>' +
          '</label>' +
          '<div class="settings-row mcp-toggle-row">' +
            '<div><b>Синхронизировать</b><span>Опрашивать сервер, пока приложение открыто</span></div>' +
            '<button class="switch" type="button" data-mcp-enabled aria-label="Синхронизация"></button>' +
          '</div>' +
        '</div>' +
        '<div class="mcp-actions">' +
          '<button class="v-btn" type="button" data-mcp-check><svg class="ic"><use href="#i-link"/></svg> Проверить связь</button>' +
          '<button class="v-btn" type="button" data-mcp-sync><svg class="ic"><use href="#i-undo"/></svg> Синхронизировать сейчас</button>' +
          '<button class="v-btn" type="button" data-mcp-pull><svg class="ic"><use href="#i-download"/></svg> Скачать с сервера</button>' +
        '</div>' +
        '<label class="mcp-url">MCP-адрес для ChatGPT / Claude' +
          '<div class="input-with-btn">' +
            '<input type="text" data-mcp-url readonly>' +
            '<button class="mini-open" type="button" data-mcp-copy title="Скопировать">⧉</button>' +
          '</div>' +
        '</label>' +
        '<div class="settings-note" data-mcp-last></div>' +
        '<div class="settings-note mcp-warn">Адрес с токеном — это пароль. Не публикуйте его. ' +
          'ChatGPT требует HTTPS: запустите туннель по инструкции.</div>' +
        '<div class="mcp-doc-row">' +
          '<button class="v-btn" type="button" data-mcp-doc>Инструкция docs/MCP.md</button>' +
          '<button class="v-btn" type="button" data-mcp-off>Выключить</button>' +
        '</div>';

      const urlInput = body.querySelector("[data-mcp-server]");
      const tokenInput = body.querySelector("[data-mcp-token]");
      urlInput.value = this.cfg.url || defaultUrl();
      tokenInput.value = this.cfg.token || "";
      this.paintPanelAfterMount = () => this.paintPanel();

      const persist = () => {
        this.cfg.url = urlInput.value.trim().replace(/\/+$/, "") || defaultUrl();
        this.cfg.token = tokenInput.value.trim();
        this.saveConfig();
      };
      const enableToggle = () => {
        persist();
        if (!this.cfg.token) {
          U.toast("Вставьте токен из окна server.py", "warn");
          tokenInput.focus();
          return;
        }
        if (this.cfg.enabled) this.stop();
        else this.start();
        this.paintPanel();
      };

      body.querySelector("[data-mcp-enabled]").addEventListener("click", enableToggle);
      body.querySelector("[data-mcp-eye]").addEventListener("click", () => {
        tokenInput.type = tokenInput.type === "password" ? "text" : "password";
      });
      body.querySelector("[data-mcp-check]").addEventListener("click", async () => {
        persist();
        await this.check();
      });
      body.querySelector("[data-mcp-sync]").addEventListener("click", async () => {
        persist();
        if (!this.cfg.enabled) this.start();
        await this.push(true);
      });
      body.querySelector("[data-mcp-pull]").addEventListener("click", async () => {
        persist();
        if (!this.cfg.token) {
          U.toast("Вставьте токен", "warn");
          return;
        }
        await this.pullNow();
      });
      body.querySelector("[data-mcp-copy]").addEventListener("click", async () => {
        persist();
        const value = this.mcpUrl();
        if (!value) return;
        try {
          await navigator.clipboard.writeText(value);
          U.toast("MCP-адрес скопирован");
        } catch (e) {
          const input = body.querySelector("[data-mcp-url]");
          input.select();
          document.execCommand("copy");
          U.toast("MCP-адрес скопирован");
        }
      });
      body.querySelector("[data-mcp-doc]").addEventListener("click", () => {
        window.open("docs/MCP.md", "_blank", "noopener");
      });
      body.querySelector("[data-mcp-off]").addEventListener("click", () => {
        this.stop();
        this.paintPanel();
        U.toast("Синхронизация выключена");
      });

      TB.overlays.showModal({
        title: "ChatGPT и MCP",
        sub: "Внешний чат сможет создавать и редактировать ваши дела",
        body,
        footer: [
          { label: "Закрыть" },
          { label: "Сохранить", kind: "primary", onClick: () => {
            persist();
            if (this.cfg.enabled) this.start();
            U.toast("Настройки связи сохранены");
          } },
        ],
      });
      setTimeout(() => {
        this.paintPanel();
        this.paintChrome();
      }, 0);
    },
  };

  TB.sync = sync;
})();
