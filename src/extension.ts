import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
    console.log('Extension "move-go" is now active!');

    const disposable = vscode.workspace.onWillRenameFiles(async (event) => {
        for (const file of event.files) {
            if (path.extname(file.oldUri.fsPath) === '.go') {
                try {
                    const thenable = updateImports(file.oldUri.fsPath, file.newUri.fsPath);
                    event.waitUntil(thenable);
                } catch (error) {
                    vscode.window.showErrorMessage(`更新Go文件时发生错误: ${error}`);
                }
            }
        }
    });

    context.subscriptions.push(disposable);
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

    // 在文件被移动之前读取内容
    const movedFileContent = await vscode.workspace.fs.readFile(vscode.Uri.file(oldPath));
    const movedFileDefinitions = getFileDefinitions(movedFileContent.toString());

    const files = await vscode.workspace.findFiles('**/*.go');

    for (const file of files) {
        const filePath = file.fsPath;
        const content = await vscode.workspace.fs.readFile(file);
        let text = content.toString();

        if (filePath === oldPath) {
            // 情况1: 移动文件本身
            text = updateMovedFile(text, newPackageName);
        } else if (path.dirname(filePath) === oldDir) {
            // 情况2: 和移动文件处于同一目录
            text = updateSameDirectoryFile(text, movedFileDefinitions, newPackageName, newImportPath);
        } else if (path.dirname(filePath) === newDir) {
            // 情况4: 移动文件的目标目录
            text = updateTargetDirectoryFile(text, oldImportPath, oldPackageName, movedFileDefinitions);
        } else {
            // 情况3: 和移动文件处于不同目录，但调用移动文件中的函数
            text = updateDifferentDirectoryFile(text, oldImportPath, newImportPath, oldPackageName, newPackageName);
        }
        if (text !== content.toString()) {
            await vscode.workspace.fs.writeFile(file, Buffer.from(text));
        }
    }
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
    // 添加新的import语句
    const importStatement = `"${newImportPath}"`;
    const importRegex = /import\s*\(([\s\S]*?)\)/;
    const importMatch = text.match(importRegex);

    if (importMatch) {
        // 如果已经有import块，在其中添加新的import
        if (!importMatch[1].includes(importStatement)) {
            text = text.replace(importRegex, (match) => {
                return match.slice(0, -1) + `\t${importStatement}\n)`;
            });
        }
    } else {
        // 如果没有import块，在package声明后添加新的import
        const packageRegex = /package\s+\w+/;
        text = text.replace(packageRegex, (match) => {
            return `${match}\n\nimport (\n\t${importStatement}\n)`;
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
    // 删除导入语句
    const importRegex = /import\s*\(([\s\S]*?)\)/;
    text = text.replace(importRegex, (match, imports) => {
        const lines = imports.split('\n').filter((line: string) => !line.includes(oldImportPath));
        if (lines.length <= 0) {
            return '';
        }
        return `import (\n${lines.join('\n')}\n)`;
    });

    // 删除函数调用的包名前缀
    for (const def of movedFileDefinitions) {
        const prefixRegex = new RegExp(`\\b${escapeRegExp(oldPackageName)}\\.${escapeRegExp(def)}\\b`, 'g');
        text = text.replace(prefixRegex, def);
    }

    return text;
}

function updateDifferentDirectoryFile(text: string, oldImportPath: string, newImportPath: string, oldPackageName: string, newPackageName: string): string {
    // 更新导入路径
    const importRegex = /import\s*\(([\s\S]*?)\)/;
    text = text.replace(importRegex, (match, imports) => {
        const updatedImports = imports.replace(
            new RegExp(`["']${escapeRegExp(oldImportPath)}["']`, 'g'),
            `"${newImportPath}"`
        );
        return `import (${updatedImports})`;
    });

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
