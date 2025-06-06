import * as vscode from 'vscode';
import { ProtoIndexManager, ProtoDefinitionInfo } from './protoIndexManager';

export class EnhancedProtoDefinitionProvider implements vscode.DefinitionProvider {
    private indexManager: ProtoIndexManager;

    constructor() {
        this.indexManager = ProtoIndexManager.getInstance();
    }

    async provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.Definition | undefined> {

        // 1. 只处理Go文件
        if (document.languageId !== 'go') {
            return undefined;
        }

        // 2. 获取光标位置的标识符和类型信息
        const typeInfo = await this.getTypeInfoAtPosition(document, position);
        if (!typeInfo) {
            return undefined;
        }

        // 3. 使用TypeDefinitionProvider找到Go定义文件
        const typeDefinitions = await this.getGoTypeDefinitions(document, position);
        if (!typeDefinitions || typeDefinitions.length === 0) {
            return undefined;
        }

        // 4. 检查是否有proto生成的文件
        const hasProtoFiles = typeDefinitions.some(typeDef =>
            this.isProtoGeneratedFile(typeDef.uri.fsPath)
        );

        if (!hasProtoFiles) {
            return undefined;
        }

        // 5. 检测到proto文件，我们来处理
        return await this.handleProtoDefinition(typeDefinitions, typeInfo);
    }

    /**
     * 处理proto定义查找
     */
    private async handleProtoDefinition(typeDefinitions: vscode.Location[], typeInfo: TypeInfo): Promise<vscode.Location[]> {
        // 根据类型信息查找对应的proto定义
        const protoInfo = await this.findProtoDefinition(typeInfo);

        if (protoInfo) {
            return [this.createLocationFromProtoInfo(protoInfo)];
        }

        // 如果没找到proto定义，但检测到proto生成文件，返回proto生成的Go文件
        const protoGeneratedFiles = typeDefinitions.filter(typeDef =>
            this.isProtoGeneratedFile(typeDef.uri.fsPath)
        );

        if (protoGeneratedFiles.length > 0) {
            return protoGeneratedFiles;
        }

        return typeDefinitions;
    }

    /**
     * 查找proto定义
     */
    private async findProtoDefinition(typeInfo: TypeInfo): Promise<ProtoDefinitionInfo | undefined> {
        let searchName = typeInfo.identifier;

        // 根据类型调整搜索策略
        if (typeInfo.type === 'enum_value') {
            // 对于枚举值，提取枚举类型名并精确查找枚举值位置
            const enumInfo = this.parseEnumIdentifier(typeInfo.identifier);
            if (enumInfo) {
                // 使用新的精确查找方法
                return await this.indexManager.findEnumValueDefinition(enumInfo.enumName, enumInfo.valueName);
            }
        }

        // 从索引中查找（结构体或枚举类型）
        const protoInfo = await this.indexManager.findProtoDefinition(searchName);
        if (protoInfo) {
            return protoInfo;
        }

        return undefined;
    }

    /**
     * 获取光标位置的类型信息
     */
    private async getTypeInfoAtPosition(document: vscode.TextDocument, position: vscode.Position): Promise<TypeInfo | undefined> {
        // 1. 获取基本的标识符
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return undefined;
        }

        const identifier = document.getText(wordRange);

        // 检查是否是有效的Go标识符（大写字母开头）
        if (!/^[A-Z][a-zA-Z0-9_]*$/.test(identifier)) {
            return undefined;
        }

        // 2. 获取Hover信息来判断类型
        try {
            const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
                'vscode.executeHoverProvider',
                document.uri,
                position
            );

            if (!hovers || hovers.length === 0) {
                return { identifier, type: 'unknown' };
            }

            // 3. 分析hover内容判断类型
            const typeCategory = this.analyzeHoverContent(hovers, identifier);
            return { identifier, type: typeCategory };

        } catch (error) {
            return { identifier, type: 'unknown' };
        }
    }

    /**
     * 分析hover内容判断类型
     */
    private analyzeHoverContent(hovers: vscode.Hover[], identifier: string): TypeCategory {
        for (const hover of hovers) {
            for (const content of hover.contents) {
                let text = '';
                if (typeof content === 'string') {
                    text = content;
                } else if (content instanceof vscode.MarkdownString) {
                    text = content.value;
                }

                // 统一清理代码块标记
                const cleanText = text.replace(/```\w*\n?/g, '').trim();

                // 分析类型信息
                if (this.isStructType(cleanText)) {
                    return 'struct';
                } else if (this.isEnumType(cleanText, identifier)) {
                    return 'enum';
                } else if (this.isEnumValue(cleanText, identifier)) {
                    return 'enum_value';
                }
            }
        }

        return 'unknown';
    }

    /**
     * 判断是否为结构体类型
     */
    private isStructType(hoverText: string): boolean {
        // 匹配结构体定义模式
        return /type\s+\w+\s+struct/.test(hoverText) ||
            /struct\s*{/.test(hoverText);
    }

    /**
     * 判断是否为枚举类型
     */
    private isEnumType(hoverText: string, identifier: string): boolean {
        // Go中枚举通常定义为 type EnumName int
        return new RegExp(`type\\s+${identifier}\\s+int`).test(hoverText) ||
            new RegExp(`type\\s+${identifier}\\s+\\w*int\\d*`).test(hoverText);
    }

    /**
     * 判断是否为枚举值
     */
    private isEnumValue(hoverText: string, identifier: string): boolean {
        // 枚举值显示为 const EnumValue EnumType = value
        return hoverText.startsWith('const');
    }

    /**
     * 解析枚举标识符
     * 识别模式：EnumName_EnumValueName
     */
    private parseEnumIdentifier(identifier: string): { enumName: string, valueName: string } | undefined {
        // 检查是否包含下划线
        const underscoreIndex = identifier.indexOf('_');
        if (underscoreIndex === -1) {
            return undefined;
        }

        // 提取枚举名和值名
        const enumName = identifier.substring(0, underscoreIndex);
        const valueName = identifier.substring(underscoreIndex + 1);

        // 验证枚举名格式（大写字母开头）
        if (!/^[A-Z][a-zA-Z0-9]*$/.test(enumName)) {
            return undefined;
        }

        // 验证值名格式（大写字母开头）
        if (!/^[A-Z][a-zA-Z0-9]*$/.test(valueName)) {
            return undefined;
        }

        return { enumName, valueName };
    }

    /**
     * 使用TypeDefinitionProvider获取Go类型定义
     */
    private async getGoTypeDefinitions(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<vscode.Location[] | undefined> {
        try {
            return await vscode.commands.executeCommand<vscode.Location[]>(
                'vscode.executeTypeDefinitionProvider',
                document.uri,
                position
            );
        } catch (error) {
            return undefined;
        }
    }

    /**
     * 检查文件是否是proto生成的Go文件
     */
    private isProtoGeneratedFile(filePath: string): boolean {
        const fileName = filePath.toLowerCase();

        // 从配置中获取文件后缀
        const config = vscode.workspace.getConfiguration('goProtoJump');
        const suffixes = config.get<string[]>('protoFileSuffixes', [
            '.pb.go',           // user.pb.go
            '_grpc.pb.go',      // user_grpc.pb.go
            '.proto.go',        // user.proto.go
            '.pb.gw.go',        // gateway生成的文件
        ]);

        // 检查文件名是否以任何一个后缀结尾
        for (const suffix of suffixes) {
            if (fileName.endsWith(suffix.toLowerCase())) {
                return true;
            }
        }
        return false;
    }

    /**
     * 从proto信息创建VSCode位置对象
     */
    private createLocationFromProtoInfo(protoInfo: ProtoDefinitionInfo): vscode.Location {
        const uri = vscode.Uri.file(protoInfo.filePath);
        // VSCode的Position构造函数期望0基索引，而我们的protoInfo.line是1基索引
        const position = new vscode.Position(protoInfo.line - 1, protoInfo.column);
        return new vscode.Location(uri, position);
    }

    /**
     * 获取索引统计信息（用于调试）
     */
    public getIndexStats(): { protoFiles: number, definitions: number, mappings: number } {
        return this.indexManager.getIndexStats();
    }

    /**
     * 清理索引（用于测试或重置）
     */
    public clearIndex(): void {
        this.indexManager.clearIndex();
    }
}

// 类型定义
interface TypeInfo {
    identifier: string;
    type: TypeCategory;
}

type TypeCategory = 'struct' | 'enum' | 'enum_value' | 'unknown';