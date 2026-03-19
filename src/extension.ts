import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export function activate(context: vscode.ExtensionContext) {
	// --- Helper: Get configurations ---
	function getFolderSymbol(type: 'names' | 'namesWithFolders' | 'ascii'): string {
		const config = vscode.workspace.getConfiguration('ameliance-copy-file-names');
		const defaultValue = type === 'ascii' ? '/' : '';
		return config.get<string>(`${type}.folderEndSymbol`) ?? defaultValue;
	}

	function getAsciiSymbols() {
		const config = vscode.workspace.getConfiguration('ameliance-copy-file-names.ascii');
		return {
			vertical: config.get<string>('verticalLine') ?? '│   ',
			last: config.get<string>('lastItem') ?? '└── ',
			item: config.get<string>('item') ?? '├── ',
			indent: '    ', // Відступ для останнього елемента (зазвичай 4 пробіли)
		};
	}

	// --- Helper: Get paths from URI or Clipboard fallback ---
	async function getSelectedPaths(uri: vscode.Uri, uris: vscode.Uri[]): Promise<string[]> {
		if (uris && uris.length > 0) return uris.map((u) => u.fsPath);
		if (uri) return [uri.fsPath];
		await vscode.commands.executeCommand('copyRelativeFilePath');
		const clipboard = await vscode.env.clipboard.readText();
		return clipboard ? clipboard.split(/\r?\n/).filter((line) => line.trim().length > 0) : [];
	}

	// --- Helper: Render ASCII Tree ---
	function renderTree(obj: any, prefix = ''): string {
		if (!obj || typeof obj !== 'object') return '';
		const folderSymbol = getFolderSymbol('ascii');
		const symbols = getAsciiSymbols();

		let result = '';
		const keys = Object.keys(obj).sort((a, b) => {
			const aIsDir = obj[a] !== null && typeof obj[a] === 'object';
			const bIsDir = obj[b] !== null && typeof obj[b] === 'object';
			if (aIsDir && !bIsDir) return -1;
			if (!aIsDir && bIsDir) return 1;
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

	function filterTopLevelPaths(paths: string[]): string[] {
		return paths.filter(
			(current) =>
				!paths.some((other) => {
					if (current === other) return false;
					const relative = path.relative(other, current);
					return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
				}),
		);
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

	const copyAsTreeSelected = vscode.commands.registerCommand(
		'ameliance-copy-file-names.copyAsTreeSelected',
		async (uri, uris) => {
			const list = await getSelectedPaths(uri, uris);
			const workspace = vscode.workspace.workspaceFolders?.[0].uri.fsPath || '';
			const folderSymbol = getFolderSymbol('ascii');
			const map: any = {};

			list.forEach((p) => {
				let curr = map;
				const isDir = fs.existsSync(p) && fs.statSync(p).isDirectory();
				const parts = path.relative(workspace, p).split(path.sep);
				parts.forEach((part, index) => {
					const isLast = index === parts.length - 1;
					if (!curr[part]) curr[part] = isLast && !isDir ? null : {};
					curr = curr[part];
				});
			});

			const rootKeys = Object.keys(map);
			let output = '';
			if (rootKeys.length === 1) {
				const isDir = map[rootKeys[0]] !== null;
				output = `${rootKeys[0]}${isDir ? folderSymbol : ''}\n${renderTree(map[rootKeys[0]])}`;
			} else {
				output = renderTree(map);
			}
			await vscode.env.clipboard.writeText(output.trimEnd());
		},
	);

	const copyAsTreeRecursive = vscode.commands.registerCommand(
		'ameliance-copy-file-names.copyAsTreeRecursive',
		async (uri, uris) => {
			const paths = filterTopLevelPaths(await getSelectedPaths(uri, uris));
			const folderSymbol = getFolderSymbol('ascii');
			const symbols = getAsciiSymbols();

			function scan(p: string): any {
				if (fs.statSync(p).isDirectory()) {
					const m: any = {};
					fs.readdirSync(p).forEach((f) => {
						if (!ignoreList.includes(f)) m[f] = scan(path.join(p, f));
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
		},
	);

	const copyFileNamesInFolderFlat = vscode.commands.registerCommand(
		'ameliance-copy-file-names.copyFileNamesInFolderFlat',
		async (uri, uris) => {
			const paths = filterTopLevelPaths(await getSelectedPaths(uri, uris));
			let files: string[] = [];
			paths.forEach((p) => {
				if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
					files = [
						...files,
						...fs
							.readdirSync(p)
							.filter((i) => fs.statSync(path.join(p, i)).isFile())
							.sort(),
					];
				} else {
					files.push(path.basename(p));
				}
			});
			await vscode.env.clipboard.writeText([...new Set(files)].join('\n'));
		},
	);

	const copyFileNamesInFolderRecursive = vscode.commands.registerCommand(
		'ameliance-copy-file-names.copyFileNamesInFolderRecursive',
		async (uri, uris) => {
			const paths = filterTopLevelPaths(await getSelectedPaths(uri, uris));
			let files: string[] = [];
			function walk(p: string) {
				if (fs.statSync(p).isDirectory()) {
					fs.readdirSync(p).forEach((i) => !ignoreList.includes(i) && walk(path.join(p, i)));
				} else {
					files.push(path.basename(p));
				}
			}
			paths.forEach(walk);
			await vscode.env.clipboard.writeText([...new Set(files)].sort().join('\n'));
		},
	);

	const copyNamesInFolderWithFoldersFlat = vscode.commands.registerCommand(
		'ameliance-copy-file-names.copyNamesInFolderWithFoldersFlat',
		async (uri, uris) => {
			const pathsList = filterTopLevelPaths(await getSelectedPaths(uri, uris));
			const symbol = getFolderSymbol('namesWithFolders');
			let resultList: string[] = [];

			pathsList.forEach((p) => {
				if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
					const items = fs.readdirSync(p).filter((item) => !ignoreList.includes(item));
					const folders = items
						.filter((i) => fs.statSync(path.join(p, i)).isDirectory())
						.sort()
						.map((f) => f + symbol);
					const files = items.filter((i) => fs.statSync(path.join(p, i)).isFile()).sort();
					resultList = [...resultList, ...folders, ...files];
				} else {
					resultList.push(path.basename(p));
				}
			});
			await vscode.env.clipboard.writeText([...new Set(resultList)].join('\n'));
		},
	);

	const copyNamesInFolderWithFoldersRecursive = vscode.commands.registerCommand(
		'ameliance-copy-file-names.copyNamesInFolderWithFoldersRecursive',
		async (uri, uris) => {
			const pathsList = filterTopLevelPaths(await getSelectedPaths(uri, uris));
			const symbol = getFolderSymbol('namesWithFolders');
			let resultList: string[] = [];

			function collectRecursive(fsPath: string) {
				if (fs.statSync(fsPath).isDirectory()) {
					const items = fs.readdirSync(fsPath).filter((item) => !ignoreList.includes(item));
					const sorted = items.sort((a, b) => {
						const aIsDir = fs.statSync(path.join(fsPath, a)).isDirectory();
						const bIsDir = fs.statSync(path.join(fsPath, b)).isDirectory();
						if (aIsDir && !bIsDir) return -1;
						if (!aIsDir && bIsDir) return 1;
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
		},
	);

	context.subscriptions.push(
		copyNames,
		copyFileNamesInFolderFlat,
		copyFileNamesInFolderRecursive,
		copyNamesInFolderWithFoldersFlat,
		copyNamesInFolderWithFoldersRecursive,
		copyAsTreeSelected,
		copyAsTreeRecursive,
	);
}

export function deactivate() {}
