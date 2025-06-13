/**
 * Cross-platform file service implementation
 * 
 * Provides file system operations with proper error handling and logging
 * Abstracts file operations to support testing and different environments
 */

import { App, FileSystemAdapter } from 'obsidian';
import { IFileService, FileStats, FileSystemError } from './interfaces';
import { 
	loggerDebug, 
	loggerInfo, 
	loggerWarn, 
	loggerError,
	registerLoggerClass 
} from '../utils/obsidian-logger';

// Use require for Node.js modules in Obsidian
const fs = require('fs/promises');
const path = require('path');

export class DefaultFileService implements IFileService {
	private app: App;
	private vaultPath: string | null = null;

	constructor(app: App) {
		this.app = app;
		registerLoggerClass(this, 'FileService');
		loggerDebug(this, 'FileService initialized');
		
		// Initialize vault path
		this.initializeVaultPath();
	}

	private initializeVaultPath(): void {
		try {
			const adapter = this.app.vault.adapter;
			if (adapter instanceof FileSystemAdapter) {
				this.vaultPath = adapter.getBasePath();
				loggerDebug(this, `Vault path initialized: ${this.vaultPath}`);
			} else {
				loggerWarn(this, 'FileSystemAdapter not available, using relative paths');
			}
		} catch (error) {
			loggerError(this, 'Failed to initialize vault path', { error });
		}
	}
	async exists(path: string): Promise<boolean> {
		try {
			await fs.access(path);
			loggerDebug(this, `File exists: ${path}`);
			return true;
		} catch (error) {
			loggerDebug(this, `File does not exist: ${path}`);
			return false;
		}
	}

	async getStats(path: string): Promise<FileStats> {
		try {
			const stats = await fs.stat(path);
			const result: FileStats = {
				isFile: stats.isFile(),
				isDirectory: stats.isDirectory(),
				size: stats.size,
				lastModified: stats.mtime,
				created: stats.birthtime || stats.ctime
			};
			loggerDebug(this, `Got stats for: ${path}`, { stats: result });
			return result;
		} catch (error) {
			const errorMessage = `Failed to get stats for: ${path}`;
			loggerError(this, errorMessage, { error });
			throw new FileSystemError(errorMessage, error as Error);
		}
	}

	async readDirectory(path: string): Promise<string[]> {
		try {
			const files = await fs.readdir(path);
			loggerDebug(this, `Read directory: ${path}`, { fileCount: files.length });
			return files;
		} catch (error) {
			const errorMessage = `Failed to read directory: ${path}`;
			loggerError(this, errorMessage, { error });
			throw new FileSystemError(errorMessage, error as Error);
		}
	}

	async readFile(filePath: string): Promise<string> {
		try {
			const content = await fs.readFile(filePath, 'utf-8');
			loggerDebug(this, `Read file: ${filePath}`, { size: content.length });
			return content;
		} catch (error) {
			const errorMessage = `Failed to read file: ${filePath}`;
			loggerError(this, errorMessage, { error });
			throw new FileSystemError(errorMessage, error as Error);
		}
	}

	async getParentDirectory(filePath: string): Promise<string> {
		const parent = path.dirname(filePath);
		loggerDebug(this, `Parent directory of ${filePath}: ${parent}`);
		return parent;
	}

	async getFileName(filePath: string): Promise<string> {
		const fileName = path.basename(filePath);
		loggerDebug(this, `File name of ${filePath}: ${fileName}`);
		return fileName;
	}

	async getRelativePath(basePath: string, targetPath: string): Promise<string> {
		// Normalize paths to use forward slashes for consistency
		const normalizedBase = basePath.replace(/\\/g, '/');
		const normalizedTarget = targetPath.replace(/\\/g, '/');
		
		if (!normalizedTarget.startsWith(normalizedBase)) {
			throw new FileSystemError(`Target path ${targetPath} is not under base path ${basePath}`);
		}
		
		const relativePath = normalizedTarget.substring(normalizedBase.length + 1);
		loggerDebug(this, `Relative path from ${basePath} to ${targetPath}: ${relativePath}`);
		return relativePath;
	}

	async normalizePath(path: string): Promise<string> {
		// Convert to forward slashes for cross-platform consistency
		const normalized = path.replace(/\\/g, '/');
		loggerDebug(this, `Normalized path: ${path} -> ${normalized}`);
		return normalized;
	}
	async joinPaths(...paths: string[]): Promise<string> {
		const joined = path.join(...paths);
		const normalized = await this.normalizePath(joined);
		loggerDebug(this, `Joined paths: [${paths.join(', ')}] -> ${normalized}`);
		return normalized;
	}

	// ============================================================================
	// Legacy methods from original IFileService interface
	// ============================================================================
	getAbsolutePath(relativePath: string): string {
		if (!this.vaultPath) {
			loggerWarn(this, 'Vault path not available, returning relative path');
			return relativePath;
		}
		
		// If path is already absolute, return it
		if (path.isAbsolute(relativePath)) {
			loggerDebug(this, `Path is already absolute: ${relativePath}`);
			return relativePath;
		}
		
		// Convert vault-relative path to absolute path
		const absolutePath = path.join(this.vaultPath, relativePath);
		loggerDebug(this, `Converted to absolute path: ${relativePath} -> ${absolutePath}`);
		return absolutePath;
	}
	
	async getBackupLocation(file: any, useAdjacentStorage: boolean = false): Promise<string> {
		if (!this.vaultPath) {
			throw new FileSystemError('Vault path not available for backup location');
		}
		
		const fileName = file.name || file.basename || 'unknown';
		
		if (useAdjacentStorage) {
			// Use the parent directory as the backup repository
			// This way the original file stays in place and only rdiff-backup-data is added
			const filePath = file.path || fileName;
			const fileAbsolutePath = this.getAbsolutePath(filePath);
			const parentDir = path.dirname(fileAbsolutePath);
			
			loggerDebug(this, `Generated adjacent backup location: ${filePath} -> ${parentDir} (parent directory as repository)`);			return parentDir;
		} else {
			// Original behavior: Create backup directory structure in plugin folder
			const pluginDir = path.join(this.vaultPath, '.obsidian', 'plugins', 'asset-increment');
			const backupDir = path.join(pluginDir, 'backups');
			const backupPath = path.join(backupDir, fileName);
			
			loggerDebug(this, `Generated centralized backup location: ${file.path || fileName} -> ${backupPath}`);
			return backupPath;
		}
	}

	async getFileSize(filePath: string): Promise<number> {
		try {
			const stats = await this.getStats(filePath);
			return stats.size;
		} catch (error) {
			const errorMessage = `Failed to get file size for: ${filePath}`;
			loggerError(this, errorMessage, { error });
			throw new FileSystemError(errorMessage, error as Error);
		}
	}

	formatFileSize(bytes: number): string {
		if (bytes === 0) return '0 B';
		
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		
		const formatted = `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
		loggerDebug(this, `Formatted file size: ${bytes} bytes -> ${formatted}`);
		return formatted;
	}

	shouldUseCompression(fileSize: number): boolean {
		// Use compression for files larger than 1MB
		const threshold = 1024 * 1024;
		const shouldCompress = fileSize > threshold;
		loggerDebug(this, `Should use compression for ${fileSize} bytes: ${shouldCompress}`);
		return shouldCompress;
	}

	async ensureDirectoryExists(dirPath: string): Promise<void> {
		try {
			const exists = await this.exists(dirPath);
			if (!exists) {
				// This would need to be implemented with fs.mkdir
				// For now, just log that we would create it
				loggerInfo(this, `Would create directory: ${dirPath}`);
				// throw new FileSystemError(`Directory creation not implemented: ${dirPath}`);
			} else {
				loggerDebug(this, `Directory exists: ${dirPath}`);
			}
		} catch (error) {
			const errorMessage = `Failed to ensure directory exists: ${dirPath}`;
			loggerError(this, errorMessage, { error });
			throw new FileSystemError(errorMessage, error as Error);
		}
	}
}
