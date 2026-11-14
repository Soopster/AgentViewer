# Better prompts

The bundled Better prompts plugin follows
[pi-better](https://github.com/nicobailon/pi-better). It uses upstream
[`helper.md`](https://github.com/nicobailon/pi-better/blob/main/helper.md)
instructions: inspect original material, answer the four Depth questions, and
rewrite the user's request without expanding its scope or doing the work.
`plugins/better/helper.md` preserves the source and MIT attribution. The server
embeds the same text for packaging, checked by the smoke; it does not fetch
updates at runtime. The wrapper supplies captured context and the marked output
format.

Type `/better <prompt>` in either composer and submit it. `/better` with no
arguments deepens the current conversation. The plugin contributes the slash
suggestion only while enabled. Web also offers a composer button; OpenTUI offers
Ctrl+K e and a clickable accessory for entering a request.

Research runs in a separate session on the captured provider/account and source
working directory. You can keep typing or let the main agent continue. While
it runs, the plugin owns two live rows above the input:

- A six-cell meter progresses through file research, four Depth questions and
  writing. Its current cell pulses alongside the elapsed time.
- Recent tool calls show running/success/failure marks, command or path details,
  total tool count and failed-tool count.

Escape cancels the helper before the ordinary agent/composer Escape behavior.
A focused autocomplete picker or dialog retains its own Escape. After the helper
has stopped, another Escape reaches the normal handler. The job also stops when
its composer owner changes, its plugin is disabled or its host closes. A
qualified source session can run one helper at a time, with a twenty-minute cap.

On success the rewrite is inserted into the composer automatically. New text
written meanwhile is retained below it. The plugin says the prompt is ready to
edit and send, including whether newer text was preserved. Nothing is sent
automatically. Click **× Dismiss** to clear the finished or failed status; its
rows disappear and the composer draft is preserved. Idle accessories reserve no
rows. Attachments remain in the composer. On error the source task is
restored alongside any newer text. Remote-attached TUIs stream progress from the
daemon using the same endpoint as Web.

## Architecture and provider limits

Slash commands, row budgets, progress rendering, timing, animation and cancellation
use the [shared composer contribution APIs](plugin-composer-contributions.md).
The shell has no Better-specific layout, timer or key branch.

The shared lifecycle supports all ten registered providers, including ACP and
provider mods. Native Claude uses a read/search allowlist; Pi temporarily
restricts active tools to file readers/search; Copilot supplies an allowlist;
Codex uses a read-only offline turn sandbox; OpenCode uses its plan agent.
Research approval requests reject tools outside the read/search policy (Codex
can use shell commands in its read-only sandbox). Plugin follow-up observers
skip helper settlement. ACP and provider-mod enforcement depends on those
runtimes' own permission contracts; arbitrary provider/extension code is trusted.
Providers without tools show zero tools and must state unavailable evidence.

Compared with pi-better, the helper receives the last forty saved messages' text,
bounded to 24,000 characters, rather than a native full-context fork. Saved model
selection is inherited when available; unsaved model choices, thinking levels,
tool history and live incomplete output are not inherited. Prompt-cache reuse
is not promised. Helpers remain inspectable sessions rather than ephemeral Pi
files. Boomerang/rewind and subagent-brief interception are outside this plugin.

## Verification

`npm run better:smoke` covers provider/account routing with mocked runtimes,
fragmented streams, progress normalization, failures, cancellation, permission
policy, a second plugin's slash contribution, and real OpenTUI row/key behavior.
`npm run better:web:smoke` exercises the Web command submission and real accessory
host in headless Chrome against a mocked research endpoint. These checks do not
prove live-provider or native OS-terminal behavior.
