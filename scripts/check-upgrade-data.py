"""Verify Windows startup preserves an existing database and Excel connection in CI."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import sys

assert os.environ.get("GITHUB_ACTIONS") == "true", "This fixture is for the disposable CI runner only."
mode, database = sys.argv[1:]
work = Path(os.environ["RUNNER_TEMP"]) / "kar-upgrade-check"
tables = ["tasks", "task_month_layout", "custom_colors", "app_meta", "schema_migrations", "local_settings"]

def state(connection):
    return {table: connection.execute(f"SELECT * FROM {table} ORDER BY 1").fetchall() for table in tables}

if mode == "seed":
    work.mkdir()
    workbook = work / "existing-work.xlsx"
    shutil.copy2("tests/fixtures/v2.0.3-schedule.xlsx", workbook)
    snapshot = json.loads(Path("tests/fixtures/v2.0.3-snapshot.json").read_text(encoding="utf-8"))
    with sqlite3.connect(database) as db:
        assert db.execute("SELECT count(*) FROM tasks").fetchone()[0] == 0
        assert db.execute("SELECT revision FROM app_meta").fetchone()[0] == 0
        for task in snapshot["tasks"]:
            columns = list(task)
            db.execute(f"INSERT INTO tasks ({','.join(columns)}) VALUES ({','.join('?' for _ in columns)})", list(task.values()))
        db.execute("INSERT INTO task_month_layout VALUES (?, '2026-09', 0, 0)", [snapshot["tasks"][0]["id"]])
        for color in snapshot["custom_colors"]:
            db.execute("INSERT INTO custom_colors VALUES (?, ?, ?)", [color["hex"], color["label"], color["sort_order"]])
        link = dict(path=str(workbook), sheet="Sheet2", hash=hashlib.sha256(workbook.read_bytes()).hexdigest(), saved_revision=41, template_year=None)
        db.execute("INSERT INTO local_settings VALUES ('linked_excel', ?)", [json.dumps(link)])
        db.execute("UPDATE app_meta SET revision=41")
        before = state(db)
    (work / "before.json").write_text(json.dumps(before, ensure_ascii=False), encoding="utf-8")
    print("Seeded an existing schema-1 schedule and Excel connection in the disposable Windows runner.")
elif mode == "verify":
    before = json.loads((work / "before.json").read_text(encoding="utf-8"))
    with sqlite3.connect(Path(database).as_uri() + "?mode=ro", uri=True) as db:
        after = json.loads(json.dumps(state(db)))
        assert db.execute("PRAGMA user_version").fetchone()[0] == 1
    assert after == before, "Existing tasks, notes, palette, revision, or connection changed during startup."
    link = json.loads(dict(after["local_settings"])["linked_excel"])
    assert hashlib.sha256(Path(link["path"]).read_bytes()).hexdigest() == link["hash"]
    print("Existing tasks, notes, row layout, colors, schema, revision, Excel path and file survived restart unchanged.")
else:
    raise ValueError(mode)
