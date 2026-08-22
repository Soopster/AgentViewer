use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, WindowEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Holds every spawned backend child (the web server, and — in dev mode
/// only — nothing else directly, since `bin/agent-viewer.mjs` self-manages
/// its own AHP grandchild there) so they can be torn down from the tray
/// "Quit" item and on app exit.
struct BackendState {
    children: Mutex<Vec<CommandChild>>,
}

/// `src-tauri/Cargo.toml`'s directory, one level up = the repo root that
/// holds `bin/agent-viewer.mjs`. Only used in dev mode, against a live
/// checkout — a packaged build uses `packaged_resources` instead.
fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri has a parent directory")
        .to_path_buf()
}

/// The bundled `next-standalone` resource tree, if this is a packaged build
/// with `scripts/prepareDesktopResources.mjs`'s output actually bundled
/// (via `tauri.conf.json`'s `bundle.resources`). `tauri dev` never
/// populates `resource_dir()` with our custom resources — only `tauri
/// build` copies them in — so this naturally distinguishes dev vs packaged
/// without any separate flag.
fn packaged_resources(app: &tauri::AppHandle) -> Option<PathBuf> {
    let resource_dir = app.path().resource_dir().ok()?;
    let standalone_dir = resource_dir.join("next-standalone");
    standalone_dir.join("server.js").exists().then_some(standalone_dir)
}

/// macOS (and Linux desktop) GUI apps launched via Finder/`open`/a dock icon
/// do NOT inherit the PATH a login shell would have — no nvm, no Homebrew
/// `/opt/homebrew/bin`, nothing beyond a minimal system default. Every test
/// of this app from a terminal masked that, since the terminal's shell had
/// already sourced the user's rc files; opening the real bundled .app hits
/// this immediately and can't find `node`.
///
/// The standard fix (Electron's `fix-path`, VS Code's `resolve-path`) is to
/// ask `$SHELL -ilc 'echo $PATH'`. That does NOT work here: it requires a
/// controlling TTY for the `-i` (interactive) flag zsh needs to actually
/// source `.zshrc` (where this machine's nvm init lives) — without one, zsh
/// aborts early with "can't change option: zle" and PATH comes back empty.
/// Confirmed by reproducing it with a full, unstripped environment, so a
/// launchd-launched GUI app (which also has no TTY) hits the same failure.
/// Instead, augment PATH directly with the install locations the common
/// macOS/Linux version managers actually use — no subprocess, no TTY
/// dependency, and it's what most desktop Node-wrapping apps converge on
/// for exactly this reason.
#[cfg(unix)]
fn common_runtime_dirs() -> Vec<PathBuf> {
    let mut dirs = vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/opt/homebrew/sbin"),
        PathBuf::from("/usr/local/bin"),
    ];
    if let Ok(home) = std::env::var("HOME") {
        let home = PathBuf::from(home);
        // nvm doesn't symlink a stable "current" path; use the lexically
        // highest installed version (good enough — any modern Node works).
        if let Ok(entries) = std::fs::read_dir(home.join(".nvm/versions/node")) {
            let mut versions: Vec<_> = entries.filter_map(|e| e.ok()).map(|e| e.path()).collect();
            versions.sort();
            if let Some(latest) = versions.last() {
                dirs.push(latest.join("bin"));
            }
        }
        dirs.push(home.join(".volta/bin"));
        dirs.push(home.join(".bun/bin"));
        dirs.push(home.join(".local/bin"));
        dirs.push(home.join(".cargo/bin"));
    }
    dirs
}

/// Prepends `common_runtime_dirs()` (that actually exist) to our own
/// process's PATH, so both the `runtime_present` checks below and every
/// spawned child (which inherits `std::env::vars()`) can find `node`/`bun`
/// even when launched with no shell environment at all.
#[cfg(unix)]
fn fix_path_env() {
    let current = std::env::var("PATH").unwrap_or_default();
    let existing: std::collections::HashSet<&str> = current.split(':').collect();
    let mut prepend = Vec::new();
    for dir in common_runtime_dirs() {
        if !dir.is_dir() {
            continue;
        }
        let dir_str = dir.to_string_lossy().into_owned();
        if !existing.contains(dir_str.as_str()) {
            prepend.push(dir_str);
        }
    }
    if prepend.is_empty() {
        return;
    }
    prepend.push(current);
    // SAFETY: called once, synchronously, before any other thread is
    // spawned (start of `setup()`), so no concurrent env access races.
    unsafe {
        std::env::set_var("PATH", prepend.join(":"));
    }
}

#[cfg(not(unix))]
fn fix_path_env() {}

/// Whether `name --version` runs successfully, i.e. `name` resolves on PATH.
/// Mirrors the presence check `bin/agent-viewer.mjs`'s `resolveBunLauncher`/
/// `failMissingBun` already do for the CLI.
fn runtime_present(name: &str) -> bool {
    std::process::Command::new(name)
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

/// Escapes a string for embedding inside a single-quoted JS string literal in
/// the splash webview (see the `__setSplash*` helpers in `src-tauri-ui/
/// index.html`).
fn escape_js(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('\'', "\\'")
        .replace('\n', "<br/>")
}

/// Runs a JS expression in the splash webview ("main") window, if it exists.
fn eval_splash(app: &tauri::AppHandle, script: String) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.eval(&script);
}

/// Updates the live status line on the branded splash while the backend boots.
fn show_splash_status(app: &tauri::AppHandle, message: &str) {
    eval_splash(app, format!("window.__setSplashStatus('{}');", escape_js(message)));
}

/// Drives the determinate progress bar (0-100) on the branded splash. The bar
/// runs an indeterminate shimmer until the first progress value arrives.
fn show_splash_progress(app: &tauri::AppHandle, percent: f32) {
    let p = percent.clamp(0.0, 100.0);
    eval_splash(app, format!("window.__setSplashProgress({p});"));
}

/// Switches the branded splash to its error state with an actionable message.
/// Used when a required runtime is missing, a spawn fails, or the backend
/// never becomes healthy, so the user sees why instead of an indefinitely
/// spinning splash.
fn show_splash_message(app: &tauri::AppHandle, heading: &str, body: &str) {
    eval_splash(
        app,
        format!(
            "window.__setSplashError('{}', '{}');",
            escape_js(heading),
            escape_js(body),
        ),
    );
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

/// Streams a spawned command's stdout/stderr into the Rust log, tagged with
/// `label`, so `cargo tauri dev` output shows real backend errors instead of
/// a blank window.
fn forward_events(label: &'static str, mut rx: tauri::async_runtime::Receiver<CommandEvent>) {
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    log::info!("[{label}] {}", String::from_utf8_lossy(&line).trim_end());
                }
                CommandEvent::Stderr(line) => {
                    log::warn!("[{label}] {}", String::from_utf8_lossy(&line).trim_end());
                }
                CommandEvent::Error(err) => {
                    log::error!("[{label}] error: {err}");
                }
                CommandEvent::Terminated(payload) => {
                    log::error!("[{label}] exited: {payload:?}");
                    break;
                }
                _ => {}
            }
        }
    });
}

/// PIDs of `pid`'s direct and indirect children, via `pgrep -P` (present on
/// macOS/Linux). In dev mode, `bin/agent-viewer.mjs` spawns the AHP
/// Coordinator as a grandchild, so `CommandChild::kill()` alone (which only
/// signals the direct child) leaves it orphaned — confirmed by testing an
/// external SIGTERM against a running dev instance. In packaged mode this
/// is a defensive no-op: both children are already direct, leaf processes.
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
    let Some(state) = app.try_state::<BackendState>() else {
        return;
    };
    for child in state.children.lock().expect("backend state poisoned").drain(..) {
        #[cfg(unix)]
        {
            let pid = child.pid();
            for descendant in descendant_pids(pid) {
                kill_pid(descendant);
            }
        }
        let _ = child.kill();
    }
}

/// Mirrors `bin/agent-viewer.mjs`'s `resolveWebHostname()`: the bind address
/// is fixed for the process's lifetime, so this reads the same
/// `.agent-viewer-data/remote-access.json` (relative to `cwd`, matching
/// `lib/remoteAuth.ts`) once at spawn time. Toggling remote access in the
/// running app updates the *auth* check immediately; the network bind only
/// picks it up on the next launch.
fn resolve_web_hostname(cwd: &std::path::Path) -> &'static str {
    let state_file = cwd.join(".agent-viewer-data").join("remote-access.json");
    let Ok(contents) = std::fs::read_to_string(state_file) else {
        return "127.0.0.1";
    };
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&contents) else {
        return "127.0.0.1";
    };
    if parsed.get("enabled").and_then(|v| v.as_bool()) == Some(true) {
        "0.0.0.0"
    } else {
        "127.0.0.1"
    }
}

/// Spawns the backend against a bundled packaged build: the traced
/// `next-standalone/server.js` run directly with system Node, and the AHP
/// Coordinator as a real Tauri sidecar (`bun build --compile`'d ahead of
/// time by `scripts/prepareDesktopResources.mjs`, so packaged installs need
/// only Node on PATH, not Bun).
fn spawn_packaged_backend(
    app_handle: &tauri::AppHandle,
    resources: &std::path::Path,
    port: u16,
    ahp_port: u16,
) -> Result<Vec<CommandChild>, String> {
    let server_js = resources.join("server.js");
    let own_pid = std::process::id().to_string();

    // Everything the child spawns inherits these, so build the env once.
    let mut envs: Vec<(String, String)> = std::env::vars().collect();
    // Lets both children self-terminate if this app dies without running
    // kill_backend() first (a crash or SIGKILL bypasses RunEvent::
    // ExitRequested and the signal-hook handler entirely) — see
    // lib/parentWatchdog.ts. Confirmed happening in practice: an app
    // instance died unexpectedly and left both children reparented under
    // launchd with nothing left to signal them.
    envs.push(("AGENT_VIEWER_PARENT_PID".to_string(), own_pid.clone()));
    let typescript_lsp_bin =
        resources
            .join("typescript-lsp")
            .join(if cfg!(windows) { "tsc.exe" } else { "tsc" });
    envs.push((
        "AGENT_VIEWER_TYPESCRIPT_LSP_BIN".to_string(),
        typescript_lsp_bin.to_string_lossy().to_string(),
    ));
    // Point the embedded-terminal route (lib/terminalSession.ts) at the TUI
    // binary bundled as a sidecar, so packaged installs need only Node (no
    // Bun) to run the OpenTUI terminal inside the app.
    if let Ok(tui_cmd) = app_handle.shell().sidecar("agent-viewer-tui") {
        // Extract the resolved sidecar path without spawning it — the web
        // server (not Rust) owns the terminal process lifecycle. The std
        // Command -> OsStr conversion is the plugin's only public path to it.
        let program: std::process::Command = tui_cmd.into();
        let program = program.get_program().to_string_lossy().to_string();
        envs.push(("AGENT_VIEWER_TUI_BIN".to_string(), program));
    } else {
        log::warn!("embedded-terminal TUI sidecar not found; terminal page will fall back to Bun");
    }

    let (web_rx, web_child) = app_handle
        .shell()
        .command("node")
        .arg(&server_js)
        .current_dir(resources)
        .envs(envs)
        .env("PORT", port.to_string())
        .env("HOSTNAME", resolve_web_hostname(resources))
        .spawn()
        .map_err(|err| format!("failed to spawn packaged web server: {err}"))?;
    forward_events("web", web_rx);

    let (ahp_rx, ahp_child) = app_handle
        .shell()
        .sidecar("agent-viewer-ahp")
        .map_err(|err| format!("failed to resolve AHP sidecar: {err}"))?
        .args(["--ws", &format!("127.0.0.1:{ahp_port}")])
        .env("AGENT_VIEWER_PARENT_PID", &own_pid)
        .spawn()
        .map_err(|err| format!("failed to spawn AHP sidecar: {err}"))?;
    forward_events("ahp", ahp_rx);

    Ok(vec![web_child, ahp_child])
}

/// Spawns the backend against a live dev checkout: `bin/agent-viewer.mjs
/// web`, which self-manages its own `next dev` + Bun AHP child exactly as
/// the CLI does.
fn spawn_dev_backend(app_handle: &tauri::AppHandle, port: u16, ahp_port: u16) -> Result<Vec<CommandChild>, String> {
    let entrypoint = repo_root().join("bin").join("agent-viewer.mjs");
    let args = vec![
        entrypoint.to_string_lossy().to_string(),
        "web".to_string(),
        "--port".to_string(),
        port.to_string(),
        "--ahp-port".to_string(),
        ahp_port.to_string(),
    ];

    let (rx, child) = app_handle
        .shell()
        .command("node")
        .args(args)
        .current_dir(repo_root())
        // GUI-launched processes don't reliably inherit a login shell's PATH
        // (e.g. nvm-managed node); pass it through explicitly so the "node"
        // lookup succeeds.
        .envs(std::env::vars())
        // bin/agent-viewer.mjs doesn't strip env when it spawns `next dev`
        // and the Bun AHP child, so this reaches both of them too — each
        // self-terminates via lib/parentWatchdog.ts if this app dies
        // without running kill_backend() first (crash, SIGKILL, etc.).
        .env("AGENT_VIEWER_PARENT_PID", std::process::id().to_string())
        .spawn()
        .map_err(|err| format!("failed to spawn dev backend: {err}"))?;
    forward_events("backend", rx);

    Ok(vec![child])
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

            // Must run before any runtime_present()/spawn call below.
            fix_path_env();

            let app_handle = app.handle().clone();
            let resources = packaged_resources(&app_handle);
            let is_packaged = resources.is_some();

            show_splash_status(&app_handle, "Checking runtime dependencies…");
            show_splash_progress(&app_handle, 10.0);

            let mut missing_runtimes = Vec::new();
            if !runtime_present("node") {
                missing_runtimes.push("Node.js (>=22.5) — https://nodejs.org");
            }
            // Packaged installs run the AHP Coordinator as a precompiled
            // sidecar binary (see spawn_packaged_backend) — only dev mode
            // still needs Bun on PATH to run bin/agent-viewer-ahp.ts directly.
            if !is_packaged && !runtime_present("bun") {
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

            show_splash_status(&app_handle, "Starting backend server…");
            show_splash_progress(&app_handle, 40.0);

            let spawn_result = match &resources {
                Some(resources) => spawn_packaged_backend(&app_handle, resources, port, ahp_port),
                None => spawn_dev_backend(&app_handle, port, ahp_port),
            };
            let children = match spawn_result {
                Ok(children) => children,
                Err(message) => {
                    // A panic here would abort the whole app (this closure
                    // runs inside a macOS callback that can't unwind) —
                    // log and leave the splash visible instead of crashing.
                    log::error!("{message}");
                    show_splash_message(&app_handle, "Failed to start backend", &format!("{message}\n\nSee the app log for details."));
                    return Ok(());
                }
            };

            log::info!(
                "spawned agent-viewer backend on port {port} (ahp {ahp_port}, packaged={is_packaged})"
            );
            app.manage(BackendState {
                children: Mutex::new(children),
            });
            show_splash_status(&app_handle, &format!("Waiting for server on port {port}…"));
            show_splash_progress(&app_handle, 75.0);

            // Health-check the backend off the main thread, then navigate the
            // splash window to the live app once it responds. A stalled
            // backend surfaces an actionable message rather than leaving the
            // splash spinning forever.
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
