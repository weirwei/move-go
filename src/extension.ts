import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';

export function activate(context: vscode.ExtensionContext) {
    console.log('Extension "move-go" is now active!');

    const disposable = vscode.workspace.onWillRenameFiles(async (event) => {
        for (const file of event.files) {
            if (path.extname(file.oldUri.fsPath) === '.go') {
                try {
                    const thenable = handleFileRename(file.oldUri.fsPath, file.newUri.fsPath);
                    event.waitUntil(thenable);
                } catch (error) {
                    vscode.window.showErrorMessage(`移动Go文件时发生错误: ${error}`);
                }
            }
        }
    });

    context.subscriptions.push(disposable);
}

async function handleFileRename(oldPath: string, newPath: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('move-go');
    const showPrompt = config.get<boolean>('showPrompt', true);

    if (showPrompt) {
        const answer = await vscode.window.showWarningMessage(
            '检测到Go文件移动。是否需要更新引用？',
            { modal: true },
            '是'
        );

        if (answer === '是') {
            await updateImports(oldPath, newPath);
        }
    } else {
        // 如果禁用了弹窗，直接更新引用
        await updateImports(oldPath, newPath);
    }
}

async function updateImports(oldPath: string, newPath: string): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        return;
    }

    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    const moduleName = await getGoModuleName(workspaceRoot);

    const oldRelativePath = path.relative(workspaceRoot, oldPath);
    const newRelativePath = path.relative(workspaceRoot, newPath);

    const oldImportPath = getGoImportPath(moduleName, oldRelativePath);
    const newImportPath = getGoImportPath(moduleName, newRelativePath);

    const oldPackageName = path.basename(path.dirname(oldPath));
    const newPackageName = path.basename(path.dirname(newPath));

    const oldDir = path.dirname(oldPath);
    const newDir = path.dirname(newPath);

    const movedFileContent = await vscode.workspace.fs.readFile(vscode.Uri.file(oldPath));
    const movedFileDefinitions = getFileDefinitions(movedFileContent.toString());

    const files = await vscode.workspace.findFiles('**/*.go');

    const affectedFiles = new Set<string>();

    for (const file of files) {
        const filePath = file.fsPath;
        const content = await vscode.workspace.fs.readFile(file);
        let text = content.toString();
        let isModified = false;

        if (filePath === oldPath) {
            text = updateMovedFile(text, newPackageName);
            isModified = true;
        } else if (path.dirname(filePath) === oldDir) {
            text = updateSameDirectoryFile(text, movedFileDefinitions, newPackageName, newImportPath);
            isModified = true;
        } else if (path.dirname(filePath) === newDir) {
            text = updateTargetDirectoryFile(text, oldImportPath, oldPackageName, movedFileDefinitions);
            isModified = true;
        } else {
            const updatedText = updateDifferentDirectoryFile(text, oldImportPath, newImportPath, oldPackageName, newPackageName);
            if (updatedText !== text) {
                text = updatedText;
                isModified = true;
            }
        }

        if (isModified) {
            await vscode.workspace.fs.writeFile(file, Buffer.from(text));
            affectedFiles.add(filePath);
        }
    }
    console.log("affectedFiles",affectedFiles)
    // 对受影响的文件执行 goimports 命令
    for (const filePath of affectedFiles) {
        await runGoimports(filePath);
    }
}

async function runGoimports(filePath: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const command = `goimports -w "${filePath}"`;
        cp.exec(command, (error, stdout, stderr) => {
            if (error) {
                vscode.window.showErrorMessage(`执行 goimports 时发生错误: ${error.message}`);
                reject(error);
            } else {
                console.log(`goimports 执行成功: ${filePath}`);
                if (stderr) {
                    console.error(`goimports 警告: ${stderr}`);
                }
                resolve();
            }
        });
    });
}

function getFileDefinitions(content: string): string[] {
    const definitions = [];
    const lines = content.split('\n');
    const singleLineRegex = /^(func|var|const|type)\s+(\w+)/;
    const blockStartRegex = /^(var|const|type)\s*\(/;
    const blockEndRegex = /^\)/;
    const blockItemRegex = /^\s*(\w+)/;

    let inBlock = false;
    let blockType = '';

    for (const line of lines) {
        if (inBlock) {
            if (blockEndRegex.test(line)) {
                inBlock = false;
                blockType = '';
            } else {
                const match = line.match(blockItemRegex);
                if (match) {
                    definitions.push(match[1]);
                }
            }
        } else {
            const singleLineMatch = line.match(singleLineRegex);
            if (singleLineMatch) {
                definitions.push(singleLineMatch[2]);
            } else {
                const blockStartMatch = line.match(blockStartRegex);
                if (blockStartMatch) {
                    inBlock = true;
                    blockType = blockStartMatch[1];
                }
            }
        }
    }

    return definitions;
}

function updateMovedFile(text: string, newPackageName: string): string {
    const packageRegex = /package\s+(\w+)/;
    const match = text.match(packageRegex);

    if (match) {
        text = text.replace(packageRegex, `package ${newPackageName}`);
    }

    return text;
}

function updateSameDirectoryFile(text: string, movedFileDefinitions: string[], newPackageName: string, newImportPath: string): string {
    const importStatement = `"${newImportPath}"`;
    const singleImportRegex = /^import\s+"[^"]+"\s*$/m;
    const multiImportRegex = /import\s*\(([\s\S]*?)\)/;

    if (multiImportRegex.test(text)) {
        // 处理多行 import 块
        text = text.replace(multiImportRegex, (match, imports) => {
            if (!imports.includes(importStatement)) {
                return `import (\n${imports}\t${importStatement}\n)`;
            }
            return match;
        });
    } else if (singleImportRegex.test(text)) {
        // 处理单行 import
        if (!text.includes(importStatement)) {
            text = text.replace(singleImportRegex, (match) => {
                return `${match}\nimport ${importStatement}`;
            });
        }
    } else {
        // 没有 import，添加新的 import
        const packageRegex = /package\s+\w+/;
        text = text.replace(packageRegex, (match) => {
            return `${match}\n\nimport ${importStatement}`;
        });
    }

    // 为移动文件中的定义添加新的包名前缀
    for (const def of movedFileDefinitions) {
        const defRegex = new RegExp(`\\b${escapeRegExp(def)}\\b(?!\\s*:=)`, 'g');
        text = text.replace(defRegex, `${newPackageName}.${def}`);
    }
    return text;
}

function updateTargetDirectoryFile(text: string, oldImportPath: string, oldPackageName: string, movedFileDefinitions: string[]): string {
    const singleImportRegex = new RegExp(`^import\\s+"${escapeRegExp(oldImportPath)}"\\s*$`, 'm');
    const multiImportRegex = /import\s*\(([\s\S]*?)\)/;

    if (multiImportRegex.test(text)) {
        // 处理多行 import 块
        text = text.replace(multiImportRegex, (match, imports) => {
            const lines = imports.split('\n').filter((line: string) => !line.includes(oldImportPath));
            if (lines.length <= 0) {
                return '';
            }
            return `import (\n${lines.join('\n')}\n)`;
        });
    } else {
        // 处理单行 import
        text = text.replace(singleImportRegex, '');
    }

    // 删除函数调用的包名前缀
    for (const def of movedFileDefinitions) {
        const prefixRegex = new RegExp(`\\b${escapeRegExp(oldPackageName)}\\.${escapeRegExp(def)}\\b`, 'g');
        text = text.replace(prefixRegex, def);
    }

    return text;
}

function updateDifferentDirectoryFile(text: string, oldImportPath: string, newImportPath: string, oldPackageName: string, newPackageName: string): string {
    const singleImportRegex = new RegExp(`^import\\s+"${escapeRegExp(oldImportPath)}"\\s*$`, 'm');
    const multiImportRegex = /import\s*\(([\s\S]*?)\)/;

    if (multiImportRegex.test(text)) {
        // 处理多行 import 块
        text = text.replace(multiImportRegex, (match, imports) => {
            const updatedImports = imports.replace(
                new RegExp(`["']${escapeRegExp(oldImportPath)}["']`, 'g'),
                `"${newImportPath}"`
            );
            return `import (${updatedImports})`;
        });
    } else {
        // 处理单行 import
        text = text.replace(singleImportRegex, `import "${newImportPath}"`);
    }

    // 更新函数调用
    if (oldPackageName !== newPackageName) {
        const functionCallRegex = new RegExp(`\\b${escapeRegExp(oldPackageName)}\\.`, 'g');
        text = text.replace(functionCallRegex, `${newPackageName}.`);
    }

    return text;
}

async function getGoModuleName(workspaceRoot: string): Promise<string> {
    const goModPath = path.join(workspaceRoot, 'go.mod');
    try {
        const content = await vscode.workspace.fs.readFile(vscode.Uri.file(goModPath));
        const text = content.toString();
        const match = text.match(/module\s+(.+)/);
        if (match) {
            return match[1].trim();
        }
    } catch (error) {
        console.error('Error reading go.mod file:', error);
    }
    return '';
}

function getGoImportPath(moduleName: string, relativePath: string): string {
    const parts = relativePath.split(path.sep);
    const packagePath = parts.slice(0, -1).join('/');
    return `${moduleName}/${packagePath}`;
}

function escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function deactivate() { }
