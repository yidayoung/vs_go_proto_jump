import * as vscode from 'vscode';
import { EnhancedProtoDefinitionProvider } from './enhancedDefinitionProvider';
import { ProtoIndexManager } from './protoIndexManager';

export function activate(context: vscode.ExtensionContext) {
    console.log('Go Proto Jump extension is now active!');

    // 初始化索引管理器
    const indexManager = ProtoIndexManager.getInstance();
    indexManager.initialize(context);

    const enhancedDefinitionProvider = new EnhancedProtoDefinitionProvider();
    const definitionProvider = vscode.languages.registerDefinitionProvider(
        { scheme: 'file', language: 'go' },
        enhancedDefinitionProvider
    );

    // 注册重建索引命令
    const rebuildIndexCommand = vscode.commands.registerCommand('go-proto-jump.rebuildIndex', async () => {
        vscode.window.showInformationMessage('Rebuilding proto index...');
        await indexManager.buildIndex();
        const stats = enhancedDefinitionProvider.getIndexStats();
        vscode.window.showInformationMessage(
            `Proto index rebuilt successfully! Found ${stats.definitions} definitions.`
        );
    });

    context.subscriptions.push(definitionProvider, rebuildIndexCommand);
}

export function deactivate() {
    // 保存缓存并清理资源
    const indexManager = ProtoIndexManager.getInstance();
    indexManager.dispose();
} 