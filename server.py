#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Пробка — локальный сервер.

Одновременно:
  1) раздаёт PWA (index.html, js, css, шрифты);
  2) REST-синхронизация с приложением (/api/doc);
  3) MCP-сервер для ChatGPT / Claude и других клиентов (/mcp/<token>).

Запуск:
    python server.py
    python server.py --port 8765 --host 0.0.0.0
    python server.py --stdio          # для Claude Desktop (stdio MCP)

Зависимостей нет — только стандартная библиотека Python 3.10+.
Данные: ./data/doc.json, токен: ./data/config.json, резервные копии: ./data/backups.
"""
from __future__ import annotations

import argparse
import copy
import datetime as dt
import hmac
import html
import json
import os
import re
import secrets
import socket
import sys
import threading
import time
import traceback
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent
MCP_PROTOCOL = "2025-06-18"
SUPPORTED_PROTOCOLS = {"2024-11-05", "2025-03-26", "2025-06-18"}
SERVER_NAME = "probka"
SERVER_VERSION = "1.0.0"

KINDS = [
    "task", "note", "idea", "event", "homework", "contest", "template",
    "link", "journal", "portfolio", "project", "release", "date",
]
SPHERES = ["work", "study", "projects", "life"]
STATUSES = ["inbox", "today", "doing", "done"]
REPEATS = ["none", "daily", "weekdays", "weekly", "monthly", "yearly"]
STAGES = ["idea", "design", "build", "test", "release"]

SPHERE_NAMES = {
    "work": "Работа",
    "study": "Учёба",
    "projects": "Проекты",
    "life": "Личное",
}


# ---------------------------------------------------------------------------
# утилиты
# ---------------------------------------------------------------------------

def now_ms() -> int:
    return int(time.time() * 1000)


def uid(prefix: str) -> str:
    alphabet = "0123456789abcdefghijklmnopqrstuvwxyz"
    n = now_ms()
    out = ""
    while n:
        out = alphabet[n % 36] + out
        n //= 36
    return f"{prefix}_{out}_{secrets.token_hex(4)}"


def esc(value) -> str:
    return html.escape(str(value if value is not None else ""), quote=False)


def clip(value, low, high):
    try:
        return max(low, min(high, value))
    except Exception:
        return low


def make_html(title: str, notes: str | None = None) -> str:
    parts = [f"<div>{esc(str(title).strip())}</div>"]
    if notes:
        for line in str(notes).replace("\r\n", "\n").replace("\r", "\n").split("\n"):
            parts.append(f"<div>{esc(line)}</div>")
    return "".join(parts)


def html_lines(raw: str) -> list[str]:
    s = str(raw or "")
    s = re.sub(r"(?i)<br\s*/?>", "\n", s)
    s = re.sub(r"(?i)</(div|p|li|h[1-6])>", "\n", s)
    s = re.sub(r"<[^>]*>", "", s)
    s = html.unescape(s).replace("\xa0", " ")
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in s.splitlines()]
    while lines and not lines[0]:
        lines.pop(0)
    while lines and not lines[-1]:
        lines.pop()
    return lines


def title_of(note: dict) -> str:
    lines = html_lines(note.get("html", ""))
    return lines[0] if lines else "(без названия)"


def plain_text(note: dict) -> str:
    return " ".join(html_lines(note.get("html", "")))


def norm_due(value) -> str | None:
    """Приводит дату к локальному ISO 'YYYY-MM-DDTHH:MM'. Пустое — None."""
    if value is None:
        return None
    raw = str(value).strip()
    if not raw or raw.lower() in {"none", "null", "нет", "без срока"}:
        return None
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw):
        return raw + "T18:00"
    try:
        d = dt.datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(
            f"Не понимаю дату {raw!r}. Нужен ISO-формат: 2026-10-25 или 2026-10-25T18:00."
        ) from exc
    if d.tzinfo is not None:
        d = d.astimezone()
    return d.strftime("%Y-%m-%dT%H:%M")


def parse_due(value) -> dt.datetime | None:
    raw = norm_due(value)
    if not raw:
        return None
    return dt.datetime.strptime(raw, "%Y-%m-%dT%H:%M")


def fmt_due(d: dt.datetime) -> str:
    return d.strftime("%Y-%m-%dT%H:%M")


def add_months(d: dt.datetime, months: int) -> dt.datetime:
    y = d.year + (d.month - 1 + months) // 12
    m = (d.month - 1 + months) % 12 + 1
    day = min(d.day, [31, 29 if y % 4 == 0 and (y % 100 != 0 or y % 400 == 0) else 28,
                      31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1])
    return d.replace(year=y, month=m, day=day)


def next_due(due, repeat: str) -> str | None:
    if not repeat or repeat == "none":
        return None
    d = parse_due(due) or dt.datetime.now().replace(second=0, microsecond=0)
    if repeat == "daily":
        d += dt.timedelta(days=1)
    elif repeat == "weekdays":
        d += dt.timedelta(days=1)
        while d.weekday() >= 5:
            d += dt.timedelta(days=1)
    elif repeat == "weekly":
        d += dt.timedelta(days=7)
    elif repeat == "monthly":
        d = add_months(d, 1)
    elif repeat == "yearly":
        d = add_months(d, 12)
    else:
        return None
    return fmt_due(d)


def local_day(offset: int = 0) -> str:
    return (dt.date.today() + dt.timedelta(days=offset)).isoformat()


def checklist_norm(items) -> list[dict]:
    out = []
    for item in items or []:
        if isinstance(item, str):
            text, done = item, False
        elif isinstance(item, dict):
            text, done = item.get("text", ""), bool(item.get("done"))
        else:
            continue
        text = str(text).strip()
        if text:
            out.append({"id": uid("c"), "text": text, "done": done})
    return out


# ---------------------------------------------------------------------------
# документ по умолчанию (пока приложение ещё ни разу не синхронизировалось)
# ---------------------------------------------------------------------------

def default_doc() -> dict:
    now = now_ms()
    def board(bid, name, color, bg, sphere=None, inbox=False):
        return {"id": bid, "name": name, "color": color, "bg": bg,
                "sphere": sphere, "inbox": inbox, "view": None, "created": now}
    return {
        "version": 1,
        "createdAt": now,
        "boards": [
            board("srv_week", "Неделя", "#B5432F", "cork"),
            board("srv_work", "Работа", "#4E7FA6", "linen", "work"),
            board("srv_study", "Учёба", "#6E9C83", "kraft", "study"),
            board("srv_projects", "Проекты", "#8A6FA8", "felt", "projects"),
            board("srv_life", "Личное", "#C4718E", "cork", "life"),
            board("srv_inbox", "Входящие", "#8B7A63", "linen", None, True),
        ],
        "notes": [],
        "threads": [],
        "focusLog": [],
        "tombstones": {"notes": {}, "boards": {}, "threads": {}},
        "settings": {
            "theme": "light", "snap": True, "lastBoard": "srv_week",
            "view": "today", "lastSphere": "work", "weeklyGoals": "",
            "digestDate": "", "reminders": False, "inboxBoardId": "srv_inbox",
        },
    }


def _clean_tombs(raw) -> dict:
    if not isinstance(raw, dict):
        raw = {}
    out = {"notes": {}, "boards": {}, "threads": {}}
    for kind in out:
        src = raw.get(kind)
        if isinstance(src, dict):
            for key, value in src.items():
                try:
                    out[kind][str(key)] = int(value)
                except (TypeError, ValueError):
                    continue
    return out


def _board_for_sphere(boards: list[dict], sphere: str | None):
    if sphere:
        for b in boards:
            if not b.get("inbox") and b.get("sphere") == sphere:
                return b
    for b in boards:
        if not b.get("inbox"):
            return b
    return boards[0] if boards else None


def _inbox(boards: list[dict]):
    for b in boards:
        if b.get("inbox"):
            return b
    return boards[0] if boards else None


def merge_docs(server: dict, client: dict) -> dict:
    """Объединяет серверный и клиентский документы.

    Побеждает более свежий updated у записи. Надгробия (tombstones) не дают
    удалённым записям воскресать. Служебные доски srv_* растворяются, как
    только у приложения появляются собственные доски.
    """
    if not isinstance(client, dict):
        return server
    server = copy.deepcopy(server) if isinstance(server, dict) else default_doc()
    client = copy.deepcopy(client)

    c_boards = client.get("boards") if isinstance(client.get("boards"), list) else []
    s_boards = server.get("boards") if isinstance(server.get("boards"), list) else []
    s_notes = server.get("notes") if isinstance(server.get("notes"), list) else []
    c_notes = client.get("notes") if isinstance(client.get("notes"), list) else []

    result = copy.deepcopy(client)
    result["version"] = 1
    result["createdAt"] = client.get("createdAt") or server.get("createdAt") or now_ms()
    result.setdefault("focusLog", [])
    result.setdefault("threads", [])
    result.setdefault("settings", {})

    # --- доски ---
    boards = copy.deepcopy(c_boards)
    board_ids = {b.get("id") for b in boards}
    board_map = {}
    if c_boards:
        c_inbox = _inbox(c_boards)
        for sb in s_boards:
            sid = sb.get("id")
            if not sid or not str(sid).startswith("srv_") or sid in board_ids:
                continue
            target = c_inbox if sb.get("inbox") else _board_for_sphere(c_boards, sb.get("sphere"))
            if target:
                board_map[sid] = target.get("id")
    else:
        for sb in s_boards:
            if sb.get("id") not in board_ids:
                boards.append(copy.deepcopy(sb))
                board_ids.add(sb.get("id"))
    if not boards:
        boards = copy.deepcopy(s_boards)

    # --- надгробия ---
    st = _clean_tombs(server.get("tombstones"))
    ct = _clean_tombs(client.get("tombstones"))
    tombs = {"notes": {}, "boards": {}, "threads": {}}
    for kind in tombs:
        for key, value in st[kind].items():
            tombs[kind][key] = max(tombs[kind].get(key, 0), value)
        for key, value in ct[kind].items():
            tombs[kind][key] = max(tombs[kind].get(key, 0), value)

    boards = [b for b in boards if b.get("id") not in tombs["boards"]]
    board_ids = {b.get("id") for b in boards}

    # --- записи ---
    notes_by_id: dict[str, dict] = {}
    for n in s_notes:
        if not isinstance(n, dict) or not n.get("id"):
            continue
        n = copy.deepcopy(n)
        if n.get("boardId") in board_map:
            n["boardId"] = board_map[n["boardId"]]
        if n.get("boardId") not in board_ids and boards:
            n["boardId"] = _inbox(boards)["id"]
        notes_by_id[n["id"]] = n
    for n in c_notes:
        if not isinstance(n, dict) or not n.get("id"):
            continue
        n = copy.deepcopy(n)
        old = notes_by_id.get(n["id"])
        if old is None or int(n.get("updated") or 0) >= int(old.get("updated") or 0):
            notes_by_id[n["id"]] = n

    notes = []
    for n in notes_by_id.values():
        tomb = tombs["notes"].get(n.get("id"), 0)
        if tomb and tomb >= int(n.get("updated") or 0):
            continue
        notes.append(n)
    notes.sort(key=lambda x: (int(x.get("created") or 0), x.get("id", "")))
    note_ids = {n["id"] for n in notes}

    # --- нити ---
    threads_by_id: dict[str, dict] = {}
    for t in server.get("threads") or []:
        if isinstance(t, dict) and t.get("id"):
            threads_by_id[t["id"]] = copy.deepcopy(t)
    for t in client.get("threads") or []:
        if not isinstance(t, dict) or not t.get("id"):
            continue
        old = threads_by_id.get(t["id"])
        if old is None or int(t.get("updated") or 0) >= int(old.get("updated") or 0):
            threads_by_id[t["id"]] = copy.deepcopy(t)
    threads = []
    for t in threads_by_id.values():
        if t.get("id") in tombs["threads"]:
            continue
        if t.get("from") not in note_ids or t.get("to") not in note_ids:
            continue
        if t.get("boardId") not in board_ids:
            continue
        threads.append(t)

    # --- фокус-лог ---
    focus = {}
    for row in (server.get("focusLog") or []) + (client.get("focusLog") or []):
        if isinstance(row, dict):
            key = row.get("id") or f"{row.get('at')}_{row.get('noteId')}_{row.get('sphere')}"
            focus[key] = row
    focus_log = sorted(focus.values(), key=lambda x: int(x.get("at") or 0))[-3000:]

    # --- настройки: приложение главнее ---
    settings = copy.deepcopy(server.get("settings") or {})
    settings.update(copy.deepcopy(client.get("settings") or {}))
    if not settings.get("lastBoard") or settings.get("lastBoard") not in board_ids:
        settings["lastBoard"] = boards[0]["id"] if boards else None
    inbox = _inbox(boards)
    if inbox:
        settings["inboxBoardId"] = inbox["id"]

    # чистим старые надгробия (старше 120 дней)
    cutoff = now_ms() - 120 * 86400 * 1000
    tombs = {k: {i: ts for i, ts in v.items() if ts >= cutoff} for k, v in tombs.items()}

    result.update({
        "boards": boards,
        "notes": notes,
        "threads": threads,
        "focusLog": focus_log,
        "tombstones": tombs,
        "settings": settings,
    })
    return result


# ---------------------------------------------------------------------------
# хранилище
# ---------------------------------------------------------------------------

class Store:
    def __init__(self, data_dir: Path):
        self.dir = data_dir
        self.dir.mkdir(parents=True, exist_ok=True)
        (self.dir / "backups").mkdir(exist_ok=True)
        self.lock = threading.RLock()
        self.config = self._load_config()
        self.token = self.config["token"]
        self.revision = 0
        self.updated_at = 0
        self.doc = default_doc()
        self._last_backup = 0.0
        self._load_doc()

    # -- config ------------------------------------------------------------
    def _load_config(self) -> dict:
        path = self.dir / "config.json"
        cfg = {}
        if path.exists():
            try:
                cfg = json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                cfg = {}
        changed = False
        if not cfg.get("token"):
            cfg["token"] = secrets.token_hex(24)
            changed = True
        if not cfg.get("createdAt"):
            cfg["createdAt"] = now_ms()
            changed = True
        cfg.setdefault("name", "Пробка")
        if changed or not path.exists():
            self._atomic_write(path, cfg)
            try:
                os.chmod(path, 0o600)
            except OSError:
                pass
        return cfg

    # -- документ ----------------------------------------------------------
    def _load_doc(self):
        path = self.dir / "doc.json"
        if not path.exists():
            self._save_unlocked()
            return
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            doc = payload.get("doc") if isinstance(payload, dict) else None
            if not isinstance(doc, dict):
                raise ValueError("нет doc")
            self.doc = doc
            self.revision = int(payload.get("revision") or 0)
            self.updated_at = int(payload.get("updatedAt") or 0)
        except Exception as exc:
            bad = self.dir / f"doc.broken-{int(time.time())}.json"
            try:
                path.replace(bad)
            except OSError:
                pass
            print(f"! Не удалось прочитать data/doc.json ({exc}); начал новый документ.", file=sys.stderr)
            self.doc = default_doc()
            self.revision = 0
            self._save_unlocked()

    def _atomic_write(self, path: Path, payload):
        tmp = path.with_suffix(path.suffix + ".tmp")
        text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        tmp.write_text(text, encoding="utf-8")
        os.replace(tmp, path)

    def _backup_unlocked(self):
        if time.time() - self._last_backup < 300:
            return
        self._last_backup = time.time()
        folder = self.dir / "backups"
        stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
        path = folder / f"doc-{stamp}-r{self.revision}.json"
        try:
            self._atomic_write(path, {"revision": self.revision, "updatedAt": self.updated_at, "doc": self.doc})
            files = sorted(folder.glob("doc-*.json"))
            for old in files[:-20]:
                try:
                    old.unlink()
                except OSError:
                    pass
        except OSError:
            pass

    def _save_unlocked(self):
        self._backup_unlocked()
        self._atomic_write(self.dir / "doc.json", {
            "revision": self.revision, "updatedAt": self.updated_at, "doc": self.doc,
        })

    def snapshot(self):
        with self.lock:
            return self.revision, copy.deepcopy(self.doc)

    def mutate(self, fn):
        with self.lock:
            doc = copy.deepcopy(self.doc)
            result = fn(doc)
            if doc != self.doc:
                self.doc = doc
                self.revision += 1
                self.updated_at = now_ms()
                self._save_unlocked()
            return result, self.revision, copy.deepcopy(self.doc)

    def merge_from_client(self, client_doc: dict):
        with self.lock:
            merged = merge_docs(self.doc, client_doc)
            if merged != self.doc:
                self.doc = merged
                self.revision += 1
                self.updated_at = now_ms()
                self._save_unlocked()
            return self.revision, copy.deepcopy(self.doc)


# ---------------------------------------------------------------------------
# общие выборки
# ---------------------------------------------------------------------------

def find_note(doc: dict, note_id: str) -> dict | None:
    for n in doc.get("notes") or []:
        if n.get("id") == note_id:
            return n
    return None


def board_name(doc: dict, board_id: str) -> str:
    for b in doc.get("boards") or []:
        if b.get("id") == board_id:
            return b.get("name") or ""
    return ""


def brief(doc: dict, n: dict) -> dict:
    checks = n.get("checklist") or []
    done_checks = sum(1 for c in checks if c.get("done"))
    out = {
        "id": n.get("id"),
        "title": title_of(n),
        "sphere": n.get("sphere"),
        "kind": n.get("kind"),
        "status": n.get("status"),
        "done": bool(n.get("done")),
        "archived": bool(n.get("archived")),
        "due": n.get("due"),
        "priority": n.get("priority") or 0,
        "tags": n.get("tags") or [],
        "board": board_name(doc, n.get("boardId")),
    }
    if checks:
        out["checklist"] = f"{done_checks}/{len(checks)}"
    if n.get("projectId"):
        project = find_note(doc, n["projectId"])
        if project:
            out["project"] = title_of(project)
    if n.get("subject"):
        out["subject"] = n["subject"]
    if n.get("url"):
        out["url"] = n["url"]
    if n.get("meta"):
        out["meta"] = n["meta"]
    return out


def note_full(doc: dict, n: dict) -> dict:
    out = brief(doc, n)
    out["html"] = n.get("html") or ""
    out["text"] = plain_text(n)
    out["checklist"] = [
        {"id": c.get("id"), "text": c.get("text"), "done": bool(c.get("done"))}
        for c in (n.get("checklist") or [])
    ]
    out["created"] = n.get("created")
    out["updated"] = n.get("updated")
    out["completedAt"] = n.get("completedAt")
    out["reminder"] = n.get("reminder")
    out["repeat"] = n.get("repeat")
    out["estimate"] = n.get("estimate")
    out["favorite"] = bool(n.get("favorite"))
    out["top3"] = bool(n.get("top3"))
    out["important"] = bool(n.get("important"))
    return out


def resolve_board(doc: dict, sphere: str | None, status: str | None,
                  board: str | None = None) -> dict:
    boards = doc.get("boards") or []
    if not boards:
        raise ValueError("На сервере нет ни одной доски — сначала откройте приложение.")
    if board:
        raw = str(board).strip()
        for b in boards:
            if b.get("id") == raw or (b.get("name") or "").lower() == raw.lower():
                return b
        for b in boards:
            if raw.lower() in (b.get("name") or "").lower():
                return b
    if status == "inbox":
        return _inbox(boards)
    if sphere:
        b = _board_for_sphere(boards, sphere)
        if b:
            return b
    return _inbox(boards) if status == "inbox" else (_board_for_sphere(boards, sphere) or boards[0])


def validate_enum(value, allowed, field: str):
    if value is None:
        return None
    value = str(value)
    if value not in allowed:
        raise ValueError(f"{field}: допустимые значения — {', '.join(allowed)}")
    return value


def tool_error(message: str) -> dict:
    return {"error": message}


# ---------------------------------------------------------------------------
# MCP-инструменты
# ---------------------------------------------------------------------------

class ToolBox:
    def __init__(self, store: Store):
        self.store = store

    # -- чтение ------------------------------------------------------------
    def status(self, args: dict) -> dict:
        rev, doc = self.store.snapshot()
        notes = [n for n in doc.get("notes") or [] if not n.get("archived")]
        active = [n for n in notes if not n.get("done")]
        today = [n for n in active if (n.get("due") or "")[:10] == local_day(0)]
        return {
            "ok": True,
            "server": "Пробка",
            "revision": rev,
            "notes": len(doc.get("notes") or []),
            "active": len(active),
            "today": len(today),
            "boards": [{"id": b.get("id"), "name": b.get("name"), "sphere": b.get("sphere"),
                        "inbox": bool(b.get("inbox"))} for b in doc.get("boards") or []],
            "now": dt.datetime.now().strftime("%Y-%m-%dT%H:%M"),
            "hint": "Используй probka_list_notes / probka_search, чтобы найти id, затем probka_update_note.",
        }

    def boards(self, args: dict) -> dict:
        _, doc = self.store.snapshot()
        counts = {}
        for n in doc.get("notes") or []:
            if not n.get("archived"):
                counts[n.get("boardId")] = counts.get(n.get("boardId"), 0) + 1
        return {"boards": [
            {"id": b.get("id"), "name": b.get("name"), "sphere": b.get("sphere"),
             "inbox": bool(b.get("inbox")), "active": counts.get(b.get("id"), 0)}
            for b in doc.get("boards") or []
        ]}

    def list_notes(self, args: dict) -> dict:
        _, doc = self.store.snapshot()
        sphere = validate_enum(args.get("sphere"), SPHERES, "sphere")
        kind = validate_enum(args.get("kind"), KINDS, "kind")
        status = args.get("status")
        if status not in (None, "", "all", "active", *STATUSES):
            raise ValueError("status: all, active, inbox, today, doing или done")
        tag = (args.get("tag") or "").strip().lower()
        query = (args.get("query") or "").strip().lower()
        include_archived = bool(args.get("include_archived"))
        include_done = bool(args.get("include_done")) or status == "all" or status == "done"
        due_before = norm_due(args.get("due_before")) if args.get("due_before") else None
        due_after = norm_due(args.get("due_after")) if args.get("due_after") else None
        limit = int(clip(int(args.get("limit") or 50), 1, 200))
        notes = []
        for n in doc.get("notes") or []:
            if n.get("archived") and not include_archived:
                continue
            if n.get("done") and not include_done and status != "done":
                continue
            if sphere and n.get("sphere") != sphere:
                continue
            if kind and n.get("kind") != kind:
                continue
            if status == "active" and (n.get("done") or n.get("archived")):
                continue
            if status in STATUSES and n.get("status") != status:
                continue
            if tag and tag not in [str(t).lower() for t in (n.get("tags") or [])]:
                continue
            if query and query not in (title_of(n) + " " + plain_text(n) + " " + " ".join(n.get("tags") or [])).lower():
                continue
            due = n.get("due")
            if due_before and (not due or due > due_before):
                continue
            if due_after and (not due or due < due_after):
                continue
            notes.append(n)
        notes.sort(key=lambda n: (n.get("due") is None, n.get("due") or "9999", -(int(n.get("priority") or 0))))
        total = len(notes)
        return {"total": total, "count": min(total, limit),
                "notes": [brief(doc, n) for n in notes[:limit]]}

    def search(self, args: dict) -> dict:
        q = (args.get("query") or "").strip()
        if not q:
            raise ValueError("query обязателен")
        args = dict(args)
        args["query"] = q
        return self.list_notes(args)

    def get_note(self, args: dict) -> dict:
        note_id = args.get("id")
        if not note_id:
            raise ValueError("id обязателен")
        _, doc = self.store.snapshot()
        n = find_note(doc, str(note_id))
        if not n:
            raise ValueError(f"Запись {note_id} не найдена")
        return {"note": note_full(doc, n)}

    # -- запись ------------------------------------------------------------
    def _new_note(self, doc: dict, args: dict, force_inbox: bool = False) -> dict:
        title = str(args.get("title") or "").strip()
        if not title:
            raise ValueError("title обязателен")
        sphere = validate_enum(args.get("sphere"), SPHERES, "sphere")
        kind = validate_enum(args.get("kind"), KINDS, "kind") or "task"
        status = validate_enum(args.get("status"), STATUSES, "status")
        if force_inbox:
            status = "inbox"
            sphere = sphere
        status = status or "today"
        due = norm_due(args.get("due")) if "due" in args else None
        board = resolve_board(doc, sphere, status, args.get("board"))
        count = len(doc.get("notes") or [])
        note = {
            "id": uid("n"), "boardId": board["id"],
            "x": 100 + (count % 3) * 250, "y": 100 + (count // 3) % 4 * 190,
            "w": 215, "h": 165, "rot": 0, "z": count + 1,
            "color": "lemon" if kind == "task" else "paper",
            "font": "hand", "fontSize": 16, "align": "left",
            "html": make_html(title, args.get("notes")),
            "tags": [str(t).strip() for t in (args.get("tags") or []) if str(t).strip()],
            "due": due, "priority": int(clip(int(args.get("priority") or 0), 0, 3)),
            "done": status == "done", "pin": "tape", "shadow": "soft",
            "bold": False, "italic": False,
            "checklist": checklist_norm(args.get("checklist")),
            "attachments": [], "archived": False, "archivedAt": None,
            "created": now_ms(), "updated": now_ms(),
            "kind": kind, "sphere": sphere, "status": status,
            "reminder": args.get("reminder"), "estimate": max(0, int(args.get("estimate") or 0)),
            "repeat": validate_enum(args.get("repeat") or "none", REPEATS, "repeat") or "none",
            "projectId": args.get("project_id") or None,
            "subject": str(args.get("subject") or ""),
            "url": str(args.get("url") or ""), "source": "mcp",
            "usage": 0, "favorite": bool(args.get("favorite")), "top3": bool(args.get("top3")),
            "important": bool(args.get("important")), "focusMinutes": 0,
            "postponedCount": 0, "completedAt": now_ms() if status == "done" else None,
            "spawnedId": None,
            "meta": copy.deepcopy(args.get("meta") or {}),
        }
        doc.setdefault("notes", []).append(note)
        if sphere:
            doc.setdefault("settings", {})["lastSphere"] = sphere
        return note

    def create_note(self, args: dict) -> dict:
        note, rev, doc = self.store.mutate(lambda d: self._new_note(d, args))
        return {"ok": True, "revision": rev, "note": note_full(doc, note)}

    def capture(self, args: dict) -> dict:
        note, rev, doc = self.store.mutate(lambda d: self._new_note(d, args, force_inbox=True))
        return {"ok": True, "revision": rev, "note": note_full(doc, note)}

    def update_note(self, args: dict) -> dict:
        note_id = args.get("id")
        if not note_id:
            raise ValueError("id обязателен")
        def apply(doc):
            n = find_note(doc, str(note_id))
            if not n:
                raise ValueError(f"Запись {note_id} не найдена")
            if "title" in args or "notes" in args:
                lines = html_lines(n.get("html", ""))
                title = str(args.get("title")).strip() if args.get("title") is not None else (lines[0] if lines else "")
                body = args.get("notes")
                if body is None:
                    body = "\n".join(lines[1:]) if len(lines) > 1 else ""
                n["html"] = make_html(title, str(body) if body else "")
            for key, field in (("sphere", "sphere"), ("kind", "kind"), ("status", "status"),
                               ("priority", "priority"), ("subject", "subject"), ("url", "url"),
                               ("repeat", "repeat"), ("reminder", "reminder"),
                               ("project_id", "projectId"), ("estimate", "estimate")):
                if key in args:
                    value = args.get(key)
                    if field in ("sphere",):
                        value = validate_enum(value, SPHERES, "sphere")
                    elif field == "kind":
                        value = validate_enum(value, KINDS, "kind")
                    elif field == "status":
                        value = validate_enum(value, STATUSES, "status")
                    elif field == "repeat":
                        value = validate_enum(value, REPEATS, "repeat")
                    elif field == "priority":
                        value = int(clip(int(value or 0), 0, 3))
                    elif field == "estimate":
                        value = max(0, int(value or 0))
                    n[field] = value
            if "tags" in args:
                n["tags"] = [str(t).strip() for t in (args.get("tags") or []) if str(t).strip()]
            if "checklist" in args:
                n["checklist"] = checklist_norm(args.get("checklist"))
            if "due" in args:
                n["due"] = norm_due(args.get("due"))
            if "favorite" in args:
                n["favorite"] = bool(args.get("favorite"))
            if "top3" in args:
                n["top3"] = bool(args.get("top3"))
            if "important" in args:
                n["important"] = bool(args.get("important"))
            if "archived" in args:
                n["archived"] = bool(args.get("archived"))
                n["archivedAt"] = now_ms() if n["archived"] else None
            if isinstance(args.get("meta"), dict):
                n.setdefault("meta", {}).update(copy.deepcopy(args["meta"]))
            if args.get("status") is not None:
                n["done"] = n.get("status") == "done"
                n["completedAt"] = now_ms() if n["done"] else None
            if n.get("status") == "done" and not n.get("done"):
                n["done"] = True
                n["completedAt"] = n["completedAt"] or now_ms()
            if n.get("done") and n.get("repeat") and n.get("repeat") != "none" and not n.get("spawnedId"):
                self._spawn_next(doc, n)
            # перенос из «Входящих» в сферу
            if args.get("sphere") and n.get("status") == "inbox":
                n["status"] = "today"
                target = resolve_board(doc, n.get("sphere"), "today")
                if target and (board_name(doc, n.get("boardId")) == "Входящие" or
                               any(b.get("id") == n.get("boardId") and b.get("inbox") for b in doc.get("boards") or [])):
                    n["boardId"] = target["id"]
                    n["z"] = max([int(x.get("z") or 0) for x in doc.get("notes") or []] + [0]) + 1
            n["updated"] = now_ms()
            return n
        note, rev, doc = self.store.mutate(apply)
        # mutate returns the live result even if doc unchanged
        n = find_note(doc, str(note_id)) or note
        return {"ok": True, "revision": rev, "note": note_full(doc, n)}

    def _spawn_next(self, doc: dict, note: dict):
        due = next_due(note.get("due"), note.get("repeat") or "none")
        if not due:
            return
        copy_note = copy.deepcopy(note)
        copy_note["id"] = uid("n")
        copy_note["due"] = due
        copy_note["done"] = False
        copy_note["status"] = "today"
        copy_note["completedAt"] = None
        copy_note["created"] = now_ms()
        copy_note["updated"] = now_ms()
        copy_note["spawnedId"] = None
        copy_note["postponedCount"] = 0
        copy_note["archived"] = False
        copy_note["archivedAt"] = None
        copy_note["z"] = max([int(x.get("z") or 0) for x in doc.get("notes") or []] + [0]) + 1
        copy_note["checklist"] = [
            {"id": uid("c"), "text": c.get("text", ""), "done": False}
            for c in (copy_note.get("checklist") or [])
        ]
        note["spawnedId"] = copy_note["id"]
        doc.setdefault("notes", []).append(copy_note)

    def complete_note(self, args: dict) -> dict:
        args = dict(args)
        args["status"] = "done" if args.get("done", True) else "today"
        return self.update_note(args)

    def postpone_note(self, args: dict) -> dict:
        note_id = args.get("id")
        days = int(args.get("days") or 1)
        if not -365 <= days <= 365:
            raise ValueError("days: от -365 до 365")
        def apply(doc):
            n = find_note(doc, str(note_id))
            if not n:
                raise ValueError(f"Запись {note_id} не найдена")
            base = parse_due(n.get("due")) or dt.datetime.now().replace(hour=18, minute=0, second=0, microsecond=0)
            n["due"] = fmt_due(base + dt.timedelta(days=days))
            n["postponedCount"] = int(n.get("postponedCount") or 0) + 1
            if n.get("status") == "inbox":
                n["status"] = "today"
            n["updated"] = now_ms()
            return n
        note, rev, doc = self.store.mutate(apply)
        return {"ok": True, "revision": rev, "note": note_full(doc, note)}

    def archive_note(self, args: dict) -> dict:
        args = dict(args)
        args["archived"] = bool(args.get("archived", True))
        return self.update_note(args)

    # -- чек-лист ----------------------------------------------------------
    def checklist(self, args: dict) -> dict:
        note_id = args.get("id")
        action = args.get("action") or "add"
        if action not in ("add", "toggle", "remove", "clear"):
            raise ValueError("action: add, toggle, remove или clear")
        def apply(doc):
            n = find_note(doc, str(note_id))
            if not n:
                raise ValueError(f"Запись {note_id} не найдена")
            items = n.setdefault("checklist", [])
            if action == "add":
                text = str(args.get("text") or "").strip()
                if not text:
                    raise ValueError("text обязателен для action=add")
                items.append({"id": uid("c"), "text": text, "done": False})
            elif action == "toggle":
                target = None
                item_id = args.get("item_id")
                index = args.get("index")
                if item_id:
                    target = next((c for c in items if c.get("id") == item_id), None)
                elif index is not None:
                    try:
                        target = items[int(index)]
                    except (IndexError, ValueError):
                        target = None
                if not target:
                    raise ValueError("Не нашёл пункт. Укажи item_id или index (с нуля).")
                target["done"] = not bool(target.get("done"))
            elif action == "remove":
                item_id = args.get("item_id")
                index = args.get("index")
                if item_id:
                    items[:] = [c for c in items if c.get("id") != item_id]
                elif index is not None:
                    try:
                        items.pop(int(index))
                    except (IndexError, ValueError) as exc:
                        raise ValueError("Неверный index") from exc
                else:
                    raise ValueError("Укажи item_id или index")
            else:
                items.clear()
            n["updated"] = now_ms()
            return n
        note, rev, doc = self.store.mutate(apply)
        return {"ok": True, "revision": rev, "id": note_id,
                "checklist": note.get("checklist") or [], "note": brief(doc, note)}

    # -- шаблоны / обзор ---------------------------------------------------
    def templates(self, args: dict) -> dict:
        _, doc = self.store.snapshot()
        q = (args.get("query") or "").strip().lower()
        out = []
        for n in doc.get("notes") or []:
            if n.get("kind") != "template" or n.get("archived"):
                continue
            text = title_of(n) + " " + plain_text(n)
            if q and q not in text.lower():
                continue
            out.append({"id": n.get("id"), "title": title_of(n), "text": plain_text(n),
                        "tags": n.get("tags") or [], "usage": n.get("usage") or 0,
                        "favorite": bool(n.get("favorite"))})
        out.sort(key=lambda x: (-int(x["favorite"]), -int(x["usage"])))
        return {"templates": out[:30], "total": len(out)}

    def use_template(self, args: dict) -> dict:
        template_id = args.get("id")
        fields = args.get("fields") or {}
        def apply(doc):
            n = find_note(doc, str(template_id))
            if not n:
                raise ValueError(f"Шаблон {template_id} не найден")
            text = "\n".join(html_lines(n.get("html", "")))
            for key, value in fields.items():
                text = text.replace("{" + str(key) + "}", str(value))
            n["usage"] = int(n.get("usage") or 0) + 1
            n["updated"] = now_ms()
            return text
        text, rev, _ = self.store.mutate(apply)
        return {"ok": True, "revision": rev, "text": text,
                "hint": "Скопируй текст в нужную заметку или создай задачу через probka_create_note."}

    def agenda(self, args: dict) -> dict:
        _, doc = self.store.snapshot()
        days = int(clip(int(args.get("days") or 7), 1, 60))
        now = dt.datetime.now()
        today = now.date()
        groups = {"overdue": [], "today": [], "tomorrow": [], "week": [], "later": [], "no_due": []}
        for n in doc.get("notes") or []:
            if n.get("archived") or n.get("done"):
                continue
            item = brief(doc, n)
            due = parse_due(n.get("due"))
            if not due:
                if n.get("status") in ("today", "doing"):
                    groups["no_due"].append(item)
                continue
            delta = (due.date() - today).days
            if delta < 0:
                groups["overdue"].append(item)
            elif delta == 0:
                groups["today"].append(item)
            elif delta == 1:
                groups["tomorrow"].append(item)
            elif delta <= days:
                groups["week"].append(item)
            else:
                groups["later"].append(item)
        for key in groups:
            groups[key].sort(key=lambda x: x.get("due") or "")
        return {"now": now.strftime("%Y-%m-%dT%H:%M"), "days": days, "groups": groups}

    def stats(self, args: dict) -> dict:
        _, doc = self.store.snapshot()
        days = int(clip(int(args.get("days") or 7), 1, 365))
        since = now_ms() - days * 86400 * 1000
        notes = doc.get("notes") or []
        active = [n for n in notes if not n.get("done") and not n.get("archived")]
        done = [n for n in notes if n.get("done") and not n.get("archived")
                and int(n.get("completedAt") or 0) >= since]
        focus = [f for f in doc.get("focusLog") or [] if int(f.get("at") or 0) >= since]
        by_sphere = {}
        for s in SPHERES:
            by_sphere[s] = {
                "name": SPHERE_NAMES[s],
                "active": sum(1 for n in active if n.get("sphere") == s),
                "done": sum(1 for n in done if n.get("sphere") == s),
                "focus_minutes": sum(int(f.get("minutes") or 0) for f in focus if f.get("sphere") == s),
            }
        return {
            "days": days,
            "active": len(active),
            "done": len(done),
            "overdue": sum(1 for n in active if n.get("due") and n["due"] < dt.datetime.now().strftime("%Y-%m-%dT%H:%M")),
            "focus_minutes": sum(int(f.get("minutes") or 0) for f in focus),
            "by_sphere": by_sphere,
            "top3": [brief(doc, n) for n in active if n.get("top3")][:3],
        }


# ---------------------------------------------------------------------------
# схемы MCP-инструментов
# ---------------------------------------------------------------------------

NOTE_FIELDS = {
    "title": {"type": "string", "description": "Название (первая строка заметки). Обязательно при создании."},
    "notes": {"type": "string", "description": "Описание/детали обычным текстом. Переносы строк сохраняются."},
    "sphere": {"type": "string", "enum": SPHERES, "description": "Сфера: work, study, projects, life."},
    "kind": {"type": "string", "enum": KINDS, "description": "Тип записи. По умолчанию task."},
    "status": {"type": "string", "enum": STATUSES, "description": "inbox, today, doing или done."},
    "due": {"type": "string", "description": "Дедлайн ISO: 2026-10-25 или 2026-10-25T18:00. Пустая строка — убрать."},
    "priority": {"type": "integer", "minimum": 0, "maximum": 3, "description": "0 нет, 1 низкий, 2 средний, 3 высокий."},
    "tags": {"type": "array", "items": {"type": "string"}, "description": "Теги."},
    "checklist": {"type": "array", "items": {"type": "string"}, "description": "Пункты чек-листа."},
    "board": {"type": "string", "description": "id или название доски. Обычно не нужно: доска выбирается по сфере."},
    "project_id": {"type": "string", "description": "id проекта (записи kind=project)."},
    "subject": {"type": "string", "description": "Предмет для учёбы."},
    "url": {"type": "string", "description": "Ссылка."},
    "estimate": {"type": "integer", "minimum": 0, "description": "Оценка в минутах."},
    "repeat": {"type": "string", "enum": REPEATS, "description": "Повтор: none, daily, weekdays, weekly, monthly, yearly."},
    "reminder": {"type": "integer", "description": "Напоминание в минутах до дедлайна."},
    "favorite": {"type": "boolean"},
    "top3": {"type": "boolean", "description": "Войти в три главных дела дня."},
    "important": {"type": "boolean"},
    "meta": {"type": "object", "description": "Доп. поля: stage, eventDate, mood, link, duration и т.п."},
}

TOOL_SPECS = [
    {
        "name": "probka_status",
        "description": "Проверить связь с «Пробкой» и получить сводку: ревизия, число активных задач, доски, текущее время сервера. Начни с этого, если не уверен в подключении.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "probka_boards",
        "description": "Список досок с id, сферой и числом активных заметок. Нужен, если пользователь просит переместить задачу на конкретную доску.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "probka_list_notes",
        "description": "Список задач и заметок с фильтрами. Возвращает id — используй его для update/complete/postpone/archive. По умолчанию активные (не выполненные, не в архиве), до 50 штук.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "sphere": {"type": "string", "enum": SPHERES},
                "kind": {"type": "string", "enum": KINDS},
                "status": {"type": "string", "enum": ["all", "active"] + STATUSES,
                           "description": "active — все незавершённые; all — включая выполненные."},
                "tag": {"type": "string"},
                "query": {"type": "string", "description": "Поиск по названию, тексту и тегам."},
                "due_before": {"type": "string", "description": "ISO-дата/время верхней границы дедлайна."},
                "due_after": {"type": "string", "description": "ISO-дата/время нижней границы дедлайна."},
                "include_archived": {"type": "boolean"},
                "include_done": {"type": "boolean"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 200},
            },
        },
    },
    {
        "name": "probka_search",
        "description": "Найти записи по тексту (название, описание, теги). Возвращает id и краткие сведения. Используй перед редактированием, если не знаешь id.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Строка поиска."},
                "sphere": {"type": "string", "enum": SPHERES},
                "include_done": {"type": "boolean"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 100},
            },
            "required": ["query"],
        },
    },
    {
        "name": "probka_get_note",
        "description": "Получить запись целиком: текст, чек-лист, дедлайн, теги, метаданные. Требует id.",
        "inputSchema": {
            "type": "object",
            "properties": {"id": {"type": "string"}},
            "required": ["id"],
        },
    },
    {
        "name": "probka_create_note",
        "description": "Создать задачу/заметку. Достаточно title. Если указана сфера, запись автоматически попадёт на доску этой сферы. Дедлайн — ISO-строка.",
        "inputSchema": {
            "type": "object",
            "properties": NOTE_FIELDS,
            "required": ["title"],
        },
    },
    {
        "name": "probka_update_note",
        "description": "Изменить существующую запись. Передавай только меняющиеся поля и обязательно id. title/notes заменяют текст заметки; чтобы убрать дедлайн, передай due как пустую строку.",
        "inputSchema": {
            "type": "object",
            "properties": dict({"id": {"type": "string"}}, **NOTE_FIELDS),
            "required": ["id"],
        },
    },
    {
        "name": "probka_complete_note",
        "description": "Отметить задачу выполненной (или вернуть в работу при done=false). Для повторяющихся задач создаст следующее вхождение.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "id": {"type": "string"},
                "done": {"type": "boolean", "description": "По умолчанию true."},
            },
            "required": ["id"],
        },
    },
    {
        "name": "probka_postpone_note",
        "description": "Перенести дедлайн на N дней вперёд (или назад при отрицательном N). Если дедлайна нет, поставит сегодня/завтра на 18:00.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "id": {"type": "string"},
                "days": {"type": "integer", "minimum": -365, "maximum": 365, "description": "По умолчанию 1."},
            },
            "required": ["id"],
        },
    },
    {
        "name": "probka_archive_note",
        "description": "Убрать запись в архив (не удаляет). archived=false возвращает из архива.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "id": {"type": "string"},
                "archived": {"type": "boolean", "description": "По умолчанию true."},
            },
            "required": ["id"],
        },
    },
    {
        "name": "probka_capture",
        "description": "Быстро записать мысль во «Входящие», без сферы и дедлайна. Потом пользователь разберёт входящие в приложении.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "notes": {"type": "string"},
                "kind": {"type": "string", "enum": KINDS},
                "tags": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["title"],
        },
    },
    {
        "name": "probka_checklist",
        "description": "Работа с чек-листом записи: add (текст), toggle (item_id или index), remove (item_id или index), clear. После изменения возвращает полный чек-лист.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "id": {"type": "string"},
                "action": {"type": "string", "enum": ["add", "toggle", "remove", "clear"]},
                "text": {"type": "string"},
                "item_id": {"type": "string"},
                "index": {"type": "integer", "minimum": 0},
            },
            "required": ["id", "action"],
        },
    },
    {
        "name": "probka_templates",
        "description": "Найти шаблоны (kind=template) по тексту. Возвращает id, название, текст и популярность.",
        "inputSchema": {
            "type": "object",
            "properties": {"query": {"type": "string"}},
        },
    },
    {
        "name": "probka_use_template",
        "description": "Взять шаблон и подставить поля вида {клиент}. Возвращает готовый текст, который можно передать в probka_create_note.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "id": {"type": "string"},
                "fields": {"type": "object", "description": "Пары подстановки, например {\"клиент\": \"Аня\"}."},
            },
            "required": ["id"],
        },
    },
    {
        "name": "probka_agenda",
        "description": "Повестка: просроченные, сегодня, завтра, на неделе, позже и активные без дедлайна.",
        "inputSchema": {
            "type": "object",
            "properties": {"days": {"type": "integer", "minimum": 1, "maximum": 60}},
        },
    },
    {
        "name": "probka_stats",
        "description": "Статистика за N дней: активные, выполненные, просроченные, минуты фокуса и разбивка по сферам.",
        "inputSchema": {
            "type": "object",
            "properties": {"days": {"type": "integer", "minimum": 1, "maximum": 365}},
        },
    },
]

TOOL_METHODS = {
    "probka_status": "status",
    "probka_boards": "boards",
    "probka_list_notes": "list_notes",
    "probka_search": "search",
    "probka_get_note": "get_note",
    "probka_create_note": "create_note",
    "probka_update_note": "update_note",
    "probka_complete_note": "complete_note",
    "probka_postpone_note": "postpone_note",
    "probka_archive_note": "archive_note",
    "probka_capture": "capture",
    "probka_checklist": "checklist",
    "probka_templates": "templates",
    "probka_use_template": "use_template",
    "probka_agenda": "agenda",
    "probka_stats": "stats",
}

MCP_INSTRUCTIONS = (
    "«Пробка» — личный офлайн-first таск-менеджер пользователя. "
    "Сферы: work (Работа/VPN Pipster), study (Учёба), projects (своё приложение), life (Личное). "
    "Сначала найди записи через probka_list_notes или probka_search и получи id. "
    "Не выдумывай id. Даты передавай в ISO 8601 (2026-10-25 или 2026-10-25T18:00). "
    "Вместо удаления используй архив. После изменений кратко перескажи пользователю, что сделано, "
    "и назови дедлайн, если он есть. Время сервера — локальное время компьютера пользователя."
)


# ---------------------------------------------------------------------------
# JSON-RPC / MCP
# ---------------------------------------------------------------------------

def rpc_error(rid, code: int, message: str):
    return {"jsonrpc": "2.0", "id": rid, "error": {"code": code, "message": message}}


def rpc_result(rid, result):
    return {"jsonrpc": "2.0", "id": rid, "result": result}


def mcp_process(toolbox: ToolBox, req):
    """Обрабатывает одно JSON-RPC сообщение. None — уведомление без ответа."""
    if not isinstance(req, dict):
        return rpc_error(None, -32600, "Invalid Request")
    rid = req.get("id")
    method = req.get("method")
    if not method:
        return rpc_error(rid, -32600, "Не указан method")
    is_notification = "id" not in req
    params = req.get("params") or {}

    if method == "initialize":
        requested = params.get("protocolVersion")
        version = requested if requested in SUPPORTED_PROTOCOLS else MCP_PROTOCOL
        return rpc_result(rid, {
            "protocolVersion": version,
            "capabilities": {
                "tools": {"listChanged": False},
                "resources": {},
                "logging": {},
            },
            "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
            "instructions": MCP_INSTRUCTIONS,
        })
    if method.startswith("notifications/"):
        return None
    if method == "ping":
        return rpc_result(rid, {})
    if method == "logging/setLevel":
        return rpc_result(rid, {})
    if method == "tools/list":
        return rpc_result(rid, {"tools": TOOL_SPECS})
    if method in ("resources/list", "resources/templates/list", "prompts/list"):
        key = "resources" if method == "resources/list" else ("resourceTemplates" if method == "resources/templates/list" else "prompts")
        return rpc_result(rid, {key: []})
    if method == "tools/call":
        name = params.get("name")
        arguments = params.get("arguments") or {}
        if name not in TOOL_METHODS:
            return rpc_error(rid, -32602, f"Неизвестный инструмент: {name}")
        if not isinstance(arguments, dict):
            return rpc_error(rid, -32602, "arguments должен быть объектом")
        try:
            handler = getattr(toolbox, TOOL_METHODS[name])
            payload = handler(arguments)
            text = json.dumps(payload, ensure_ascii=False, indent=2)
            return rpc_result(rid, {
                "content": [{"type": "text", "text": text}],
                "isError": bool(isinstance(payload, dict) and payload.get("error")),
            })
        except Exception as exc:
            text = f"Ошибка инструмента {name}: {exc}"
            if os.environ.get("PROBKA_DEBUG"):
                text += "\n\n" + traceback.format_exc()
            return rpc_result(rid, {
                "content": [{"type": "text", "text": text}],
                "isError": True,
            })
    return rpc_error(rid, -32601, f"Method not found: {method}")


# ---------------------------------------------------------------------------
# HTTP: PWA + REST + MCP
# ---------------------------------------------------------------------------

class ProbkaHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address, handler, store: Store):
        self.store = store
        self.toolbox = ToolBox(store)
        self.sessions: set[str] = set()
        super().__init__(address, handler)


class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "Probka/" + SERVER_VERSION
    sys_version = ""

    extensions_map = dict(SimpleHTTPRequestHandler.extensions_map)
    extensions_map.update({
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".html": "text/html; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".webmanifest": "application/manifest+json; charset=utf-8",
        ".svg": "image/svg+xml; charset=utf-8",
        ".woff2": "font/woff2",
        ".woff": "font/woff",
        ".ttf": "font/ttf",
        ".md": "text/markdown; charset=utf-8",
    })

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    # -- служебное ---------------------------------------------------------
    def log_message(self, fmt, *args):
        try:
            line = fmt % args
        except Exception:
            line = " ".join(str(a) for a in args)
        line = re.sub(r"/mcp/[A-Za-z0-9_\-]+", "/mcp/***", line)
        sys.stderr.write("%s  %s\n" % (dt.datetime.now().strftime("%H:%M:%S"), line))

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers",
                         "Content-Type, Authorization, X-Probka-Token, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID")
        self.send_header("Access-Control-Expose-Headers", "Mcp-Session-Id, MCP-Protocol-Version")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cache-Control", getattr(self, "_cache_control", None) or "no-cache, must-revalidate")
        self._cache_control = None
        super().end_headers()

    def _send_json(self, status: int, payload, extra: dict | None = None):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cache_control = "no-store"
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _send_text(self, status: int, text: str, content_type="text/plain; charset=utf-8", extra: dict | None = None):
        body = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self._cache_control = "no-store"
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _read_json(self, limit: int = 24 * 1024 * 1024):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0:
            raise ValueError("Пустое тело запроса")
        if length > limit:
            raise OverflowError("Слишком большой запрос")
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    # -- авторизация -------------------------------------------------------
    def _path_token(self, path: str):
        if path.startswith("/mcp"):
            rest = path[4:].strip("/")
            if rest:
                return unquote(rest.split("/")[0])
        return None

    def _authorized(self, path: str) -> bool:
        server: ProbkaHTTPServer = self.server  # type: ignore
        expected = server.store.token
        from_path = self._path_token(path)
        if from_path and hmac.compare_digest(from_path, expected):
            return True
        header = self.headers.get("Authorization") or ""
        if header.lower().startswith("bearer "):
            if hmac.compare_digest(header[7:].strip(), expected):
                return True
        x_token = self.headers.get("X-Probka-Token")
        if x_token and hmac.compare_digest(x_token.strip(), expected):
            return True
        query = urlparse(self.path).query
        if query:
            for part in query.split("&"):
                if part.startswith("token="):
                    if hmac.compare_digest(unquote(part[6:]), expected):
                        return True
        return False

    def _deny(self):
        self._send_json(401, {"ok": False, "error": "Нужен токен. Откройте настройки «Связь с MCP» в приложении."},
                        {"WWW-Authenticate": 'Bearer realm="probka"'})

    def _mcp_path(self, path: str) -> bool:
        return path == "/mcp" or path.startswith("/mcp/")

    # -- HTTP методы -------------------------------------------------------
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/api/health":
            with self.server.store.lock:
                self._send_json(200, {
                    "ok": True, "product": "Пробка", "version": SERVER_VERSION,
                    "revision": self.server.store.revision,
                    "mcp": True, "auth": True,
                })
            return
        if path == "/api/info":
            self._send_json(200, {
                "ok": True, "product": "Пробка", "version": SERVER_VERSION,
                "auth": True, "mcp": True,
            })
            return
        if path == "/api/doc":
            if not self._authorized(path):
                self._deny()
                return
            with self.server.store.lock:
                self._send_json(200, {
                    "ok": True,
                    "revision": self.server.store.revision,
                    "updatedAt": self.server.store.updated_at,
                    "doc": self.server.store.doc,
                })
            return
        if self._mcp_path(path):
            if not self._authorized(path):
                self._deny()
                return
            accept = self.headers.get("Accept") or ""
            if "text/event-stream" not in accept:
                self._send_json(405, {"ok": False, "error": "MCP использует POST. GET нужен только для SSE."},
                                {"Allow": "POST, DELETE, OPTIONS"})
                return
            # минимальный SSE-канал: подтверждаем подключение и закрываем.
            body = b": probka mcp\nretry: 3000\n\n"
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self._cache_control = "no-cache"
            self.send_header("Connection", "close")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass
            return

        # статика и защита приватных файлов
        segments = [s for s in path.split("/") if s]
        if segments and segments[0] in {"data", ".git", ".opencode", "tools", "__pycache__"}:
            self._send_text(404, "Not found")
            return
        if segments and (segments[0] == "server.py" or segments[0].endswith((".py", ".bat", ".ps1", ".tmp"))):
            self._send_text(404, "Not found")
            return
        super().do_GET()

    def do_HEAD(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/") or self._mcp_path(parsed.path):
            self.send_response(405)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        super().do_HEAD()

    def do_PUT(self):
        path = urlparse(self.path).path
        if path != "/api/doc":
            self._send_json(404, {"ok": False, "error": "Not found"})
            return
        if not self._authorized(path):
            self._deny()
            return
        try:
            payload = self._read_json()
        except OverflowError:
            self._send_json(413, {"ok": False, "error": "Слишком большой документ"})
            return
        except Exception as exc:
            self._send_json(400, {"ok": False, "error": f"Некорректный JSON: {exc}"})
            return
        doc = payload.get("doc") if isinstance(payload, dict) else None
        if not isinstance(doc, dict):
            self._send_json(400, {"ok": False, "error": "Нужен объект {doc: {...}}"})
            return
        try:
            revision, merged = self.server.store.merge_from_client(doc)
        except Exception as exc:
            self._send_json(500, {"ok": False, "error": f"Ошибка слияния: {exc}"})
            return
        self._send_json(200, {
            "ok": True, "revision": revision,
            "updatedAt": self.server.store.updated_at,
            "doc": merged,
        })

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/doc" or path == "/api/sync":
            self.do_PUT()
            return
        if not self._mcp_path(path):
            self._send_json(404, {"ok": False, "error": "Not found"})
            return
        if not self._authorized(path):
            self._deny()
            return
        try:
            req = self._read_json(limit=4 * 1024 * 1024)
        except OverflowError:
            self._send_json(413, {"ok": False, "error": "Слишком большой запрос"})
            return
        except Exception as exc:
            self._send_json(400, {"jsonrpc": "2.0", "id": None,
                                  "error": {"code": -32700, "message": f"Parse error: {exc}"}})
            return
        if isinstance(req, list):
            self._send_json(400, {"jsonrpc": "2.0", "id": None,
                                  "error": {"code": -32600, "message": "Batch не поддерживается"}})
            return
        try:
            response = mcp_process(self.server.toolbox, req)
        except Exception as exc:
            response = rpc_error(req.get("id") if isinstance(req, dict) else None,
                                 -32603, f"Internal error: {exc}")
            if os.environ.get("PROBKA_DEBUG"):
                traceback.print_exc()

        session_id = self.headers.get("Mcp-Session-Id")
        method = req.get("method") if isinstance(req, dict) else None
        if method == "initialize":
            session_id = uuid.uuid4().hex
            self.server.sessions.add(session_id)
        extra = {}
        if session_id:
            extra["Mcp-Session-Id"] = session_id
            extra["MCP-Protocol-Version"] = MCP_PROTOCOL
        if response is None:
            self.send_response(202)
            self.send_header("Content-Length", "0")
            for key, value in extra.items():
                self.send_header(key, value)
            self.end_headers()
            return
        accept = self.headers.get("Accept") or ""
        if "text/event-stream" in accept and "application/json" not in accept:
            data = json.dumps(response, ensure_ascii=False)
            body = ("event: message\ndata: " + data + "\n\n").encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self._cache_control = "no-cache"
            self.send_header("Content-Length", str(len(body)))
            for key, value in extra.items():
                self.send_header(key, value)
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass
            return
        self._send_json(200, response, extra)

    def do_DELETE(self):
        path = urlparse(self.path).path
        if not self._mcp_path(path):
            self._send_json(404, {"ok": False, "error": "Not found"})
            return
        if not self._authorized(path):
            self._deny()
            return
        session_id = self.headers.get("Mcp-Session-Id")
        if session_id:
            self.server.sessions.discard(session_id)
        self._send_json(200, {"ok": True})


# ---------------------------------------------------------------------------
# stdio-режим (Claude Desktop)
# ---------------------------------------------------------------------------

def run_stdio(store: Store):
    toolbox = ToolBox(store)
    sys.stderr.write("Пробка MCP (stdio). Данные: %s\n" % (store.dir / "doc.json"))
    sys.stderr.flush()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception as exc:
            print(json.dumps({"jsonrpc": "2.0", "id": None,
                              "error": {"code": -32700, "message": f"Parse error: {exc}"}}), flush=True)
            continue
        if isinstance(req, list):
            print(json.dumps({"jsonrpc": "2.0", "id": None,
                              "error": {"code": -32600, "message": "Batch не поддерживается"}}), flush=True)
            continue
        try:
            response = mcp_process(toolbox, req)
        except Exception as exc:
            response = rpc_error(req.get("id") if isinstance(req, dict) else None,
                                 -32603, f"Internal error: {exc}")
        if response is not None:
            print(json.dumps(response, ensure_ascii=False), flush=True)


# ---------------------------------------------------------------------------
# запуск
# ---------------------------------------------------------------------------

def lan_ip() -> str | None:
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.connect(("8.8.8.8", 80))
            return sock.getsockname()[0]
        finally:
            sock.close()
    except OSError:
        try:
            return socket.gethostbyname(socket.gethostname())
        except OSError:
            return None


def main(argv=None):
    parser = argparse.ArgumentParser(description="Пробка — локальный сервер с MCP")
    parser.add_argument("--host", default="0.0.0.0", help="Адрес (по умолчанию 0.0.0.0 — доступ с телефона)")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--data", default=str(ROOT / "data"), help="Папка данных")
    parser.add_argument("--stdio", action="store_true", help="MCP через stdin/stdout для Claude Desktop")
    parser.add_argument("--open", action="store_true", help="Открыть приложение в браузере")
    args = parser.parse_args(argv)

    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

    store = Store(Path(args.data).resolve())
    if args.stdio:
        run_stdio(store)
        return

    try:
        httpd = ProbkaHTTPServer((args.host, args.port), Handler, store)
    except OSError as exc:
        print(f"! Не удалось занять {args.host}:{args.port}: {exc}", file=sys.stderr)
        raise SystemExit(1)

    port = httpd.server_address[1]
    ip = lan_ip()
    print("")
    print("  ПРОБКА — доска времени")
    print("  ------------------------------------------------")
    print(f"  Приложение:  http://localhost:{port}/")
    if ip and args.host in ("0.0.0.0", "::"):
        print(f"  С телефона:  http://{ip}:{port}/")
    print(f"  MCP:         http://localhost:{port}/mcp/<токен>")
    print(f"  Токен:       {store.token}")
    print("  ------------------------------------------------")
    print("  Для ChatGPT нужен HTTPS-туннель, см. docs/MCP.md")
    print("  Остановить: Ctrl+C")
    print("")
    sys.stdout.flush()

    if args.open:
        import webbrowser
        webbrowser.open(f"http://localhost:{port}/")

    try:
        httpd.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        print("\nОстанавливаюсь…")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()



