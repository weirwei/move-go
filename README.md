# Move Go

Move Go 是一个 VSCode 扩展，用于移动 Go 语言文件或目录时自动更新相关的导入路径。

## 功能

这个扩展提供了以下功能：

- 移动 Go 文件或目录
- 自动更新移动后的文件中的导入路径
- 自动更新工作区中其他 Go 文件中对移动文件的导入路径

## 使用方法

1. 在 VSCode 中打开一个 Go 文件。
2. 使用快捷键 `Ctrl+Shift+P`（Windows/Linux）或 `Cmd+Shift+P`（macOS）打开命令面板。
3. 输入 "Move Go File and Update Imports" 并选择该命令。
4. 在弹出的输入框中输入新的文件路径。
5. 插件会自动移动文件并更新相关的导入路径。

## 要求

- Visual Studio Code 1.95.0 或更高版本
- 在工作区中打开的 Go 项目

## 扩展设置

目前，这个扩展不需要任何额外的设置。

## 已知问题

暂无已知问题。如果你发现任何问题，请在我们的 GitHub 仓库中提出 issue。

## 发布说明

### 0.0.1

- 初始版本
- 实现了基本的 Go 文件移动和导入路径更新功能

---

## 遵循扩展指南

我们确保遵循了 VSCode 扩展开发的最佳实践。更多信息请参考：

* [扩展指南](https://code.visualstudio.com/api/references/extension-guidelines)

**享受使用 Move Go 扩展！**
