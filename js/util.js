/* Пробка — утилиты */
(function () {
  "use strict";

  const TB = (window.TB = window.TB || {});

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  let seq = 0;
  function uid(prefix) {
    seq += 1;
    return (
      (prefix || "id") +
      "_" +
      Date.now().toString(36) +
      "_" +
      seq.toString(36) +
      Math.random().toString(36).slice(2, 6)
    );
  }

  const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  function debounce(fn, wait) {
    let t = null;
    function wrapped() {
      const args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(self, args), wait);
    }
    wrapped.cancel = () => clearTimeout(t);
    return wrapped;
  }

  function escapeHtml(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  const ALLOWED_TAGS = new Set([
    "B", "STRONG", "I", "EM", "U", "S", "STRIKE", "BR", "DIV", "P",
    "SPAN", "UL", "OL", "LI", "MARK", "BLOCKQUOTE",
  ]);
  const ALLOWED_STYLE = new Set([
    "color", "background-color", "text-align", "font-weight", "font-style", "text-decoration",
  ]);

  function sanitizeHtml(html) {
    const tpl = document.createElement("template");
    tpl.innerHTML = String(html || "");
    const walk = (node) => {
      let child = node.firstChild;
      while (child) {
        const next = child.nextSibling;
        if (child.nodeType === 1) {
          if (!ALLOWED_TAGS.has(child.tagName)) {
            const frag = document.createDocumentFragment();
            while (child.firstChild) frag.appendChild(child.firstChild);
            child.replaceWith(frag);
            child = next;
            continue;
          }
          Array.from(child.attributes).forEach((attr) => {
            if (attr.name === "style") {
              const keep = child.style.cssText
                .split(";")
                .map((s) => s.trim())
                .filter(Boolean)
                .filter((decl) => ALLOWED_STYLE.has(decl.split(":")[0].trim().toLowerCase()));
              if (keep.length) child.setAttribute("style", keep.join("; "));
              else child.removeAttribute("style");
            } else {
              child.removeAttribute(attr.name);
            }
          });
          walk(child);
        } else if (child.nodeType === 8) {
          child.remove();
        }
        child = next;
      }
    };
    walk(tpl.content);
    return tpl.innerHTML;
  }

  function plainText(html) {
    const tpl = document.createElement("template");
    tpl.innerHTML = String(html || "");
    const root = tpl.content;
    root.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
    root.querySelectorAll("div, p, li, h1, h2, h3, section, blockquote").forEach((el) => el.append("\n"));
    return (root.textContent || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function firstLine(html, fallback) {
    const text = plainText(html);
    if (!text) return fallback || "";
    const line = text.split(/\n|\r/).map((s) => s.trim()).find(Boolean) || text;
    return line.length > 80 ? line.slice(0, 80) + "…" : line;
  }

  function titleOfNote(note) {
    return firstLine(note.html, "Без названия");
  }

  const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  const WEEKDAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];

  function parseDue(due) {
    if (!due) return null;
    const d = new Date(due);
    return isNaN(d.getTime()) ? null : d;
  }

  function dueInfo(due) {
    const d = parseDue(due);
    if (!d) return null;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const diff = Math.round((day - today) / 86400000);
    const hasTime = !(d.getHours() === 0 && d.getMinutes() === 0);
    const time = hasTime
      ? String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0")
      : "";
    let label;
    let cls = "";
    if (diff < 0) {
      label = diff === -1 ? "вчера" : d.getDate() + " " + MONTHS_SHORT[d.getMonth()];
      cls = "overdue";
    } else if (diff === 0) {
      label = "сегодня";
      cls = "soon";
    } else if (diff === 1) {
      label = "завтра";
      cls = "soon";
    } else if (diff < 7) {
      label = WEEKDAYS[d.getDay()] + ", " + d.getDate() + " " + MONTHS_SHORT[d.getMonth()];
    } else {
      label = d.getDate() + " " + MONTHS_SHORT[d.getMonth()];
      if (d.getFullYear() !== now.getFullYear()) label += " " + d.getFullYear();
    }
    return {
      label: time ? label + " · " + time : label,
      cls,
      date: d,
      diff,
      full: d.toLocaleString("ru-RU", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }),
    };
  }

  function toLocalInput(due) {
    const d = parseDue(due);
    if (!d) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function fmtDate(ts) {
    if (!ts) return "—";
    const d = new Date(ts);
    return d.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  function fmtBytes(n) {
    if (!n && n !== 0) return "";
    if (n < 1024) return n + " Б";
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " КБ";
    return (n / 1024 / 1024).toFixed(1) + " МБ";
  }

  function fmtClock(sec) {
    sec = Math.max(0, Math.round(sec));
    const m = Math.floor(sec / 60), s = sec % 60;
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }

  function tagsFrom(str) {
    return Array.from(
      new Set(
        String(str || "")
          .split(/[,;#]/)
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean)
          .slice(0, 12)
      )
    );
  }

  function hashHue(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
    return h;
  }

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
  }

  function toast(message, type) {
    const root = $("#toasts");
    if (!root) return;
    const el = document.createElement("div");
    el.className = "toast" + (type ? " " + type : "");
    el.innerHTML = '<span class="dot"></span><span></span>';
    el.lastElementChild.textContent = message;
    root.appendChild(el);
    setTimeout(() => {
      el.classList.add("out");
      setTimeout(() => el.remove(), 240);
    }, 2600);
  }

  function beep() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const play = (freq, start, dur, gain) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, ctx.currentTime + start);
        g.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + start + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
        osc.connect(g).connect(ctx.destination);
        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + start + dur + 0.02);
      };
      play(660, 0, 0.18, 0.12);
      play(880, 0.2, 0.22, 0.1);
      setTimeout(() => ctx.close(), 900);
    } catch (e) { /* sound is optional */ }
  }

  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  /** Patch helper keeps object shapes predictable. */
  function assign(target, patch) {
    Object.keys(patch || {}).forEach((k) => { target[k] = patch[k]; });
    return target;
  }

  TB.util = {
    $, $$, uid, clamp, debounce, escapeHtml, sanitizeHtml, plainText, firstLine,
    titleOfNote, dueInfo, toLocalInput, fmtDate, fmtBytes, fmtClock, tagsFrom,
    hashHue, isTypingTarget, toast, beep, downloadBlob, assign, parseDue,
    MONTHS_SHORT, WEEKDAYS,
  };

  TB.PALETTE = [
    { id: "lemon", name: "Лимон", bg: "#FFE68C", ink: "#3C2E12" },
    { id: "amber", name: "Янтарь", bg: "#FFCE87", ink: "#41290E" },
    { id: "rose", name: "Роза", bg: "#F9BCC7", ink: "#401E24" },
    { id: "coral", name: "Коралл", bg: "#FFB29E", ink: "#431E14" },
    { id: "mint", name: "Мята", bg: "#BFE9CA", ink: "#183B27" },
    { id: "sky", name: "Небо", bg: "#BBDFF4", ink: "#123140" },
    { id: "lilac", name: "Сирень", bg: "#D6CCF2", ink: "#2B2142" },
    { id: "paper", name: "Бумага", bg: "#FCF7EA", ink: "#33291D" },
    { id: "kraft", name: "Крафт", bg: "#E3CEA6", ink: "#3A2B16" },
    { id: "graphite", name: "Графит", bg: "#3B3731", ink: "#F5EBD6" },
  ];

  TB.paletteOf = function (id) {
    return TB.PALETTE.find((p) => p.id === id) || TB.PALETTE[0];
  };

  TB.BOARD_BGS = [
    { id: "cork", name: "Пробка" },
    { id: "linen", name: "Лён" },
    { id: "felt", name: "Фетр" },
    { id: "kraft", name: "Крафт" },
  ];

  TB.BOARD_COLORS = ["#B5432F", "#C49A57", "#6E9C83", "#4E7FA6", "#8A6FA8", "#C4718E", "#6B655C"];

  /* Четыре сферы жизни — контекст каждой записи */
  TB.SPHERES = [
    { id: "work", name: "Работа", short: "Работа", color: "#4E7FA6", soft: "#DCE8F2" },
    { id: "study", name: "Учёба", short: "Учёба", color: "#6E9C83", soft: "#DFEDE4" },
    { id: "projects", name: "Проекты", short: "Проекты", color: "#8A6FA8", soft: "#E8E1F4" },
    { id: "life", name: "Личное", short: "Личное", color: "#C4718E", soft: "#F6E1E8" },
  ];
  TB.sphereOf = function (id) {
    return TB.SPHERES.find((s) => s.id === id) || null;
  };

  TB.KINDS = [
    { id: "task", name: "Задача", icon: "i-check-square" },
    { id: "note", name: "Заметка", icon: "i-file" },
    { id: "idea", name: "Идея", icon: "i-flag" },
    { id: "event", name: "Встреча", icon: "i-calendar" },
    { id: "homework", name: "ДЗ", icon: "i-edit" },
    { id: "contest", name: "Конкурс", icon: "i-flag" },
    { id: "template", name: "Шаблон", icon: "i-copy" },
    { id: "link", name: "Ссылка", icon: "i-link" },
    { id: "journal", name: "Журнал", icon: "i-edit" },
    { id: "portfolio", name: "Портфолио", icon: "i-folder" },
    { id: "project", name: "Проект", icon: "i-board" },
    { id: "release", name: "Релиз", icon: "i-upload" },
    { id: "date", name: "Дата", icon: "i-calendar" },
  ];
  TB.kindOf = function (id) {
    return TB.KINDS.find((k) => k.id === id) || TB.KINDS[0];
  };

  TB.STATUSES = [
    { id: "inbox", name: "Входящие" },
    { id: "today", name: "Сегодня" },
    { id: "doing", name: "В работе" },
    { id: "done", name: "Сделано" },
  ];
  TB.statusOf = function (id) {
    return TB.STATUSES.find((s) => s.id === id) || TB.STATUSES[1];
  };

  TB.REPEATS = [
    { id: "none", name: "Нет" },
    { id: "daily", name: "Ежедневно" },
    { id: "weekdays", name: "По будням" },
    { id: "weekly", name: "Еженедельно" },
    { id: "monthly", name: "Ежемесячно" },
    { id: "yearly", name: "Ежегодно" },
  ];

  TB.REMINDERS = [
    { id: "0", name: "В момент срока", min: 0 },
    { id: "10", name: "За 10 минут", min: 10 },
    { id: "60", name: "За час", min: 60 },
    { id: "180", name: "За 3 часа", min: 180 },
    { id: "1440", name: "За день", min: 1440 },
    { id: "4320", name: "За 3 дня", min: 4320 },
  ];

  TB.CONTEST_STAGES = [
    { id: "watch", name: "Слежу" },
    { id: "prep", name: "Готовлюсь" },
    { id: "join", name: "Участвую" },
    { id: "result", name: "Результат" },
  ];
  TB.IDEA_STAGES = [
    { id: "new", name: "Новая" },
    { id: "research", name: "Изучаю" },
    { id: "roadmap", name: "В роадмапе" },
    { id: "rejected", name: "Отклонена" },
  ];
  TB.PROJECT_STAGES = [
    { id: "idea", name: "Идея" },
    { id: "dev", name: "В разработке" },
    { id: "beta", name: "Бета" },
    { id: "release", name: "Релиз" },
    { id: "paused", name: "Пауза" },
  ];
  TB.ROADMAP_COLUMNS = [
    { id: "now", name: "Сейчас" },
    { id: "next", name: "Дальше" },
    { id: "later", name: "Потом" },
    { id: "done", name: "Готово" },
  ];
})();
