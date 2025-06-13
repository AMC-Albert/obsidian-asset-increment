import { TFile, Vault, normalizePath, App } from 'obsidian';
import { stat, mkdir, access } from 'fs/promises';
import { join, dirname, basename, extname } from 'path';
import { RdiffBackupWrapper } from './RdiffBackupWrapper';
import { 
	AssetInfo, 
	BackupOptions, 
	RestoreOptions, 
	BackupResult,
	AssetIncrementSettings
} from './types';
import { 
	loggerDebug, 
	loggerInfo, 
	loggerWarn, 
	loggerError,
	registerLoggerClass 
} from './utils/obsidian-logger';

export class AssetManager {
	private app: App;
	private vault: Vault;
	private settings: AssetIncrementSettings;
	private rdiffWrapper: RdiffBackupWrapper;
	private assetsCache = new Map<string, AssetInfo>();
	private vaultPath: string;
	constructor(app: App, settings: AssetIncrementSettings, pluginId?: string) {
		this.app = app;
		this.vault = app.vault;		this.settings = settings;
		
		// Get vault base path first
		let vaultBasePath = '';
		if (this.vault.adapter && 'basePath' in this.vault.adapter) {
			vaultBasePath = (this.vault.adapter as any).basePath;
		}
		
		// Calculate plugin directory path using absolute path
		const pluginDir = pluginId 
			? join(vaultBasePath, this.vault.configDir, 'plugins', pluginId)
			: undefined;
		
		loggerDebug(this, `AssetManager initialization:`, {
			pluginId,
			vaultBasePath,
			vaultConfigDir: this.vault.configDir,
			calculatedPluginDir: pluginDir
		});
			
		this.rdiffWrapper = new RdiffBackupWrapper(settings.rdiffExecutablePath, pluginDir);
		
		// Store vault base path for later use
		this.vaultPath = vaultBasePath;
		registerLoggerClass(this, 'AssetManager');
	}

	/**
	 * Initialize the asset manager
	 */
	async initialize(): Promise<void> {
		await this.rdiffWrapper.initialize();
		loggerInfo(this, 'AssetManager initialized');
	}

	/**
	 * Check if a file is a supported asset type
	 */
	isSupportedAsset(file: TFile | string): boolean {
		const path = typeof file === 'string' ? file : file.path;
		const ext = extname(path).toLowerCase().replace('.', '');
		return this.settings.monitoredExtensions.includes(ext);
	}

	/**
	 * Create a backup for an asset file
	 */
	async backupAsset(file: TFile, options: Partial<BackupOptions> = {}): Promise<BackupResult> {
		loggerDebug(this, `Starting asset backup for: ${file.path}`);

		if (!this.isSupportedAsset(file)) {
			loggerWarn(this, `File ${file.path} is not a supported asset type`);
			return {
				success: false,
				stdout: '',
				stderr: 'Unsupported asset type',
				exitCode: -1,
				error: 'Unsupported asset type'
			};
		}

		try {
			const sourcePath = this.getAbsolutePath(file.path);
			const backupLocation = await this.getBackupLocation(file);
			
			// Ensure backup directory exists
			await this.ensureDirectoryExists(dirname(backupLocation));

			// Determine compression based on file size
			const fileSize = await this.getFileSize(sourcePath);
			const useCompression = this.shouldUseCompression(fileSize);
			const backupOptions: BackupOptions = {
				// apiVersion: '201', // Removed - not supported in rdiff-backup 2.2.6
				compression: useCompression,
				exclude: ['*.tmp', '*.log', '.DS_Store'], // Default exclude patterns
				...options
			};

			loggerInfo(this, `Backing up ${file.name} (${this.formatFileSize(fileSize)}) with compression: ${useCompression}`);

			const result = await this.rdiffWrapper.backup(sourcePath, backupLocation, backupOptions);

			if (result.success) {
				await this.updateAssetInfo(file, backupLocation, result);
				loggerInfo(this, `Asset backup completed successfully for ${file.name}`);
				
				if (result.statistics) {
					loggerInfo(this, `Delta size: ${this.formatFileSize(result.statistics.incrementFileSize || 0)} (${result.statistics.compressionRatio?.toFixed(1)}% of original)`);
				}
			}

			return result;
		} catch (error) {
			loggerError(this, `Asset backup failed: ${error}`);
			return {
				success: false,
				stdout: '',
				stderr: String(error),
				exitCode: -1,
				error: String(error)
			};
		}
	}

	/**
	 * Restore an asset from backup
	 */
	async restoreAsset(file: TFile, options: RestoreOptions = {}): Promise<BackupResult> {
		loggerDebug(this, `Starting asset restore for: ${file.path}`);

		try {
			const backupLocation = await this.getBackupLocation(file);
			const restorePath = this.getAbsolutePath(file.path + '.restored');

			// Check if backup exists
			await access(backupLocation);

			const result = await this.rdiffWrapper.restore(backupLocation, restorePath, options);

			if (result.success) {
				loggerInfo(this, `Asset restored successfully to ${restorePath}`);
			}

			return result;
		} catch (error) {
			loggerError(this, `Asset restore failed: ${error}`);
			return {
				success: false,
				stdout: '',
				stderr: String(error),
				exitCode: -1,
				error: String(error)
			};
		}
	}

	/**
	 * Get asset information including backup statistics
	 */
	async getAssetInfo(file: TFile): Promise<AssetInfo | null> {
		try {
			const sourcePath = this.getAbsolutePath(file.path);
			const backupLocation = await this.getBackupLocation(file);

			// Check if backup exists
			try {
				await access(backupLocation);
			} catch {
				return null; // No backup exists
			}

			const originalSize = await this.getFileSize(sourcePath);
			const increments = await this.rdiffWrapper.listIncrements(backupLocation);
			const totalBackupSize = await this.calculateBackupSize(backupLocation);

			const assetInfo: AssetInfo = {
				path: file.path,
				originalSize,
				backupLocation,
				lastBackup: new Date(), // Would need to parse from increments
				incrementCount: increments.length,
				totalBackupSize,
				compressionRatio: totalBackupSize > 0 ? (totalBackupSize / originalSize) * 100 : 0
			};

			this.assetsCache.set(file.path, assetInfo);
			return assetInfo;
		} catch (error) {
			loggerError(this, `Failed to get asset info: ${error}`);
			return null;
		}
	}

	/**
	 * Get backup history for an asset
	 */
	async getAssetHistory(file: TFile): Promise<{ timestamp: string; size: number }[]> {
		try {
			const backupLocation = await this.getBackupLocation(file);
			const increments = await this.rdiffWrapper.listIncrements(backupLocation);
			
			return increments.map(inc => ({
				timestamp: inc.timestamp,
				size: inc.size
			}));
		} catch (error) {
			loggerError(this, 'Failed to get asset history', { file: file.path, error });
			return [];
		}
	}

	/**
	 * List all backed up assets
	 */
	async listBackedUpAssets(): Promise<AssetInfo[]> {
		const assets: AssetInfo[] = [];
		const allFiles = this.vault.getFiles();

		for (const file of allFiles) {
			if (this.isSupportedAsset(file)) {
				const assetInfo = await this.getAssetInfo(file);
				if (assetInfo) {
					assets.push(assetInfo);
				}
			}
		}

		return assets;
	}

	/**
	 * Clean up old increments based on settings
	 */	async cleanupOldIncrements(file: TFile): Promise<void> {
		try {
			const backupLocation = await this.getBackupLocation(file);
			const increments = await this.rdiffWrapper.listIncrements(backupLocation);

			// Use cleanupAfterDays setting for cleanup
			if (this.settings.cleanupAfterDays > 0) {
				const cutoffDate = new Date();
				cutoffDate.setDate(cutoffDate.getDate() - this.settings.cleanupAfterDays);
				
				const oldIncrements = increments.filter(inc => {
					const incDate = new Date(inc.timestamp);
					return incDate < cutoffDate;
				});

				if (oldIncrements.length > 0) {
					loggerInfo(this, `Cleaning up ${oldIncrements.length} old increments for ${file.name}`);
					// This would require implementing rdiff-backup remove increments command
					// For now, just log the intention
					loggerDebug(this, `Would remove ${oldIncrements.length} oldest increments`);
				}
			}
		} catch (error) {
			loggerWarn(this, `Failed to cleanup old increments: ${error}`);
		}
	}

	/**
	 * Check if rdiff-backup is available
	 */
	async isRdiffAvailable(): Promise<boolean> {
		return await this.rdiffWrapper.isAvailable();
	}

	/**
	 * Update settings and reinitialize wrapper if needed
	 */
	updateSettings(settings: AssetIncrementSettings): void {
		this.settings = settings;
		// Update settings reference
		this.settings = settings;
		this.rdiffWrapper = new RdiffBackupWrapper(settings.rdiffExecutablePath);
		this.assetsCache.clear(); // Clear cache as backup locations might have changed
	}
	/**
	 * Test if rdiff-backup is properly installed and accessible
	 */
	async testRdiffInstallation(): Promise<{ success: boolean; version?: string; error?: string }> {		try {
			// Use the existing isAvailable method
			const isAvailable = await this.rdiffWrapper.isAvailable();
			if (isAvailable) {
				// Try to get info to confirm it's working
				return {
					success: true,
					version: 'Available'
				};
			} else {
				return {
					success: false,
					error: 'rdiff-backup not available'
				};
			}
		} catch (error) {
			loggerError(this, 'Failed to test rdiff-backup installation', { error });
			return {
				success: false,
				error: error instanceof Error ? error.message : String(error)
			};
		}
	}

	/**
	 * Get the backup directory path
	 */
	private getBackupDirectory(): string {
		return this.settings.backupDirectory;
	}

	/**
	 * Get statistics for all backup repositories
	 */
	async getRepositoryStatistics(): Promise<{ repositoryCount: number; totalSizeBytes: number; averageEfficiency: number } | null> {
		try {
			const backupDir = this.getBackupDirectory();
			const backupPath = join(this.vaultPath, backupDir);

			// Check if backup directory exists
			const exists = await this.app.vault.adapter.exists(backupPath);
			if (!exists) {
				return { repositoryCount: 0, totalSizeBytes: 0, averageEfficiency: 0 };
			}

			// List all backup repositories
			const repos = await this.app.vault.adapter.list(backupPath);
			const directories = repos.folders || [];

			let totalSize = 0;
			let totalEfficiency = 0;
			let validRepos = 0;

			for (const repoDir of directories) {
				try {
					const repoPath = join(backupPath, repoDir);
					const stats = await this.getRepositorySize(repoPath);
					if (stats) {
						totalSize += stats.size;
						totalEfficiency += stats.efficiency || 0;
						validRepos++;
					}
				} catch (error) {
					loggerWarn(this, 'Failed to get stats for repository', { repo: repoDir, error });
				}
			}

			return {
				repositoryCount: validRepos,
				totalSizeBytes: totalSize,
				averageEfficiency: validRepos > 0 ? totalEfficiency / validRepos : 0
			};
		} catch (error) {
			loggerError(this, 'Failed to get repository statistics', { error });
			return null;
		}
	}

	/**
	 * Delete all backup repositories (danger zone)
	 */
	async deleteAllRepositories(): Promise<void> {
		try {
			const backupDir = this.getBackupDirectory();
			const backupPath = join(this.vaultPath, backupDir);

			const exists = await this.app.vault.adapter.exists(backupPath);
			if (!exists) {
				return;
			}

			// Remove the entire backup directory
			await this.app.vault.adapter.rmdir(backupPath, true);
			loggerInfo(this, 'All backup repositories deleted');
		} catch (error) {
			loggerError(this, 'Failed to delete all repositories', { error });
			throw error;
		}
	}

	/**
	 * Get size and efficiency stats for a repository
	 */
	private async getRepositorySize(repoPath: string): Promise<{ size: number; efficiency?: number } | null> {
		try {
			// This is a simplified implementation - in reality you'd want to
			// parse the rdiff-backup metadata for accurate statistics
			const stat = await this.app.vault.adapter.stat(repoPath);
			return {
				size: stat?.size || 0,
				efficiency: 75 // Placeholder - would need real calculation
			};
		} catch (error) {
			loggerWarn(this, 'Failed to get repository size', { repoPath, error });
			return null;
		}
	}

	private getAbsolutePath(vaultPath: string): string {
		// Use the vault adapter's path property which should be available
		const adapter = this.vault.adapter as any;
		const basePath = adapter.basePath || adapter.path || '';
		return join(basePath, vaultPath);
	}
	private async getBackupLocation(file: TFile): Promise<string> {
		const adapter = this.vault.adapter as any;
		const basePath = adapter.basePath || adapter.path || '';
		
		if (this.settings.storeBackupsAdjacentToFiles) {
			// Store backup data adjacent to the original file
			const filePath = join(basePath, file.path);
			const fileDir = dirname(filePath);
			const fileName = file.name;
			
			// Create a directory named after the file for its backup data
			// e.g., for "project.blend", create "project.blend.rdiff-backup/"
			return join(fileDir, `${fileName}.rdiff-backup`);
		} else {
			// Original behavior: Use centralized backup directory
			const relativePath = file.path.replace(/[/\\]/g, '_').replace(/\./g, '_');
			const backupDir = this.settings.backupDirectory || 
				join(basePath, '.asset-backups');
			
			return join(backupDir, relativePath);
		}
	}

	private async ensureDirectoryExists(dirPath: string): Promise<void> {
		try {
			await access(dirPath);
		} catch {
			await mkdir(dirPath, { recursive: true });
			loggerDebug(this, `Created backup directory: ${dirPath}`);
		}
	}

	private async getFileSize(filePath: string): Promise<number> {
		try {
			const stats = await stat(filePath);
			return stats.size;
		} catch (error) {
			loggerWarn(this, `Failed to get file size for ${filePath}: ${error}`);
			return 0;
		}
	}
	private shouldUseCompression(fileSize: number): boolean {
		// For rdiff-backup efficiency, we generally want to avoid compression
		// as it interferes with delta calculation
		return false;
	}

	private async calculateBackupSize(backupLocation: string): Promise<number> {
		try {
			// This would need to recursively calculate the size of the backup directory
			// For now, return 0 as a placeholder
			loggerDebug(this, `Calculating backup size for: ${backupLocation}`);
			return 0;
		} catch (error) {
			loggerWarn(this, `Failed to calculate backup size: ${error}`);
			return 0;
		}
	}

	private async updateAssetInfo(file: TFile, backupLocation: string, result: BackupResult): Promise<void> {
		try {
			const originalSize = await this.getFileSize(this.getAbsolutePath(file.path));
			const totalBackupSize = await this.calculateBackupSize(backupLocation);

			const assetInfo: AssetInfo = {
				path: file.path,
				originalSize,
				backupLocation,
				lastBackup: new Date(),
				incrementCount: 1, // Would need to count actual increments
				totalBackupSize,
				compressionRatio: result.statistics?.compressionRatio || 0
			};

			this.assetsCache.set(file.path, assetInfo);
		} catch (error) {
			loggerWarn(this, `Failed to update asset info: ${error}`);
		}
	}

	private formatFileSize(bytes: number): string {
		if (bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
	}
}
