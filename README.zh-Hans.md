# mjai

[English](README.md) · 简体中文 · [繁體中文](README.zh-Hant.md)

mjai 是雀魂 AI 辅助工具，HUD 也提供可选的代打功能。Chrome 扩展程序读取支持的牌局消息，本地 Rust 桥接程序维护牌局状态，Mortal v4 ONNX 模型提供建议。

此文件夹为源码套件，不含模型、ONNX Runtime、Python、已编译桥接程序、Chrome 个人资料或已保存的扩展程序 ID。普通用户请参阅另行提供的 portable 套件。macOS 启动器源码及[套件指南](docs/macos.zh-Hans.md)也包含在内。

## 下载并使用

发行版发布后，从 GitHub Releases 下载 macOS 或 Windows portable 套件并完整解压。macOS 双击 `Start-mjai.command`，Windows 双击 `Start-mjai.bat`。选择 **1**，选择模型或将 ONNX 模型拖入终端导入，再按提示设置 Chrome 扩展程序。下方 Rust 命令供开发者从源码构建。

GitHub 源码 ZIP 不含随附模型、桥接程序或运行环境。

## 功能

- 切牌、操作按钮及可识别的原生多选吃牌绿框。
- 可选代打，包含 1–3 秒延迟、立直切牌及牌局事件确认的绿框备用操作。
- 根据立直、副露和后盘舍牌显示红色及橙色风险提示，可独立切换。
- 黑绿、白色、浅粉蓝主题，以及可保存的位置、大小和收起状态。
- Default Mortal、CallManiac、SuperTurtle 人格及强度调节。
- 支持四人牌局状态追踪及指定消息的重连恢复。
- HUD 可切换繁体中文、简体中文和 English。

CallManiac 的役种路线判断较保守，无法保证和牌。筋牌是风险估计；高亮位置可能需要调整。

## 开发者：macOS 构建和测试

源码曾在 Apple Silicon macOS、Rust/Cargo 1.99 和 Python 3.8 开发库上测试。构建需要 Rust、Python 头文件和 Cargo 依赖。实际推理需要模型与 ONNX Runtime。

1. 安装 Rust 和兼容的 Python 3.8 开发环境。
2. 在项目文件夹执行：

```sh
export PYO3_PYTHON=/path/to/python3.8
cargo test --locked --manifest-path bridge/Cargo.toml
cargo build --locked --manifest-path bridge/Cargo.toml
node --test extension/tests/*.test.cjs
```

3. 准备有权使用的 Mortal v4 ONNX 模型与兼容 ONNX Runtime 动态库。模型须接受 `obs` 和 `mask`，并输出包含 46 个动作的 `q`。
4. 在 Chrome 扩展程序页面开启开发者模式，加载 `extension/` 并复制其 ID。
5. 替换以下路径和 ID 后启动桥接程序：

```sh
export ORT_DYLIB_PATH=/path/to/libonnxruntime.dylib
bridge/target/debug/majsoul-bridge-server \
  --model /path/to/model.onnx \
  --allow-origin chrome-extension://YOUR_EXTENSION_ID
```

6. 保持桥接程序运行，刷新游戏页面并开始四人牌局。在 HUD 选择人格与强度，按 Control–C 结束桥接程序。

## Windows

Windows 启动器源码位于 `windows/`，另行组装的套件操作见 [Windows 指南](docs/windows.zh-Hans.md)。Windows 可执行文件已交叉编译，尚未实机测试。

在 Windows x64 安装 Rust、Visual Studio C++ 构建工具和附开发库的 64 位 Python 3.8，于 PowerShell 执行：

```powershell
$env:PYO3_PYTHON = (Get-Command python).Source
cargo test --locked --manifest-path bridge/Cargo.toml
cargo build --release --locked --manifest-path bridge/Cargo.toml
```

实际推理还需兼容 ONNX Runtime DLL、Python DLL 和 Mortal v4 ONNX 模型，并设置 `ORT_DYLIB_PATH`。启动桥接程序时设置 `--allow-origin chrome-extension://YOUR_EXTENSION_ID`。

## 隐私和许可

桥接程序默认只监听本机，并限制已设置的扩展程序来源。扩展程序传送建议所需的牌局消息，不转发登录凭证；当前牌局历史只保留在内存。源码套件排除本地设置、浏览器资料、模型、运行环境及构建产物。

项目原创代码采用 **AGPL-3.0-or-later**，详见 [LICENSE](LICENSE)。随附 Mortal 代码也采用 AGPL-3.0-or-later。其他第三方材料及声明见 [THIRD_PARTY.md](THIRD_PARTY.md)。此源码仓库不包含 ONNX 模型，模型来源及再分发权需另行确认。
