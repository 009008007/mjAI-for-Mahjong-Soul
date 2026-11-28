> This guide describes the separately assembled Windows package. The source folder does not include its model or runtime.

# mjai — Windows guide

[繁體中文](windows.md) · [简体中文](windows.zh-Hans.md) · English

The Windows x64 package includes the model, Python, ONNX Runtime, bridge and Chrome extension. Keep the entire folder together. Windows 10 or 11 x64 and Google Chrome are required. The bridge is cross-compiled and has not yet been tested on Windows.

## First setup

1. Extract the entire folder to a writable location, such as Documents. Do not run it inside a ZIP.
2. Open Chrome and double-click `Start-mjai.bat`. The launcher checks the environment and model.
3. Choose 1. In Chrome's extensions page, enable Developer mode, select Load unpacked and choose the `extension` folder.
4. Return to the launcher and press Enter. It tries to detect and remember the extension ID. If detection fails, copy the ID from the extension card and paste it once.
5. Keep the launcher open, use the same Chrome profile, reload Mahjong Soul and start a four-player game.

## Using mjai

Start the launcher and choose 1. Press Ctrl+C when finished. Choose 2 to change the extension ID or 3 to check the environment again. If port 23410 is occupied, close the previous mjai bridge first.

Use **語言 / 语言 / Language** in the HUD to select Traditional Chinese, Simplified Chinese or English. Chrome remembers the choice. The recommended tile and danger displays have independent switches. Choose black-green, white or pastel pink-blue in the theme menu.

Green marks a recommendation. Danger marks are initially off. Red indicates high estimated risk and orange medium estimated risk, based on riichi, open melds, discards and visible tiles. If a recommendation is also dangerous, its green outline displays a colored warning. Unmarked tiles can still deal in.

Drag the HUD title to move it, use − and + to resize, and ▾ to collapse it. Markers remain visible while collapsed. Reset position and size from the HUD. If a marker is misaligned, use Adjust highlight and align the yellow previews with the first tile and rightmost action button.

Choose Default, CallManiac or SuperTurtle under AI style. Intensity ranges from 0 to 2, with 1 as default. Zero uses the original Mortal decision. Changes apply at the next decision.

## Troubleshooting

If the HUD is missing, enable the extension in the same Chrome profile, leave the launcher running and refresh the game. If the game state is incomplete, refresh to request recovery or wait for a new round. If the package moves or the Chrome profile changes, reload the extension and use launcher option 2. To apply updated extension files, reload the extension and refresh the game. Autoplay is optional and disabled by default.

## Choose or import a model

Choose 1, then select a model by number or press Enter to use the last selection. Choose A to import: drag an ONNX file into the terminal and press Enter. The launcher tests compatibility and stores a copy in `model/imported/`. It preserves existing models and remembers your choice. Select Q to return. Only self-contained compatible Mortal v4 ONNX models are supported.

## Temporary autoplay

Check **Enable autoplay** in the HUD to follow AI decisions; clear it to block all further automated submissions. Normally actions wait randomly for 1–3 seconds. When little time remains, a still-valid highlighted recommendation is sent immediately. If a discard or win is not confirmed in time, the extension uses Chrome’s debugger permission to click the current visible highlight. For discards, it can confirm the selected tile with a second click if the game has not yet sent an operation. The HUD reports confirmation from the game event. Chrome may briefly display a debugging notice. The checkbox stays enabled across manual moves and recoverable errors; a decision is skipped if its game state cannot be verified. A submission already sent cannot be recalled. Keep the game page open and the computer awake.

Compatibility with live Mahjong Soul games still needs verification. Test riichi and multiple chi choices in a computer practice game first.
