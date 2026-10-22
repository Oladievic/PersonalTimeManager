/* Пробка — локальное хранилище: IndexedDB с резервным JSON в localStorage */
(function () {
  "use strict";

  const TB = window.TB;
  const DB_NAME = "probka";
  const DB_VERSION = 1;
  const LS_DOC = "probka.doc.fallback";

  let db = null;
  let mode = "idb";

  function request(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function openDB() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("IndexedDB недоступен"));
        return;
      }
      const open = indexedDB.open(DB_NAME, DB_VERSION);
      open.onupgradeneeded = () => {
        const d = open.result;
        if (!d.objectStoreNames.contains("kv")) d.createObjectStore("kv");
        if (!d.objectStoreNames.contains("files")) d.createObjectStore("files", { keyPath: "id" });
        if (!d.objectStoreNames.contains("backups")) {
          const s = d.createObjectStore("backups", { keyPath: "id" });
          s.createIndex("at", "at");
        }
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
      open.onblocked = () => reject(new Error("База данных занята другой вкладкой"));
    });
  }

  async function idbGet(storeName, key) {
    const t = db.transaction(storeName, "readonly");
    return request(t.objectStore(storeName).get(key));
  }
  async function idbPut(storeName, value, key) {
    const t = db.transaction(storeName, "readwrite");
    const store = t.objectStore(storeName);
    const r = key === undefined ? store.put(value) : store.put(value, key);
    await request(r);
    return new Promise((resolve, reject) => {
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error("Запись отменена"));
    });
  }
  async function idbDelete(storeName, key) {
    const t = db.transaction(storeName, "readwrite");
    await request(t.objectStore(storeName).delete(key));
  }
  async function idbAll(storeName) {
    const t = db.transaction(storeName, "readonly");
    return request(t.objectStore(storeName).getAll());
  }

  function readFallback() {
    try {
      const raw = localStorage.getItem(LS_DOC);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function writeFallback(doc) {
    try {
      localStorage.setItem(LS_DOC, JSON.stringify(doc));
    } catch (e) { /* quota — ignore, IndexedDB is the primary store */ }
  }

  const store = {
    get mode() { return mode; },

    async init() {
      try {
        db = await openDB();
        mode = "idb";
      } catch (err) {
        console.warn("Пробка: IndexedDB недоступен, используется localStorage", err);
        db = null;
        mode = "local";
      }
      let doc = null;
      if (db) {
        try {
          doc = await idbGet("kv", "doc");
        } catch (e) {
          console.warn("Пробка: не удалось прочитать документ", e);
        }
      }
      if (!doc) doc = readFallback();
      return { doc, mode };
    },

    async saveDoc(doc) {
      if (db) {
        await idbPut("kv", doc, "doc");
      }
      writeFallback(doc);
    },

    async putFile(record) {
      if (!db) throw new Error("Файлы недоступны в этом браузере");
      await idbPut("files", record);
      return record;
    },

    async getFile(id) {
      if (!db) return null;
      try {
        return await idbGet("files", id);
      } catch (e) {
        return null;
      }
    },

    async deleteFile(id) {
      if (!db) return;
      try {
        await idbDelete("files", id);
      } catch (e) { /* ignore */ }
    },

    async listFiles() {
      if (!db) return [];
      try {
        return await idbAll("files");
      } catch (e) {
        return [];
      }
    },

    async createBackup(doc, reason) {
      if (!db) throw new Error("Резервные копии недоступны");
      const rec = {
        id: "bk_" + Date.now(),
        at: Date.now(),
        reason: reason || "авто",
        doc: JSON.parse(JSON.stringify(doc)),
      };
      await idbPut("backups", rec);
      try {
        const all = await idbAll("backups");
        const sorted = all.sort((a, b) => b.at - a.at);
        for (let i = 8; i < sorted.length; i++) await idbDelete("backups", sorted[i].id);
      } catch (e) { /* pruning is best-effort */ }
      return rec;
    },

    async listBackups() {
      if (!db) return [];
      try {
        const all = await idbAll("backups");
        return all.sort((a, b) => b.at - a.at);
      } catch (e) {
        return [];
      }
    },

    async getBackup(id) {
      if (!db) return null;
      return idbGet("backups", id);
    },

    async deleteBackup(id) {
      if (!db) return;
      await idbDelete("backups", id);
    },

    async estimate() {
      try {
        if (navigator.storage && navigator.storage.estimate) {
          const e = await navigator.storage.estimate();
          return { usage: e.usage || 0, quota: e.quota || 0 };
        }
      } catch (e) { /* ignore */ }
      return null;
    },
  };

  TB.store = store;
})();
