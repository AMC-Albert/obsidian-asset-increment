/**
 * Asset management service
 * 
 * High-level service that coordinates backup operations for Obsidian assets.
 * Uses the backup, file, and settings services to provide a complete asset management solution.
 */

import { TFile } from 'obsidian';
import { IAssetService, IBackupService, IFileService, ISettingsService } from './interfaces';
import { BackupVersioningService, BackupVersionInfo } from './BackupVersioningService';
import { 
	BackupOptions, 
	BackupResult, 
	BackupStatistics,
	AssetIncrementSettings 
} from '../types';
import { 
	loggerDebug, 
	loggerInfo, 
	loggerWarn, 
	loggerError,
	registerLoggerClass 
} from '../utils/obsidian-logger';

export class DefaultAssetService implements IAssetService {
	private backupService: IBackupService;
	private fileService: IFileService;
	private settingsService: ISettingsService;
	private versioningService: BackupVersioningService;
	private initialized = false;

	constructor(
		backupService: IBackupService,
		fileService: IFileService,
		settingsService: ISettingsService
	) {
		this.backupService = backupService;
		this.fileService = fileService;
		this.settingsService = settingsService;
				// Initialize versioning service for backup metadata tracking
		this.versioningService = new BackupVersioningService(fileService);
		
		registerLoggerClass(this, 'AssetService');
		loggerDebug(this, 'AssetService initialized with 3-digit versioning');
	}
	async initialize(): Promise<void> {
		try {
			loggerInfo(this, 'Initializing asset service...');
			
			// The backup service should already be initialized by the service registry
			// We don't need to initialize it again here
			loggerDebug(this, 'Asset service dependencies already initialized');
			
			this.initialized = true;
			loggerInfo(this, 'Asset service initialized successfully');
		} catch (error) {
			loggerError(this, 'Failed to initialize asset service', { 
				error: error instanceof Error ? {
					name: error.name,
					message: error.message,
					stack: error.stack
				} : error 
			});
			throw error;
		}
	}
	async backupAsset(file: TFile, options: BackupOptions = {}): Promise<BackupResult> {
		try {
			loggerInfo(this, `Starting asset backup for: ${file.path}`);
			
			if (!this.initialized) {
				await this.initialize();
			}
			// Get settings to determine backup behavior
			const settings = this.settingsService.getSettings();
			
			// Get file information
			const sourcePath = this.fileService.getAbsolutePath(file.path);
			const backupPath = await this.fileService.getBackupLocation(file, settings.storeBackupsAdjacentToFiles);
			const fileSize = await this.fileService.getFileSize(sourcePath);
			
			// Determine backup options based on file size and settings
			const backupOptions: BackupOptions = {
				...options,
				compression: options.compression !== undefined 
					? options.compression 
					: this.fileService.shouldUseCompression(fileSize)
			};

			loggerDebug(this, `Backup configuration`, {
				sourcePath,
				backupPath,
				fileSize: this.fileService.formatFileSize(fileSize),
				compression: backupOptions.compression
			});

			// Ensure backup directory exists
			const backupDir = await this.fileService.getParentDirectory(backupPath);
			await this.fileService.ensureDirectoryExists(backupDir);			// Get next version number for tracking
			const nextVersion = await this.versioningService.getNextVersion(sourcePath, backupPath);
			
			// Perform the backup using the appropriate method
			const result = settings.storeBackupsAdjacentToFiles 
				? await this.backupService.backupFileAdjacent(sourcePath, backupPath, backupOptions)
				: await this.backupService.backupFile(sourcePath, backupPath, backupOptions);
			
			if (result.success) {
				// Create version metadata for this backup
				const versionInfo = await this.versioningService.createVersionInfo(sourcePath, backupPath, nextVersion);
				loggerInfo(this, `Asset backup completed successfully: ${file.path} (${this.versioningService.getVersionDisplayString(nextVersion)})`);
				
				// Store version info in result for reference
				result.versionInfo = versionInfo;
			} else {
				loggerWarn(this, `Asset backup failed: ${file.path}`, { 
					error: result.error,
					stderr: result.stderr 
				});
			}
			
			return result;
		} catch (error) {
			const errorMessage = `Asset backup operation failed: ${error}`;
			loggerError(this, errorMessage, { error, filePath: file.path });
			return {
				success: false,
				stdout: '',
				stderr: errorMessage,
				exitCode: -1,
				error: errorMessage
			};
		}
	}

	async restoreAsset(file: TFile, increment?: string): Promise<BackupResult> {
		try {
			loggerInfo(this, `Starting asset restore for: ${file.path}`, { increment });
			if (!this.initialized) {
				await this.initialize();
			}

			const settings = this.settingsService.getSettings();
			const backupPath = await this.fileService.getBackupLocation(file, settings.storeBackupsAdjacentToFiles);
			const restorePath = this.fileService.getAbsolutePath(file.path);
			
			// Check if backup exists
			const backupExists = await this.fileService.exists(backupPath);
			if (!backupExists) {
				const error = `No backup found for asset: ${file.path}`;
				loggerError(this, error);
				return {
					success: false,
					stdout: '',
					stderr: error,
					exitCode: -1,
					error
				};
			}

			const restoreOptions = increment ? { at: increment } : {};
			
			loggerDebug(this, `Restore configuration`, {
				backupPath,
				restorePath,
				increment
			});

			// Perform the restore
			const result = await this.backupService.restoreFile(backupPath, restorePath, restoreOptions);
			
			if (result.success) {
				loggerInfo(this, `Asset restore completed successfully: ${file.path}`);
			} else {
				loggerWarn(this, `Asset restore failed: ${file.path}`, { 
					error: result.error,
					stderr: result.stderr 
				});
			}
			
			return result;
		} catch (error) {
			const errorMessage = `Asset restore operation failed: ${error}`;
			loggerError(this, errorMessage, { error, filePath: file.path });
			return {
				success: false,
				stdout: '',
				stderr: errorMessage,
				exitCode: -1,
				error: errorMessage
			};
		}
	}
	async getAssetBackupInfo(file: TFile): Promise<{
		hasBackup: boolean;
		backupPath?: string;
		statistics?: BackupStatistics;
		increments?: string[];
		versionHistory?: BackupVersionInfo[];
		currentVersion?: string;
	}> {
		try {
			loggerDebug(this, `Getting backup info for asset: ${file.path}`);
			
			const settings = this.settingsService.getSettings();
			const backupPath = await this.fileService.getBackupLocation(file, settings.storeBackupsAdjacentToFiles);
			const hasBackup = await this.fileService.exists(backupPath);
			
			if (!hasBackup) {
				loggerDebug(this, `No backup found for asset: ${file.path}`);
				return { hasBackup: false };
			}

			// Get backup statistics and increments
			let statistics: BackupStatistics | undefined;
			let increments: string[] = [];
			let versionHistory: BackupVersionInfo[] = [];
			let currentVersion: string | undefined;
			
			try {
				statistics = await this.backupService.getBackupStatistics(backupPath);
				increments = await this.backupService.listBackupIncrements(backupPath);
				
				// Get version history from our versioning service
				const history = await this.versioningService.getBackupHistory(file.path, backupPath);
				versionHistory = history.versions;
				currentVersion = history.currentVersion;
			} catch (error) {
				loggerWarn(this, `Failed to get detailed backup info for: ${file.path}`, { error });
			}

			const info = {
				hasBackup: true,
				backupPath,
				statistics,
				increments,
				versionHistory,
				currentVersion
			};
			
			loggerDebug(this, `Backup info for ${file.path}`, { 
				hasBackup: info.hasBackup,
				incrementCount: increments.length,
				versionCount: versionHistory.length,
				currentVersion
			});
			
			return info;
		} catch (error) {
			loggerError(this, `Failed to get asset backup info: ${file.path}`, { error });
			return { hasBackup: false };
		}
	}

	async testBackupSystem(): Promise<boolean> {
		try {
			loggerInfo(this, 'Testing backup system...');
			
			if (!this.initialized) {
				await this.initialize();
			}

			const isAvailable = await this.backupService.isAvailable();
			
			if (isAvailable) {
				loggerInfo(this, 'Backup system test passed');
			} else {
				loggerWarn(this, 'Backup system test failed - service not available');
			}
			
			return isAvailable;
		} catch (error) {
			loggerError(this, 'Backup system test failed with error', { error });
			return false;
		}	}

	// ============================================================================
	// Backup Version History Methods
	// ============================================================================

	/**
	 * Get backup version history for an asset
	 */
	async getAssetVersionHistory(file: TFile): Promise<BackupVersionInfo[]> {
		try {
			loggerDebug(this, `Getting version history for: ${file.path}`);
			const settings = this.settingsService.getSettings();
			const backupPath = await this.fileService.getBackupLocation(file, settings.storeBackupsAdjacentToFiles);
			const history = await this.versioningService.getBackupHistory(file.path, backupPath);
			return history.versions;
		} catch (error) {
			loggerError(this, `Failed to get version history: ${file.path}`, { error });
			return [];
		}
	}

	/**
	 * Get the current version number for an asset
	 */
	async getCurrentVersion(file: TFile): Promise<string> {
		try {
			const settings = this.settingsService.getSettings();
			const backupPath = await this.fileService.getBackupLocation(file, settings.storeBackupsAdjacentToFiles);
			const history = await this.versioningService.getBackupHistory(file.path, backupPath);
			return history.currentVersion;
		} catch (error) {
			loggerError(this, `Failed to get current version: ${file.path}`, { error });
			return '000'; // No backups yet
		}
	}

	/**
	 * Get formatted version list for display
	 */
	async getVersionListForDisplay(file: TFile): Promise<string[]> {
		try {
			const versions = await this.getAssetVersionHistory(file);
			return versions.map(v => this.versioningService.getVersionDescription(v));
		} catch (error) {
			loggerError(this, `Failed to get version list: ${file.path}`, { error });
			return [`Error getting versions: ${error}`];
		}
	}
}
