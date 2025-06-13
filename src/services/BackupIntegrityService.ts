import { TFile, Notice, FileSystemAdapter } from 'obsidian';
import type { AssetIncrementSettings } from '../types'; // Ensure LogLevel is imported or defined if used here
import type { IAssetService, IFileService, ISettingsService, IBackupService } from './interfaces'; // Corrected to IBackupService
import { ASSET_META_SUFFIX } from '../constants';
import {
	loggerDebug,
	loggerInfo,
	loggerWarn,
	loggerError,
	registerLoggerClass
} from '../utils/obsidian-logger';

// Use require for Node.js modules in Obsidian
const path = require('path');
const fs = require('fs/promises'); // Using fs/promises for async file operations

// Define the structure for the rename log entry
interface RenameLogEntry {
	newPath: string;
	oldPath: string;
	timestamp: string;
}

export interface IBackupIntegrityService {
	handleFileRename(file: TFile, oldPath: string): Promise<void>;
	getHistoricalPaths(currentPath: string): Promise<string[]>;
}

export class BackupIntegrityService implements IBackupIntegrityService {
	constructor(
		private app: any,
		private settingsService: ISettingsService,
		private assetService: IAssetService,
		private fileService: IFileService,
		private backupService: IBackupService,
		private lastBackupTimes: Map<string, number>
	) {
		registerLoggerClass(this, 'BackupIntegrityService');
	}	/**
	 * Get the rename log path for a specific asset
	 */
	private getRenameLogPath(assetPath: string): string {
		// Convert to absolute path if it's vault-relative
		const absoluteAssetPath = this.getAbsolutePathFromVaultPath(assetPath);
		const metaDir = `${absoluteAssetPath}${ASSET_META_SUFFIX}`;
		// Use path.resolve to normalize path separators for the platform
		return path.resolve(path.join(metaDir, 'rename-log.json'));
	}

	/**
	 * Load rename log for a specific asset
	 */
	private async loadRenameLog(assetPath: string): Promise<RenameLogEntry[]> {
		try {
			const logPath = this.getRenameLogPath(assetPath);			if (await this.fileService.exists(logPath)) {
				const logContent = await fs.readFile(logPath, 'utf-8');
				const renameLog = JSON.parse(logContent);
				loggerInfo(this, `Rename log loaded for asset: ${assetPath} (${renameLog.length} entries)`);
				return renameLog;
			} else {
				loggerDebug(this, `No rename log found for asset: ${assetPath}`);
				return [];
			}
		} catch (error) {
			loggerError(this, `Failed to load rename log for asset: ${assetPath}`, { error });
			return []; // Start with an empty log if loading fails
		}
	}
	/**
	 * Save rename log for a specific asset
	 */	private async saveRenameLog(assetPath: string, renameLog: RenameLogEntry[]): Promise<void> {
		try {
			const logPath = this.getRenameLogPath(assetPath);
			const metaDir = path.dirname(logPath);
					// Ensure the meta directory exists
			await this.fileService.ensureDirectoryExists(metaDir);
			
			// Verify the directory was created
			const metaDirExists = await this.fileService.exists(metaDir);
			if (!metaDirExists) {
				throw new Error(`Failed to create meta directory: ${metaDir}`);
			}
			
			// Use path.resolve to ensure proper path formatting
			const normalizedLogPath = path.resolve(logPath);
			await fs.writeFile(normalizedLogPath, JSON.stringify(renameLog, null, 2), 'utf-8');
			loggerInfo(this, `Rename log saved for asset: ${assetPath} (${renameLog.length} entries) at ${normalizedLogPath}`);
		} catch (error) {
			loggerError(this, `Failed to save rename log for asset: ${assetPath}`, { error });
			// Don't throw - this shouldn't break the rename operation
		}
	}
	/**
	 * Add a rename log entry for a specific asset
	 */
	private async addRenameLogEntry(assetPath: string, oldPath: string, newPath: string): Promise<void> {
		const entry: RenameLogEntry = {
			oldPath,
			newPath,
			timestamp: new Date().toISOString(),
		};
		
		const renameLog = await this.loadRenameLog(assetPath);
		renameLog.push(entry);
		
		// Keep the log from growing indefinitely, e.g., last 100 renames per asset
		if (renameLog.length > 100) {
			renameLog.shift(); // Remove the oldest entry
		}
		
		await this.saveRenameLog(assetPath, renameLog);
	}

	/**
	 * Get historical paths for a specific asset
	 */
	async getHistoricalPaths(currentPath: string): Promise<string[]> {
		const renameLog = await this.loadRenameLog(currentPath);
		const history = [currentPath];
		let pathToCheck = currentPath;
		
		// Limit iterations to prevent infinite loops
		for (let i = 0; i < renameLog.length && i < 100; i++) {
			const entry = renameLog.find((e: RenameLogEntry) => e.newPath === pathToCheck);
			if (entry) {
				history.push(entry.oldPath);
				pathToCheck = entry.oldPath;
			} else {
				break;
			}
		}
		return history.reverse(); // Oldest path first
	}


	async handleFileRename(file: TFile, oldPath: string): Promise<void> {
		loggerInfo(this, `Handling file rename/move: ${oldPath} -> ${file.path}`);
		const settings = this.settingsService.getSettings();

		if (!settings.storeBackupsAdjacent) {
			loggerInfo(this, 'Backup history preservation for renames/moves is only active for adjacent backups. Skipping.');
			// For non-adjacent (centralized) backups, restic handles paths directly.
			// We might still want to log the rename if we were to offer history tracing for centralized backups.
			return;
		}
		const oldFileAbsolutePath = this.getAbsolutePathFromVaultPath(oldPath);
		const newFileAbsolutePath = this.getAbsolutePathFromVaultPath(file.path);

		// With the new per-file .meta folder structure:
		// Old file: /path/to/MyAsset.blend -> Meta folder: /path/to/MyAsset.blend.meta
		// New file: /path/to/NewAsset.blend -> Meta folder: /path/to/NewAsset.blend.meta
		const oldMetaDir = oldFileAbsolutePath + ASSET_META_SUFFIX;
		const newMetaDir = newFileAbsolutePath + ASSET_META_SUFFIX;

		try {
			const oldMetaExists = await this.fileService.exists(oldMetaDir);			if (oldMetaExists) {
				if (oldMetaDir !== newMetaDir) {
					// File moved or renamed - need to move the entire .meta folder
					loggerInfo(this, `Asset moved/renamed. Moving meta folder: ${oldMetaDir} -> ${newMetaDir}`);
					
					// Ensure the parent directory of the new meta folder exists
					const newMetaDirParent = path.dirname(newMetaDir);
					await this.fileService.ensureDirectoryExists(newMetaDirParent);
					
					// Check if a meta folder already exists at the new location
					const newMetaDirExists = await this.fileService.exists(newMetaDir);
					if (newMetaDirExists) {						// This case is complex: an asset was moved to a location where another asset 
						// already had a meta folder. We'll archive the existing one before moving.
						loggerWarn(this, `Meta folder already exists at the new location: ${newMetaDir}. Archiving it.`);
						const archiveName = `${path.basename(newMetaDir)}.pre-move-archive.${new Date().toISOString().replace(/[:.]/g, '-')}`;
						const archivePath = path.join(path.dirname(newMetaDir), archiveName);
						await fs.rename(newMetaDir, archivePath);
						new Notice(`Archived existing meta folder at new location of ${file.name} to ${archiveName}.`, 5000);
					}					await fs.rename(oldMetaDir, newMetaDir);
					
					// Small delay to ensure filesystem operation is completed
					await new Promise(resolve => setTimeout(resolve, 100));
					
					// Verify the move was successful
					const moveSuccessful = await this.fileService.exists(newMetaDir);
					if (moveSuccessful) {
						new Notice(`Moved backup history for ${file.name} to new location.`, 3000);
					} else {
						loggerError(this, `Meta folder move failed: ${oldMetaDir} -> ${newMetaDir}`);
						new Notice(`Error moving backup history for ${file.name}.`, 3000);
						return; // Don't proceed if move failed
					}
				} else {
					// File renamed within the same location. The meta folder doesn't need to move.
					// The backup history remains in the same .meta folder.
					loggerInfo(this, `Asset renamed at same location: ${path.basename(oldPath)} -> ${file.name}. Meta folder remains: ${oldMetaDir}`);
					new Notice(`File renamed: ${file.name}. Backup history preserved.`, 3000);
				}                // Log the rename for history tracking
				await this.addRenameLogEntry(file.path, oldPath, file.path);

				// Update last backup times
				if (this.lastBackupTimes.has(oldPath)) {
					this.lastBackupTimes.set(file.path, this.lastBackupTimes.get(oldPath)!);
					this.lastBackupTimes.delete(oldPath);
				}

				loggerInfo(this, `Rename/move handling completed for ${file.path}. Backup history preserved.`);			} else {
				loggerInfo(this, `No existing meta folder found at ${oldMetaDir}. Nothing to move for ${oldPath}.`);
				// If auto-backup is on, a new backup will be created for the new file eventually or on next save.				// We can still log the rename if we want to trace files that never had backups.
				await this.addRenameLogEntry(file.path, oldPath, file.path);
			}

		} catch (error) {
			loggerError(this, 'Error handling file rename/move for backup integrity', { oldPath, newPath: file.path, error });
			new Notice(`Error processing rename/move for ${file.name}. Backup history may be affected. Check logs.`, 7000);
		}
	}

	// Removed archiveOldBackupHistory, removeDirectory, handleDirectoryMove, handleSameDirectoryRename, updateBackupRepositoryPaths, diagnoseBackupRepositoryState
	// as they are no longer part of the new strategy.

	/**
	 * Helper to get absolute path from vault-relative path
	 */
	private getAbsolutePathFromVaultPath(vaultPath: string): string {
		const adapter = this.app.vault.adapter;
		if (adapter instanceof FileSystemAdapter) {
			return adapter.getFullPath(vaultPath); // Use getFullPath for reliability
		}
		loggerError(this, 'FileSystemAdapter not available when trying to get absolute path.');
		throw new Error('FileSystemAdapter not available');
	}

	// Removed getBackupLocationForPath as fileService.getBackupLocation should be used or path derived directly.
}
