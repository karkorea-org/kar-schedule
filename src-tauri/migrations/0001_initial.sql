CREATE TABLE tasks (
 id TEXT PRIMARY KEY NOT NULL, title TEXT NOT NULL, start_date TEXT NOT NULL,
 end_date TEXT NOT NULL CHECK(end_date>=start_date), notes TEXT NOT NULL,
 color TEXT, done INTEGER NOT NULL CHECK(done IN(0,1)), sort_order INTEGER NOT NULL CHECK(sort_order>=0),
 display_row INTEGER CHECK(display_row IS NULL OR display_row BETWEEN 0 AND 500),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_tasks_dates ON tasks(start_date,end_date);
CREATE TABLE task_month_layout (
 task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
 month_key TEXT NOT NULL, display_row INTEGER CHECK(display_row IS NULL OR display_row BETWEEN 0 AND 500),
 sort_order INTEGER NOT NULL CHECK(sort_order>=0), PRIMARY KEY(task_id,month_key)
);
CREATE TABLE custom_colors(hex TEXT PRIMARY KEY NOT NULL,label TEXT NOT NULL,sort_order INTEGER NOT NULL);
CREATE TABLE app_meta(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL);
INSERT INTO app_meta VALUES(1,0);
CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL);
INSERT INTO schema_migrations VALUES(1,'initial',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
PRAGMA user_version=1;
