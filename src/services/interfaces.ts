/**
 * Service interfaces for the Asset Increment Plugin
 * 
 * This file defines the contracts for all services in the plugin,
 * promoting loose coupling and testability.
 */

import { TFile } from 'obsidian';
import { 
	BackupOptions, 
	RestoreOptions, 
	BackupResult, 
	BackupStatistics,
	AssetIncrementSettings 
} from '../types';

// ============================================================================
// File System Types
// ============================================================================

export interface FileStats {
	isFile: boolean;
	isDirectory: boolean;
	size: number;
	lastModified: Date;
	created: Date;
}

export class FileSystemError extends Error {
	constructor(message: string, public readonly cause?: Error) {
		super(message);
		this.name = 'FileSystemError';
		if (cause) {
			this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
		}
	}
}

// ============================================================================
// Service Interfaces
// ============================================================================

/**
 * Service for managing backup operations
 */
export interface IBackupService {
	/**
	 * Initialize the backup service
	 */
	initialize(): Promise<void>;

	/**
	 * Check if the backup system is available and configured
	 */
	isAvailable(): Promise<boolean>;

	/**
	 * Backup a file to the configured backup location
	 */
	backupFile(sourcePath: string, destinationPath: string, options?: BackupOptions): Promise<BackupResult>;

	/**
	 * Restore a file from backup
	 */
	restoreFile(backupPath: string, restorePath: string, options?: RestoreOptions): Promise<BackupResult>;

	/**
	 * Get backup statistics for a given backup location
	 */
	getBackupStatistics(backupPath: string): Promise<BackupStatistics | undefined>;

	/**
	 * List available backup increments
	 */
	listBackupIncrements(backupPath: string): Promise<string[]>;
}

/**
 * Service for managing file operations and paths
 */
export interface IFileService {
	/**
	 * Check if a file or directory exists
	 */
	exists(path: string): Promise<boolean>;
	
	/**
	 * Get file/directory statistics
	 */
	getStats(path: string): Promise<FileStats>;
	
	/**
	 * Read directory contents
	 */
	readDirectory(path: string): Promise<string[]>;
	
	/**
	 * Read file contents as string
	 */
	readFile(path: string): Promise<string>;
	
	/**
	 * Get parent directory of a path
	 */
	getParentDirectory(path: string): Promise<string>;
	
	/**
	 * Get file name from a path
	 */
	getFileName(path: string): Promise<string>;
	
	/**
	 * Get relative path from base to target
	 */
	getRelativePath(basePath: string, targetPath: string): Promise<string>;
	
	/**
	 * Normalize path for cross-platform consistency
	 */
	normalizePath(path: string): Promise<string>;
	
	/**
	 * Join path segments
	 */
	joinPaths(...paths: string[]): Promise<string>;
	
	/**
	 * Get the absolute path for a file
	 */
	getAbsolutePath(relativePath: string): string;

	/**
	 * Get the backup location for a file
	 */
	getBackupLocation(file: TFile): Promise<string>;

	/**
	 * Get the size of a file in bytes
	 */
	getFileSize(filePath: string): Promise<number>;

	/**
	 * Format file size for display
	 */
	formatFileSize(bytes: number): string;

	/**
	 * Check if a file should use compression based on size
	 */
	shouldUseCompression(fileSize: number): boolean;

	/**
	 * Ensure a directory exists
	 */
	ensureDirectoryExists(dirPath: string): Promise<void>;
}

/**
 * Service for platform-specific command execution
 */
export interface ICommandService {
	/**
	 * Execute a command with arguments
	 */
	execute(command: string, args: string[], options?: CommandOptions): Promise<CommandResult>;

	/**
	 * Check if an executable exists and is working
	 */
	testExecutable(executablePath: string, testArgs?: string[]): Promise<boolean>;
}

export interface CommandOptions {
	workingDirectory?: string;
	timeout?: number;
}

export interface CommandResult {
	success: boolean;
	stdout: string;
	stderr: string;
	exitCode: number;
	error?: string;
}

/**
 * Service for managing plugin settings
 */
export interface ISettingsService {
	/**
	 * Load settings from storage
	 */
	loadSettings(): Promise<AssetIncrementSettings>;

	/**
	 * Save settings to storage
	 */
	saveSettings(settings: AssetIncrementSettings): Promise<void>;

	/**
	 * Get current settings
	 */
	getSettings(): AssetIncrementSettings;

	/**
	 * Update specific setting values
	 */
	updateSettings(updates: Partial<AssetIncrementSettings>): Promise<void>;

	/**
	 * Update a specific setting value with type safety
	 */
	updateSetting<K extends keyof AssetIncrementSettings>(
		key: K, 
		value: AssetIncrementSettings[K]
	): Promise<void>;

	/**
	 * Reset settings to defaults
	 */
	resetToDefaults(): Promise<void>;

	/**
	 * Get a specific setting value with type safety
	 */
	getSetting<K extends keyof AssetIncrementSettings>(key: K): AssetIncrementSettings[K];
}

/**
 * Service for coordinating asset management operations
 */
export interface IAssetService {
	/**
	 * Initialize the asset service
	 */
	initialize(): Promise<void>;

	/**
	 * Backup an asset file
	 */
	backupAsset(file: TFile, options?: BackupOptions): Promise<BackupResult>;

	/**
	 * Restore an asset file
	 */
	restoreAsset(file: TFile, increment?: string): Promise<BackupResult>;

	/**
	 * Get backup information for an asset
	 */
	getAssetBackupInfo(file: TFile): Promise<{
		hasBackup: boolean;
		backupPath?: string;
		statistics?: BackupStatistics;
		increments?: string[];
	}>;

	/**
	 * Test if the backup system is ready
	 */
	testBackupSystem(): Promise<boolean>;
}
