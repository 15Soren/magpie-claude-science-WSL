# Claude Science for Magpie

English · [简体中文](README.zh-CN.md)

This project is a derivative of [Guuuu233/claude-science-for-magpie](https://github.com/Guuuu233/claude-science-for-magpie); thank you to Guuuu233 for that work. It is in turn based on [Sia's original project](https://github.com/shiyang1026/magpie-claude-science); thanks to Sia and all contributors. This repository retains the original MIT copyright and license notice.

This project has not published a separate npm package. `magpie-claude-science@latest` refers to the original project and does not contain this repository's WSL changes.

Use Magpie's models in Claude Science. On Windows + WSL, a WSL user service connects directly to the Windows Magpie gateway without installing a Magpie agent plugin. The original macOS integration remains available.

**Experimental.** WSL service startup and model requests were verified with Science **0.1.71** and Windows Magpie **0.1.2048**. The macOS integration was previously tested with Science **0.1.60** and Magpie **0.1.1219**.

## Windows + WSL quick start

Run Magpie on Windows and install Claude Science and Linux Node.js 22+ in WSL. Enable systemd in WSL and check that `systemctl --user status` works. The gateway must be accessible from WSL on loopback; the default is `http://127.0.0.1:3425`. Check WSL networking and Magpie's listener if it is unreachable.

From this checkout in WSL:

```sh
npm ci --ignore-scripts
node src/cli.js install --gateway http://127.0.0.1:3425
mycsci
```

Use the arrow keys to browse models, space to toggle selections, and enter to confirm. `mycsci` starts or checks the bridge and prints a single-use URL to paste into a Windows browser. For existing installations, run `node src/cli.js register` from this checkout to install the command; ensure `~/.local/bin` is on PATH. Add `--model <catalog-id>` for unattended installation. For a protected gateway, set `MAGPIE_GATEWAY_KEY` before installation; the key is saved in the WSL user's private state file. Magpie model metadata is preserved and served to Science; support for capabilities and reasoning levels depends on the Science version.

```sh
node src/cli.js doctor
node src/cli.js models                       # select multiple models
node src/cli.js models --model <catalog-id>  # add a model
node src/cli.js restart
node src/cli.js uninstall
```

Uninstall stops the WSL user service and restores the Science configuration; sessions and authentication are retained. The service runs while WSL and the user systemd session are running. Keep Windows Magpie running.

## macOS quick start

Requires macOS, an official Node.js 22+ distribution, and installed Claude Science and Magpie. Start Magpie, enable at least one model, finish active Science tasks, and run from this checkout:

```sh
npm ci --ignore-scripts
node src/cli.js install
```

Choose a model when prompted. For unattended setup, supply `--model` with an ID from your Magpie catalog. The installer reads Magpie's gateway port and finds available local ports; overrides are listed by `node src/cli.js --help`.

**Adding the plugin in Magpie alone does not complete setup.** The installer creates a macOS LaunchAgent and copies its runtime, production dependencies and Node into a private release directory. The installed service no longer depends on the checkout or npm cache. Node builds linked to external libraries, such as some Homebrew builds, are refused.

Open the original **Claude Science.app**. The first “Sign in” confirms a local browser session, not an Anthropic login. Keep Magpie running and select models from its Agent page.

### Sign in leads to Sign in on the web / Paste code instead

That page is Science's account login flow. Check whether local setup completed; existing browser login state is not evidence of a successful installation:

```sh
node src/cli.js doctor
```

If the local service is not initialized, run `install` above. If installed, check the service state and `sciencePort` in the output, then reopen the app to reach the managed service. A port such as `localhost:8765` alone does not establish whether setup succeeded. If `doctor` reports an error, share its summary, not tokens, full private logs, or `state.json`.

## Manage

```sh
node src/cli.js doctor
node src/cli.js restart
node src/cli.js upgrade    # Run from the updated checkout/package
node src/cli.js rollback   # Restore the previous managed runtime release
node src/cli.js uninstall  # Restore original config; retain session data
```

Stop active Science tasks before lifecycle changes. Upgrade preserves local identity and sessions and restores the previous service if startup fails. Migrating an early checkout-based installation is supported through `upgrade`; a previous managed release is required for `rollback`.

## How it works

```text
Claude Science → local compatibility service → Magpie → selected provider/model
```

Data, local identity and versioned runtime files live under `~/.config/magpie/claude-science-runtime/`. Original credentials and app binaries are preserved. The original config is redirected only after an owned Science daemon passes readiness checks. Disabling or uninstalling restores it; conflicting user edits are retained for manual resolution.

## Limitations

- The macOS integration uses one upstream model; WSL supports multiple models, with capability and reasoning controls limited by Science itself.
- Anthropic-hosted search, MCP and account services are not provided.
- Full scientific workflows, long sessions and image support remain unverified.
- Owned-orphan recovery and executable-change detection have automated tests. Real macOS reboot races and future Science versions still need validation. Finish current tasks before restarting after a Science update.
- Custom XDG roots and relocated Science data directories are not supported.

## Development and releases

```sh
npm test
npm run check:package
npm run test:integration  # Requires Magpie and Bun; uses a temporary home and mock upstream
```

The inherited CI configuration tests Node 22/24 on Linux/macOS and a pinned Magpie version. The inherited release workflow is restricted to the original repository and does not publish this derivative. See the [original release setup (中文)](docs/publishing.md).

When reporting a problem, include versions, `doctor` output and reproduction steps. Omit credentials and private logs. See [operations (中文)](docs/operations.zh-CN.md) and [Magpie's guide](https://usemagpie.ai/docs/plugins).

## License

[MIT](LICENSE). Independent community project; not affiliated with Anthropic or Magpie.

The Claude Science icon belongs to its respective owner and is excluded from the MIT license.
