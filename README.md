# mjai

English · [简体中文](README.zh-Hans.md) · [繁體中文](README.zh-Hant.md)

mjai is a read-only Mahjong Soul assistant: a Chrome extension observes supported
game messages, a local Rust bridge maintains game state, and a Mortal v4 ONNX
model provides suggestions. The extension displays advice and does not play.

This folder is a **source package**. It does not contain a model, ONNX Runtime,
Python, a built bridge, Chrome profile data or saved extension IDs. A separate
portable package is intended for end users; see its setup guide.
The macOS launcher source and [macOS package guide](docs/macos.md) are included;
the launcher needs the separately supplied model and runtime files.

## Download and play

Download the macOS or Windows portable package from the repository Releases page after a release is published. Extract the entire folder, then double-click `Start-mjai.command` on macOS or `Start-mjai.bat` on Windows. Choose **1** and select a model or import an ONNX file by dragging it into the terminal. Follow the Chrome extension prompts. Rust commands below are for developers building from source.

The source-code ZIP does not contain the bundled model, bridge or runtime.

## Features

- Suggestions and optional green outlines for discards and action buttons.
- Optional red and orange warnings for high- and medium-risk tiles based on riichi, open melds and late-round discards, independently configurable from the recommendation highlight.
- Black-green, white, and pastel pink-blue HUD themes, with saved position, scale and collapse state.
- Default Mortal, CallManiac and SuperTurtle styles, with adjustable intensity.
- Switch the HUD between Traditional Chinese, Simplified Chinese and English.
- Four-player game state tracking and reconnect recovery for supported messages.

CallManiac checks for plausible open-hand yaku routes; its early-hand guard is
conservative and cannot guarantee a future win. Suji is a risk estimate, not a
guarantee of safety. Highlight positions are estimated and may need adjustment.

## Developer build and test on macOS

The source was tested on Apple Silicon macOS with Rust/Cargo 1.99 and Python
3.8 development libraries. A Rust toolchain, Python headers and Cargo
dependencies are needed. The model and ONNX Runtime are needed for actual
inference; their absence does not prevent source-only tests.

1. Install Rust and a compatible Python 3.8 development installation.
2. From the project folder, build and run the tests:

   ```sh
   export PYO3_PYTHON=/path/to/python3.8
   cargo test --locked --manifest-path bridge/Cargo.toml
   cargo build --locked --manifest-path bridge/Cargo.toml
   node --test extension/tests/*.test.cjs
   ```

3. Supply a compatible Mortal v4 ONNX model and a compatible ONNX Runtime
   dynamic library. The model must accept `obs` and `mask` and produce `q`
   with 46 actions. Only use files you are entitled to use.
4. Load `extension/` through Chrome's **Extensions → Developer mode → Load
   unpacked**, and copy its extension ID.
5. Start the bridge, replacing the paths and ID below:

   ```sh
   export ORT_DYLIB_PATH=/path/to/libonnxruntime.dylib
   bridge/target/debug/majsoul-bridge-server \
     --model /path/to/model.onnx \
     --allow-origin chrome-extension://YOUR_EXTENSION_ID
   ```

6. Leave the bridge running, reload a supported game page and start a
   four-player game. Select a style and intensity in the HUD. Press Control-C
   in the bridge terminal to stop it.

## Windows

The Windows launcher source is in `windows/`; the [Windows package guide](docs/windows.md)
describes the separately assembled end-user bundle. The Windows binary was
cross-compiled but has not yet been tested on Windows.

To build from source on Windows x64, install Rust, Visual Studio C++ build
tools, and 64-bit Python 3.8 with its development libraries. From PowerShell:

```powershell
$env:PYO3_PYTHON = (Get-Command python).Source
cargo test --locked --manifest-path bridge/Cargo.toml
cargo build --release --locked --manifest-path bridge/Cargo.toml
```

Actual inference also requires the compatible ONNX Runtime DLL, the Python DLL,
and a Mortal v4 ONNX model. Supply these separately and configure
`ORT_DYLIB_PATH`; set `--allow-origin chrome-extension://YOUR_EXTENSION_ID`
when starting the bridge. A macOS executable cannot run on Windows.

## Privacy and local files

The bridge listens on loopback by default and restricts browser connections to
the configured extension origin. The extension forwards game-state traffic
needed for recommendations; it does not forward login tokens. Current-round
history is retained in memory for recovery. Local settings, browser profiles,
model weights, runtimes and build outputs are excluded from the source package.

## Attribution and publishing

See [THIRD_PARTY.md](THIRD_PARTY.md) and [Mortal/LICENSE](Mortal/LICENSE).
The included Mortal code is AGPL-3.0-or-later. The owner has not yet specified
licensing for the project's original files. Before publishing, establish the
appropriate license and verify the model's origin and redistribution rights.
