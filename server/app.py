#!/usr/bin/env python3

from __future__ import annotations

import asyncio
import json
import os
import re
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

try:
    from notebooklm import NotebookLMClient
except ImportError:
    NotebookLMClient = None


ROOT = Path(__file__).resolve().parent.parent


def load_env_file(env_path: Path) -> None:
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


load_env_file(ROOT / ".env")

EXPORT_DIR = Path(os.getenv("EXPORT_DIR", ROOT / "exports")).resolve()
HOST = os.getenv("NOTEBOOKLM_BRIDGE_HOST", "127.0.0.1")
PORT = int(os.getenv("NOTEBOOKLM_BRIDGE_PORT", "8765"))
DEFAULT_NOTEBOOK_ID = os.getenv("NOTEBOOKLM_NOTEBOOK_ID", "").strip()
DEFAULT_NOTEBOOK_TITLE = os.getenv("NOTEBOOKLM_NOTEBOOK_TITLE", "").strip()
MAX_CONTENT_CHARS = int(os.getenv("MAX_CONTENT_CHARS", "180000"))


def slugify(value: str) -> str:
    value = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower())
    value = re.sub(r"-{2,}", "-", value).strip("-")
    return value or "captured-page"


def shorten_text(value: str, limit: int) -> tuple[str, bool]:
    if len(value) <= limit:
        return value, False
    return value[: limit - 1].rstrip() + "\n\n[Content truncated before upload.]", True


def build_markdown(payload: dict[str, Any]) -> str:
    title = payload.get("title") or "Untitled page"
    url = payload.get("url") or ""
    description = payload.get("description") or ""
    selected_text = payload.get("selectedText") or ""
    body = payload.get("markdown") or payload.get("textContent") or ""
    use_selection = payload.get("includeSelectionFirst", True)

    sections = [f"# {title}"]

    if url:
        sections.append(f"Source URL: {url}")
    if description:
        sections.append(f"Description: {description}")
    if payload.get("capturedAt"):
        sections.append(f"Captured At: {payload['capturedAt']}")

    content = selected_text if use_selection and selected_text else body
    if selected_text and use_selection:
        sections.append("## Highlighted Selection")
        sections.append(selected_text)
        if body and selected_text != body:
            sections.append("## Full Extracted Content")
            sections.append(body)
    else:
        sections.append("## Extracted Content")
        sections.append(content)

    return "\n\n".join(section.strip() for section in sections if section.strip()).strip() + "\n"


def save_markdown(payload: dict[str, Any], markdown: str) -> Path:
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    hostname = slugify(urlparse(payload.get("url") or "").netloc or "local")
    title_slug = slugify(payload.get("title") or "captured-page")
    path = EXPORT_DIR / f"{timestamp}-{hostname}-{title_slug}.md"
    path.write_text(markdown, encoding="utf-8")
    return path


async def ensure_notebook(client: Any, notebook_id: str, notebook_title: str) -> str:
    if notebook_id:
        return notebook_id

    if not notebook_title:
        return ""

    notebooks = await client.notebooks.list()
    for notebook in notebooks:
        current_title = getattr(notebook, "title", "")
        current_id = getattr(notebook, "id", "")
        if isinstance(notebook, dict):
            current_title = current_title or notebook.get("title", "")
            current_id = current_id or notebook.get("id", "")
        if current_title == notebook_title:
            return current_id

    created = await client.notebooks.create(notebook_title)
    created_id = getattr(created, "id", "")
    if isinstance(created, dict):
        created_id = created_id or created.get("id", "")
    return created_id


async def upload_to_notebook(payload: dict[str, Any], markdown: str) -> str:
    if NotebookLMClient is None:
        raise RuntimeError(
            "notebooklm-py is not installed. Run `pip install \"notebooklm-py[browser]\"` first."
        )

    notebook_id = (payload.get("notebookId") or DEFAULT_NOTEBOOK_ID or "").strip()
    notebook_title = (payload.get("notebookTitle") or DEFAULT_NOTEBOOK_TITLE or "").strip()
    source_mode = payload.get("sourceMode") or "text"
    source_name = payload.get("title") or "Captured page"
    source_url = (payload.get("url") or "").strip()

    async with await NotebookLMClient.from_storage() as client:
        notebook_id = await ensure_notebook(client, notebook_id, notebook_title)

        if not notebook_id:
            return ""

        if source_mode in {"text", "text-and-url"}:
            await client.sources.add_text(notebook_id, source_name, markdown)

        if source_mode in {"url", "text-and-url"} and source_url:
            await client.sources.add_url(notebook_id, source_url)

        return notebook_id


class NotebookLMBridgeHandler(BaseHTTPRequestHandler):
    server_version = "NotebookLMBridge/0.1"

    def _send_json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_GET(self) -> None:
        if self.path != "/health":
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})
            return

        self._send_json(
            HTTPStatus.OK,
            {
                "ok": True,
                "message": "NotebookLM bridge is running.",
                "exportDir": str(EXPORT_DIR),
                "hasNotebookLMClient": NotebookLMClient is not None,
            },
        )

    def do_POST(self) -> None:
        if self.path != "/ingest":
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(content_length)
            payload = json.loads(raw_body.decode("utf-8"))

            markdown = build_markdown(payload)
            markdown, truncated = shorten_text(markdown, MAX_CONTENT_CHARS)
            saved_path = save_markdown(payload, markdown)

            notebook_id = asyncio.run(upload_to_notebook(payload, markdown))
            saved_only = not notebook_id

            if saved_only:
                message = "Page captured locally. Set a notebook ID or notebook title to upload it to NotebookLM."
            else:
                message = "Page captured and uploaded to NotebookLM."

            if truncated:
                message += " Content was truncated before upload."

            self._send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "message": message,
                    "notebookId": notebook_id,
                    "savedPath": str(saved_path),
                    "savedOnly": saved_only,
                },
            )
        except Exception as exc:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})


def main() -> None:
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer((HOST, PORT), NotebookLMBridgeHandler)
    print(f"NotebookLM bridge listening on http://{HOST}:{PORT}")
    print(f"Saving captured pages to {EXPORT_DIR}")
    server.serve_forever()


if __name__ == "__main__":
    main()
