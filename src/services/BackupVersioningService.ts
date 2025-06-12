/**
 * Backup versioning service for metadata-only version tracking
 * 
 * Tracks backup increments as versions (001, 002, 003, etc.) without modifying original filenames.
 * Versions are metadata that correspond to rdiff-backup increments.
 */

import { IFileService } from './interfaces';
import { 
	loggerDebug, 
	loggerInfo, 
	loggerWarn, 
	loggerError,
	registerLoggerClass 
} from '../utils/obsidian-logger';

export interface BackupVersionInfo {
	version: string;        // 3-digit format: "001", "002", etc.
	timestamp: Date;        // When this backup was created
	backupPath: string;     // Path to the backup repository
	fileSize: number;       // Size of the original file at backup time
	incrementPath?: string; // Path to the specific increment (if available)
	description?: string;   // Optional description
	isLatest: boolean;      // Whether this is the most recent backup
}

export interface AssetBackupHistory {
	assetPath: string;              // Original file path (unchanged)
	backupRepository: string;       // rdiff-backup repository path
	currentVersion: string;         // Latest version number (e.g., "003")
	versions: BackupVersionInfo[];  // All backup versions
	totalVersions: number;          // Total number of backups
}

export class BackupVersioningService {
	private fileService: IFileService;

	constructor(fileService: IFileService) {
		this.fileService = fileService;
		registerLoggerClass(this, 'BackupVersioningService');
		loggerDebug(this, 'BackupVersioningService initialized');
	}

	/**
	 * Generate next version number in 3-digit format
	 */
	async getNextVersion(assetPath: string, backupPath: string): Promise<string> {
		try {
			const history = await this.getBackupHistory(assetPath, backupPath);
			const nextVersionNum = history.totalVersions + 1;
			const nextVersion = this.formatVersionNumber(nextVersionNum);
			
			loggerDebug(this, `Next version for ${assetPath}: ${nextVersion}`);
			return nextVersion;
		} catch (error) {
			loggerWarn(this, `Failed to get next version for ${assetPath}, defaulting to 001`, { error });
			return '001';
		}
	}

	/**
	 * Format version number to 3-digit string
	 */
	formatVersionNumber(versionNum: number): string {
		if (versionNum < 1 || versionNum > 999) {
			loggerWarn(this, `Version number ${versionNum} is out of range (1-999), clamping`);
			versionNum = Math.max(1, Math.min(999, versionNum));
		}
		
		const formatted = versionNum.toString().padStart(3, '0');
		loggerDebug(this, `Formatted version number: ${versionNum} -> ${formatted}`);
		return formatted;
	}

	/**
	 * Parse version number from string
	 */
	parseVersionNumber(version: string): number {
		const parsed = parseInt(version, 10);
		if (isNaN(parsed)) {
			loggerWarn(this, `Invalid version string: ${version}, defaulting to 1`);
			return 1;
		}
		return parsed;
	}

	/**
	 * Create version metadata for a new backup
	 * This tracks the backup as a version without changing the original filename
	 */
	async createVersionInfo(
		assetPath: string, 
		backupPath: string, 
		version?: string
	): Promise<BackupVersionInfo> {
		try {
			// Get next version if not provided
			const versionNumber = version || await this.getNextVersion(assetPath, backupPath);
			
			// Get file size of original asset
			const fileSize = await this.fileService.getFileSize(assetPath);
			
			const versionInfo: BackupVersionInfo = {
				version: versionNumber,
				timestamp: new Date(),
				backupPath,
				fileSize,
				description: `Backup version ${versionNumber}`,
				isLatest: true // This will be updated when newer versions are created
			};
			
			loggerDebug(this, `Created version info for ${assetPath}`, { 
				version: versionNumber, 
				backupPath,
				fileSize 
			});
			
			return versionInfo;
		} catch (error) {
			loggerError(this, `Failed to create version info for ${assetPath}`, { error });
			throw error;
		}
	}

	/**
	 * Get backup history for an asset
	 * This would typically read from rdiff-backup increments and map them to versions
	 */
	async getBackupHistory(assetPath: string, backupPath: string): Promise<AssetBackupHistory> {
		try {
			loggerDebug(this, `Getting backup history for ${assetPath} at ${backupPath}`);
			
			// For now, return a basic history structure
			// In a full implementation, this would:
			// 1. Read rdiff-backup increments from the backup repository
			// 2. Map each increment to a version number
			// 3. Extract timestamp and size information
			
			const versions: BackupVersionInfo[] = [];
			let currentVersion = '000';
			
			// Check if backup repository exists
			const backupExists = await this.fileService.exists(backupPath);
			if (backupExists) {
				// This is a placeholder - in reality you'd read rdiff-backup data
				// For now, assume there's at least one backup if the directory exists
				const stats = await this.fileService.getStats(backupPath);
				
				versions.push({
					version: '001',
					timestamp: stats.lastModified,
					backupPath,
					fileSize: 0, // Would be read from backup metadata
					isLatest: true
				});
				
				currentVersion = '001';
			}
			
			const history: AssetBackupHistory = {
				assetPath,
				backupRepository: backupPath,
				currentVersion,
				versions,
				totalVersions: versions.length
			};
			
			loggerDebug(this, `Backup history for ${assetPath}`, { 
				totalVersions: history.totalVersions,
				currentVersion: history.currentVersion 
			});
			
			return history;
		} catch (error) {
			loggerError(this, `Failed to get backup history for ${assetPath}`, { error });
			
			// Return empty history on error
			return {
				assetPath,
				backupRepository: backupPath,
				currentVersion: '000',
				versions: [],
				totalVersions: 0
			};
		}
	}

	/**
	 * Get version display string for UI
	 */
	getVersionDisplayString(version: string): string {
		return `v${version}`;
	}

	/**
	 * Get version description for UI
	 */
	getVersionDescription(versionInfo: BackupVersionInfo): string {
		const displayVersion = this.getVersionDisplayString(versionInfo.version);
		const timestamp = versionInfo.timestamp.toLocaleString();
		const fileSize = this.fileService.formatFileSize(versionInfo.fileSize);
		
		return `${displayVersion} (${timestamp}) - ${fileSize}`;
	}

	/**
	 * Compare two version strings
	 */
	compareVersions(version1: string, version2: string): number {
		const num1 = this.parseVersionNumber(version1);
		const num2 = this.parseVersionNumber(version2);
		return num1 - num2;
	}

	/**
	 * Get latest version from a list of versions
	 */
	getLatestVersion(versions: BackupVersionInfo[]): BackupVersionInfo | null {
		if (versions.length === 0) return null;
		
		return versions.reduce((latest, current) => {
			return this.compareVersions(current.version, latest.version) > 0 ? current : latest;
		});
	}

	/**
	 * Update version metadata when a new backup is created
	 */
	async updateVersionHistory(
		assetPath: string, 
		backupPath: string, 
		newVersionInfo: BackupVersionInfo
	): Promise<AssetBackupHistory> {
		try {
			const history = await this.getBackupHistory(assetPath, backupPath);
			
			// Mark all existing versions as not latest
			history.versions.forEach(v => v.isLatest = false);
			
			// Add new version
			history.versions.push(newVersionInfo);
			history.currentVersion = newVersionInfo.version;
			history.totalVersions = history.versions.length;
			
			// Sort versions by version number
			history.versions.sort((a, b) => this.compareVersions(a.version, b.version));
			
			loggerInfo(this, `Updated version history for ${assetPath}`, {
				newVersion: newVersionInfo.version,
				totalVersions: history.totalVersions
			});
			
			return history;
		} catch (error) {
			loggerError(this, `Failed to update version history for ${assetPath}`, { error });
			throw error;
		}
	}
}
