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

If the HUD is missing, enable the extension in the same Chrome profile, leave the launcher running and refresh the game. If the game state is incomplete, refresh to request recovery or wait for a new round. If the package moves or the Chrome profile changes, reload the extension and use launcher option 2. To apply updated extension files, reload the extension and refresh the game. The HUD displays advice only.
