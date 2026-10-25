/* Пробка — боковая панель и панель деталей */
(function () {
  "use strict";

  const TB = window.TB;
  const U = TB.util;
  const $ = U.$;
  const $$ = U.$$;

  const details = $("#details");
  let detailsOpen = false;
  let detailsId = null;
  let contentDirty = false;
  let suppress = false;

  const panels = {
    init() {
      bindDetails();
      bindAdvancedDetails();
      bindSidebar();
      this.renderSidebar();
    },

    renderSidebar() {
      if (!TB.model.doc) return;
      const list = $("#boardList");
      list.innerHTML = "";
      const current = TB.model.ui.boardId;
      TB.model.boards().forEach((b) => {
        const count = TB.model.notes(b.id).length;
        const btn = document.createElement("button");
        btn.className = "board-item" + (b.id === current ? " active" : "");
        btn.style.setProperty("--bcol", b.color || "#B5432F");
        btn.title = "Открыть доску «" + b.name + "»\nДвойной клик — настройки";
        const dot = document.createElement("span");
        dot.className = "board-dot";
        const name = document.createElement("span");
        name.className = "board-name";
        name.textContent = b.name;
        const cnt = document.createElement("span");
        cnt.className = "board-count";
        cnt.textContent = count || "";
        btn.append(dot, name, cnt);
        btn.addEventListener("click", () => {
          if (b.id !== TB.model.ui.boardId) TB.model.setBoard(b.id);
          closeSidebar();
        });
        btn.addEventListener("dblclick", (e) => {
          e.preventDefault();
          TB.overlays.boardModal(b.id);
        });
        list.appendChild(btn);
      });

      const cloud = $("#tagCloud");
      cloud.innerHTML = "";
      const tags = TB.model.tags();
      if (!tags.length) {
        const empty = document.createElement("span");
        empty.className = "tag-empty";
        empty.textContent = "Добавьте теги в карточке заметки";
        cloud.appendChild(empty);
      } else {
        tags.forEach((t) => {
          const chip = document.createElement("button");
          chip.className = "tag-chip" + (TB.model.ui.filterTag === t.name ? " active" : "");
          chip.textContent = "#" + t.name;
          chip.title = t.count + " заметок";
          chip.addEventListener("click", () => {
            TB.model.ui.filterTag = TB.model.ui.filterTag === t.name ? null : t.name;
            TB.board.render();
            renderSidebar();
          });
          cloud.appendChild(chip);
        });
      }
      $("#clearTag").hidden = !TB.model.ui.filterTag;
      $("#agendaBadge").hidden = true;
      this.updateFocusTarget();
      const storage = $("#storageInfo");
      if (storage && !TB.sync) storage.textContent = TB.store.mode === "idb" ? "Локально · IndexedDB" : "Локально · localStorage";
      if (TB.sync) TB.sync.paintChrome();
      if (TB.refreshChrome) TB.refreshChrome();
      this.updateThreadCount();
    },

    updateFocusTarget() {
      const el = $("#focusTarget");
      if (!el) return;
      const n = TB.model.selectedNote();
      el.textContent = n ? U.titleOfNote(n) : "без задачи";
      el.title = n ? U.titleOfNote(n) : "Выберите заметку, чтобы привязать фокус";
    },

    updateThreadCount() {
      const sub = $("#boardSub");
      if (!sub) return;
      const notes = TB.model.notes().length;
      const threads = TB.model.threads().length;
      sub.textContent = plural(notes, "заметка", "заметки", "заметок") + " · " + plural(threads, "нить", "нити", "нитей");
    },

    /* ------------------------- selection & details ------------------------- */

    onSelectionChanged() {
      this.updateFocusTarget();
      if (detailsOpen) {
        const n = TB.model.selectedNote();
        if (!n) this.closeDetails();
        else if (detailsId !== n.id && TB.model.ui.view !== "board") this.openDetails(n.id);
      }
    },

    onNoteChanged(n, opts) {
      if (!n) return;
      this.updateFocusTarget();
      if (!detailsOpen || detailsId !== n.id) return;
      if (!(opts && opts.keepContent)) {
        // content is intentionally not overwritten to protect the caret
      }
      this.refreshChecklist(n);
      this.refreshFiles(n);
      this.refreshMeta(n);
      this.refreshDone(n);
      this.refreshDue(n);
      this.refreshAdvanced(n);
    },

    onDocRestored() {
      if (detailsOpen) {
        const n = TB.model.selectedNote();
        if (!n) this.closeDetails();
        else this.openDetails(n.id, true);
      }
      this.renderSidebar();
    },

    isDetailsOpen() { return detailsOpen; },

    openDetails(id, force, sourceEl) {
      const n = TB.model.note(id);
      if (!n) return;
      const wasOpen = detailsOpen;
      const previousId = detailsId;
      if (!force && wasOpen && detailsId === id) {
        details.classList.add("open");
        return;
      }
      const source = sourceEl || findBoardNote(id);
      detailsId = id;
      detailsOpen = true;
      details.classList.add("open");
      details.setAttribute("aria-hidden", "false");
      if (TB.model.ui.selectedId !== id) TB.model.ui.selectedId = id;
      fillDetails(n);
      if (TB.board) TB.board.select(id);
      this.updateFocusTarget();
      if (!wasOpen || previousId !== id) animateDetailsFrom(source);
    },

    closeDetails() {
      detailsOpen = false;
      detailsId = null;
      details.classList.remove("open");
      details.setAttribute("aria-hidden", "true");
    },

    highlightThread(id) {
      if (TB.model.ui.selectedThread !== id) TB.model.ui.selectedThread = id;
    },

    openThread(id) {
      const t = TB.model.doc.threads.find((x) => x.id === id);
      if (!t) return;
      TB.model.ui.selectedThread = id;
      const colors = ["#B5432F", "#8A6631", "#6E9C83", "#4E7FA6", "#8A6FA8", "#C4718E", "#3A3128"];
      const body = document.createElement("div");
      body.className = "board-form";
      body.innerHTML =
        "<label>Цвет нити</label><div class='swatches' data-colors></div>" +
        "<label>Толщина <span data-width-label></span></label><input type='range' min='1' max='6' step='0.5' data-width>" +
        "<div class='grid-2'><label>Стиль<select data-style><option value='solid'>Сплошная</option><option value='dashed'>Пунктир</option><option value='dotted'>Точки</option></select></label>" +
        "<label>Подпись<input type='text' data-label placeholder='например: зависит от'></label></div>" +
        "<label style='display:flex;gap:8px;align-items:center;font-size:12px;color:var(--ink)'><input type='checkbox' data-arrow style='width:auto'> Стрелка на конце</label>";

      const swatches = body.querySelector("[data-colors]");
      let color = t.color;
      colors.forEach((c) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "swatch" + (c === color ? " active" : "");
        b.style.background = c;
        b.addEventListener("click", () => {
          color = c;
          $$(".swatch", swatches).forEach((x) => x.classList.toggle("active", x === b));
        });
        swatches.appendChild(b);
      });
      const width = body.querySelector("[data-width]");
      const widthLabel = body.querySelector("[data-width-label]");
      width.value = t.width;
      widthLabel.textContent = t.width + " px";
      width.addEventListener("input", () => { widthLabel.textContent = width.value + " px"; });
      const style = body.querySelector("[data-style]");
      style.value = t.style || "solid";
      const label = body.querySelector("[data-label]");
      label.value = t.label || "";
      const arrow = body.querySelector("[data-arrow]");
      arrow.checked = !!t.arrow;

      const m = TB.overlays.showModal({
        title: "Нить",
        sub: "Связь между двумя заметками",
        body,
        footer: [
          { label: "Удалить", kind: "danger", onClick: () => {
            const ok = TB.overlays.confirm({ title: "Удалить нить?", text: "Связь исчезнет, заметки останутся.", ok: "Удалить" });
            ok.then((yes) => {
              if (!yes) return;
              TB.model.deleteThread(id);
              m.close();
              TB.overlays.toast("Нить удалена");
            });
          } },
          { label: "Отмена", onClick: () => m.close() },
          { label: "Сохранить", kind: "primary", onClick: () => {
            TB.model.updateThread(id, {
              color, width: Number(width.value), style: style.value,
              label: label.value.trim(), arrow: arrow.checked,
            });
            m.close();
            TB.overlays.toast("Нить обновлена");
          } },
        ],
      });
    },
  };

  function plural(n, one, few, many) {
    const mod10 = n % 10, mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return n + " " + one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return n + " " + few;
    return n + " " + many;
  }

  /* ------------------------------ details ------------------------------ */

  function bindDetails() {
    $("#detailsClose").addEventListener("click", () => panels.closeDetails());

    const dContent = $("#dContent");
    dContent.addEventListener("focus", () => { contentDirty = false; });
    dContent.addEventListener("paste", (e) => {
      const html = e.clipboardData && e.clipboardData.getData("text/html");
      if (!html) return;
      e.preventDefault();
      const clean = U.sanitizeHtml(html);
      try { document.execCommand("insertHTML", false, clean); } catch (err) { /* older browsers */ }
    });
    dContent.addEventListener("input", () => {
      const n = TB.model.note(detailsId);
      if (!n || suppress) return;
      if (!contentDirty) {
        TB.model.snapshot();
        contentDirty = true;
      }
      n.html = dContent.innerHTML;
      n.updated = Date.now();
      TB.model.saveSoon();
      TB.board.syncNote(n.id);
      if (TB.refreshChrome) TB.refreshChrome();
    });
    dContent.addEventListener("blur", () => {
      const n = TB.model.note(detailsId);
      if (!n) return;
      const clean = U.sanitizeHtml(dContent.innerHTML);
      if (clean !== dContent.innerHTML) {
        const pos = null;
        dContent.innerHTML = clean;
      }
      if (n.html !== clean) {
        n.html = clean;
        n.updated = Date.now();
        TB.model.saveSoon();
        TB.board.syncNote(n.id);
      }
    });

    $$("#dFmt [data-fmt]").forEach((btn) => {
      btn.addEventListener("pointerdown", (e) => e.preventDefault());
      btn.addEventListener("click", () => {
        const cmd = btn.dataset.fmt;
        dContent.focus();
        if (cmd === "hilite") {
          document.execCommand("hiliteColor", false, "#FFE28A");
        } else if (cmd === "clear") {
          document.execCommand("removeFormat", false, null);
        } else {
          document.execCommand(cmd, false, null);
        }
        dContent.dispatchEvent(new Event("input", { bubbles: true }));
      });
    });

    $("#dDue").addEventListener("change", (e) => {
      const n = TB.model.note(detailsId);
      if (!n) return;
      TB.model.snapshot();
      n.due = e.target.value || null;
      n.updated = Date.now();
      TB.model.saveSoon();
      TB.board.syncNote(n.id);
      panels.refreshDue(n);
      panels.renderSidebar();
      if (TB.refreshChrome) TB.refreshChrome();
    });
    $("#dDueClear").addEventListener("click", () => {
      const n = TB.model.note(detailsId);
      if (!n) return;
      TB.model.snapshot();
      n.due = null;
      n.updated = Date.now();
      TB.model.saveSoon();
      $("#dDue").value = "";
      TB.board.syncNote(n.id);
      panels.refreshDue(n);
      panels.renderSidebar();
    });

    $("#dPriority").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-p]");
      if (!btn) return;
      const n = TB.model.note(detailsId);
      if (!n) return;
      TB.model.snapshot();
      n.priority = Number(btn.dataset.p);
      n.updated = Date.now();
      TB.model.saveSoon();
      TB.board.syncNote(n.id);
      setPriority(n.priority);
    });

    const tagsInput = $("#dTags");
    const applyTags = () => {
      const n = TB.model.note(detailsId);
      if (!n) return;
      const tags = U.tagsFrom(tagsInput.value);
      if (JSON.stringify(tags) === JSON.stringify(n.tags)) return;
      TB.model.snapshot();
      n.tags = tags;
      n.updated = Date.now();
      TB.model.saveSoon();
      tagsInput.value = tags.join(", ");
      TB.board.syncNote(n.id);
      panels.renderSidebar();
      renderTagSuggest(n);
    };
    tagsInput.addEventListener("change", applyTags);
    tagsInput.addEventListener("blur", applyTags);
    tagsInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); tagsInput.blur(); }
    });

    $("#dNewItem").addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const n = TB.model.note(detailsId);
      if (!n) return;
      const text = e.target.value.trim();
      if (!text) return;
      TB.model.snapshot();
      n.checklist.push({ id: U.uid("c"), text, done: false });
      n.updated = Date.now();
      e.target.value = "";
      TB.model.saveSoon();
      TB.board.syncNote(n.id);
      panels.refreshChecklist(n);
    });

    $("#dChecklist").addEventListener("click", (e) => {
      const row = e.target.closest(".check-row");
      if (!row) return;
      const n = TB.model.note(detailsId);
      if (!n) return;
      const idx = Number(row.dataset.idx);
      const item = n.checklist[idx];
      if (!item) return;
      if (e.target.closest(".check-box")) {
        TB.model.snapshot();
        item.done = !item.done;
        n.updated = Date.now();
        TB.model.saveSoon();
        panels.refreshChecklist(n);
        TB.board.syncNote(n.id);
      } else if (e.target.closest(".check-del")) {
        TB.model.snapshot();
        n.checklist.splice(idx, 1);
        n.updated = Date.now();
        TB.model.saveSoon();
        panels.refreshChecklist(n);
        TB.board.syncNote(n.id);
      }
    });
    $("#dChecklist").addEventListener("focusout", (e) => {
      const txt = e.target.closest(".check-txt");
      if (!txt) return;
      const n = TB.model.note(detailsId);
      if (!n) return;
      const idx = Number(txt.closest(".check-row").dataset.idx);
      const item = n.checklist[idx];
      if (!item) return;
      const val = txt.textContent.trim();
      if (!val) {
        TB.model.snapshot();
        n.checklist.splice(idx, 1);
      } else {
        if (val === item.text) return;
        TB.model.snapshot();
        item.text = val;
      }
      n.updated = Date.now();
      TB.model.saveSoon();
      panels.refreshChecklist(n);
      TB.board.syncNote(n.id);
    });

    $("#dAddFile").addEventListener("click", () => $("#dFileInput").click());
    $("#dFileInput").addEventListener("change", async (e) => {
      const files = Array.from(e.target.files || []);
      e.target.value = "";
      if (!files.length) return;
      const n = TB.model.note(detailsId);
      if (!n) return;
      let added = 0;
      TB.model.snapshot();
      for (const file of files) {
        if (file.size > 25 * 1024 * 1024) {
          U.toast("«" + file.name + "» больше 25 МБ — пропущено", "warn");
          continue;
        }
        try {
          const fileId = U.uid("f");
          await TB.store.putFile({
            id: fileId, name: file.name, type: file.type || "application/octet-stream",
            size: file.size, blob: file, at: Date.now(),
          });
          n.attachments.push({
            id: U.uid("a"), fileId, name: file.name,
            size: file.size, type: file.type || "application/octet-stream",
          });
          added += 1;
        } catch (err) {
          U.toast("Не удалось сохранить файл: " + (err.message || "ошибка"), "error");
        }
      }
      if (added) {
        n.updated = Date.now();
        TB.model.saveSoon();
        TB.board.syncNote(n.id);
        panels.refreshFiles(n);
        U.toast(added === 1 ? "Файл прикреплён" : "Файлов прикреплено: " + added);
      }
    });

    $("#dFiles").addEventListener("click", async (e) => {
      const del = e.target.closest(".file-del");
      const n = TB.model.note(detailsId);
      if (!n) return;
      if (del) {
        const row = del.closest(".file-row");
        const idx = Number(row.dataset.idx);
        const att = n.attachments[idx];
        if (!att) return;
        TB.model.snapshot();
        n.attachments.splice(idx, 1);
        n.updated = Date.now();
        TB.store.deleteFile(att.fileId);
        TB.model.saveSoon();
        panels.refreshFiles(n);
        TB.board.syncNote(n.id);
        return;
      }
      const link = e.target.closest("[data-file]");
      if (link) {
        e.preventDefault();
        const att = n.attachments.find((a) => a.id === link.dataset.file);
        if (!att) return;
        const rec = await TB.store.getFile(att.fileId);
        if (!rec || !rec.blob) {
          U.toast("Файл не найден в хранилище", "error");
          return;
        }
        U.downloadBlob(att.name || rec.name || "file", rec.blob);
      }
    });

    $("#dPalette").addEventListener("click", (e) => {
      const sw = e.target.closest("[data-color]");
      if (!sw) return;
      const n = TB.model.note(detailsId);
      if (!n) return;
      TB.model.snapshot();
      n.color = sw.dataset.color;
      n.updated = Date.now();
      TB.model.saveSoon();
      TB.board.syncNote(n.id);
      renderPalette(n);
    });

    $("#dFont").addEventListener("change", (e) => {
      const n = TB.model.note(detailsId);
      if (!n) return;
      TB.model.snapshot();
      n.font = e.target.value;
      n.updated = Date.now();
      TB.model.saveSoon();
      TB.board.syncNote(n.id);
    });
    $("#dPin").addEventListener("change", (e) => {
      const n = TB.model.note(detailsId);
      if (!n) return;
      TB.model.snapshot();
      n.pin = e.target.value;
      TB.model.saveSoon();
      TB.board.syncNote(n.id);
    });
    $("#dShadow").addEventListener("change", (e) => {
      const n = TB.model.note(detailsId);
      if (!n) return;
      TB.model.snapshot();
      n.shadow = e.target.value;
      TB.model.saveSoon();
      TB.board.syncNote(n.id);
    });

    $("#dSize").addEventListener("pointerdown", () => TB.model.snapshot());
    $("#dSize").addEventListener("input", (e) => {
      const n = TB.model.note(detailsId);
      if (!n) return;
      n.fontSize = U.clamp(Number(e.target.value), 11, 34);
      n.updated = Date.now();
      TB.model.saveSoon();
      TB.board.syncNote(n.id);
    });
    $("#dRot").addEventListener("pointerdown", () => TB.model.snapshot());
    $("#dRot").addEventListener("input", (e) => {
      const n = TB.model.note(detailsId);
      if (!n) return;
      n.rot = Number(e.target.value);
      n.updated = Date.now();
      TB.board.renderThreads();
      const el = TB.board.els.get(n.id);
      if (el) el.style.transform = "translate3d(" + n.x + "px," + n.y + "px,0) rotate(" + n.rot + "deg)";
      TB.model.saveSoon();
    });

    $("#dBoard").addEventListener("change", (e) => {
      if (!detailsId) return;
      TB.model.moveNoteToBoard(detailsId, e.target.value);
    });

    $("#dDone").addEventListener("click", () => {
      const n = TB.model.note(detailsId);
      if (!n) return;
      TB.model.toggleDone(n.id);
      panels.refreshDone(TB.model.note(n.id));
    });
    $("#dDup").addEventListener("click", () => {
      const n = TB.model.note(detailsId);
      if (!n) return;
      const copy = TB.model.duplicateNote(n.id);
      if (copy) panels.openDetails(copy.id, true);
    });
    $("#dArchiveNote").addEventListener("click", () => {
      const n = TB.model.note(detailsId);
      if (!n) return;
      TB.model.archiveNote(n.id, true);
      U.toast("Заметка в архиве");
    });
    $("#dDelete").addEventListener("click", () => {
      const n = TB.model.note(detailsId);
      if (!n) return;
      TB.overlays.confirm({
        title: "Удалить заметку?",
        text: "«" + U.titleOfNote(n) + "» и все её нити исчезнут. Действие можно отменить через Ctrl+Z.",
        ok: "Удалить",
      }).then((yes) => {
        if (!yes) return;
        TB.model.deleteNote(n.id);
        U.toast("Заметка удалена — Ctrl+Z вернёт");
      });
    });
  }

  function findBoardNote(id) {
    if (!id || TB.model.ui.view !== "board") return null;
    const notes = document.querySelectorAll("#notes .note[data-id]");
    for (let i = 0; i < notes.length; i += 1) {
      if (notes[i].dataset.id === id) return notes[i];
    }
    return null;
  }

  function animateDetailsFrom(source) {
    if (!source || !details.animate) return;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const from = source.getBoundingClientRect();
    const to = details.getBoundingClientRect();
    if (!from.width || !from.height || !to.width || !to.height) return;
    if (from.bottom < 0 || from.top > window.innerHeight) return;
    const sx = U.clamp(from.width / to.width, 0.14, 0.7);
    const sy = U.clamp(from.height / to.height, 0.14, 0.7);
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    details.getAnimations().forEach((a) => a.cancel());
    details.classList.add("arriving");
    const anim = details.animate(
      [
        { transformOrigin: "top left", transform: "translate(" + dx + "px," + dy + "px) scale(" + sx + "," + sy + ")", opacity: 0.35, filter: "brightness(0.92)" },
        { transformOrigin: "top left", transform: "translate(0,0) scale(1,1)", opacity: 1, filter: "brightness(1)" },
      ],
      { duration: 420, easing: "cubic-bezier(0.2, 0.9, 0.2, 1)" }
    );
    const finish = () => details.classList.remove("arriving");
    anim.addEventListener("finish", finish, { once: true });
    setTimeout(finish, 650);
  }

  function fillDetails(n) {
    suppress = true;
    const dContent = $("#dContent");
    if (document.activeElement !== dContent) dContent.innerHTML = U.sanitizeHtml(n.html || "");
    $("#dDue").value = U.toLocalInput(n.due);
    setPriority(n.priority || 0);
    $("#dTags").value = (n.tags || []).join(", ");
    renderTagSuggest(n);
    renderChecklist(n);
    renderFiles(n);
    renderPalette(n);
    $("#dFont").value = n.font || "hand";
    $("#dSize").value = n.fontSize || 16;
    $("#dRot").value = n.rot || 0;
    $("#dPin").value = n.pin || "tape";
    $("#dShadow").value = n.shadow || "soft";
    const boardSelect = $("#dBoard");
    boardSelect.innerHTML = "";
    TB.model.boards().forEach((b) => {
      const opt = document.createElement("option");
      opt.value = b.id;
      opt.textContent = b.name;
      boardSelect.appendChild(opt);
    });
    boardSelect.value = n.boardId;
    fillAdvanced(n);
    refreshDone(n);
    refreshMeta(n);
    $("#dCheckCount").textContent = (n.checklist || []).length ? n.checklist.filter((c) => c.done).length + "/" + n.checklist.length : "";
    $("#dFileCount").textContent = (n.attachments || []).length || "";
    suppress = false;
    dContent.scrollTop = 0;
  }

  function refreshDue(n) {
    $("#dDue").value = U.toLocalInput(n.due);
  }

  function refreshDone(n) {
    const btn = $("#dDone");
    if (!btn) return;
    btn.classList.toggle("primary-done", !!(n && n.done));
    btn.innerHTML = n && n.done
      ? '<svg class="ic"><use href="#i-check-square"/></svg> Готово'
      : '<svg class="ic"><use href="#i-check"/></svg> Отметить готово';
  }

  function refreshMeta(n) {
    const el = $("#dMeta");
    if (!el) return;
    const board = TB.model.boards().find((b) => b.id === n.boardId);
    el.innerHTML = "";
    el.append(
      document.createTextNode("Доска: " + (board ? board.name : "—") + " · "),
      document.createTextNode("создано " + U.fmtDate(n.created)),
      document.createElement("br"),
      document.createTextNode("изменено " + U.fmtDate(n.updated) + " · " + Math.round(n.w) + "×" + Math.round(n.h) + " px")
    );
  }

  function setPriority(p) {
    $$("#dPriority [data-p]").forEach((b) => b.classList.toggle("active", Number(b.dataset.p) === Number(p)));
  }

  function renderTagSuggest(n) {
    const box = $("#dTagSuggest");
    if (!box) return;
    box.innerHTML = "";
    TB.model.allTagsFlat()
      .filter((t) => !(n.tags || []).includes(t))
      .slice(0, 6)
      .forEach((t) => {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = "+ #" + t;
        b.addEventListener("click", () => {
          const input = $("#dTags");
          const tags = U.tagsFrom(input.value + ", " + t);
          input.value = tags.join(", ");
          input.dispatchEvent(new Event("change", { bubbles: true }));
          renderTagSuggest(TB.model.note(detailsId));
        });
        box.appendChild(b);
      });
  }

  function renderChecklist(n) {
    const list = $("#dChecklist");
    if (!list) return;
    list.innerHTML = "";
    (n.checklist || []).forEach((item, idx) => {
      const row = document.createElement("div");
      row.className = "check-row" + (item.done ? " done" : "");
      row.dataset.idx = idx;
      row.innerHTML =
        '<button class="check-box box" type="button" aria-label="Отметить"></button>' +
        '<span class="txt check-txt" contenteditable="true" spellcheck="false"></span>' +
        '<button class="check-del del" type="button" aria-label="Удалить">×</button>';
      row.querySelector(".check-txt").textContent = item.text;
      list.appendChild(row);
    });
    $("#dCheckCount").textContent = (n.checklist || []).length ? n.checklist.filter((c) => c.done).length + "/" + n.checklist.length : "";
  }

  function renderFiles(n) {
    const list = $("#dFiles");
    if (!list) return;
    list.innerHTML = "";
    (n.attachments || []).forEach((att, idx) => {
      const row = document.createElement("div");
      row.className = "file-row";
      row.dataset.idx = idx;
      row.innerHTML =
        '<svg class="ic"><use href="#i-file"/></svg>' +
        '<a href="#" data-file="' + U.escapeHtml(att.id) + '"></a>' +
        '<span class="size">' + U.fmtBytes(att.size) + '</span>' +
        '<button class="file-del del" type="button" aria-label="Удалить файл">×</button>';
      row.querySelector("a").textContent = att.name;
      list.appendChild(row);
    });
    $("#dFileCount").textContent = (n.attachments || []).length || "";
  }

  function renderPalette(n) {
    const box = $("#dPalette");
    if (!box) return;
    box.innerHTML = "";
    TB.PALETTE.forEach((p) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "swatch" + (p.id === n.color ? " active" : "");
      b.style.background = p.bg;
      b.dataset.color = p.id;
      b.title = p.name;
      box.appendChild(b);
    });
  }

  /* ------------------------- расширенная карточка ------------------------- */

  function stageOptions(kind) {
    if (kind === "contest") return TB.CONTEST_STAGES;
    if (kind === "idea") return TB.IDEA_STAGES;
    if (kind === "project") return TB.PROJECT_STAGES;
    return null;
  }

  function fillAdvanced(n) {
    suppress = true;
    const sphereBox = $("#dSphere");
    if (sphereBox) {
      $$("[data-sphere]", sphereBox).forEach((b) => {
        b.classList.toggle("active", b.dataset.sphere === n.sphere);
      });
    }

    const kind = $("#dKind");
    if (kind) {
      kind.innerHTML = TB.KINDS.map((k) => '<option value="' + k.id + '">' + U.escapeHtml(k.name) + "</option>").join("");
      kind.value = n.kind || "task";
    }
    const status = $("#dStatus");
    if (status) {
      status.innerHTML = TB.STATUSES.map((s) => '<option value="' + s.id + '">' + U.escapeHtml(s.name) + "</option>").join("");
      status.value = n.status || (n.done ? "done" : "today");
    }

    const reminder = $("#dReminder");
    if (reminder) {
      reminder.innerHTML = '<option value="">нет</option>' +
        TB.REMINDERS.map((r) => '<option value="' + r.id + '">' + U.escapeHtml(r.name) + "</option>").join("");
      reminder.value = n.reminder == null || n.reminder === "" ? "" : String(n.reminder);
    }
    const repeat = $("#dRepeat");
    if (repeat) {
      repeat.innerHTML = TB.REPEATS.map((r) => '<option value="' + r.id + '">' + U.escapeHtml(r.name) + "</option>").join("");
      repeat.value = n.repeat || "none";
    }

    const est = $("#dEstimate");
    if (est) {
      $$("[data-est]", est).forEach((b) => {
        b.classList.toggle("active", Number(b.dataset.est) === Number(n.estimate || 0));
      });
    }

    const proj = $("#dProject");
    if (proj) {
      proj.innerHTML = '<option value="">без проекта</option>' +
        TB.model.projects().filter((p) => p.id !== n.id).map((p) =>
          '<option value="' + U.escapeHtml(p.id) + '">' + U.escapeHtml(U.titleOfNote(p)) + "</option>").join("");
      proj.value = n.projectId || "";
    }
    $("#dSubject").value = n.subject || "";
    $("#dUrl").value = n.url || "";

    const stages = stageOptions(n.kind);
    const wrap = $("#dStageWrap");
    if (wrap) {
      wrap.hidden = !stages;
      if (stages) {
        const sel = $("#dStage");
        sel.innerHTML = stages.map((s) => '<option value="' + s.id + '">' + U.escapeHtml(s.name) + "</option>").join("");
        sel.value = (n.meta || {}).stage || stages[0].id;
        $("#dStageLabel").textContent = n.kind === "project" ? "Стадия проекта" : n.kind === "idea" ? "Стадия идеи" : "Этап конкурса";
      }
    }

    const eventWrap = $("#dEventWrap");
    if (eventWrap) {
      const showEvent = n.kind === "event" || n.kind === "date";
      eventWrap.hidden = !showEvent;
      if (showEvent) $("#dEventDate").value = (n.meta || {}).eventDate || U.toLocalInput(n.due);
    }
    const moodWrap = $("#dMoodWrap");
    if (moodWrap) {
      moodWrap.hidden = n.kind !== "journal";
      if (n.kind === "journal") $("#dMood").value = (n.meta || {}).mood || "";
    }

    $$("#dFlags [data-flag]").forEach((b) => {
      b.classList.toggle("active", !!n[b.dataset.flag]);
    });
    suppress = false;
  }

  function refreshAdvanced(n) {
    if (!n) return;
    fillAdvanced(n);
    refreshDue(n);
    refreshDone(n);
    refreshMeta(n);
  }

  function current() {
    return TB.model.note(detailsId);
  }

  function patchNote(patch, metaPatch) {
    const n = current();
    if (!n) return null;
    if (metaPatch) {
      patch.meta = Object.assign({}, n.meta || {}, metaPatch);
    }
    TB.model.updateNote(n.id, patch);
    if (TB.board && TB.board.syncNote) TB.board.syncNote(n.id);
    panels.renderSidebar();
    return n;
  }

  function bindAdvancedDetails() {
    $("#dSphere").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-sphere]");
      if (!btn || !current()) return;
      TB.model.assignSphere(current().id, btn.dataset.sphere);
      fillAdvanced(current());
    });

    $("#dKind").addEventListener("change", (e) => {
      const n = current();
      if (!n) return;
      const kind = e.target.value;
      const stages = stageOptions(kind);
      const meta = Object.assign({}, n.meta || {});
      if (stages) meta.stage = meta.stage && stages.some((s) => s.id === meta.stage) ? meta.stage : stages[0].id;
      TB.model.updateNote(n.id, { kind, meta });
      fillAdvanced(n);
    });

    $("#dStatus").addEventListener("change", (e) => {
      const n = current();
      if (!n) return;
      TB.model.setStatus(n.id, e.target.value);
      refreshAdvanced(n);
    });

    $("#dReminder").addEventListener("change", (e) => {
      patchNote({ reminder: e.target.value === "" ? null : Number(e.target.value) });
    });
    $("#dRepeat").addEventListener("change", (e) => {
      patchNote({ repeat: e.target.value });
    });
    $("#dEstimate").addEventListener("click", (e) => {
      const b = e.target.closest("[data-est]");
      if (!b) return;
      patchNote({ estimate: Number(b.dataset.est) });
      fillAdvanced(current());
    });
    $("#dProject").addEventListener("change", (e) => {
      patchNote({ projectId: e.target.value || null });
    });
    $("#dSubject").addEventListener("change", (e) => {
      patchNote({ subject: e.target.value.trim() });
    });
    $("#dUrl").addEventListener("change", (e) => {
      let value = e.target.value.trim();
      if (value && !/^https?:\/\//i.test(value)) value = "https://" + value;
      e.target.value = value;
      patchNote({ url: value });
    });
    $("#dOpenUrl").addEventListener("click", () => {
      const value = $("#dUrl").value.trim();
      if (!value) {
        U.toast("Ссылки пока нет", "warn");
        return;
      }
      window.open(/^https?:\/\//i.test(value) ? value : "https://" + value, "_blank", "noopener");
    });

    $("#dStage").addEventListener("change", (e) => {
      patchNote({}, { stage: e.target.value });
    });
    $("#dEventDate").addEventListener("change", (e) => {
      const value = e.target.value || "";
      const patch = { meta: Object.assign({}, current().meta || {}, { eventDate: value }) };
      if (current().kind === "date") patch.due = value || null;
      TB.model.updateNote(current().id, patch);
    });
    $("#dEventClear").addEventListener("click", () => {
      const n = current();
      if (!n) return;
      const meta = Object.assign({}, n.meta || {});
      delete meta.eventDate;
      TB.model.updateNote(n.id, { meta, due: n.kind === "date" ? null : n.due });
      $("#dEventDate").value = "";
    });
    $("#dMood").addEventListener("change", (e) => {
      patchNote({}, { mood: e.target.value.trim() });
    });

    $("#dFlags").addEventListener("click", (e) => {
      const b = e.target.closest("[data-flag]");
      const n = current();
      if (!b || !n) return;
      const flag = b.dataset.flag;
      const next = !n[flag];
      if (flag === "top3" && next && TB.model.top3Items().filter((x) => x.id !== n.id).length >= 3) {
        U.toast("В тройке уже три дела. Снимите одну звезду.", "warn");
        return;
      }
      TB.model.updateNote(n.id, { [flag]: next });
      fillAdvanced(n);
    });
  }

  /* ------------------------------ sidebar ------------------------------ */

  function bindSidebar() {
    $("#btnNewBoard").addEventListener("click", () => TB.overlays.boardModal());
    $("#clearTag").addEventListener("click", () => {
      TB.model.ui.filterTag = null;
      TB.board.render();
      panels.renderSidebar();
    });
    $("#btnAgenda").addEventListener("click", () => TB.tools.openAgenda());
    $("#btnArchive").addEventListener("click", () => TB.tools.openArchive());
    $("#btnSidebar").addEventListener("click", openSidebar);
    $("#btnSidebarClose").addEventListener("click", closeSidebar);
    $("#btnSidebar").addEventListener("click", () => {
      if (window.innerWidth <= 860) openSidebar();
    });

    stageClickClose();
  }

  function stageClickClose() {
    const stage = $("#stage");
    if (!stage) return;
    stage.addEventListener("pointerdown", () => {
      if (window.innerWidth <= 860) closeSidebar();
    }, true);
  }

  function openSidebar() {
    $("#sidebar").classList.add("open");
  }
  function closeSidebar() {
    $("#sidebar").classList.remove("open");
  }

  // expose detail helpers used from board/model
  panels.refreshChecklist = renderChecklist;
  panels.refreshFiles = renderFiles;
  panels.refreshMeta = refreshMeta;
  panels.refreshDone = refreshDone;
  panels.refreshDue = refreshDue;
  panels.refreshAdvanced = refreshAdvanced;
  panels.fillDetails = fillDetails;

  TB.panels = panels;
})();
