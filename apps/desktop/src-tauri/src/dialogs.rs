//! The shell's native dialogs. Each waits for its answer, so none may run on the main thread.

use std::path::Path;

use tauri::{AppHandle, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

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

/// True when the person chose `yes`.
pub fn confirm(
    app: &AppHandle,
    kind: MessageDialogKind,
    title: &str,
    message: &str,
    yes: &str,
    no: &str,
) -> bool {
    app.dialog()
        .message(message)
        .title(title)
        .kind(kind)
        .buttons(MessageDialogButtons::OkCancelCustom(
            yes.to_owned(),
            no.to_owned(),
        ))
        .blocking_show()
}

/// The folder picked, or None when the picker was cancelled.
pub fn pick_folder(
    app: &AppHandle,
    title: &str,
    create: bool,
    start_in: Option<&Path>,
    parent: Option<&WebviewWindow>,
) -> Option<String> {
    let mut picker = app
        .dialog()
        .file()
        .set_title(title)
        .set_can_create_directories(create);
    if let Some(directory) = start_in {
        picker = picker.set_directory(directory);
    }
    if let Some(parent) = parent {
        picker = picker.set_parent(parent);
    }
    picker
        .blocking_pick_folder()
        .and_then(|picked| picked.into_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
}
