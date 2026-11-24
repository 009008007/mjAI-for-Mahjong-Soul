# mjai

[English](README.md) · [简体中文](README.zh-Hans.md) · 繁體中文

mjai 是雀魂的唯讀輔助工具。Chrome 擴充功能讀取支援的牌局訊息，本機 Rust 橋接程式維護牌局狀態，Mortal v4 ONNX 模型提供建議。

此資料夾為原始碼套件，不含模型、ONNX Runtime、Python、已編譯橋接程式、Chrome 個人資料或已儲存的擴充功能 ID。一般使用者請參閱另行提供的 portable 套件。macOS 啟動器原始碼及[套件指南](docs/macos.zh-Hant.md)也包含在內。

## 下載並使用

發行版發布後，從 GitHub Releases 下載 macOS 或 Windows portable 套件並完整解壓。macOS 按兩下 `Start-mjai.command`，Windows 按兩下 `Start-mjai.bat`。選擇 **1**，選擇模型或把 ONNX 模型拖入終端機匯入，再依提示設定 Chrome 擴充功能。下方 Rust 指令供開發者從原始碼建置。

GitHub 原始碼 ZIP 不含隨附模型、橋接程式或執行環境。

## 功能

- 切牌與操作按鈕建議及綠框。
- 根據立直、副露和後盤捨牌顯示紅色及橙色風險提示，可獨立切換。
- 黑綠、白色、淺粉藍主題，以及可儲存的位置、大小和收合狀態。
- Default Mortal、CallManiac、SuperTurtle 人格及強度調節。
- 支援四人牌局狀態追蹤及指定訊息的重連恢復。
- HUD 可切換繁體中文、簡體中文和 English。

CallManiac 的役種路線判斷較保守，無法保證和牌。筋牌是風險估計；高亮位置可能需要調整。

## 開發者：macOS 建置和測試

原始碼曾在 Apple Silicon macOS、Rust/Cargo 1.99 和 Python 3.8 開發函式庫上測試。建置需要 Rust、Python 標頭和 Cargo 依賴。實際推論需要模型與 ONNX Runtime。

1. 安裝 Rust 和相容的 Python 3.8 開發環境。
2. 在專案資料夾執行：

```sh
export PYO3_PYTHON=/path/to/python3.8
cargo test --locked --manifest-path bridge/Cargo.toml
cargo build --locked --manifest-path bridge/Cargo.toml
node --test extension/tests/*.test.cjs
```

3. 準備有權使用的 Mortal v4 ONNX 模型與相容 ONNX Runtime 動態函式庫。模型須接受 `obs` 和 `mask`，並輸出包含 46 個動作的 `q`。
4. 在 Chrome 擴充功能頁開啟開發人員模式，載入 `extension/` 並複製其 ID。
5. 替換以下路徑和 ID 後啟動橋接程式：

```sh
export ORT_DYLIB_PATH=/path/to/libonnxruntime.dylib
bridge/target/debug/majsoul-bridge-server \
  --model /path/to/model.onnx \
  --allow-origin chrome-extension://YOUR_EXTENSION_ID
```

6. 保持橋接程式執行，重新整理遊戲頁面並開始四人牌局。在 HUD 選擇人格與強度，按 Control–C 結束橋接程式。

## Windows

Windows 啟動器原始碼位於 `windows/`，另行組裝的套件操作見 [Windows 指南](docs/windows.md)。Windows 執行檔已交叉編譯，尚未實機測試。

在 Windows x64 安裝 Rust、Visual Studio C++ 建置工具和附開發函式庫的 64 位 Python 3.8，於 PowerShell 執行：

```powershell
$env:PYO3_PYTHON = (Get-Command python).Source
cargo test --locked --manifest-path bridge/Cargo.toml
cargo build --release --locked --manifest-path bridge/Cargo.toml
```

實際推論還需相容 ONNX Runtime DLL、Python DLL 和 Mortal v4 ONNX 模型，並設定 `ORT_DYLIB_PATH`。啟動橋接程式時設定 `--allow-origin chrome-extension://YOUR_EXTENSION_ID`。

## 私隱和授權

橋接程式預設只監聽本機，並限制已設定的擴充功能來源。擴充功能傳送建議所需的牌局訊息，不轉送登入憑證；當前牌局歷史只保留於記憶體。原始碼套件排除本機設定、瀏覽器資料、模型、執行環境及建置產物。

專案原創程式碼採用 **AGPL-3.0-or-later**，詳見 [LICENSE](LICENSE)。隨附 Mortal 程式碼亦採用 AGPL-3.0-or-later。其他第三方材料與聲明見 [THIRD_PARTY.md](THIRD_PARTY.md)。此原始碼儲存庫不包含 ONNX 模型，模型來源及再分發權需另行確認。
