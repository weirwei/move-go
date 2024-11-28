# Go Move Auto Update

A Visual Studio Code extension that automatically updates package references in other files when moving or renaming Go directories or files.

## Features

- Automatically detects move or rename operations on Go files and directories
- Updates package imports in other files when Go files are moved or renamed
- Supports recursive updates in subdirectories
- Provides operation logs showing updated files and changes made

Example:

When you move or rename a Go file in VSCode, for instance, moving `utils/helper.go` to `common/helper.go`:

```go
// Original file location: utils/helper.go
package utils

func HelperFunction() {
    // ...
}
```

The extension will automatically update import statements in other files:

```go
// Before update
import "myproject/utils"

// After update
import "myproject/common"
```

## Requirements

- Visual Studio Code 1.93.0 or higher
- Make sure `goimports` was installed

## Usage

1. After installing the extension, open VSCode in a workspace containing Go projects
2. Use VSCode's file explorer to move or rename Go files or directories
3. The extension will automatically detect these operations and update package references in relevant files

## Configuration

You can customize the behavior of Go Move Auto Update through the following setting:

- `move-go.showPrompt`: Enable/disable the prompt asking for confirmation before updating references (default: `true`)

To modify this setting:

1. Open VSCode Settings (File > Preferences > Settings)
2. Search for "Go Move Auto Update"
3. Find the "Show Prompt" option and check/uncheck it as needed

Alternatively, you can add the following to your `settings.json` file:

```json
{
  "move-go.showPrompt": false
}
```

Set it to `false` if you want the extension to automatically update references without prompting.

## How It Works

The extension works by listening to VSCode's file system events:

1. Detects move/rename operations on Go files or directories
2. Scans all Go files in the project
3. Finds and updates affected import statements in these files
4. Automatically saves the changed files

## Known Issues

No known issues at this time. If you discover any problems, please submit an issue on the GitHub repository.
