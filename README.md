# Asset Increment Plugin

An Obsidian plugin that provides incremental versioning for binary asset files using restic.

## Features

- **Incremental Backups**: Efficient delta compression for asset files
- **Auto-Detection**: Automatically detects restic executable
- **Multiple File Types**: Support for Blender files, 3D models, images, and more
- **Efficiency Tracking**: Shows space savings from incremental backups
- **Flexible Configuration**: Comprehensive settings for backup management

## Installation

### Option 1: Auto-Detection (Recommended)
1. Download restic for your platform
2. Place the executable (`restic.exe` on Windows, `restic` on Unix) in the plugin's directory
3. The plugin will automatically detect and use it

### Option 2: System Installation
1. Install restic system-wide
2. Ensure it's available in your PATH
3. Plugin will detect it automatically

### Option 3: Custom Path
1. Install restic anywhere
2. Set the full path in plugin settings

## Detection Order

The plugin searches for restic in this order:
1. **Plugin directory** (`.obsidian/plugins/obsidian-asset-increment/`)
2. **User-specified path** (from settings)
3. **System PATH**

## Supported File Types

- **Blender**: `.blend`, `.blend1`, `.blend2`
- **3D Models**: `.fbx`, `.obj`, `.dae`, `.gltf`, `.glb`, `.3ds`, `.max`, `.ma`, `.mb`
- **Uncompressed Images**: `.bmp`, `.tiff`, `.tga`, `.exr`, `.hdr`
- **Archives**: `.zip`, `.rar`, `.7z`, `.psd`, `.ai`, `.indd`
- **Custom**: User-configurable extensions

## Commands

- `Backup current asset file` - Create incremental backup
- `Restore asset from backup` - Restore from backup history
- `Show asset backup history` - View all increments
- `Test restic installation` - Verify setup

## Configuration

Access settings via Settings → Community Plugins → Asset Increment

### Key Settings
- **Auto-backup on save**: Automatically backup when files change
- **Efficiency notifications**: Show space savings information
- **Cleanup policies**: Manage old backups automatically
- **File type monitoring**: Configure which extensions to track

## Usage

1. Enable the plugin
2. Configure file types to monitor in settings
3. Use commands to backup/restore assets
4. Enable auto-backup for seamless workflow

## Space Efficiency

This plugin uses restic's binary delta compression, which is highly efficient for:
- Blender files with incremental changes
- Large texture files with minor modifications
- 3D models with topology updates
- Project files with embedded assets

Typical space savings: 70-90% for incremental changes.

## Requirements

- Obsidian v1.0.0+
- restic executable
- Sufficient disk space for backup repository
