//! The shell's native dialogs. Each waits for its answer, so none may run on the main thread.

use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

pub fn show(app: &AppHandle, kind: MessageDialogKind, title: &str, message: &str) {
    app.dialog()
        .message(message)
        .title(title)
        .kind(kind)
        .blocking_show();
}

pub fn error(app: &AppHandle, title: &str, message: &str) {
    show(app, MessageDialogKind::Error, title, message);
}
