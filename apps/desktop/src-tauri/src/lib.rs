//! Study Kingdom desktop shell: hosts the shared web client and exposes a few
//! native macOS capabilities used for computer-mode study accountability.

mod mac;
mod secure;

use serde::Serialize;
use std::sync::Mutex;
use tauri::Manager;

/// Power assertion held while a paper-mode session runs.
#[derive(Default)]
struct SleepGuard(Mutex<Option<mac::Assertion>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FrontApp {
    bundle_id: String,
    name: String,
    locked: bool,
    idle_seconds: f64,
    self_bundle_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RunningApp {
    bundle_id: String,
    name: String,
}

// Synchronous commands run on the main thread, which AppKit prefers.
#[tauri::command]
fn front_app(app: tauri::AppHandle) -> FrontApp {
    let (bundle_id, name) = mac::frontmost_app().unwrap_or_default();
    FrontApp {
        bundle_id,
        name,
        locked: mac::screen_locked(),
        idle_seconds: mac::idle_seconds(),
        self_bundle_id: app.config().identifier.clone(),
    }
}

#[tauri::command]
fn running_apps(app: tauri::AppHandle) -> Vec<RunningApp> {
    let me = app.config().identifier.clone();
    mac::running_apps()
        .into_iter()
        .filter(|(id, _)| *id != me)
        .map(|(bundle_id, name)| RunningApp { bundle_id, name })
        .collect()
}

#[tauri::command]
fn prevent_sleep(state: tauri::State<SleepGuard>, enable: bool, reason: String) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if enable {
        if guard.is_none() {
            *guard = Some(mac::Assertion::prevent_idle_sleep(&reason)?);
        }
    } else {
        // Dropping the assertion releases it.
        *guard = None;
    }
    Ok(())
}

#[tauri::command]
fn secure_get(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    secure::get(&app.config().identifier, &key)
}

#[tauri::command]
fn secure_set(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    secure::set(&app.config().identifier, &key, &value)
}

#[tauri::command]
fn secure_delete(app: tauri::AppHandle, key: String) -> Result<(), String> {
    secure::delete(&app.config().identifier, &key)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(SleepGuard::default())
        .invoke_handler(tauri::generate_handler![
            front_app,
            running_apps,
            prevent_sleep,
            secure_get,
            secure_set,
            secure_delete
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                window.set_title("Study Kingdom")?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Study Kingdom");
}
