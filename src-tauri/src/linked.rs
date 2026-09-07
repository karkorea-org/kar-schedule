use crate::{database, Store};
use database::{Snapshot, Versioned};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    io::Write,
    path::{Path, PathBuf},
};
use tauri::{Manager, State};

#[derive(Clone, Serialize, Deserialize)]
pub struct Link {
    pub path: PathBuf,
    pub sheet: String,
    pub hash: String,
    pub saved_revision: i64,
    #[serde(default)]
    pub template_year: Option<i32>,
}
pub struct Pending {
    pub token: String,
    pub path: PathBuf,
    pub hash: String,
}
#[derive(Serialize)]
pub struct Selection {
    token: String,
    name: String,
    bytes: Vec<u8>,
}
#[derive(Serialize)]
pub struct Read {
    pub info: Link,
    pub bytes: Vec<u8>,
}
pub fn hash(b: &[u8]) -> String {
    format!("{:x}", Sha256::digest(b))
}
fn read_file(path: &Path) -> Result<Vec<u8>, String> {
    if std::fs::metadata(path)
        .map_err(|_| {
            "연결된 Excel을 찾을 수 없습니다. 폴더 연결을 확인하거나 Excel을 다시 연결하세요."
        })?
        .len()
        > 30 * 1024 * 1024
    {
        return Err("연결 Excel은 30MB 이내여야 합니다.".into());
    }
    std::fs::read(path).map_err(|e| format!("Excel을 읽지 못했습니다: {e}"))
}
pub fn get(c: &Connection) -> Result<Option<Link>, String> {
    let value: Option<String> = c
        .query_row(
            "SELECT value FROM local_settings WHERE key='linked_excel'",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    value
        .map(|s| {
            serde_json::from_str(&s).map_err(|e| format!("Excel 연결 정보를 읽지 못했습니다: {e}"))
        })
        .transpose()
}
#[tauri::command]
pub async fn connection_info(store: State<'_, Store>) -> Result<Option<Link>, String> {
    let db = store.db.lock().map_err(|_| "저장소 잠금 오류")?;
    get(&db)
}
#[tauri::command]
pub async fn select_excel(app: tauri::AppHandle) -> Result<Option<Selection>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<Store>();
        let mut dialog = rfd::FileDialog::new()
            .set_title("KAR — 업무 Excel 선택 (새 빈 파일도 가능)")
            .add_filter("Excel 업무 일정", &["xlsx"]);
        if let Some(dir) = store.last_dir.lock().unwrap().as_ref() {
            dialog = dialog.set_directory(dir);
        }
        let Some(path) = dialog.pick_file() else {
            return Ok(None);
        };
        let path = path.canonicalize().map_err(|e| e.to_string())?;
        if !path
            .extension()
            .is_some_and(|e| e.to_string_lossy().eq_ignore_ascii_case("xlsx"))
        {
            return Err(".xlsx 파일을 연결하세요.".into());
        }
        let bytes = read_file(&path)?;
        let token = uuid::Uuid::new_v4().to_string();
        *store.last_dir.lock().unwrap() = path.parent().map(Path::to_path_buf);
        store.imported.lock().unwrap().insert(path.clone());
        *store.pending_excel.lock().unwrap() = Some(Pending {
            token: token.clone(),
            path: path.clone(),
            hash: hash(&bytes),
        });
        Ok(Some(Selection {
            token,
            name: path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into(),
            bytes,
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn connect_excel(
    store: State<'_, Store>,
    token: String,
    sheet: String,
    snapshot: Snapshot,
    revision: i64,
    template_year: Option<i32>,
) -> Result<Versioned, String> {
    if template_year.is_some_and(|y| !(1900..=9999).contains(&y)) {
        return Err("업무일지 연도를 확인하세요.".into());
    }
    if sheet.is_empty() || sheet.len() > 124 || sheet == "ColorDB" {
        return Err("일정 시트를 선택하세요.".into());
    }
    let mut pending = store.pending_excel.lock().map_err(|_| "연결 잠금 오류")?;
    let p = pending
        .as_ref()
        .filter(|p| p.token == token)
        .ok_or("Excel을 다시 선택하세요.")?;
    if hash(&read_file(&p.path)?) != p.hash {
        return Err("선택한 뒤 Excel이 변경됐습니다. 다시 연결하세요.".into());
    }
    let info = Link {
        path: p.path.clone(),
        sheet,
        hash: p.hash.clone(),
        saved_revision: if template_year.is_some() { revision } else { revision + 1 },
        template_year,
    };
    let json = serde_json::to_string(&info).map_err(|e| e.to_string())?;
    let mut db = store.db.lock().map_err(|_| "저장소 잠금 오류")?;
    let result = database::commit_with_link(
        &mut db,
        snapshot,
        revision,
        true,
        &store.backups,
        Some(&json),
    )?;
    store.imported.lock().unwrap().insert(p.path.clone());
    *pending = None;
    Ok(result)
}
#[tauri::command]
pub async fn read_linked_excel(store: State<'_, Store>) -> Result<Read, String> {
    let db = store.db.lock().map_err(|_| "저장소 잠금 오류")?;
    let info = get(&db)?.ok_or("먼저 Excel 연결로 본인 업무 파일을 선택하세요.")?;
    let bytes = read_file(&info.path)?;
    if hash(&bytes) != info.hash {
        return Err("Excel 또는 FreeFileSync에서 파일이 변경됐습니다. 덮어쓰지 않았습니다. 현재 일정을 백업한 뒤 Excel을 다시 연결하세요.".into());
    }
    Ok(Read { info, bytes })
}
pub fn write_checked(link: &Link, bytes: &[u8], backup_dir: &Path) -> Result<String, String> {
    if bytes.len() > 30 * 1024 * 1024 || !bytes.starts_with(b"PK") {
        return Err("저장할 Excel 형식 또는 크기를 확인하세요.".into());
    }
    let parent = link.path.parent().ok_or("저장 폴더를 찾을 수 없습니다.")?;
    let lock = parent.join(format!(
        "~${}",
        link.path.file_name().unwrap_or_default().to_string_lossy()
    ));
    if lock.exists() {
        return Err("Excel에서 파일이 열려 있습니다. Excel 파일을 닫고 다시 저장하세요.".into());
    }
    let old = read_file(&link.path)?;
    if hash(&old) != link.hash {
        return Err("연결 파일이 외부에서 변경되어 저장하지 않았습니다. 현재 일정을 백업한 뒤 Excel을 다시 연결하세요.".into());
    }
    std::fs::create_dir_all(backup_dir)
        .map_err(|e| format!("Excel 복구 사본 폴더 생성 실패: {e}"))?;
    let backup_path = backup_dir.join(format!(
        "KAR-Excel-{}-{}.xlsx",
        chrono::Utc::now().format("%Y%m%d-%H%M%S"),
        uuid::Uuid::new_v4()
    ));
    let mut backup = tempfile::NamedTempFile::new_in(backup_dir).map_err(|e| e.to_string())?;
    backup.write_all(&old).map_err(|e| e.to_string())?;
    backup.as_file().sync_all().map_err(|e| e.to_string())?;
    backup.persist(&backup_path).map_err(|e| e.to_string())?;
    let mut temp = tempfile::NamedTempFile::new_in(parent)
        .map_err(|e| format!("Excel 임시 파일 생성 실패: {e}"))?;
    temp.write_all(bytes).map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    if lock.exists() || hash(&read_file(&link.path)?) != link.hash {
        return Err("저장 도중 Excel이 변경되거나 열려 저장을 중단했습니다.".into());
    }
    temp.persist(&link.path)
        .map_err(|e| format!("Excel 저장 실패. 파일 잠금·폴더 권한을 확인하세요: {e}"))?;
    let saved = hash(bytes);
    if hash(&read_file(&link.path)?) != saved {
        return Err("Excel 저장 직후 외부 변경이 감지됐습니다. 파일 내용을 확인하세요.".into());
    }
    let mut previous: Vec<_> = std::fs::read_dir(backup_dir)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .filter(|e| {
            e.file_name().to_string_lossy().starts_with("KAR-Excel-")
                && e.path().extension().is_some_and(|x| x == "xlsx")
        })
        .collect();
    previous.sort_by_key(|e| e.file_name());
    let extra = previous.len().saturating_sub(10);
    for e in previous.into_iter().take(extra) {
        let _ = std::fs::remove_file(e.path());
    }
    Ok(saved)
}
#[tauri::command]
pub async fn save_linked_excel(
    store: State<'_, Store>,
    bytes: Vec<u8>,
    revision: i64,
) -> Result<Link, String> {
    let db = store.db.lock().map_err(|_| "저장소 잠금 오류")?;
    if database::load(&db)?.revision != revision {
        return Err("일정이 변경됐습니다. 다시 저장하세요.".into());
    }
    let mut info = get(&db)?.ok_or("먼저 Excel을 연결하세요.")?;
    info.hash = write_checked(&info, &bytes, &store.backups.join("excel"))?;
    info.saved_revision = revision;
    db.execute(
        "UPDATE local_settings SET value=?1 WHERE key='linked_excel'",
        [serde_json::to_string(&info).map_err(|e| e.to_string())?],
    )
    .map_err(|e| {
        format!("Excel은 저장됐지만 연결 기록 저장에 실패했습니다. 다시 연결하세요: {e}")
    })?;
    Ok(info)
}
#[tauri::command]
pub async fn disconnect_excel(store: State<'_, Store>) -> Result<(), String> {
    store
        .db
        .lock()
        .map_err(|_| "저장소 잠금 오류")?
        .execute("DELETE FROM local_settings WHERE key='linked_excel'", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn connection_and_snapshot_commit_together_and_survive_restart() {
        let d=tempfile::tempdir().unwrap();let path=d.path().join("test.db");
        let mut c=database::open(&path).unwrap();
        let link=Link{path:d.path().join("업무.xlsx"),sheet:"Sheet2".into(),hash:"original".into(),saved_revision:1,template_year:Some(2027)};
        let json=serde_json::to_string(&link).unwrap();
        database::commit_with_link(&mut c,Snapshot::default(),0,true,&d.path().join("backups"),Some(&json)).unwrap();
        drop(c);let mut c=database::open(&path).unwrap();assert_eq!(get(&c).unwrap().unwrap().saved_revision,1);
        assert_eq!(get(&c).unwrap().unwrap().template_year, Some(2027));
        c.execute_batch("CREATE TRIGGER reject_metadata BEFORE INSERT ON local_settings BEGIN SELECT RAISE(ABORT,'failed metadata'); END;").unwrap();
        assert!(database::commit_with_link(&mut c,Snapshot::default(),1,false,d.path(),Some("{}" )).is_err());
        assert_eq!(database::load(&c).unwrap().revision,1);assert_eq!(get(&c).unwrap().unwrap().hash,"original");
    }
    #[test]
    fn previous_version_links_remain_readable() {
        let old = r#"{"path":"work.xlsx","sheet":"Sheet2","hash":"old","saved_revision":1}"#;
        let link: Link = serde_json::from_str(old).unwrap();
        assert_eq!(link.template_year, None);
        assert_eq!(link.saved_revision, 1);
    }
    #[test]
    fn save_preserves_previous_file_and_rejects_external_changes_and_excel_lock() {
        let d = tempfile::tempdir().unwrap();
        let path = d.path().join("업무.xlsx");
        std::fs::write(&path, b"PK-original").unwrap();
        let link = Link {
            path: path.clone(),
            sheet: "Sheet2".into(),
            hash: hash(b"PK-original"),
            saved_revision: 0,
            template_year: None,
        };
        let backup = d.path().join("backups");
        let h = write_checked(&link, b"PK-updated", &backup).unwrap();
        assert_eq!(h, hash(b"PK-updated"));
        let saved = std::fs::read_dir(&backup)
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        assert_eq!(std::fs::read(saved).unwrap(), b"PK-original");
        assert!(write_checked(&link, b"PK-stale", &backup).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"PK-updated");
        let link = Link { hash: h, ..link };
        std::fs::write(d.path().join("~$업무.xlsx"), b"lock").unwrap();
        assert!(write_checked(&link, b"PK-blocked", &backup).is_err());
        assert_eq!(std::fs::read(path).unwrap(), b"PK-updated");
    }
}
