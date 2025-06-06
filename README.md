# Go Proto Jump

[中文文档](README_zh.md)

A VSCode extension that enables navigation from Go generated structs to their original Proto definition files.

## Features

- 🚀 **Smart Navigation**: Jump directly from Go structs to Proto definitions
- 🔍 **Enum Support**: Precise location of enum types and enum values
- 📁 **Auto Indexing**: Automatically scan and index Proto files
- ⚡ **High Performance**: Built-in caching mechanism for fast response
- 🛠️ **Configurable**: Support custom Proto file patterns and directories

## Usage

1. In a Go file, place your cursor on a Proto-generated struct or enum
2. Press `F12` or right-click and select "Go to Definition"
3. The extension will automatically jump to the corresponding Proto definition

## Configuration Options

### `goProtoJump.protoDirs`
- **Type**: `string[]`
- **Default**: `["proto", "protos", "api", "pb", "protobuf", "schemas"]`
- **Description**: List of directories to search for Proto files

### `goProtoJump.protoFileSuffixes`
- **Type**: `string[]`
- **Default**: `[".pb.go", "_grpc.pb.go", ".proto.go", ".pb.gw.go"]`
- **Description**: List of suffixes to identify Proto-generated Go files

### `goProtoJump.enableCache`
- **Type**: `boolean`
- **Default**: `true`
- **Description**: Enable disk cache for improved performance

### `goProtoJump.enableDebugLog`
- **Type**: `boolean`
- **Default**: `false`
- **Description**: Enable debug logging

## Configuration Example

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

## Commands

- **Rebuild Proto Index**: `Go Proto Jump: Rebuild Proto Index`
  - Manually rebuild the Proto file index

## Supported File Types

By default, supports the following Proto-generated Go file patterns:
- `*.pb.go` - Standard protobuf generated files
- `*_grpc.pb.go` - gRPC service generated files
- `*.proto.go` - Custom proto generated files
- `*.pb.gw.go` - grpc-gateway generated files

You can configure custom suffixes through `goProtoJump.protoFileSuffixes`.

## License

MIT