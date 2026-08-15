use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, WindowEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Holds the spawned `bin/agent-viewer.mjs web` child so it can be torn down
/// from the tray "Quit" item and on app exit.
struct BackendState {
    child: Mutex<Option<CommandChild>>,
}

/// `src-tauri/Cargo.toml`'s directory, one level up = the repo root that
/// holds `bin/agent-viewer.mjs`. This resolves correctly for `cargo tauri
/// dev` against a live checkout; a bundled production build should instead
/// resolve this from `app.path().resource_dir()` once packaging ships
/// pruned resources alongside the binary (tracked as a follow-up).
fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri has a parent directory")
        .to_path_buf()
}

/// Whether `name --version` runs successfully, i.e. `name` resolves on PATH.
/// Mirrors the presence check `bin/agent-viewer.mjs`'s `resolveBunLauncher`/
/// `failMissingBun` already do for the CLI — the desktop app has the same
/// system Node + Bun requirement (see the plan's "require system Node/Bun"
/// decision), so it needs the same guard before spawning.
fn runtime_present(name: &str) -> bool {
    std::process::Command::new(name)
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

/// Replaces the splash contents with an install-instructions message. Used
/// when a required runtime is missing, and when the backend never becomes
/// healthy, so the user sees an actionable message instead of an
/// indefinitely spinning splash.
fn show_splash_message(app: &tauri::AppHandle, heading: &str, body: &str) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let escape = |s: &str| s.replace('\\', "\\\\").replace('\'', "\\'").replace('\n', "<br/>");
    let script = format!(
        "document.body.innerHTML = '<div style=\"text-align:center;font-family:-apple-system,BlinkMacSystemFont,\\'Segoe UI\\',sans-serif;color:#e6e6e6;padding:32px;max-width:440px;margin:0 auto\">' + \
         '<div style=\"font-size:15px;font-weight:600;margin-bottom:10px\">{}</div>' + \
         '<div style=\"font-size:13px;opacity:0.75;line-height:1.6\">{}</div></div>';",
        escape(heading),
        escape(body),
    );
    let _ = window.eval(&script);
}

/// Prefer `preferred`; fall back to an OS-assigned free port if it's taken.
fn find_free_port(preferred: u16) -> u16 {
    if TcpListener::bind(("127.0.0.1", preferred)).is_ok() {
        return preferred;
    }
    TcpListener::bind(("127.0.0.1", 0))
        .and_then(|listener| listener.local_addr())
        .map(|addr| addr.port())
        .unwrap_or(preferred)
}

/// PIDs of `pid`'s direct and indirect children, via `pgrep -P` (present on
/// macOS/Linux). The backend's own process (`bin/agent-viewer.mjs`) spawns
/// the AHP Coordinator as a grandchild, so `CommandChild::kill()` alone
/// (which only signals the direct child) leaves it orphaned — confirmed by
/// testing an external SIGTERM against a running dev instance.
#[cfg(unix)]
fn descendant_pids(pid: u32) -> Vec<u32> {
    let mut descendants = Vec::new();
    let mut frontier = vec![pid];
    while let Some(current) = frontier.pop() {
        let Ok(output) = std::process::Command::new("pgrep")
            .arg("-P")
            .arg(current.to_string())
            .output()
        else {
            continue;
        };
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            if let Ok(child_pid) = line.trim().parse::<u32>() {
                descendants.push(child_pid);
                frontier.push(child_pid);
            }
        }
    }
    descendants
}

#[cfg(unix)]
fn kill_pid(pid: u32) {
    // A target may already be gone by the time we get here (e.g. it exited
    // via its own faster internal signal cascade) — that's expected, not an
    // error, so discard `kill`'s "No such process" stderr rather than log it.
    let _ = std::process::Command::new("kill")
        .arg("-TERM")
        .arg(pid.to_string())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();
}

fn kill_backend(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<BackendState>() {
        if let Some(child) = state.child.lock().expect("backend state poisoned").take() {
            #[cfg(unix)]
            {
                let pid = child.pid();
                // Signal grandchildren (the AHP sidecar) before the direct
                // child, otherwise agent-viewer.mjs's own SIGTERM handler
                // may already be mid-exit by the time we look up its tree.
                for descendant in descendant_pids(pid) {
                    kill_pid(descendant);
                }
            }
            let _ = child.kill();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let app_handle = app.handle().clone();

            let mut missing_runtimes = Vec::new();
            if !runtime_present("node") {
                missing_runtimes.push("Node.js (>=22.5) — https://nodejs.org");
            }
            if !runtime_present("bun") {
                missing_runtimes.push("Bun — https://bun.sh");
            }
            if !missing_runtimes.is_empty() {
                log::error!("missing required runtime(s): {missing_runtimes:?}");
                show_splash_message(
                    &app_handle,
                    "Missing required runtime",
                    &format!(
                        "Agent Viewer needs the following on your PATH:\n\n{}\n\nInstall them, then relaunch Agent Viewer.",
                        missing_runtimes.join("\n")
                    ),
                );
                return Ok(());
            }

            let port = find_free_port(3000);
            let ahp_port = port + 1;
            let entrypoint = repo_root().join("bin").join("agent-viewer.mjs");
            let entrypoint_str = entrypoint.to_string_lossy().to_string();

            let debug = cfg!(debug_assertions);
            let mut args = vec![
                entrypoint_str,
                "web".to_string(),
                "--port".to_string(),
                port.to_string(),
                "--ahp-port".to_string(),
                ahp_port.to_string(),
            ];
            if !debug {
                args.push("--production".to_string());
            }

            let shell = app_handle.shell();
            let spawn_result = shell
                .command("node")
                .args(args)
                .current_dir(repo_root())
                // GUI-launched processes don't reliably inherit a login
                // shell's PATH (e.g. nvm-managed node); pass it through
                // explicitly so the "node" lookup succeeds.
                .envs(std::env::vars())
                .spawn();
            let (mut rx, child) = match spawn_result {
                Ok(pair) => pair,
                Err(err) => {
                    // A panic here would abort the whole app (this closure
                    // runs inside a macOS callback that can't unwind) —
                    // log and leave the splash visible instead of crashing.
                    log::error!("failed to spawn agent-viewer backend: {err}");
                    show_splash_message(
                        &app_handle,
                        "Failed to start backend",
                        &format!("{err}\n\nSee the app log for details."),
                    );
                    return Ok(());
                }
            };

            log::info!("spawned agent-viewer backend on port {port} (ahp {ahp_port})");
            app.manage(BackendState {
                child: Mutex::new(Some(child)),
            });

            // Stream backend stdout/stderr into the Rust log so `cargo tauri
            // dev` output shows real backend errors, not just a blank window.
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            log::info!("[backend] {}", String::from_utf8_lossy(&line).trim_end());
                        }
                        CommandEvent::Stderr(line) => {
                            log::warn!("[backend] {}", String::from_utf8_lossy(&line).trim_end());
                        }
                        CommandEvent::Error(err) => {
                            log::error!("[backend] error: {err}");
                        }
                        CommandEvent::Terminated(payload) => {
                            log::error!("[backend] exited: {payload:?}");
                            break;
                        }
                        _ => {}
                    }
                }
            });

            // Health-check the backend off the main thread, then navigate the
            // splash window to the live app once it responds. A stalled
            // backend times out into a native error dialog rather than
            // leaving the splash spinning forever.
            let health_handle = app_handle.clone();
            std::thread::spawn(move || {
                let addr = format!("127.0.0.1:{port}");
                let deadline = Instant::now() + Duration::from_secs(60);
                loop {
                    if let Ok(parsed) = addr.parse() {
                        if TcpStream::connect_timeout(&parsed, Duration::from_millis(300)).is_ok() {
                            break;
                        }
                    }
                    if Instant::now() > deadline {
                        log::error!("agent-viewer backend did not become ready within 60s");
                        show_splash_message(
                            &health_handle,
                            "Backend did not start",
                            &format!(
                                "Agent Viewer's backend didn't respond on port {port} within 60s.\n\nCheck the app log, or try relaunching."
                            ),
                        );
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(250));
                }
                if let Some(window) = health_handle.get_webview_window("main") {
                    let url = format!("http://127.0.0.1:{port}/");
                    if let Ok(parsed) = url.parse() {
                        let _ = window.navigate(parsed);
                    }
                }
            });

            // Tray: closing the window hides it (agent turns may still be
            // running in the background); Quit here or via Cmd+Q fully exits
            // and tears down the backend.
            let show_item = MenuItem::with_id(app, "show", "Show Agent Viewer", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit Agent Viewer", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let mut tray_builder = TrayIconBuilder::new()
                .menu(&tray_menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        kill_backend(app);
                        app.exit(0);
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }
            tray_builder.build(app)?;

            // RunEvent::ExitRequested (below) only fires for app-initiated
            // quits (tray Quit, Cmd+Q). An external SIGTERM/SIGINT (e.g. a
            // process manager or `killall`) bypasses it entirely, leaking
            // the backend — confirmed by testing against a running dev
            // instance. Catch those here and run the same teardown.
            #[cfg(unix)]
            {
                use signal_hook::consts::{SIGINT, SIGTERM};
                use signal_hook::iterator::Signals;
                let signal_handle = app_handle.clone();
                if let Ok(mut signals) = Signals::new([SIGTERM, SIGINT]) {
                    std::thread::spawn(move || {
                        if signals.forever().next().is_some() {
                            log::info!("received termination signal, shutting down backend");
                            kill_backend(&signal_handle);
                            signal_handle.exit(0);
                        }
                    });
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                window.hide().ok();
                api.prevent_close();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                kill_backend(app_handle);
            }
        });
}
