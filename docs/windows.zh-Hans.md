> This guide describes the separately assembled Windows package. The source folder does not include its model or runtime.

# mjai — Windows 使用说明

[繁體中文](windows.md) · 简体中文 · [English](windows.en.md)

Windows x64 套件包含模型、Python、ONNX Runtime、桥接程序和 Chrome 扩展程序。请保留完整文件夹。需要 Windows 10 或 11 64 位及 Google Chrome。桥接程序已交叉编译，尚未在 Windows 实机测试。

## 首次使用

1. 将整个文件夹解压到可写位置，例如「文档」。不要在 ZIP 内直接运行。
2. 打开 Chrome，双击 `Start-mjai.bat`。启动器会检查环境和模型。
3. 选择 1。在 Chrome 扩展程序页面开启「开发者模式」，选择「加载已解压的扩展程序」，选中 `extension` 文件夹。
4. 返回启动窗口按 Enter。程序会尝试检测并记住扩展程序 ID。若检测失败，从扩展程序卡片复制 ID 并粘贴一次。
5. 保持启动窗口开启，使用同一个 Chrome 个人资料刷新雀魂，开始四人牌局。

## 使用 mjai

启动程序后选择 1，结束时按 Ctrl+C。选择 2 可更改扩展程序 ID，选择 3 可重新检查环境。若 23410 端口被占用，请先关闭之前运行的 mjai 桥接程序。

HUD 的「語言 / 语言 / Language」可切换繁体中文、简体中文和 English，Chrome 会记住选择。「最佳牌显示」和「危险牌显示」可独立开关。主题可选黑绿、白色或浅粉蓝。

绿框标示建议。危险提示默认关闭。红框表示高风险，橙框表示中风险，依据包括立直、副露、舍牌和可见牌。推荐牌同时危险时，绿框上会显示对应颜色警告。没有标记的牌仍可能放铳。

拖动 HUD 标题可移动，按 − 和 + 缩放，按 ▾ 收起。收起时牌面标记仍会显示，可在 HUD 重设位置与大小。若标记不对齐，使用「调整标记位置」，将黄色预览框对齐第一张牌和最右操作按钮。

AI 风格可选 Default、CallManiac 和 SuperTurtle。强度范围为 0–2，默认 1。0 使用原始 Mortal 决策。更改在下次决策生效。

## 故障排除

若没有 HUD，请在相同的 Chrome 个人资料中启用扩展程序，保持启动器运行并刷新游戏。牌局数据不完整时，刷新以请求恢复或等待新一局。移动套件或更换 Chrome 个人资料后，重新加载扩展程序并使用启动器选项 2。更新扩展程序文件后，请重新加载扩展程序并刷新游戏。HUD 只显示建议。

## 选择或导入模型

选择 1 后，输入编号选择模型，或按 Enter 使用上次选择。输入 A 导入模型，将 ONNX 文件拖入终端并按 Enter。启动器会检查兼容性，并把副本保存至 `model/imported/`，保留现有模型并记住选择。输入 Q 返回。请使用自包含且兼容 Mortal v4 的 ONNX 模型。
