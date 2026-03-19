"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.deactivate = exports.activate = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
function activate(context) {
    // --- Helper: Get configurations ---
    function getFolderSymbol(type) {
        const config = vscode.workspace.getConfiguration('ameliance-copy-file-names');
        const defaultValue = type === 'ascii' ? '/' : '';
        return config.get(`${type}.folderEndSymbol`) ?? defaultValue;
    }
    function getAsciiSymbols() {
        const config = vscode.workspace.getConfiguration('ameliance-copy-file-names.ascii');
        return {
            vertical: config.get('verticalLine') ?? '│   ',
            last: config.get('lastItem') ?? '└── ',
            item: config.get('item') ?? '├── ',
            indent: '    ', // Відступ для останнього елемента (зазвичай 4 пробіли)
        };
    }
    // --- Helper: Get paths from URI or Clipboard fallback ---
    async function getSelectedPaths(uri, uris) {
        if (uris && uris.length > 0)
            return uris.map((u) => u.fsPath);
        if (uri)
            return [uri.fsPath];
        await vscode.commands.executeCommand('copyRelativeFilePath');
        const clipboard = await vscode.env.clipboard.readText();
        return clipboard ? clipboard.split(/\r?\n/).filter((line) => line.trim().length > 0) : [];
    }
    // --- Helper: Render ASCII Tree ---
    function renderTree(obj, prefix = '') {
        if (!obj || typeof obj !== 'object')
            return '';
        const folderSymbol = getFolderSymbol('ascii');
        const symbols = getAsciiSymbols();
        let result = '';
        const keys = Object.keys(obj).sort((a, b) => {
            const aIsDir = obj[a] !== null && typeof obj[a] === 'object';
            const bIsDir = obj[b] !== null && typeof obj[b] === 'object';
            if (aIsDir && !bIsDir)
                return -1;
            if (!aIsDir && bIsDir)
                return 1;
            return a.localeCompare(b);
        });
        keys.forEach((key, index) => {
            const isLast = index === keys.length - 1;
            const connector = isLast ? symbols.last : symbols.item;
            const isDir = obj[key] !== null && typeof obj[key] === 'object';
            result += `${prefix}${connector}${key}${isDir ? folderSymbol : ''}\n`;
            if (isDir) {
                const nextPrefix = prefix + (isLast ? symbols.indent : symbols.vertical);
                result += renderTree(obj[key], nextPrefix);
            }
        });
        return result;
    }
    function filterTopLevelPaths(paths) {
        return paths.filter((current) => !paths.some((other) => {
            if (current === other)
                return false;
            const relative = path.relative(other, current);
            return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
        }));
    }
    const ignoreList = ['node_modules', '.git', '.DS_Store', 'dist', 'build', '.next', '.nuxt'];
    // --- Commands Implementation ---
    const copyNames = vscode.commands.registerCommand('ameliance-copy-file-names.copyNames', async (uri, uris) => {
        const list = await getSelectedPaths(uri, uris);
        const symbol = getFolderSymbol('names');
        const names = list
            .map((p) => {
            const isDir = fs.existsSync(p) && fs.statSync(p).isDirectory();
            return path.basename(p) + (isDir ? symbol : '');
        })
            .join('\n');
        await vscode.env.clipboard.writeText(names);
    });
    const copyAsTreeSelected = vscode.commands.registerCommand('ameliance-copy-file-names.copyAsTreeSelected', async (uri, uris) => {
        const list = await getSelectedPaths(uri, uris);
        const workspace = vscode.workspace.workspaceFolders?.[0].uri.fsPath || '';
        const folderSymbol = getFolderSymbol('ascii');
        const map = {};
        list.forEach((p) => {
            let curr = map;
            const isDir = fs.existsSync(p) && fs.statSync(p).isDirectory();
            const parts = path.relative(workspace, p).split(path.sep);
            parts.forEach((part, index) => {
                const isLast = index === parts.length - 1;
                if (!curr[part])
                    curr[part] = isLast && !isDir ? null : {};
                curr = curr[part];
            });
        });
        const rootKeys = Object.keys(map);
        let output = '';
        if (rootKeys.length === 1) {
            const isDir = map[rootKeys[0]] !== null;
            output = `${rootKeys[0]}${isDir ? folderSymbol : ''}\n${renderTree(map[rootKeys[0]])}`;
        }
        else {
            output = renderTree(map);
        }
        await vscode.env.clipboard.writeText(output.trimEnd());
    });
    const copyAsTreeRecursive = vscode.commands.registerCommand('ameliance-copy-file-names.copyAsTreeRecursive', async (uri, uris) => {
        const paths = filterTopLevelPaths(await getSelectedPaths(uri, uris));
        const folderSymbol = getFolderSymbol('ascii');
        const symbols = getAsciiSymbols();
        function scan(p) {
            if (fs.statSync(p).isDirectory()) {
                const m = {};
                fs.readdirSync(p).forEach((f) => {
                    if (!ignoreList.includes(f))
                        m[f] = scan(path.join(p, f));
                });
                return m;
            }
            return null;
        }
        let out = '';
        paths.forEach((p, i) => {
            const isLast = i === paths.length - 1;
            const name = path.basename(p);
            const isDir = fs.statSync(p).isDirectory();
            const connector = paths.length > 1 ? (isLast ? symbols.last : symbols.item) : '';
            out += `${connector}${name}${isDir ? folderSymbol : ''}\n`;
            const nextPrefix = paths.length > 1 ? (isLast ? symbols.indent : symbols.vertical) : '';
            out += renderTree(scan(p), nextPrefix);
        });
        await vscode.env.clipboard.writeText(out.trimEnd());
    });
    const copyFileNamesInFolderFlat = vscode.commands.registerCommand('ameliance-copy-file-names.copyFileNamesInFolderFlat', async (uri, uris) => {
        const paths = filterTopLevelPaths(await getSelectedPaths(uri, uris));
        let files = [];
        paths.forEach((p) => {
            if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
                files = [
                    ...files,
                    ...fs
                        .readdirSync(p)
                        .filter((i) => fs.statSync(path.join(p, i)).isFile())
                        .sort(),
                ];
            }
            else {
                files.push(path.basename(p));
            }
        });
        await vscode.env.clipboard.writeText([...new Set(files)].join('\n'));
    });
    const copyFileNamesInFolderRecursive = vscode.commands.registerCommand('ameliance-copy-file-names.copyFileNamesInFolderRecursive', async (uri, uris) => {
        const paths = filterTopLevelPaths(await getSelectedPaths(uri, uris));
        let files = [];
        function walk(p) {
            if (fs.statSync(p).isDirectory()) {
                fs.readdirSync(p).forEach((i) => !ignoreList.includes(i) && walk(path.join(p, i)));
            }
            else {
                files.push(path.basename(p));
            }
        }
        paths.forEach(walk);
        await vscode.env.clipboard.writeText([...new Set(files)].sort().join('\n'));
    });
    const copyNamesInFolderWithFoldersFlat = vscode.commands.registerCommand('ameliance-copy-file-names.copyNamesInFolderWithFoldersFlat', async (uri, uris) => {
        const pathsList = filterTopLevelPaths(await getSelectedPaths(uri, uris));
        const symbol = getFolderSymbol('namesWithFolders');
        let resultList = [];
        pathsList.forEach((p) => {
            if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
                const items = fs.readdirSync(p).filter((item) => !ignoreList.includes(item));
                const folders = items
                    .filter((i) => fs.statSync(path.join(p, i)).isDirectory())
                    .sort()
                    .map((f) => f + symbol);
                const files = items.filter((i) => fs.statSync(path.join(p, i)).isFile()).sort();
                resultList = [...resultList, ...folders, ...files];
            }
            else {
                resultList.push(path.basename(p));
            }
        });
        await vscode.env.clipboard.writeText([...new Set(resultList)].join('\n'));
    });
    const copyNamesInFolderWithFoldersRecursive = vscode.commands.registerCommand('ameliance-copy-file-names.copyNamesInFolderWithFoldersRecursive', async (uri, uris) => {
        const pathsList = filterTopLevelPaths(await getSelectedPaths(uri, uris));
        const symbol = getFolderSymbol('namesWithFolders');
        let resultList = [];
        function collectRecursive(fsPath) {
            if (fs.statSync(fsPath).isDirectory()) {
                const items = fs.readdirSync(fsPath).filter((item) => !ignoreList.includes(item));
                const sorted = items.sort((a, b) => {
                    const aIsDir = fs.statSync(path.join(fsPath, a)).isDirectory();
                    const bIsDir = fs.statSync(path.join(fsPath, b)).isDirectory();
                    if (aIsDir && !bIsDir)
                        return -1;
                    if (!aIsDir && bIsDir)
                        return 1;
                    return a.localeCompare(b);
                });
                sorted.forEach((item) => {
                    const isDir = fs.statSync(path.join(fsPath, item)).isDirectory();
                    resultList.push(item + (isDir ? symbol : ''));
                    collectRecursive(path.join(fsPath, item));
                });
            }
        }
        pathsList.forEach(collectRecursive);
        await vscode.env.clipboard.writeText(resultList.join('\n'));
    });
    context.subscriptions.push(copyNames, copyFileNamesInFolderFlat, copyFileNamesInFolderRecursive, copyNamesInFolderWithFoldersFlat, copyNamesInFolderWithFoldersRecursive, copyAsTreeSelected, copyAsTreeRecursive);
}
exports.activate = activate;
function deactivate() { }
exports.deactivate = deactivate;
//# sourceMappingURL=extension.js.map