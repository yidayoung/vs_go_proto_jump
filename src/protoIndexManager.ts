import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface ProtoDefinitionInfo {
    name: string;
    type: 'message' | 'enum';
    filePath: string;
    line: number;
    column: number;
    packageName?: string;
}



export interface ProtoFileInfo {
    filePath: string;
    definitions: Map<string, ProtoDefinitionInfo>;
    lastModified: number;
    packageName?: string;
}

export interface CacheData {
    version: string;
    timestamp: number;
    files: { [filePath: string]: { filePath: string; definitions: { [name: string]: ProtoDefinitionInfo }; lastModified: number; packageName?: string } };
    definitions: { [name: string]: ProtoDefinitionInfo };
    mappings: { [goName: string]: string };
}

export class ProtoIndexManager {
    private static instance: ProtoIndexManager;
    private protoIndex: Map<string, ProtoFileInfo> = new Map(); // key: proto文件路径
    private definitionIndex: Map<string, ProtoDefinitionInfo> = new Map(); // key: 定义名称
    private goToProtoMapping: Map<string, string> = new Map(); // key: Go结构体名, value: proto定义名
    private fileWatcher: vscode.FileSystemWatcher | undefined;
    private isIndexing = false;

    public static getInstance(): ProtoIndexManager {
        if (!ProtoIndexManager.instance) {
            ProtoIndexManager.instance = new ProtoIndexManager();
        }
        return ProtoIndexManager.instance;
    }

    /**
     * 初始化索引管理器
     */
    public async initialize(context: vscode.ExtensionContext): Promise<void> {
        console.log('Initializing Proto Index Manager...');

        // 尝试加载缓存
        await this.loadCache(context);

        // 启动时构建索引
        await this.buildIndex();

        // 设置文件监听
        this.setupFileWatcher();

        console.log('Proto Index Manager initialized');
    }

    /**
     * 根据Go结构体名查找proto定义
     */
    public async findProtoDefinition(structName: string): Promise<ProtoDefinitionInfo | undefined> {
        // 1. 先查索引
        const definitionName = this.goToProtoMapping.get(structName) || structName;
        let definitionInfo = this.definitionIndex.get(definitionName);

        if (definitionInfo && await this.isIndexValid(definitionInfo.filePath)) {
            return definitionInfo;
        }

        // 2. 索引失效或不存在，返回undefined让调用方处理
        return undefined;
    }

    /**
     * 查找枚举值的精确位置
     */
    public async findEnumValueDefinition(enumTypeName: string, enumValueName: string): Promise<ProtoDefinitionInfo | undefined> {
        // 1. 先找到枚举类型定义
        const enumDefinition = await this.findProtoDefinition(enumTypeName);
        if (!enumDefinition || enumDefinition.type !== 'enum') {
            return undefined;
        }

        // 2. 在枚举定义范围内查找具体的枚举值
        try {
            const content = await fs.promises.readFile(enumDefinition.filePath, 'utf8');
            const enumValueInfo = this.findEnumValueInContent(content, enumDefinition, enumValueName);
            return enumValueInfo;
        } catch (error) {
            console.error('查找枚举值时出错:', error);
            return enumDefinition; // 降级返回枚举类型定义
        }
    }

    /**
     * 在proto文件内容中查找枚举值
     */
    private findEnumValueInContent(content: string, enumDefinition: ProtoDefinitionInfo, enumValueName: string): ProtoDefinitionInfo | undefined {
        const lines = content.split('\n');
        const enumStartLine = enumDefinition.line - 1; // 转换为0基索引

        // 找到枚举定义的结束位置
        let braceLevel = 0;
        let enumEndLine = lines.length - 1;
        let searchStartLine = enumStartLine;

        // 检查枚举定义行是否包含开始大括号
        const enumDefLine = lines[enumStartLine];
        if (enumDefLine.includes('{')) {
            // 如果枚举定义行包含开始大括号，从下一行开始搜索
            searchStartLine = enumStartLine + 1;
            braceLevel = 1; // 已经有一个开始大括号
        } else {
            // 如果枚举定义行不包含大括号，需要找到开始大括号
            for (let i = enumStartLine + 1; i < lines.length; i++) {
                if (lines[i].includes('{')) {
                    searchStartLine = i + 1;
                    braceLevel = 1;
                    break;
                }
            }
        }

        // 找到枚举定义的结束位置
        for (let i = searchStartLine; i < lines.length; i++) {
            const line = lines[i];
            const openBraces = (line.match(/{/g) || []).length;
            const closeBraces = (line.match(/}/g) || []).length;

            braceLevel += openBraces - closeBraces;

            if (braceLevel === 0) {
                enumEndLine = i;
                break;
            }
        }

        // 在枚举范围内查找枚举值
        for (let i = searchStartLine; i < enumEndLine; i++) {
            const line = lines[i].trim();

            // 跳过注释和空行
            if (line.startsWith('//') || line.startsWith('/*') || line === '') {
                continue;
            }

            // 尝试多种枚举值命名模式
            const patterns = this.generateEnumValuePatterns(enumValueName);

            for (const pattern of patterns) {
                const regex = new RegExp(`^${pattern}\\s*=\\s*\\d+`, 'i');
                if (regex.test(line)) {
                    // 找到枚举值在行中的位置
                    const originalLine = lines[i]; // 获取原始行（包含缩进）
                    const enumValueIndex = originalLine.indexOf(pattern);
                    const column = enumValueIndex >= 0 ? enumValueIndex : 0;

                    return {
                        name: enumValueName,
                        type: 'enum' as const,
                        filePath: enumDefinition.filePath,
                        line: i + 1, // 转换为1基索引
                        column: column,
                        packageName: enumDefinition.packageName
                    };
                }
            }
        }

        // 如果没找到具体的枚举值，返回枚举类型定义
        return enumDefinition;
    }

    /**
     * 生成枚举值的可能命名模式
     */
    private generateEnumValuePatterns(enumValueName: string): string[] {
        const patterns: string[] = [];

        // 1. 原样匹配
        patterns.push(enumValueName);

        // 2. 驼峰转下划线大写 (ActvStateStart -> ACTV_STATE_START)
        const upperSnakeCase = enumValueName
            .replace(/([A-Z])/g, '_$1')
            .toUpperCase()
            .replace(/^_/, '');
        patterns.push(upperSnakeCase);

        // 3. 全大写
        patterns.push(enumValueName.toUpperCase());

        // 4. 全小写
        patterns.push(enumValueName.toLowerCase());

        // 5. 下划线分隔的小写
        const lowerSnakeCase = enumValueName
            .replace(/([A-Z])/g, '_$1')
            .toLowerCase()
            .replace(/^_/, '');
        patterns.push(lowerSnakeCase);

        return [...new Set(patterns)]; // 去重
    }



    /**
     * 构建完整索引
     */
    public async buildIndex(): Promise<void> {
        if (this.isIndexing) {
            console.log('Index building already in progress');
            return;
        }

        this.isIndexing = true;
        try {
            console.log('Building proto index...');

            const config = vscode.workspace.getConfiguration('goProtoJump');
            const protoDirs = config.get<string[]>('protoDirs', ['proto', 'api', 'pb']);

            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                console.log('No workspace folders found');
                return;
            }

            let totalFiles = 0;
            for (const folder of workspaceFolders) {
                for (const protoDir of protoDirs) {
                    const searchPath = path.join(folder.uri.fsPath, protoDir);
                    const files = await this.findProtoFiles(searchPath);

                    for (const file of files) {
                        await this.updateProtoFileIndex(file);
                        totalFiles++;
                    }
                }
            }

            console.log(`Proto index built: ${totalFiles} files, ${this.definitionIndex.size} definitions`);
        } finally {
            this.isIndexing = false;
        }
    }

    /**
     * 查找proto文件
     */
    private async findProtoFiles(searchPath: string): Promise<string[]> {
        const files: string[] = [];

        try {
            const pattern = new vscode.RelativePattern(searchPath, '**/*.proto');
            const uris = await vscode.workspace.findFiles(pattern);

            for (const uri of uris) {
                files.push(uri.fsPath);
            }
        } catch (error) {
            // 目录不存在时忽略错误
        }

        return files;
    }

    /**
     * 更新指定proto文件的索引
     */
    public async updateProtoFileIndex(protoFilePath: string): Promise<void> {
        try {
            if (!await this.fileExists(protoFilePath)) {
                return;
            }

            const stat = await fs.promises.stat(protoFilePath);
            const lastModified = stat.mtime.getTime();

            // 检查是否需要更新
            const existingInfo = this.protoIndex.get(protoFilePath);
            if (existingInfo && existingInfo.lastModified >= lastModified) {
                return; // 文件未修改，无需更新
            }

            const content = await fs.promises.readFile(protoFilePath, 'utf8');
            const definitions = this.parseDefinitionsFromProtoContent(content, protoFilePath);
            const packageName = this.parsePackageFromProtoContent(content);

            const fileInfo: ProtoFileInfo = {
                filePath: protoFilePath,
                definitions,
                lastModified,
                packageName
            };

            // 更新文件索引
            this.protoIndex.set(protoFilePath, fileInfo);

            // 更新定义索引
            for (const [definitionName, definitionInfo] of definitions) {
                this.definitionIndex.set(definitionName, definitionInfo);
                // 建立Go结构体名到proto定义的映射
                this.goToProtoMapping.set(definitionName, definitionName);
            }

            console.log(`Updated proto index for ${protoFilePath}, found ${definitions.size} definitions`);
        } catch (error) {
            console.error(`Failed to update proto file index for ${protoFilePath}:`, error);
        }
    }



    /**
     * 解析proto文件内容，提取message和enum定义
     */
    private parseDefinitionsFromProtoContent(content: string, filePath: string): Map<string, ProtoDefinitionInfo> {
        const definitions = new Map<string, ProtoDefinitionInfo>();
        const lines = content.split('\n');
        let inComment = false;
        let braceLevel = 0;

        for (let i = 0; i < lines.length; i++) {
            const originalLine = lines[i];
            let line = originalLine.trim();

            // 处理多行注释
            if (line.includes('/*')) {
                inComment = true;
            }
            if (inComment) {
                if (line.includes('*/')) {
                    inComment = false;
                    // 移除注释部分，继续处理剩余内容
                    const commentEndIndex = line.indexOf('*/');
                    line = line.substring(commentEndIndex + 2).trim();
                } else {
                    continue;
                }
            }

            // 跳过单行注释和空行
            if (line.startsWith('//') || line === '') {
                continue;
            }

            // 跟踪大括号层级，只解析顶层定义
            const openBraces = (line.match(/{/g) || []).length;
            const closeBraces = (line.match(/}/g) || []).length;

            // 只在顶层（braceLevel = 0）解析定义
            if (braceLevel === 0) {
                // 解析message定义
                const messageMatch = /^message\s+(\w+)\s*{/.exec(line);
                if (messageMatch) {
                    const messageName = messageMatch[1];
                    definitions.set(messageName, {
                        name: messageName,
                        type: 'message',
                        filePath,
                        line: i + 1, // 转换为1基索引
                        column: originalLine.indexOf('message')
                    });
                }

                // 解析enum定义
                const enumMatch = /^enum\s+(\w+)\s*{/.exec(line);
                if (enumMatch) {
                    const enumName = enumMatch[1];
                    definitions.set(enumName, {
                        name: enumName,
                        type: 'enum',
                        filePath,
                        line: i + 1, // 转换为1基索引
                        column: originalLine.indexOf('enum')
                    });
                }
            }

            // 更新大括号层级
            braceLevel += openBraces - closeBraces;
            // 确保层级不会变成负数
            braceLevel = Math.max(0, braceLevel);
        }

        return definitions;
    }

    /**
     * 解析proto文件的package名
     */
    private parsePackageFromProtoContent(content: string): string | undefined {
        const packageMatch = /^package\s+([^;]+);/m.exec(content);
        return packageMatch ? packageMatch[1].trim() : undefined;
    }



    /**
     * 设置文件监听器
     */
    private setupFileWatcher(): void {
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
        }

        // 监听proto文件变化
        this.fileWatcher = vscode.workspace.createFileSystemWatcher('**/*.proto');

        this.fileWatcher.onDidCreate(async (uri) => {
            console.log(`Proto file created: ${uri.fsPath}`);
            await this.updateProtoFileIndex(uri.fsPath);
        });

        this.fileWatcher.onDidChange(async (uri) => {
            console.log(`Proto file changed: ${uri.fsPath}`);
            await this.updateProtoFileIndex(uri.fsPath);
        });

        this.fileWatcher.onDidDelete((uri) => {
            console.log(`Proto file deleted: ${uri.fsPath}`);
            this.removeFileFromIndex(uri.fsPath);
        });
    }

    /**
     * 从索引中移除文件
     */
    private removeFileFromIndex(filePath: string): void {
        const fileInfo = this.protoIndex.get(filePath);
        if (fileInfo) {
            // 移除该文件的所有定义
            for (const [name] of fileInfo.definitions) {
                this.definitionIndex.delete(name);
                this.goToProtoMapping.delete(name);
            }
            this.protoIndex.delete(filePath);
            console.log(`Removed ${filePath} from index`);
        }
    }

    /**
     * 加载缓存
     */
    private async loadCache(context: vscode.ExtensionContext): Promise<void> {
        const config = vscode.workspace.getConfiguration('goProtoJump');
        const enableCache = config.get<boolean>('enableCache', true);

        if (!enableCache) {
            return;
        }

        try {
            const cacheFile = path.join(context.globalStorageUri.fsPath, 'proto-index-cache.json');
            if (await this.fileExists(cacheFile)) {
                const cacheContent = await fs.promises.readFile(cacheFile, 'utf8');
                const cacheData: CacheData = JSON.parse(cacheContent);

                // 验证缓存版本
                const currentVersion = config.get<string>('cacheVersion', '1.0');
                if (cacheData.version !== currentVersion) {
                    console.log('Cache version mismatch, rebuilding index');
                    return;
                }

                // 恢复索引
                this.protoIndex.clear();
                this.definitionIndex.clear();
                this.goToProtoMapping.clear();

                for (const [filePath, fileInfo] of Object.entries(cacheData.files)) {
                    const definitions = new Map<string, ProtoDefinitionInfo>();
                    for (const [name, def] of Object.entries(fileInfo.definitions)) {
                        definitions.set(name, def);
                    }
                    this.protoIndex.set(filePath, { ...fileInfo, definitions });
                }

                for (const [name, def] of Object.entries(cacheData.definitions)) {
                    this.definitionIndex.set(name, def);
                }

                for (const [goName, protoName] of Object.entries(cacheData.mappings)) {
                    this.goToProtoMapping.set(goName, protoName);
                }

                console.log(`Loaded cache: ${this.definitionIndex.size} definitions`);
            }
        } catch (error) {
            console.error('Failed to load cache:', error);
        }
    }

    /**
     * 保存缓存
     */
    public async saveCache(context: vscode.ExtensionContext): Promise<void> {
        const config = vscode.workspace.getConfiguration('goProtoJump');
        const enableCache = config.get<boolean>('enableCache', true);

        if (!enableCache) {
            return;
        }

        try {
            const cacheData: CacheData = {
                version: config.get<string>('cacheVersion', '1.0'),
                timestamp: Date.now(),
                files: {},
                definitions: {},
                mappings: {}
            };

            // 序列化索引数据
            for (const [filePath, fileInfo] of this.protoIndex) {
                const definitions: { [name: string]: ProtoDefinitionInfo } = {};
                for (const [name, def] of fileInfo.definitions) {
                    definitions[name] = def;
                }
                cacheData.files[filePath] = { ...fileInfo, definitions };
            }

            for (const [name, def] of this.definitionIndex) {
                cacheData.definitions[name] = def;
            }

            for (const [goName, protoName] of this.goToProtoMapping) {
                cacheData.mappings[goName] = protoName;
            }

            // 确保目录存在
            await fs.promises.mkdir(context.globalStorageUri.fsPath, { recursive: true });

            const cacheFile = path.join(context.globalStorageUri.fsPath, 'proto-index-cache.json');
            await fs.promises.writeFile(cacheFile, JSON.stringify(cacheData, null, 2));

            console.log(`Saved cache: ${this.definitionIndex.size} definitions`);
        } catch (error) {
            console.error('Failed to save cache:', error);
        }
    }

    /**
     * 检查索引是否有效
     */
    private async isIndexValid(protoFilePath: string): Promise<boolean> {
        try {
            const stat = await fs.promises.stat(protoFilePath);
            const fileInfo = this.protoIndex.get(protoFilePath);

            return fileInfo ? fileInfo.lastModified >= stat.mtime.getTime() : false;
        } catch {
            return false;
        }
    }

    /**
     * 检查文件是否存在
     */
    private async fileExists(filePath: string): Promise<boolean> {
        try {
            await fs.promises.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * 清理索引
     */
    public clearIndex(): void {
        this.protoIndex.clear();
        this.definitionIndex.clear();
        this.goToProtoMapping.clear();
        console.log('Index cleared');
    }

    /**
     * 获取索引统计信息
     */
    public getIndexStats(): { protoFiles: number, definitions: number, mappings: number } {
        return {
            protoFiles: this.protoIndex.size,
            definitions: this.definitionIndex.size,
            mappings: this.goToProtoMapping.size
        };
    }

    /**
     * 销毁资源
     */
    public dispose(): void {
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
        }
    }
} 