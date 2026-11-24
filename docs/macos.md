# mjai — macOS setup

English · [简体中文](macos.zh-Hans.md) · [繁體中文](macos.zh-Hant.md)

Everything needed to run the bridge and AI model is in this folder. The current package supports **Apple Silicon Macs (M1 or later) with macOS 14 or later** and Google Chrome. It does not run on Intel Macs, Windows or Linux. The model, Python runtime and ONNX Runtime are included; you do not need to install Python or Rust for normal use. Keep the whole folder together.

## First-time setup

1. Copy the entire `mjAI_portable` folder to the Mac where you want to use it. Put it in its intended location before installing the extension; moving it later may require loading the extension again.
2. Double-click **Start-mjai.command**. A Terminal window opens and checks the files and AI model. The check does not start a game.
3. Choose **1**. If the extension has not been found, let the launcher open Chrome's Extensions page. Turn on **Developer mode**, click **Load unpacked**, and select the `extension` folder inside `mjAI_portable`.
4. Return to the launcher and press **Return**. It will try to find and remember the extension ID. If it cannot, copy the ID from the Chrome extension card and paste it into the launcher once. Use the same Chrome profile when playing.
5. Keep the launcher window open. In Chrome, open or reload your Mahjong Soul game page and start a standard four-player game. The HUD should appear in the top-right corner. The launcher does not play for you.

**Testing on the original Mac:** if your previous Mahjong Soul AI HUD is still enabled, disable that old HUD extension in Chrome before loading this portable copy; otherwise both overlays may appear. The current extension is named **mjai HUD**. This does not require changing Clash or other extensions. Do not enable the old `Majsoul Intercept v6` Tampermonkey script: it redirects the game to an old server.

## Normal use

Double-click **Start-mjai.command**, choose **1**, leave the window open, and play. The ID is saved in `.mjai-settings.json` in this folder after setup. Choose **2** if you change Chrome profiles or reload the extension from a different folder. Choose **3** to rerun the environment check. Press **Control–C** in the launcher to stop the bridge.

If another bridge already uses port 23410, close that bridge first. The launcher will not stop it automatically. A detected extension or saved ID does not prove it is connected: the live game must connect before a suggestion can appear.

## Green highlights

A green outline can mark the recommended discard or action button. It uses an estimated standard game layout and tile order; verify the marked item against the text. If it is misaligned, select **Adjust highlight** on the HUD and align the yellow previews with the first tile and rightmost action button. Some multi-choice calls need an additional selection that is not highlighted.

Use **語言 / 语言 / Language** in the HUD to choose Traditional Chinese, Simplified Chinese or English. The choice is saved in Chrome.

The HUD has independent **最佳牌顯示** and **危險牌顯示** checkboxes and a theme selector. Danger highlighting is off by default. On your discard turn, the bridge checks opponents' discards, open melds and known tile counts. High risk is red and medium risk is orange. Without riichi, a player with several open melds or many late-round discards can trigger a medium warning. The HUD shows the reason for the estimate. A recommended tile keeps its green outline with a colored warning symbol. Low risk has no outline.

Drag the HUD title to move it. Use **−** and **+** to resize and **▾** to collapse the panel. Tile markers remain visible while the panel is collapsed. Chrome saves the layout and display preferences locally. Use **重設位置與大小** to restore the default layout.

### AI styles / AI 人格

Use the HUD's **AI style / 風格** menu while playing a standard four-player game:

- **Default · 預設**: the original Mortal decision.
- **CallManiac · 副露速攻**: favors calls and discarding isolated terminals and honors. It checks each open call for a plausible yaku route and avoids increasing normal shanten; when near tenpai, it checks actual scoring waits. It takes an available win before calling.
- **SuperTurtle · 防守**: after an opponent declares riichi or in the later game, favors safer-looking discards and discourages riichi and calls.

Set **Intensity / 強度** from 0 to 2 (default 1). At 0, all styles use the original Mortal decision. Settings are saved in Chrome; a change applies at the next decision. These are heuristic score adjustments, so they do not guarantee faster hands, a particular discard, or safety. A discarded tile is treated as genbutsu only against the riichi opponents who discarded it; suji is only a risk estimate and can still deal in.

CallManiac's early-hand guard recognizes yakuhai, tanyao and flush routes. It is intentionally conservative and may pass on other valid yaku. A prospective route depends on future draws and is not a guarantee of winning.

## Troubleshooting

- **No HUD:** verify that the portable extension is enabled in the Chrome profile you are using, leave the launcher running, and reload the game page. Use menu **2** if the extension ID changed.
- **Another bridge is running:** stop its Terminal window, then choose **1** again. Do not stop unrelated applications.
- **Game cannot load:** check the game connection and disable the obsolete `Majsoul Intercept v6` script if present. Your existing network/proxy configuration can remain on.
- **Waiting for game state:** the bridge may need a complete round start or reconnect history. Reloading the game can request a fresh history; some missing or unsupported game states require waiting for a new round.
- **Missing files / unsupported Mac:** copy the complete folder again or use a supported Mac. The bundled launcher will explain the check that failed. If macOS blocks a downloaded app, follow the macOS security prompt for this file.

## Technical details

The included bridge is the user's existing Rust project and model, repackaged. The original build used Rust/Cargo **1.99.0**; Rust source and `Cargo.lock` are included under `bridge/` and `Mortal/` for developers. Rebuilding requires a compatible Rust toolchain, Python development installation and Cargo dependencies; the prebuilt executable is the normal route. ONNX Runtime **1.22.0** and the supplied model are included. The model's provenance and license were not specified in the supplied files. Third-party notices are included with their components.

The extension sends the game's relevant action and reconnect messages to the local bridge. It calculates the seat in the game page; login tokens are not forwarded. It retains the current round only in memory for reconnect recovery. The default listener is `127.0.0.1:23410` and accepts the configured Chrome extension origin.
