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
        vscode.window.showInformationMessage('正在重建Proto索引...');
        await indexManager.buildIndex();
        const stats = enhancedDefinitionProvider.getIndexStats();
        vscode.window.showInformationMessage(
            `Proto索引重建完成: ${stats.definitions}个定义`
        );
    });

    context.subscriptions.push(definitionProvider, rebuildIndexCommand);
}

export function deactivate() {
    // 保存缓存并清理资源
    const indexManager = ProtoIndexManager.getInstance();
    indexManager.dispose();
} 