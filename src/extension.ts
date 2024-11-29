import * as vscode from 'vscode';
import * as path from 'path';
import * as cp from 'child_process';

// Configuration namespace for the extension
const CONFIG_NAMESPACE = 'move-go';

// Activation function for the extension
export function activate(context: vscode.ExtensionContext) {
    console.log('Extension "move-go" is now active!');

    const disposable = vscode.workspace.onWillRenameFiles(handleFileRename);
    context.subscriptions.push(disposable);
}

// Main handler for file rename events
async function handleFileRename(event: vscode.FileWillRenameEvent) {
    for (const file of event.files) {
        if (path.extname(file.oldUri.fsPath) === '.go') {
            try {
                const thenable = processFileRename(file.oldUri.fsPath, file.newUri.fsPath);
                event.waitUntil(thenable);
            } catch (error) {
                vscode.window.showErrorMessage(`Error moving Go file: ${error}`);
            }
        }
    }
}

// Process the file rename operation
async function processFileRename(oldPath: string, newPath: string): Promise<void> {
    const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    const showPrompt = config.get<boolean>('showPrompt', true);

    if (showPrompt) {
        const answer = await vscode.window.showInformationMessage(
            'Go file movement detected. Update references?',
            { modal: true },
            'Yes',
        );

        if (answer === 'Yes') {
            await updateImports(oldPath, newPath);
        }
    } else {
        await updateImports(oldPath, newPath);
    }
}

// Update imports and references in affected files
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

    await Promise.all(files.map(async (file) => {
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
    }));

    console.log("Affected files:", affectedFiles);

    // Run goimports on affected files
    await Promise.all([...affectedFiles].map(runGoimports));
}

// Run goimports on a single file
async function runGoimports(filePath: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const command = `goimports -w "${filePath}"`;
        cp.exec(command, (error, stdout, stderr) => {
            if (error) {
                vscode.window.showErrorMessage(`Error executing goimports: ${error.message}`);
                reject(error);
            } else {
                console.log(`goimports executed successfully: ${filePath}`);
                if (stderr) {
                    console.error(`goimports warning: ${stderr}`);
                }
                resolve();
            }
        });
    });
}

// Extract Go definitions from file content
function getFileDefinitions(content: string): string[] {
    const definitions: string[] = [];
    const lines = content.split('\n');
    const singleLineRegex = /^(func|var|const|type)\s+(\w+)/;
    const blockStartRegex = /^(var|const|type)\s*\(/;
    const blockEndRegex = /^\)/;
    const blockItemRegex = /^\s*(\w+)/;

    let inBlock = false;

    for (const line of lines) {
        if (inBlock) {
            if (blockEndRegex.test(line)) {
                inBlock = false;
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
                }
            }
        }
    }

    return definitions;
}

// Update the package name in the moved file
function updateMovedFile(text: string, newPackageName: string): string {
    const packageRegex = /package\s+(\w+)/;
    return text.replace(packageRegex, `package ${newPackageName}`);
}

// Update imports and references in files in the same directory as the moved file
function updateSameDirectoryFile(text: string, movedFileDefinitions: string[], newPackageName: string, newImportPath: string): string {
    const importStatement = `"${newImportPath}"`;
    const singleImportRegex = /^import\s+"[^"]+"\s*$/m;
    const multiImportRegex = /import\s*\(([\s\S]*?)\)/;

    if (multiImportRegex.test(text)) {
        text = text.replace(multiImportRegex, (match, imports) => {
            if (!imports.includes(importStatement)) {
                return `import (\n${imports}\t${importStatement}\n)`;
            }
            return match;
        });
    } else if (singleImportRegex.test(text)) {
        if (!text.includes(importStatement)) {
            text = text.replace(singleImportRegex, (match) => {
                return `${match}\nimport ${importStatement}`;
            });
        }
    } else {
        const packageRegex = /package\s+\w+/;
        text = text.replace(packageRegex, (match) => {
            return `${match}\n\nimport ${importStatement}`;
        });
    }

    for (const def of movedFileDefinitions) {
        const defRegex = new RegExp(`\\b${escapeRegExp(def)}\\b(?!\\s*:=)`, 'g');
        text = text.replace(defRegex, `${newPackageName}.${def}`);
    }
    return text;
}

// Update imports and references in files in the target directory
function updateTargetDirectoryFile(text: string, oldImportPath: string, oldPackageName: string, movedFileDefinitions: string[]): string {
    const singleImportRegex = new RegExp(`^import\\s+"${escapeRegExp(oldImportPath)}"\\s*$`, 'm');
    const multiImportRegex = /import\s*\(([\s\S]*?)\)/;

    if (multiImportRegex.test(text)) {
        text = text.replace(multiImportRegex, (match, imports) => {
            const lines = imports.split('\n').filter((line: string) => !line.includes(oldImportPath));
            if (lines.length <= 0) {
                return '';
            }
            return `import (\n${lines.join('\n')}\n)`;
        });
    } else {
        text = text.replace(singleImportRegex, '');
    }

    for (const def of movedFileDefinitions) {
        const prefixRegex = new RegExp(`\\b${escapeRegExp(oldPackageName)}\\.${escapeRegExp(def)}\\b`, 'g');
        text = text.replace(prefixRegex, def);
    }

    return text;
}

// Update imports and references in files in different directories
function updateDifferentDirectoryFile(text: string, oldImportPath: string, newImportPath: string, oldPackageName: string, newPackageName: string): string {
    const singleImportRegex = new RegExp(`^import\\s+"${escapeRegExp(oldImportPath)}"\\s*$`, 'm');
    const multiImportRegex = /import\s*\(([\s\S]*?)\)/;

    if (multiImportRegex.test(text)) {
        text = text.replace(multiImportRegex, (match, imports) => {
            const updatedImports = imports.replace(
                new RegExp(`["']${escapeRegExp(oldImportPath)}["']`, 'g'),
                `"${newImportPath}"`
            );
            return `import (${updatedImports})`;
        });
    } else {
        text = text.replace(singleImportRegex, `import "${newImportPath}"`);
    }

    if (oldPackageName !== newPackageName) {
        const functionCallRegex = new RegExp(`\\b${escapeRegExp(oldPackageName)}\\.`, 'g');
        text = text.replace(functionCallRegex, `${newPackageName}.`);
    }

    return text;
}

// Get the Go module name from go.mod file
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

// Generate Go import path
function getGoImportPath(moduleName: string, relativePath: string): string {
    const parts = relativePath.split(path.sep);
    const packagePath = parts.slice(0, -1).join('/');
    return `${moduleName}/${packagePath}`;
}

// Escape special characters in regular expressions
function escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Deactivation function for the extension
