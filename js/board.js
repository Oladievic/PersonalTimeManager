/* Пробка — доска: рендер, нити, жесты, редактирование */
(function () {
  "use strict";

  const TB = window.TB;
  const U = TB.util;
  const $ = U.$;
  const $$ = U.$$;

  const stage = $("#stage");
  const frame = $("#boardFrame");
  const world = $("#world");
  const notesLayer = $("#notes");
  const svg = $("#threads");
  const tray = $("#toolTray");
  const hint = $("#boardHint");

  const els = new Map();
  let currentBoardId = null;
  let view = { x: 60, y: 40, z: 1 };
  let drag = null;
  let pan = null;
  let spaceHeld = false;
  let pinch = null;
  const stagePointers = new Map();
  let editingId = null;
  let committing = false;
  let linkDrag = null;
  let tempPath = null;
  

  const board = {
    els,

    init() {
      currentBoardId = TB.model.ui.boardId;
      const b = TB.model.board();
      view = b.view ? Object.assign({}, b.view) : defaultView();
      bindStage();
      bindTray();
      bindThreadLayer();
      if (!b.view) {
        // first run — fit after layout settles
        requestAnimationFrame(() => fit());
      }
      applyView();
      hideHintIfSeen();
    },

    render(opts) {
      if (editingId && !(opts && opts.keepEditing)) commitEditor();
      currentBoardId = TB.model.ui.boardId;
      const b = TB.model.board();
      frame.className = "board-frame bg-" + (b.bg || "cork");
      notesLayer.innerHTML = "";
      els.clear();

      const all = TB.model.notes();
      const filter = TB.model.ui.filterTag;
      const visible = filter ? all.filter((n) => (n.tags || []).includes(filter)) : all;
      visible.sort((a, b2) => (a.z || 0) - (b2.z || 0));
      visible.forEach((n) => {
        const el = buildNote(n);
        notesLayer.appendChild(el);
        els.set(n.id, el);
      });

      renderThreads();
      updateSelectionClasses();
      updateTray();
      updateHint();
      applyView();
      if (TB.refreshChrome) TB.refreshChrome();
    },

    syncNote(id) {
      const n = TB.model.note(id);
      const el = els.get(id);
      if (n && el) syncNoteEl(el, n);
    },

    select(id) {
      if (id && !TB.model.note(id)) id = null;
      TB.model.ui.selectedId = id;
      if (id) TB.model.ui.selectedThread = null;
      updateSelectionClasses();
      updateTray();
      if (TB.panels) TB.panels.onSelectionChanged();
    },

    deselect() {
      this.select(null);
    },

    openEditor(id) {
      const n = TB.model.note(id);
      const el = els.get(id);
      if (!n || !el || n.archived) return;
      this.select(id);
      if (editingId === id) return;
      if (editingId) commitEditor();
      const body = el.querySelector("[data-body]");
      if (!body) return;
      body.innerHTML = U.sanitizeHtml(n.html || "");
      editingId = id;
      TB.model.ui.editing = id;
      body.contentEditable = "true";
      body.spellcheck = false;
      el.classList.add("editing");
      body.focus();
      try {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(body);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      } catch (e) { /* caret is a nicety */ }
      body.addEventListener("blur", () => commitEditor());
      body.addEventListener("paste", (e) => {
        const html = e.clipboardData && e.clipboardData.getData("text/html");
        if (!html) return;
        e.preventDefault();
        try { document.execCommand("insertHTML", false, U.sanitizeHtml(html)); } catch (err) { /* ignore */ }
      });
      body.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          body.blur();
        } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          body.blur();
        }
        e.stopPropagation();
      });
      updateTray();
    },

    /* view helpers */
    fit,
    focusNote(id, opts) {
      const n = TB.model.note(id);
      if (!n) return;
      const r = frame.getBoundingClientRect();
      const z = (opts && opts.zoom) || Math.max(view.z, 0.85);
      view.z = U.clamp(z, 0.25, 2.5);
      view.x = r.width / 2 - (n.x + n.w / 2) * view.z;
      view.y = r.height / 2 - (n.y + n.h / 2) * view.z;
      applyView();
      saveView();
      TB.board.select(id);
      const el = els.get(id);
      if (el) {
        el.classList.add("just-added");
        setTimeout(() => el.classList.remove("just-added"), 600);
      }
    },
    zoomBy(factor) {
      const r = frame.getBoundingClientRect();
      zoomAt(r.width / 2, r.height / 2, factor);
    },
    resetZoom() {
      const r = frame.getBoundingClientRect();
      const wx = (r.width / 2 - view.x) / view.z;
      const wy = (r.height / 2 - view.y) / view.z;
      view.z = 1;
      view.x = r.width / 2 - wx;
      view.y = r.height / 2 - wy;
      applyView();
      saveView();
    },
    addNoteAt(clientX, clientY) {
      const p = screenToWorld(clientX, clientY);
      const n = TB.model.addNote({ x: Math.round(p.x - 100), y: Math.round(p.y - 70), html: "" });
      if (TB.refresh) TB.refresh("board");
      requestAnimationFrame(() => board.openEditor(n.id));
      return n;
    },
    onBoardChanged() {
      if (currentBoardId) saveView();
      currentBoardId = TB.model.ui.boardId;
      const b = TB.model.board();
      view = b.view ? Object.assign({}, b.view) : defaultView();
      if (TB.refresh) TB.refresh("board");
      if (!b.view) requestAnimationFrame(() => fit());
      hideHintIfSeen();
    },
    onDocRestored() {
      editingId = null;
      TB.model.ui.editing = null;
      if (TB.refresh) TB.refresh("board");
      const b = TB.model.board();
      if (b.view) {
        view = Object.assign({}, b.view);
        applyView();
      }
    },
  };

  /* ------------------------------ build note ------------------------------ */

  function buildNote(n) {
    const el = document.createElement("div");
    el.className = "note";
    el.dataset.id = n.id;
    el.tabIndex = 0;
    el.setAttribute("role", "button");
    el.innerHTML =
      '<div class="note-paper">' +
        '<div class="note-tape"></div>' +
        '<div class="note-pin"></div>' +
        '<div class="note-body" data-body></div>' +
        '<div class="note-checks" data-checks></div>' +
        '<div class="note-meta" data-meta></div>' +
        '<div class="note-expand" aria-hidden="true"><svg class="ic"><use href="#i-fit"/></svg></div>' +
        '<div class="note-stamp">готово</div>' +
      '</div>' +
      '<div class="note-handle handle-rotate" data-rotate title="Повернуть"><svg class="ic"><use href="#i-rotate"/></svg></div>' +
      '<div class="note-handle handle-resize" data-resize title="Изменить размер"></div>' +
      '<div class="note-handle link-dot" data-link title="Протянуть нить"></div>';

    syncNoteEl(el, n);

    const paper = el.querySelector(".note-paper");
    const body = el.querySelector("[data-body]");

    paper.addEventListener("pointerdown", (e) => onNoteDown(e, n, el));
    paper.addEventListener("click", (e) => {
      if (!TB.model.ui.linking) return;
      if (n.id === TB.model.ui.linking) {
        clearLinkMode();
        return;
      }
      const made = TB.model.addThread(TB.model.ui.linking, n.id);
      clearLinkMode();
      if (made) U.toast("Нить протянута");
    });
    body.addEventListener("pointerdown", (e) => {
      if (editingId === n.id) e.stopPropagation();
    });
    el.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (e.target.closest("[data-body], [data-checks]")) return;
      e.preventDefault();
      if (TB.panels) TB.panels.openDetails(n.id, false, el);
    });

    const resize = el.querySelector("[data-resize]");
    resize.addEventListener("pointerdown", (e) => onResizeDown(e, n, el));
    const rotate = el.querySelector("[data-rotate]");
    rotate.addEventListener("pointerdown", (e) => onRotateDown(e, n, el));
    const link = el.querySelector("[data-link]");
    link.addEventListener("pointerdown", (e) => onLinkDown(e, n, el));

    el.querySelectorAll("[data-checks] .note-check").forEach((item, idx) => {
      item.addEventListener("pointerdown", (e) => e.stopPropagation());
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        const t = n.checklist[idx];
        if (!t) return;
        TB.model.snapshot();
        t.done = !t.done;
        TB.model.changed("board");
      });
    });

    return el;
  }

  function noteSummary(n) {
    const text = U.noteText(n).replace(/\u00a0/g, " ").trim();
    const lines = text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    let title = lines.shift() || U.titleOfNote(n) || "Без названия";
    let excerpt = lines.join(" ");
    if (!excerpt && n.subject) excerpt = n.subject;
    if (title.length > 92) title = title.slice(0, 90).replace(/\s+\S*$/, "") + "…";
    if (excerpt.length > 210) excerpt = excerpt.slice(0, 208).replace(/\s+\S*$/, "") + "…";
    return { title, excerpt };
  }

  function noteSummaryHtml(n) {
    const parts = noteSummary(n);
    const box = document.createElement("div");
    box.className = "note-summary";
    const title = document.createElement("div");
    title.className = "note-title";
    title.textContent = parts.title;
    box.appendChild(title);
    if (parts.excerpt) {
      const excerpt = document.createElement("div");
      excerpt.className = "note-excerpt";
      excerpt.textContent = parts.excerpt;
      box.appendChild(excerpt);
    }
    return box.outerHTML;
  }

  function syncNoteEl(el, n) {
    el.style.transform = "translate3d(" + n.x + "px," + n.y + "px,0) rotate(" + (n.rot || 0) + "deg)";
    el.style.width = n.w + "px";
    el.style.height = n.h + "px";
    el.style.setProperty("--z", n.z || 1);
    el.dataset.pin = n.pin || "tape";
    el.dataset.shadow = n.shadow || "soft";
    el.dataset.priority = String(n.priority || 0);
    el.dataset.font = n.font || "hand";
    const pal = TB.paletteOf(n.color);
    el.style.setProperty("--note-bg", pal.bg);
    el.style.setProperty("--note-ink", pal.ink);
    el.style.setProperty("--note-size", (n.fontSize || 16) + "px");
    el.classList.toggle("done", !!n.done);
    el.classList.toggle("bold", !!n.bold);
    el.classList.toggle("italic", !!n.italic);
    el.classList.toggle("selected", TB.model.ui.selectedId === n.id);
    el.classList.toggle("link-source", TB.model.ui.linking === n.id);
    const summary = noteSummary(n);
    el.setAttribute("aria-label", summary.title + ". Открыть подробности");
    el.title = summary.title;

    const body = el.querySelector("[data-body]");
    if (body && editingId !== n.id) body.innerHTML = noteSummaryHtml(n);
    renderChecks(el, n);
    renderMeta(el, n);
  }

  function renderChecks(el, n) {
    const box = el.querySelector("[data-checks]");
    if (!box) return;
    const items = n.checklist || [];
    box.innerHTML = "";
    if (!items.length) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    const shown = items.slice(0, 5);
    shown.forEach((item, idx) => {
      const row = document.createElement("div");
      row.className = "note-check" + (item.done ? " done" : "");
      row.innerHTML = '<span class="box"></span><span></span>';
      row.lastElementChild.textContent = item.text;
      row.title = item.text;
      row.addEventListener("pointerdown", (e) => e.stopPropagation());
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        const t = n.checklist[idx];
        if (!t) return;
        TB.model.snapshot();
        t.done = !t.done;
        TB.model.changed("board");
      });
      box.appendChild(row);
    });
    if (items.length > shown.length) {
      const more = document.createElement("div");
      more.className = "note-check";
      more.style.opacity = "0.55";
      more.textContent = "+ ещё " + (items.length - shown.length);
      box.appendChild(more);
    }
  }

  function renderMeta(el, n) {
    const meta = el.querySelector("[data-meta]");
    if (!meta) return;
    meta.innerHTML = "";
    const due = U.dueInfo(n.due);
    if (due) {
      const chip = document.createElement("span");
      chip.className = "chip due " + due.cls + (n.done ? " done" : "");
      chip.textContent = due.label;
      chip.title = "Срок: " + due.full;
      meta.appendChild(chip);
    }
    const checklist = n.checklist || [];
    if (checklist.length) {
      const done = checklist.filter((c) => c.done).length;
      const chip = document.createElement("span");
      chip.className = "chip progress";
      chip.textContent = "✓ " + done + "/" + checklist.length;
      meta.appendChild(chip);
    }
    (n.tags || []).slice(0, 2).forEach((tag) => {
      const chip = document.createElement("span");
      chip.className = "chip tag";
      chip.textContent = "#" + tag;
      meta.appendChild(chip);
    });
    if ((n.tags || []).length > 2) {
      const chip = document.createElement("span");
      chip.className = "chip tag";
      chip.textContent = "+" + (n.tags.length - 2);
      meta.appendChild(chip);
    }
    if ((n.attachments || []).length) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.innerHTML = '<svg class="ic"><use href="#i-clip"/></svg>';
      chip.appendChild(document.createTextNode(String(n.attachments.length)));
      chip.title = "Файлы: " + n.attachments.length;
      meta.appendChild(chip);
    }
    meta.hidden = meta.children.length === 0;
  }

  function updateSelectionClasses() {
    const id = TB.model.ui.selectedId;
    els.forEach((el, nid) => {
      el.classList.toggle("selected", nid === id);
    });
    if (TB.panels) TB.panels.highlightThread(TB.model.ui.selectedThread);
  }

  /* ------------------------------ threads ------------------------------ */

  function renderThreads() {
    const sel = TB.model.ui.selectedThread;
    const visibleIds = new Set(Array.from(els.keys()));
    const threads = TB.model.threads().filter((t) => visibleIds.has(t.from) && visibleIds.has(t.to));
    svg.innerHTML = "";
    threads.forEach((t) => {
      const a = TB.model.note(t.from);
      const b = TB.model.note(t.to);
      if (!a || !b) return;
      const ca = center(a), cb = center(b);
      const p1 = anchor(a, cb.x, cb.y);
      const p2 = anchor(b, ca.x, ca.y);
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const sag = U.clamp(dist * 0.12, 8, 44);
      const c = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 + sag };

      const hit = document.createElementNS("http://www.w3.org/2000/svg", "path");
      hit.setAttribute("d", curve(p1, c, p2));
      hit.setAttribute("class", "thread-hit" + (sel === t.id ? " selected" : ""));
      hit.dataset.thread = t.id;

      const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
      line.setAttribute("d", curve(p1, c, p2));
      line.setAttribute("class", "thread-line");
      line.setAttribute("stroke", t.color || "#B5432F");
      line.setAttribute("stroke-width", String(t.width || 2));
      if (t.style === "dashed") line.setAttribute("stroke-dasharray", "7 5");
      if (t.style === "dotted") line.setAttribute("stroke-dasharray", "1.5 5");
      if (sel === t.id) line.setAttribute("stroke-width", String((t.width || 2) + 1.2));

      svg.appendChild(hit);
      svg.appendChild(line);

      if (t.arrow) {
        const ang = Math.atan2(p2.y - c.y, p2.x - c.x);
        const L = 10, W = 4.6;
        const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
        poly.setAttribute("points", [
          p2.x + "," + p2.y,
          (p2.x - L * Math.cos(ang) - W * Math.sin(ang)) + "," + (p2.y - L * Math.sin(ang) + W * Math.cos(ang)),
          (p2.x - L * Math.cos(ang) + W * Math.sin(ang)) + "," + (p2.y - L * Math.sin(ang) - W * Math.cos(ang)),
        ].join(" "));
        poly.setAttribute("fill", t.color || "#B5432F");
        poly.setAttribute("opacity", "0.95");
        svg.appendChild(poly);
      }

      if (t.label) {
        const mid = quadPoint(p1, c, p2, 0.5);
        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", mid.x);
        text.setAttribute("y", mid.y - 4);
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("class", "thread-label-text");
        text.textContent = t.label;
        svg.appendChild(text);
      }
    });
    if (TB.panels) TB.panels.updateThreadCount();
  }

  function curve(p1, c, p2) {
    return "M " + p1.x + " " + p1.y + " Q " + c.x + " " + c.y + " " + p2.x + " " + p2.y;
  }
  function quadPoint(p1, c, p2, t) {
    const mt = 1 - t;
    return {
      x: mt * mt * p1.x + 2 * mt * t * c.x + t * t * p2.x,
      y: mt * mt * p1.y + 2 * mt * t * c.y + t * t * p2.y,
    };
  }
  function center(n) {
    return { x: n.x + n.w / 2, y: n.y + n.h / 2 };
  }
  function anchor(note, tx, ty) {
    const cx = note.x + note.w / 2;
    const cy = note.y + note.h / 2;
    const rot = ((note.rot || 0) * Math.PI) / 180;
    const dx = tx - cx, dy = ty - cy;
    const cs = Math.cos(-rot), sn = Math.sin(-rot);
    const lx = dx * cs - dy * sn;
    const ly = dx * sn + dy * cs;
    const hw = note.w / 2 + 1, hh = note.h / 2 + 1;
    const t = Math.min(hw / (Math.abs(lx) || 1e-4), hh / (Math.abs(ly) || 1e-4));
    const px = lx * t, py = ly * t;
    const c2 = Math.cos(rot), s2 = Math.sin(rot);
    return { x: cx + px * c2 - py * s2, y: cy + px * s2 + py * c2 };
  }

  function bindThreadLayer() {
    svg.addEventListener("click", (e) => {
      const hit = e.target.closest("[data-thread]");
      if (!hit) return;
      const id = hit.dataset.thread;
      TB.model.ui.selectedThread = id;
      TB.model.ui.selectedId = null;
      updateSelectionClasses();
      updateTray();
      TB.board.render();
      if (TB.panels) TB.panels.openThread(id);
    });
  }

  /* ------------------------------ transforms ------------------------------ */

  function applyView() {
    world.style.transform = "translate(" + view.x + "px," + view.y + "px) scale(" + view.z + ")";
    const label = document.getElementById("zoomLabel");
    if (label) label.textContent = Math.round(view.z * 100) + "%";
  }

  function saveView() {
    const b = TB.model.board(currentBoardId);
    if (b) b.view = { x: Math.round(view.x), y: Math.round(view.y), z: Math.round(view.z * 1000) / 1000 };
  }

  function defaultView() {
    return { x: 60, y: 40, z: 0.95 };
  }

  function screenToWorld(clientX, clientY) {
    const r = frame.getBoundingClientRect();
    return {
      x: (clientX - r.left - view.x) / view.z,
      y: (clientY - r.top - view.y) / view.z,
    };
  }

  function zoomAt(mx, my, factor) {
    const z = U.clamp(view.z * factor, 0.25, 2.5);
    if (z === view.z) return;
    const wx = (mx - view.x) / view.z;
    const wy = (my - view.y) / view.z;
    view.z = z;
    view.x = mx - wx * view.z;
    view.y = my - wy * view.z;
    applyView();
    saveView();
  }

  function fit() {
    const visible = TB.model.notes();
    const r = frame.getBoundingClientRect();
    if (!r.width) return;
    if (!visible.length) {
      view = { x: Math.max(40, r.width / 2 - 170), y: Math.max(30, r.height / 2 - 150), z: 0.95 };
      applyView();
      saveView();
      return;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    visible.forEach((n) => {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.w);
      maxY = Math.max(maxY, n.y + n.h);
    });
    const pad = 90;
    const bw = Math.max(maxX - minX, 320);
    const bh = Math.max(maxY - minY, 240);
    const z = U.clamp(Math.min((r.width - pad) / bw, (r.height - pad) / bh), 0.25, 1.15);
    view.z = z;
    view.x = (r.width - bw * z) / 2 - minX * z;
    view.y = (r.height - bh * z) / 2 - minY * z;
    applyView();
    saveView();
  }

  /* ------------------------------ gestures ------------------------------ */

  function bindStage() {
    stage.addEventListener("pointerdown", (e) => {
      if (TB.model.ui.view !== "board") return;
      if (!spaceHeld && (e.target.closest(".note") || e.target.closest("[data-thread]"))) return;
      if (e.button !== undefined && e.button !== 0 && e.pointerType === "mouse") return;
      if (editingId) commitEditor();
      if (TB.model.ui.linking) clearLinkMode();
      stagePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (stagePointers.size === 1) {
        pan = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
        try { stage.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      } else if (stagePointers.size === 2) {
        pan = null;
        pinch = beginPinch();
      }
      hideHint();
      e.preventDefault();
    });

    stage.addEventListener("pointermove", (e) => {
      if (!stagePointers.has(e.pointerId)) return;
      stagePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && stagePointers.size >= 2) {
        updatePinch();
        return;
      }
      if (!pan) return;
      const dx = e.clientX - pan.sx;
      const dy = e.clientY - pan.sy;
      if (!pan.moved && Math.hypot(dx, dy) > 3) pan.moved = true;
      if (!pan.moved) return;
      view.x = pan.vx + dx;
      view.y = pan.vy + dy;
      applyView();
    });

    const endPointer = (e) => {
      stagePointers.delete(e.pointerId);
      if (pinch) {
        if (stagePointers.size < 2) {
          pinch = null;
          saveView();
        }
      }
      if (pan) {
        if (pan.moved) saveView();
        pan = null;
      }
    };
    stage.addEventListener("pointerup", endPointer);
    stage.addEventListener("pointercancel", endPointer);
    stage.addEventListener("pointerleave", (e) => {
      if (e.pointerType === "mouse" && pan) {
        pan = null;
        stagePointers.clear();
      }
    });

    stage.addEventListener("wheel", (e) => {
      if (TB.model.ui.view !== "board") return;
      if (e.target.closest(".modal, .details, .menu-pop, .search-overlay, .tool-tray, .dock")) return;
      e.preventDefault();
      const r = frame.getBoundingClientRect();
      if (e.shiftKey) {
        view.x -= e.deltaY;
        applyView();
        saveView();
        return;
      }
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      const factor = Math.exp(-e.deltaY * 0.0016);
      zoomAt(mx, my, factor);
    }, { passive: false });

    stage.addEventListener("dblclick", (e) => {
      if (TB.model.ui.view !== "board") return;
      if (e.target.closest(".note") || e.target.closest("[data-thread]")) return;
      if (e.target.closest(".tool-tray, .details, .dock, .board-hint")) return;
      board.addNoteAt(e.clientX, e.clientY);
    });

    stage.addEventListener("click", (e) => {
      if (TB.model.ui.view !== "board") return;
      if (e.target.closest(".note") || e.target.closest("[data-thread]")) return;
      if (e.target.closest(".tool-tray, .details, .dock, .board-hint")) return;
      if (!pan || !pan.moved) {
        TB.model.ui.selectedThread = null;
        TB.board.select(null);
      }
    });

    window.addEventListener("resize", U.debounce(() => {
      if (!TB.model.board().view) fit();
      applyView();
    }, 200));
  }

  function beginPinch() {
    const pts = Array.from(stagePointers.values()).slice(0, 2);
    const r = frame.getBoundingClientRect();
    const mid = { x: (pts[0].x + pts[1].x) / 2 - r.left, y: (pts[0].y + pts[1].y) / 2 - r.top };
    return {
      dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1,
      z: view.z,
      wx: (mid.x - view.x) / view.z,
      wy: (mid.y - view.y) / view.z,
    };
  }

  function updatePinch() {
    if (!pinch) return;
    const pts = Array.from(stagePointers.values()).slice(0, 2);
    if (pts.length < 2) return;
    const r = frame.getBoundingClientRect();
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
    const mid = { x: (pts[0].x + pts[1].x) / 2 - r.left, y: (pts[0].y + pts[1].y) / 2 - r.top };
    view.z = U.clamp(pinch.z * (dist / pinch.dist), 0.25, 2.5);
    view.x = mid.x - pinch.wx * view.z;
    view.y = mid.y - pinch.wy * view.z;
    applyView();
  }

  function onNoteDown(e, n, el) {
    if (spaceHeld) return;
    if (e.button !== undefined && e.button !== 0 && e.pointerType === "mouse") return;
    if (editingId === n.id) return;
    if (TB.model.ui.linking) return;
    if (e.target.closest("[data-checks]")) return;
    if (e.target.closest("[data-link], [data-resize], [data-rotate]")) return;

    board.select(n.id);
    TB.model.bringToFront(n.id);
    const wasEditing = editingId;
    if (wasEditing) commitEditor();

    const p = screenToWorld(e.clientX, e.clientY);
    drag = {
      type: "move", id: n.id, el,
      startX: n.x, startY: n.y,
      px: p.x, py: p.y,
      moved: false, snapped: false,
      pointerId: e.pointerId,
      target: e.target,
    };
    el.classList.add("dragging");
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", onDragEnd, { once: true });
    window.addEventListener("pointercancel", onDragEnd, { once: true });
    e.preventDefault();
    hideHint();
  }

  function onDragMove(e) {
    if (!drag) return;
    const n = TB.model.note(drag.id);
    if (!n) return;
    if (drag.type === "move") {
      const p = screenToWorld(e.clientX, e.clientY);
      const dx = p.x - drag.px;
      const dy = p.y - drag.py;
      if (!drag.moved && Math.hypot(dx, dy) * view.z < 3) return;
      if (!drag.moved) {
        drag.moved = true;
        TB.model.snapshot();
      }
      let x = drag.startX + dx;
      let y = drag.startY + dy;
      if (TB.model.doc.settings.snap) {
        x = Math.round(x / 8) * 8;
        y = Math.round(y / 8) * 8;
      }
      x = Math.round(Math.max(-n.w + 60, Math.min(x, 9000)));
      y = Math.round(Math.max(-20, Math.min(y, 9000)));
      n.x = x;
      n.y = y;
      drag.el.style.transform = "translate3d(" + x + "px," + y + "px,0) rotate(" + (n.rot || 0) + "deg)";
      renderThreads();
    } else if (drag.type === "resize") {
      const p = screenToWorld(e.clientX, e.clientY);
      const dx = p.x - drag.px;
      const dy = p.y - drag.py;
      if (!drag.moved && Math.hypot(dx, dy) * view.z < 2) return;
      if (!drag.moved) {
        drag.moved = true;
        TB.model.snapshot();
      }
      n.w = Math.round(U.clamp(drag.w + dx, 120, 1200));
      n.h = Math.round(U.clamp(drag.h + dy, 90, 1000));
      drag.el.style.width = n.w + "px";
      drag.el.style.height = n.h + "px";
      renderThreads();
    } else if (drag.type === "rotate") {
      const p = screenToWorld(e.clientX, e.clientY);
      const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
      let ang = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI - drag.angleOffset;
      if (TB.model.doc.settings.snap) {
        const snapTo = Math.round(ang / 5) * 5;
        if (Math.abs(ang - snapTo) < 1.4) ang = snapTo;
      }
      ang = U.clamp(ang, -20, 20);
      if (Math.abs(ang) < 0.8) ang = 0;
      n.rot = Math.round(ang * 10) / 10;
      if (!drag.moved) {
        drag.moved = true;
        TB.model.snapshot();
      }
      drag.el.style.transform = "translate3d(" + n.x + "px," + n.y + "px,0) rotate(" + n.rot + "deg)";
      const slider = document.getElementById("dRot");
      if (slider && TB.panels && TB.panels.isDetailsOpen()) slider.value = n.rot;
      renderThreads();
    }
  }

  function onDragEnd(e) {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.el) d.el.classList.remove("dragging");
    window.removeEventListener("pointermove", onDragMove);
    const n = TB.model.note(d.id);
    if (n) {
      n.updated = Date.now();
      if (d.moved) {
        TB.model.touch();
        if (TB.panels) TB.panels.onNoteChanged(n, { meta: true });
      } else if (d.type === "move" && (!e || e.type === "pointerup") && TB.model.ui.view === "board") {
        if (TB.panels) TB.panels.openDetails(d.id, false, d.el);
      }
    }
    if (TB.refreshChrome) TB.refreshChrome();
  }

  function onResizeDown(e, n, el) {
    e.stopPropagation();
    e.preventDefault();
    board.select(n.id);
    TB.model.bringToFront(n.id);
    const p = screenToWorld(e.clientX, e.clientY);
    drag = { type: "resize", id: n.id, el, px: p.x, py: p.y, w: n.w, h: n.h, moved: false };
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", onDragEnd, { once: true });
    window.addEventListener("pointercancel", onDragEnd, { once: true });
  }

  function onRotateDown(e, n, el) {
    e.stopPropagation();
    e.preventDefault();
    board.select(n.id);
    TB.model.bringToFront(n.id);
    const p = screenToWorld(e.clientX, e.clientY);
    const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
    const angle = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI;
    drag = { type: "rotate", id: n.id, el, angleOffset: angle - (n.rot || 0), moved: false };
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", onDragEnd, { once: true });
    window.addEventListener("pointercancel", onDragEnd, { once: true });
  }

  /* ------------------------------ linking ------------------------------ */

  function onLinkDown(e, n, el) {
    e.stopPropagation();
    e.preventDefault();
    if (TB.model.ui.linking) {
      clearLinkMode();
      return;
    }
    board.select(n.id);
    const p = screenToWorld(e.clientX, e.clientY);
    linkDrag = { id: n.id, from: n, startCX: e.clientX, startCY: e.clientY, moved: false, target: null };
    tempPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    tempPath.setAttribute("class", "thread-temp");
    svg.appendChild(tempPath);
    window.addEventListener("pointermove", onLinkMove);
    window.addEventListener("pointerup", onLinkUp, { once: true });
  }

  function onLinkMove(e) {
    if (!linkDrag) return;
    if (!linkDrag.moved && Math.hypot(e.clientX - linkDrag.startCX, e.clientY - linkDrag.startCY) > 4) {
      linkDrag.moved = true;
      TB.model.ui.linking = linkDrag.id;
      updateSelectionClasses();
    }
    if (!linkDrag.moved) return;
    const p = screenToWorld(e.clientX, e.clientY);
    const c = center(linkDrag.from);
    const p1 = anchor(linkDrag.from, p.x, p.y);
    const dist = Math.hypot(p.x - p1.x, p.y - p1.y);
    const sag = U.clamp(dist * 0.1, 4, 30);
    tempPath.setAttribute("d", "M " + p1.x + " " + p1.y + " Q " + ((p1.x + p.x) / 2) + " " + ((p1.y + p.y) / 2 + sag) + " " + p.x + " " + p.y);
    const over = document.elementFromPoint(e.clientX, e.clientY);
    const noteEl = over && over.closest(".note");
    els.forEach((el) => el.classList.remove("link-target"));
    linkDrag.target = null;
    if (noteEl && noteEl.dataset.id !== linkDrag.id) {
      noteEl.classList.add("link-target");
      linkDrag.target = noteEl.dataset.id;
    }
  }

  function onLinkUp(e) {
    window.removeEventListener("pointermove", onLinkMove);
    if (!linkDrag) return;
    const d = linkDrag;
    linkDrag = null;
    if (tempPath) {
      tempPath.remove();
      tempPath = null;
    }
    els.forEach((el) => el.classList.remove("link-target"));
    const over = document.elementFromPoint(e.clientX, e.clientY);
    const noteEl = over && over.closest(".note");
    const target = noteEl ? noteEl.dataset.id : d.target;
    if (d.moved && target && target !== d.id) {
      const made = TB.model.addThread(d.id, target);
      clearLinkMode();
      if (made) U.toast("Нить протянута");
      return;
    }
    if (!d.moved) {
      // click on the dot → wait for the second note
      TB.model.ui.linking = d.id;
      updateSelectionClasses();
      U.toast("Теперь нажмите на вторую заметку");
      return;
    }
    clearLinkMode();
  }

  function clearLinkMode() {
    TB.model.ui.linking = null;
    els.forEach((el) => el.classList.remove("link-source", "link-target"));
    updateSelectionClasses();
    updateTray();
  }

  /* ------------------------------ tray ------------------------------ */

  function bindTray() {
    tray.querySelector("[data-note-act]")?.addEventListener("pointerdown", (e) => e.preventDefault());
    tray.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".tray-btn")) e.preventDefault();
    });
    tray.addEventListener("click", (e) => {
      const colorBtn = e.target.closest(".tray-color");
      if (colorBtn) {
        const n = TB.model.selectedNote();
        if (!n) return;
        TB.model.updateNote(n.id, { color: colorBtn.dataset.color });
        return;
      }
      const btn = e.target.closest("[data-note-act]");
      if (!btn) return;
      const n = TB.model.selectedNote();
      if (!n) return;
      const act = btn.dataset.noteAct;
      if (act === "fontMinus" || act === "fontPlus") {
        const delta = act === "fontPlus" ? 1 : -1;
        TB.model.updateNote(n.id, { fontSize: U.clamp((n.fontSize || 16) + delta, 11, 34) });
      } else if (act === "bold") {
        TB.model.updateNote(n.id, { bold: !n.bold });
      } else if (act === "italic") {
        TB.model.updateNote(n.id, { italic: !n.italic });
      } else if (act === "link") {
        TB.model.ui.linking = n.id;
        updateSelectionClasses();
        U.toast("Теперь нажмите на вторую заметку");
      } else if (act === "details") {
        if (TB.panels) TB.panels.openDetails(n.id);
      } else if (act === "duplicate") {
        TB.model.duplicateNote(n.id);
        U.toast("Копия создана");
      } else if (act === "delete") {
        TB.model.deleteNote(n.id);
        U.toast("Заметка удалена — Ctrl+Z вернёт");
      }
    });
    renderTrayColors();
  }

  function renderTrayColors() {
    const box = $("#trayColors");
    if (!box) return;
    box.innerHTML = "";
    ["lemon", "amber", "rose", "sky", "mint", "lilac"].forEach((id) => {
      const pal = TB.paletteOf(id);
      const b = document.createElement("button");
      b.className = "tray-color";
      b.dataset.color = id;
      b.style.background = pal.bg;
      b.title = pal.name;
      box.appendChild(b);
    });
  }

  function updateTray() {
    const n = TB.model.selectedNote();
    if (!n || n.archived || editingId) {
      tray.hidden = true;
      return;
    }
    tray.hidden = false;
    $$(".tray-color", tray).forEach((b) => b.classList.toggle("active", b.dataset.color === n.color));
    const boldBtn = tray.querySelector('[data-note-act="bold"]');
    const italicBtn = tray.querySelector('[data-note-act="italic"]');
    if (boldBtn) boldBtn.classList.toggle("active", !!n.bold);
    if (italicBtn) italicBtn.classList.toggle("active", !!n.italic);
  }

  /* ------------------------------ editor commit ------------------------------ */

  function commitEditor() {
    if (!editingId || committing) return;
    const id = editingId;
    const el = els.get(id);
    editingId = null;
    TB.model.ui.editing = null;
    if (el) {
      el.classList.remove("editing");
      const body = el.querySelector("[data-body]");
      if (body) body.contentEditable = "false";
    }
    const n = TB.model.note(id);
    if (!n || !el) {
      updateTray();
      return;
    }
    const body = el.querySelector("[data-body]");
    if (!body) return;
    const raw = body.innerHTML;
    if (raw !== n.html) {
      committing = true;
      TB.model.snapshot();
      n.html = U.sanitizeHtml(raw);
      n.updated = Date.now();
      body.innerHTML = n.html;
      TB.model.saveSoon();
      if (TB.panels) TB.panels.onNoteChanged(n, { content: true });
      committing = false;
    }
    syncNoteEl(el, n);
    updateTray();
  }

  /* ------------------------------ hint ------------------------------ */

  function updateHint() {
    const count = TB.model.notes().length;
    if (hint) {
      if (!count) {
        hint.innerHTML = "Клик по бумажке — подробности. Двойной клик по доске — новая заметка. Или кнопка «Заметка» справа.";
      } else {
        hint.innerHTML = 'Клик по бумажке — подробности. Двойной клик по доске — новая заметка. Тяни за точку <span class="hint-dot"></span> на наклейке, чтобы протянуть нить.';
      }
    }
  }

  function hideHintIfSeen() {
    try {
      if (localStorage.getItem("probka.hintSeen")) hint && hint.classList.add("hide");
    } catch (e) { /* ignore */ }
    setTimeout(() => hint && hint.classList.add("hide"), 14000);
  }

  function hideHint() {
    if (!hint) return;
    hint.classList.add("hide");
    try { localStorage.setItem("probka.hintSeen", "1"); } catch (e) { /* ignore */ }
  }

  TB.board = board;
  TB.board.setSpacePan = function (on) {
    spaceHeld = !!on;
    if (frame) frame.classList.toggle("space-pan", spaceHeld);
  };
  TB.board.renderThreads = renderThreads;
  TB.board.commitEditor = commitEditor;
  TB.board.zoomAt = zoomAt;
  TB.board.applyView = applyView;
  TB.board.screenToWorld = screenToWorld;
  TB.board.enterLinkMode = function (id) {
    TB.model.ui.linking = id;
    updateSelectionClasses();
    updateTray();
  };
})();
