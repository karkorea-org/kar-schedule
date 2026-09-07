use chrono::{DateTime, NaiveDate, Utc};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
};

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Task {
    pub id: String,
    pub title: String,
    pub start_date: String,
    pub end_date: String,
    pub notes: String,
    pub color: Option<String>,
    pub done: bool,
    pub sort_order: i64,
    pub display_row: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Layout {
    pub task_id: String,
    pub month_key: String,
    pub display_row: Option<i64>,
    pub sort_order: i64,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Color {
    pub hex: String,
    pub label: String,
    pub sort_order: i64,
}
#[derive(Clone, Serialize, Deserialize, Debug, Default)]
pub struct Snapshot {
    pub tasks: Vec<Task>,
    pub task_month_layout: Vec<Layout>,
    pub custom_colors: Vec<Color>,
}
#[derive(Serialize)]
pub struct Versioned {
    #[serde(flatten)]
    pub data: Snapshot,
    pub revision: i64,
}
fn date(s: &str) -> Result<NaiveDate, String> {
    let d = NaiveDate::parse_from_str(s, "%Y-%m-%d").map_err(|_| "존재하지 않는 날짜입니다.")?;
    if s.len() != 10 || d.format("%Y-%m-%d").to_string() != s || s < "0001-01-01" {
        return Err("날짜 형식을 확인하세요.".into());
    }
    Ok(d)
}
fn color(s: &str) -> bool {
    s.len() == 6
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'A'..=b'F').contains(&b))
}
fn row(n: Option<i64>) -> bool {
    n.is_none_or(|n| (0..=500).contains(&n))
}
pub fn validate(s: &Snapshot) -> Result<(), String> {
    if s.tasks.len() > 20000 || s.task_month_layout.len() > 100000 || s.custom_colors.len() > 512 {
        return Err("데이터 개수 제한을 초과했습니다.".into());
    }
    let mut ids = HashSet::new();
    for t in &s.tasks {
        if uuid::Uuid::parse_str(&t.id).is_err() || !ids.insert(&t.id) {
            return Err("업무 ID가 잘못되었거나 중복입니다.".into());
        }
        let days = (date(&t.end_date)? - date(&t.start_date)?).num_days();
        if !(0..=36600).contains(&days)
            || t.title.chars().count() > 1000
            || t.notes.chars().count() > 100000
            || !row(t.display_row)
            || !(0..=9007199254740991).contains(&t.sort_order)
            || t.color.as_ref().is_some_and(|s| !color(s))
        {
            return Err("업무 기간·내용·행·색상을 확인하세요.".into());
        }
        for v in [&t.created_at, &t.updated_at] {
            if !v.ends_with('Z') || DateTime::parse_from_rfc3339(v).is_err() {
                return Err("기록 시각이 올바르지 않습니다.".into());
            }
        }
    }
    let mut keys = HashSet::new();
    for l in &s.task_month_layout {
        let t = s
            .tasks
            .iter()
            .find(|t| t.id == l.task_id)
            .ok_or("월별 배치의 업무가 없습니다.")?;
        date(&format!("{}-01", l.month_key))?;
        if l.month_key.as_str() < &t.start_date[..7]
            || l.month_key.as_str() > &t.end_date[..7]
            || !row(l.display_row)
            || !(0..=9007199254740991).contains(&l.sort_order)
            || !keys.insert((&l.task_id, &l.month_key))
        {
            return Err("월별 배치 정보를 확인하세요.".into());
        }
    }
    let mut colors = HashSet::new();
    for c in &s.custom_colors {
        if !color(&c.hex)
            || c.label.trim().is_empty()
            || c.label.chars().count() > 100
            || !colors.insert(&c.hex)
            || !(0..=9007199254740991).contains(&c.sort_order)
        {
            return Err("사용자 색상을 확인하세요.".into());
        }
    }
    Ok(())
}
pub fn open(path: &Path) -> Result<Connection, String> {
    let mut c = Connection::open(path).map_err(|e| e.to_string())?;
    c.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    c.execute_batch("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;")
        .map_err(|e| e.to_string())?;
    let version: i64 = c
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if version > 1 {
        return Err("더 새로운 버전의 DB입니다. 최신 KAR 앱으로 열어주세요.".into());
    }
    if version == 0 {
        let tx = c.transaction().map_err(|e| e.to_string())?;
        tx.execute_batch(include_str!("../migrations/0001_initial.sql"))
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
    }
    let check: String = c
        .query_row("PRAGMA quick_check", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if check != "ok" {
        return Err(
            "DB 무결성 검사에 실패했습니다. 원본 DB를 보존하고 백업 복구가 필요합니다.".into(),
        );
    }
    // Machine-local metadata is deliberately excluded from portable Snapshot/JSON.
    c.execute_batch(
        "CREATE TABLE IF NOT EXISTS local_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)",
    )
    .map_err(|e| e.to_string())?;
    Ok(c)
}
pub fn load(c: &Connection) -> Result<Versioned, String> {
    let result = (|| -> rusqlite::Result<Versioned> {
        let mut s = Snapshot::default();
        let mut q=c.prepare("SELECT id,title,start_date,end_date,notes,color,done,sort_order,display_row,created_at,updated_at FROM tasks ORDER BY sort_order,start_date,id")?;
        s.tasks = q
            .query_map([], |r| {
                Ok(Task {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    start_date: r.get(2)?,
                    end_date: r.get(3)?,
                    notes: r.get(4)?,
                    color: r.get(5)?,
                    done: r.get(6)?,
                    sort_order: r.get(7)?,
                    display_row: r.get(8)?,
                    created_at: r.get(9)?,
                    updated_at: r.get(10)?,
                })
            })?
            .collect::<rusqlite::Result<_>>()?;
        let mut q=c.prepare("SELECT task_id,month_key,display_row,sort_order FROM task_month_layout ORDER BY task_id,month_key")?;
        s.task_month_layout = q
            .query_map([], |r| {
                Ok(Layout {
                    task_id: r.get(0)?,
                    month_key: r.get(1)?,
                    display_row: r.get(2)?,
                    sort_order: r.get(3)?,
                })
            })?
            .collect::<rusqlite::Result<_>>()?;
        let mut q =
            c.prepare("SELECT hex,label,sort_order FROM custom_colors ORDER BY sort_order,hex")?;
        s.custom_colors = q
            .query_map([], |r| {
                Ok(Color {
                    hex: r.get(0)?,
                    label: r.get(1)?,
                    sort_order: r.get(2)?,
                })
            })?
            .collect::<rusqlite::Result<_>>()?;
        let revision = c.query_row("SELECT revision FROM app_meta WHERE id=1", [], |r| r.get(0))?;
        Ok(Versioned { data: s, revision })
    })();
    result.map_err(|e| e.to_string())
}
pub fn backup(c: &Connection, dir: &Path) -> Result<PathBuf, String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let dest = dir.join(format!(
        "KAR-Recovery-{}-{}.db",
        Utc::now().format("%Y%m%d-%H%M%S"),
        uuid::Uuid::new_v4()
    ));
    c.backup(rusqlite::MAIN_DB, &dest, None)
        .map_err(|e| e.to_string())?;
    let verify = Connection::open(&dest).map_err(|e| e.to_string())?;
    let result: String = verify
        .query_row("PRAGMA quick_check", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if result != "ok" {
        return Err("복구 백업 검증에 실패했습니다.".into());
    }
    drop(verify);
    let mut previous: Vec<_> = std::fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .filter(|e| {
            e.file_name().to_string_lossy().starts_with("KAR-Recovery-")
                && e.path().extension().is_some_and(|e| e == "db")
        })
        .collect();
    previous.sort_by_key(|e| e.file_name());
    let excess = previous.len().saturating_sub(10);
    for e in previous.into_iter().take(excess) {
        let _ = std::fs::remove_file(e.path());
    }
    Ok(dest)
}
pub fn read_recovery(path: &Path) -> Result<Snapshot, String> {
    if std::fs::metadata(path).map_err(|e| e.to_string())?.len() > 80 * 1024 * 1024 {
        return Err("복구 사본 크기가 80MB를 초과합니다.".into());
    }
    let c = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| e.to_string())?;
    let version: i64 = c
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if version != 1 {
        return Err("지원하지 않는 복구 사본 버전입니다.".into());
    }
    let check: String = c
        .query_row("PRAGMA quick_check", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if check != "ok" {
        return Err("손상된 복구 사본입니다.".into());
    }
    let snapshot = load(&c)?.data;
    validate(&snapshot)?;
    Ok(snapshot)
}
pub fn commit(
    c: &mut Connection,
    s: Snapshot,
    revision: i64,
    protect: bool,
    backup_dir: &Path,
) -> Result<Versioned, String> {
    commit_with_link(c, s, revision, protect, backup_dir, None)
}
pub fn commit_with_link(
    c: &mut Connection,
    s: Snapshot,
    revision: i64,
    protect: bool,
    backup_dir: &Path,
    link: Option<&str>,
) -> Result<Versioned, String> {
    validate(&s)?;
    let current: i64 = c
        .query_row("SELECT revision FROM app_meta WHERE id=1", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if current != revision {
        return Err(
            "다른 저장이 먼저 완료되었습니다. 앱을 다시 열어 최신 데이터를 불러오세요.".into(),
        );
    }
    if protect {
        backup(c, backup_dir)?;
    }
    let result = (|| -> rusqlite::Result<()> {
        let tx = c.transaction()?;
        tx.execute_batch(
            "DELETE FROM task_month_layout; DELETE FROM tasks; DELETE FROM custom_colors;",
        )?;
        for t in &s.tasks {
            tx.execute(
                "INSERT INTO tasks VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
                params![
                    t.id,
                    t.title,
                    t.start_date,
                    t.end_date,
                    t.notes,
                    t.color,
                    t.done,
                    t.sort_order,
                    t.display_row,
                    t.created_at,
                    t.updated_at
                ],
            )?;
        }
        for l in &s.task_month_layout {
            tx.execute(
                "INSERT INTO task_month_layout VALUES (?1,?2,?3,?4)",
                params![l.task_id, l.month_key, l.display_row, l.sort_order],
            )?;
        }
        for p in &s.custom_colors {
            tx.execute(
                "INSERT INTO custom_colors VALUES (?1,?2,?3)",
                params![p.hex, p.label, p.sort_order],
            )?;
        }
        tx.execute("UPDATE app_meta SET revision=revision+1 WHERE id=1", [])?;
        if let Some(value) = link {
            tx.execute(
                "INSERT OR REPLACE INTO local_settings VALUES('linked_excel',?1)",
                [value],
            )?;
        }
        tx.commit()
    })();
    result.map_err(|e| format!("저장하지 못했습니다. 기존 데이터는 유지됩니다: {e}"))?;
    load(c)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Snapshot {
        serde_json::from_str(r#"{"tasks":[{"id":"50b076b2-67fc-41ad-bacf-508f6582471f","title":"테스트","start_date":"2026-09-28","end_date":"2026-10-03","notes":"메모\n둘째 줄","color":"A9D18E","done":true,"sort_order":0,"display_row":null,"created_at":"2026-09-07T00:00:00Z","updated_at":"2026-09-07T00:00:00Z"}],"task_month_layout":[],"custom_colors":[]}"#).unwrap()
    }
    #[test]
    fn restart_conflict_and_rollback() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("test.db");
        let mut c = open(&p).unwrap();
        commit(&mut c, fixture(), 0, false, d.path()).unwrap();
        assert!(commit(&mut c, fixture(), 0, false, d.path()).is_err());
        c.execute_batch("CREATE TRIGGER fail_write BEFORE INSERT ON tasks BEGIN SELECT RAISE(ABORT,'disk failure'); END;").unwrap();
        assert!(commit(&mut c, fixture(), 1, false, d.path()).is_err());
        drop(c);
        let c = open(&p).unwrap();
        let s = load(&c).unwrap();
        assert_eq!(s.revision, 1);
        assert_eq!(s.data.tasks.len(), 1);
        assert!(s.data.tasks[0].done);
    }
    #[test]
    fn snapshot_backup_and_invalid_date() {
        let d = tempfile::tempdir().unwrap();
        let mut c = open(&d.path().join("test.db")).unwrap();
        commit(&mut c, fixture(), 0, false, d.path()).unwrap();
        let path = backup(&c, &d.path().join("backups")).unwrap();
        assert_eq!(load(&open(&path).unwrap()).unwrap().data.tasks.len(), 1);
        let mut bad = fixture();
        bad.tasks[0].start_date = "2026-02-30".into();
        assert!(commit(&mut c, bad, 1, false, d.path()).is_err());
        assert_eq!(load(&c).unwrap().revision, 1);
    }
    #[test]
    fn recovery_is_read_only_and_rejects_corrupt_or_future_files() {
        let d = tempfile::tempdir().unwrap();
        let source = d.path().join("source.db");
        let mut c = open(&source).unwrap();
        commit(&mut c, fixture(), 0, false, d.path()).unwrap();
        drop(c);
        let before = std::fs::read(&source).unwrap();
        let restored = read_recovery(&source).unwrap();
        assert_eq!(restored.tasks[0].notes, "메모\n둘째 줄");
        assert_eq!(std::fs::read(&source).unwrap(), before);
        let c = Connection::open(&source).unwrap();
        c.execute_batch("PRAGMA user_version=99").unwrap();
        drop(c);
        assert!(read_recovery(&source).is_err());
        let corrupt = d.path().join("corrupt.db");
        std::fs::write(&corrupt, b"truncated database").unwrap();
        assert!(read_recovery(&corrupt).is_err());
        assert_eq!(std::fs::read(corrupt).unwrap(), b"truncated database");
    }
}
