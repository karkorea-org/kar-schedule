#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod database;
mod linked;
use database::{Snapshot, Versioned};
use serde::Serialize;
use std::{collections::HashSet, io::Write, path::PathBuf, sync::Mutex};
use tauri::{Manager, State};
struct Store {
    db: Mutex<rusqlite::Connection>,
    path: PathBuf,
    backups: PathBuf,
    imported: Mutex<HashSet<PathBuf>>,
    last_dir: Mutex<Option<PathBuf>>,
    pending_excel: Mutex<Option<linked::Pending>>,
}
#[tauri::command]
async fn load_snapshot(store: State<'_, Store>) -> Result<Versioned, String> {
    let db = store.db.lock().map_err(|_| "저장소 잠금 오류")?;
    database::load(&db)
}
#[tauri::command]
async fn commit_snapshot(
    store: State<'_, Store>,
    snapshot: Snapshot,
    revision: i64,
    protect: bool,
) -> Result<Versioned, String> {
    let mut db = store.db.lock().map_err(|_| "저장소 잠금 오류")?;
    database::commit(&mut db, snapshot, revision, protect, &store.backups)
}
#[derive(Serialize)]
struct Info {
    database: String,
    backup_directory: String,
}
#[tauri::command]
fn app_info(store: State<'_, Store>) -> Info {
    Info {
        database: store.path.to_string_lossy().into(),
        backup_directory: store.backups.to_string_lossy().into(),
    }
}
#[derive(Serialize)]
struct Opened {
    name: String,
    bytes: Vec<u8>,
}
#[derive(Serialize)]
struct Recovery {
    name: String,
    data: Snapshot,
}
#[tauri::command]
async fn open_recovery(app: tauri::AppHandle) -> Result<Option<Recovery>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<Store>();
        let Some(path) = rfd::FileDialog::new()
            .set_title("KAR — 자동 복구 사본 선택")
            .set_directory(&store.backups)
            .add_filter("SQLite 복구 사본", &["db"])
            .pick_file()
        else {
            return Ok(None);
        };
        let data = database::read_recovery(&path)?;
        Ok(Some(Recovery {
            name: path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into(),
            data,
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn open_document(app: tauri::AppHandle, kind: String) -> Result<Option<Opened>, String> {
    if kind != "excel" && kind != "json" {
        return Err("지원하지 않는 파일 종류입니다.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<Store>();
        let ext = if kind == "excel" { "xlsx" } else { "json" };
        let mut dialog = rfd::FileDialog::new()
            .set_title("KAR — 가져올 파일 선택")
            .add_filter("KAR 파일", &[ext]);
        if let Some(dir) = store.last_dir.lock().unwrap().as_ref() {
            dialog = dialog.set_directory(dir);
        }
        let Some(path) = dialog.pick_file() else {
            return Ok(None);
        };
        let canonical = path.canonicalize().map_err(|e| e.to_string())?;
        if std::fs::metadata(&canonical)
            .map_err(|e| e.to_string())?
            .len()
            > 30 * 1024 * 1024
        {
            return Err("파일 크기가 30MB를 초과합니다.".into());
        }
        let bytes =
            std::fs::read(&canonical).map_err(|e| format!("파일을 읽지 못했습니다: {e}"))?;
        store.imported.lock().unwrap().insert(canonical);
        *store.last_dir.lock().unwrap() = path.parent().map(|p| p.to_path_buf());
        Ok(Some(Opened {
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
async fn save_document(
    app: tauri::AppHandle,
    kind: String,
    name: String,
    bytes: Vec<u8>,
) -> Result<Option<String>, String> {
    if !["excel", "json"].contains(&kind.as_str()) || bytes.len() > 80 * 1024 * 1024 {
        return Err("저장할 파일 형식이나 크기를 확인하세요.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<Store>();
        let ext = if kind == "excel" { "xlsx" } else { "json" };
        let safe_name = std::path::Path::new(&name)
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let mut dialog = rfd::FileDialog::new()
            .set_title("KAR — 새 파일로 저장")
            .set_file_name(safe_name)
            .add_filter("KAR 파일", &[ext]);
        if let Some(dir) = store.last_dir.lock().unwrap().as_ref() {
            dialog = dialog.set_directory(dir);
        }
        let Some(mut path) = dialog.save_file() else {
            return Ok(None);
        };
        if path.extension().is_none() {
            path.set_extension(ext);
        }
        if !path
            .extension()
            .is_some_and(|v| v.to_string_lossy().eq_ignore_ascii_case(ext))
        {
            return Err(format!(".{ext} 확장자로 저장하세요."));
        }
        if path.exists() {
            let canonical = path.canonicalize().map_err(|e| e.to_string())?;
            if canonical == store.path
                || canonical.starts_with(&store.backups)
                || store.imported.lock().unwrap().contains(&canonical)
            {
                return Err("원본 파일 보호를 위해 다른 이름으로 저장하세요.".into());
            }
        }
        let parent = path.parent().ok_or("저장 폴더를 찾을 수 없습니다.")?;
        let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
        temp.write_all(&bytes)
            .map_err(|e| format!("파일 쓰기 실패: {e}"))?;
        temp.as_file().sync_all().map_err(|e| e.to_string())?;
        temp.persist(&path).map_err(|e| {
            format!("저장 실패: 파일이 다른 프로그램에서 열려 있는지 확인하세요. {e}")
        })?;
        *store.last_dir.lock().unwrap() = Some(parent.to_path_buf());
        Ok(Some(path.to_string_lossy().into()))
    })
    .await
    .map_err(|e| e.to_string())?
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let path = dir.join("kar-schedule.sqlite3");
            let backups = dir.join("backups");
            let db = match database::open(&path) {
                Ok(c) => c,
                Err(e) => {
                    rfd::MessageDialog::new()
                        .set_title("KAR 저장소를 열 수 없습니다")
                        .set_description(format!(
                            "{e}\n\n기존 파일은 그대로 보존됩니다.\n{}",
                            path.display()
                        ))
                        .show();
                    return Err(e.into());
                }
            };
            app.manage(Store {
                db: Mutex::new(db),
                path,
                backups,
                imported: Mutex::new(HashSet::new()),
                last_dir: Mutex::new(None),
                pending_excel: Mutex::new(None),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_snapshot,
            commit_snapshot,
            open_document,
            save_document,
            open_recovery,
            app_info,
            linked::connection_info,
            linked::select_excel,
            linked::connect_excel,
            linked::read_linked_excel,
            linked::save_linked_excel,
            linked::disconnect_excel
        ])
        .run(tauri::generate_context!())
        .expect("KAR 앱 실행 실패");
}
