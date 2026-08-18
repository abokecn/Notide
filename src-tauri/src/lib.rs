#[cfg(all(debug_assertions, desktop))]
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|_app| {
            #[cfg(all(debug_assertions, desktop))]
            {
                let window = _app.get_webview_window("main").expect("main window missing");
                window.open_devtools();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Notide");
}
