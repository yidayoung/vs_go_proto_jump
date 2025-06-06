# Go Proto Jump

一个VSCode插件，支持从Go生成的结构体跳转到原始的Proto定义文件。

## 功能特性

- 🚀 **智能跳转**: 从Go结构体直接跳转到Proto定义
- 🔍 **枚举支持**: 支持枚举类型和枚举值的精确定位
- 📁 **自动索引**: 自动扫描和索引Proto文件
- ⚡ **高性能**: 内置缓存机制，快速响应
- 🛠️ **可配置**: 支持自定义Proto文件模式和目录

## 使用方法

1. 在Go文件中，将光标放在Proto生成的结构体或枚举上
2. 按 `F12` 或右键选择"转到定义"
3. 插件会自动跳转到对应的Proto定义

## 配置选项

### `goProtoJump.protoDirs`
- **类型**: `string[]`
- **默认值**: `["proto", "protos", "api", "pb", "protobuf", "schemas"]`
- **说明**: 搜索Proto文件的目录列表

### `goProtoJump.protoFileSuffixes`
- **类型**: `string[]`
- **默认值**: `[".pb.go", "_grpc.pb.go", ".proto.go", ".pb.gw.go"]`
- **说明**: 识别Proto生成Go文件的后缀列表

### `goProtoJump.enableCache`
- **类型**: `boolean`
- **默认值**: `true`
- **说明**: 启用磁盘缓存以提高性能

### `goProtoJump.enableDebugLog`
- **类型**: `boolean`
- **默认值**: `false`
- **说明**: 启用调试日志

## 配置示例

```json
{
    "goProtoJump.protoDirs": [
        "proto",
        "api/proto",
        "internal/proto"
    ],
    "goProtoJump.protoFileSuffixes": [
        ".pb.go",
        "_grpc.pb.go",
        ".proto.go",
        ".pb.gw.go",
        ".custom.go"
    ],
    "goProtoJump.enableCache": true,
    "goProtoJump.enableDebugLog": false
}
```

## 命令

- **重建Proto索引**: `Go Proto Jump: 重建Proto索引`
  - 手动重建Proto文件索引

## 支持的文件类型

默认支持以下Proto生成的Go文件模式：
- `*.pb.go` - 标准protobuf生成文件
- `*_grpc.pb.go` - gRPC服务生成文件  
- `*.proto.go` - 自定义proto生成文件
- `*.pb.gw.go` - grpc-gateway生成文件

可以通过 `goProtoJump.protoFileSuffixes` 配置自定义后缀。

## 许可证

MIT 