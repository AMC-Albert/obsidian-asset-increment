import { TFile, Notice, FileSystemAdapter } from 'obsidian';
import type { AssetIncrementSettings } from '../types'; // Ensure LogLevel is imported or defined if used here
import type { IAssetService, IFileService, ISettingsService, IBackupService } from './interfaces'; // Corrected to IBackupService
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
	loadRenameLog(): Promise<void>;
}

export class BackupIntegrityService implements IBackupIntegrityService {
	private renameLog: RenameLogEntry[] = [];
	private readonly renameLogPath: string;

	constructor(
		private app: any,
		private settingsService: ISettingsService,
		private assetService: IAssetService,
		private fileService: IFileService,
		private backupService: IBackupService, // Corrected to IBackupService
		private lastBackupTimes: Map<string, number>
	) {
		registerLoggerClass(this, 'BackupIntegrityService');
		const adapter = this.app.vault.adapter;
		if (adapter instanceof FileSystemAdapter) {
			this.renameLogPath = path.join(adapter.getBasePath(), this.app.vault.configDir, 'asset-increment-rename-log.json');
		} else {
			// Fallback or error if not FileSystemAdapter, though Obsidian plugins usually run in environments where it is.
			this.renameLogPath = 'asset-increment-rename-log.json'; // This might not be ideal
			loggerError(this, 'FileSystemAdapter not available, rename log path may be incorrect.');
		}
		this.loadRenameLog();
	}

	async loadRenameLog(): Promise<void> {
		try {
			if (await this.fileService.exists(this.renameLogPath)) {
				const logContent = await fs.readFile(this.renameLogPath, 'utf-8');
				this.renameLog = JSON.parse(logContent);
				loggerInfo(this, 'Rename log loaded successfully.');
			} else {
				loggerInfo(this, 'No existing rename log found. A new one will be created if needed.');
				this.renameLog = [];
			}
		} catch (error) {
			loggerError(this, 'Failed to load rename log', { error });
			this.renameLog = []; // Start with an empty log if loading fails
		}
	}

	private async saveRenameLog(): Promise<void> {
		try {
			await fs.writeFile(this.renameLogPath, JSON.stringify(this.renameLog, null, 2), 'utf-8');
			loggerDebug(this, 'Rename log saved successfully.');
		} catch (error) {
			loggerError(this, 'Failed to save rename log', { error });
		}
	}

	private addRenameLogEntry(oldPath: string, newPath: string): void {
		const entry: RenameLogEntry = {
			oldPath,
			newPath,
			timestamp: new Date().toISOString(),
		};
		this.renameLog.push(entry);
		// Keep the log from growing indefinitely, e.g., last 1000 renames or by time
		if (this.renameLog.length > 1000) {
			this.renameLog.shift(); // Remove the oldest entry
		}
		this.saveRenameLog();
	}

	async getHistoricalPaths(currentPath: string): Promise<string[]> {
		const history = [currentPath];
		let pathToCheck = currentPath;
		// Limit iterations to prevent infinite loops in case of circular references (though unlikely with timestamps)
		for (let i = 0; i < this.renameLog.length; i++) {
			const entry = this.renameLog.find(e => e.newPath === pathToCheck);
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
			// For non-adjacent (centralized) backups, rdiff-backup handles paths directly.
			// We might still want to log the rename if we were to offer history tracing for centralized backups.
			return;
		}

		const oldFileAbsolutePath = this.getAbsolutePathFromVaultPath(oldPath);
		const newFileAbsolutePath = this.getAbsolutePathFromVaultPath(file.path);

		const oldBackupDirParent = path.dirname(oldFileAbsolutePath);
		const newBackupDirParent = path.dirname(newFileAbsolutePath);

		const oldBackupDataDir = path.join(oldBackupDirParent, 'rdiff-backup-data');
		const newBackupDataDir = path.join(newBackupDirParent, 'rdiff-backup-data');

		try {
			const oldBackupExists = await this.fileService.exists(oldBackupDataDir);

			if (oldBackupExists) {
				if (oldBackupDataDir !== newBackupDataDir) {
					// File moved to a different directory
					loggerInfo(this, `Asset moved to a new directory. Moving rdiff-backup-data: ${oldBackupDataDir} -> ${newBackupDataDir}`);
					await this.fileService.ensureDirectoryExists(newBackupDirParent); // Ensure target parent exists
					
					// Check if a backup directory already exists at the new location
					const newBackupDataDirExists = await this.fileService.exists(newBackupDataDir);
					if (newBackupDataDirExists) {
						// This case is complex: an asset was moved to a location where another asset (or a previous version of this one)
						// already had an adjacent backup. We'll archive the existing one at the new location before moving.
						loggerWarn(this, `Backup data already exists at the new location: ${newBackupDataDir}. Archiving it.`);
						const archiveName = `rdiff-backup-data.pre-move-archive.${new Date().toISOString().replace(/[:.]/g, '-')}`;
						const archivePath = path.join(newBackupDirParent, archiveName);
						await fs.rename(newBackupDataDir, archivePath);
						new Notice(`Archived existing backup data at new location of ${file.name} to ${archiveName}.`, 5000);
					}
					
					await fs.rename(oldBackupDataDir, newBackupDataDir);
					new Notice(`Moved backup history for ${file.name} to new location.`, 3000);
				} else {
					// File renamed within the same directory. The rdiff-backup-data directory doesn't need to move.
					// Rdiff-backup will see the old file as missing and the new file as new.
					// The history for the old filename remains in rdiff-backup-data.
					loggerInfo(this, `Asset renamed within the same directory: ${path.basename(oldPath)} -> ${file.name}. Backup data directory remains: ${oldBackupDataDir}`);
					new Notice(`File renamed: ${file.name}. Backup history for old name is preserved.`, 3000);
				}
                // Log the rename for history tracking
				this.addRenameLogEntry(oldPath, file.path);

				// Update last backup times
				if (this.lastBackupTimes.has(oldPath)) {
					this.lastBackupTimes.set(file.path, this.lastBackupTimes.get(oldPath)!);
					this.lastBackupTimes.delete(oldPath);
				}

				loggerInfo(this, `Rename/move handling completed for ${file.path}. Backup history preserved.`);

			} else {
				loggerInfo(this, `No existing backup data found at ${oldBackupDataDir}. Nothing to move for ${oldPath}.`);
				// If auto-backup is on, a new backup will be created for the new file eventually or on next save.
				// We can still log the rename if we want to trace files that never had backups.
				this.addRenameLogEntry(oldPath, file.path);
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
