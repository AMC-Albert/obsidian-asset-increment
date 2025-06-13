/**
 * Backup service implementation using restic
 * 
 * Provides high-level backup operations following the service interface pattern.
 * Wraps the resticBackupWrapper with additional business logic and error handling.
 */

import { IBackupService, IFileService, ICommandService } from './interfaces';
import { ResticBackupWrapper } from '../ResticBackupWrapper';
import { 
	BackupOptions, 
	RestoreOptions, 
	BackupResult, 
	BackupStatistics, 
	BackupIncrement 
} from '../types';
import { 
	loggerDebug, 
	loggerInfo, 
	loggerWarn, 
	loggerError,
	registerLoggerClass 
} from '../utils/obsidian-logger';

export class ResticBackupService implements IBackupService {
	private resticWrapper: ResticBackupWrapper;
	private fileService: IFileService;
	private commandService: ICommandService;
	private initialized = false;

	constructor(
		fileService: IFileService,
		commandService: ICommandService,
		pluginDir?: string,
		rdiffPath?: string
	) {
		this.fileService = fileService;
		this.commandService = commandService;
		this.resticWrapper = new ResticBackupWrapper(rdiffPath || 'restic', pluginDir);
		
		registerLoggerClass(this, 'BackupService');
		loggerDebug(this, 'BackupService initialized', { pluginDir, rdiffPath });
	}

	async initialize(): Promise<void> {
		try {
			loggerInfo(this, 'Initializing backup service...');
			await this.resticWrapper.initialize();
			this.initialized = true;
			loggerInfo(this, 'Backup service initialized successfully');
		} catch (error) {
			loggerError(this, 'Failed to initialize backup service', { error });
			throw error;
		}
	}

	async isAvailable(): Promise<boolean> {
		try {
			if (!this.initialized) {
				loggerWarn(this, 'Backup service not initialized, attempting to initialize...');
				await this.initialize();
			}
			
			const available = await this.resticWrapper.isAvailable();
			loggerDebug(this, `Backup service availability: ${available}`);
			return available;
		} catch (error) {
			loggerError(this, 'Error checking backup service availability', { error });
			return false;
		}
	}

	async backupFile(sourcePath: string, destinationPath: string, options: BackupOptions = {}): Promise<BackupResult> {
		try {
			loggerInfo(this, `Starting file backup: ${sourcePath} -> ${destinationPath}`);
			
			// Validate inputs
			if (!(await this.fileService.exists(sourcePath))) {
				const error = `Source file does not exist: ${sourcePath}`;
				loggerError(this, error);
				return {
					success: false,
					stdout: '',
					stderr: error,
					exitCode: -1,
					error
				};
			}

			// Ensure backup service is available
			if (!(await this.isAvailable())) {
				const error = 'Backup service is not available';
				loggerError(this, error);
				return {
					success: false,
					stdout: '',
					stderr: error,
					exitCode: -1,
					error
				};
			}

			// Perform the backup
			const result = await this.resticWrapper.backup(sourcePath, destinationPath, options);
			
			if (result.success) {
				loggerInfo(this, `File backup completed successfully: ${sourcePath}`);
			} else {
				loggerWarn(this, `File backup failed: ${sourcePath}`, { 
					exitCode: result.exitCode, 
					stderr: result.stderr 
				});
			}
			
			return result;
		} catch (error) {
			const errorMessage = `Backup operation failed: ${error}`;
			loggerError(this, errorMessage, { error });
			return {
				success: false,
				stdout: '',
				stderr: errorMessage,
				exitCode: -1,
				error: errorMessage
			};
		}
	}

	async backupFileAdjacent(sourcePath: string, destinationPath: string, options: BackupOptions = {}): Promise<BackupResult> {
		try {
			loggerInfo(this, `Starting adjacent file backup: ${sourcePath} -> ${destinationPath}`);
			
			// Validate inputs
			if (!(await this.fileService.exists(sourcePath))) {
				const error = `Source file does not exist: ${sourcePath}`;
				loggerError(this, error);
				return {
					success: false,
					stdout: '',
					stderr: error,
					exitCode: -1,
					error
				};
			}

			// Ensure backup service is available
			if (!(await this.isAvailable())) {
				const error = 'Backup service is not available';
				loggerError(this, error);
				return {
					success: false,
					stdout: '',
					stderr: error,
					exitCode: -1,
					error
				};
			}

			// Perform the adjacent backup
			const result = await this.resticWrapper.backupAdjacent(sourcePath, destinationPath, options);
			
			if (result.success) {
				loggerInfo(this, `Adjacent file backup completed successfully: ${sourcePath}`);
			} else {
				loggerWarn(this, `Adjacent file backup failed: ${sourcePath}`, { 
					exitCode: result.exitCode, 
					stderr: result.stderr 
				});
			}
			
			return result;
		} catch (error) {
			const errorMessage = `Adjacent backup operation failed: ${error}`;
			loggerError(this, errorMessage, { error });
			return {
				success: false,
				stdout: '',
				stderr: errorMessage,
				exitCode: -1,
				error: errorMessage
			};
		}
	}

	async restoreFile(backupPath: string, restorePath: string, options: RestoreOptions = {}): Promise<BackupResult> {		try {
			loggerInfo(this, `Starting file restore: ${backupPath} -> ${restorePath}`);
			
			// For restic, backupPath is the repository path, we need to get the latest snapshot
			const repositoryPath = backupPath.endsWith('restic-repository') ? backupPath : `${backupPath}/restic-repository`;
			
			// Validate repository exists
			if (!(await this.fileService.exists(repositoryPath))) {
				const error = `Repository path does not exist: ${repositoryPath}`;
				loggerError(this, error);
				return {
					success: false,
					stdout: '',
					stderr: error,
					exitCode: -1,
					error
				};
			}

			// Ensure backup service is available
			if (!(await this.isAvailable())) {
				const error = 'Backup service is not available';
				loggerError(this, error);
				return {
					success: false,
					stdout: '',
					stderr: error,
					exitCode: -1,
					error
				};
			}

			// Get the latest snapshot or use specified snapshot
			const snapshotId = options.at || 'latest';

			// Perform the restore
			const result = await this.resticWrapper.restore(repositoryPath, snapshotId, restorePath, options);
			
			if (result.success) {
				loggerInfo(this, `File restore completed successfully: ${restorePath}`);
			} else {
				loggerWarn(this, `File restore failed: ${restorePath}`, { 
					exitCode: result.exitCode, 
					stderr: result.stderr 
				});
			}
			
			return result;
		} catch (error) {
			const errorMessage = `Restore operation failed: ${error}`;
			loggerError(this, errorMessage, { error });
			return {
				success: false,
				stdout: '',
				stderr: errorMessage,
				exitCode: -1,
				error: errorMessage
			};
		}
	}

	async getBackupStatistics(backupPath: string): Promise<BackupStatistics | undefined> {
		try {
			loggerDebug(this, `Getting backup statistics for: ${backupPath}`);
			
			if (!(await this.fileService.exists(backupPath))) {
				loggerWarn(this, `Backup path does not exist: ${backupPath}`);
				return undefined;
			}

			// This would need to be implemented in the rdiff wrapper
			// For now, return undefined as the method exists but may not be fully implemented
			loggerDebug(this, 'Backup statistics not yet implemented');
			return undefined;
		} catch (error) {
			loggerError(this, `Failed to get backup statistics: ${backupPath}`, { error });
			return undefined;
		}
	}

	async listBackupIncrements(backupPath: string): Promise<string[]> {
		try {
			loggerDebug(this, `Listing backup increments for: ${backupPath}`);
			
			if (!(await this.fileService.exists(backupPath))) {
				loggerWarn(this, `Backup path does not exist: ${backupPath}`);
				return [];
			}

			// Ensure backup service is available
			if (!(await this.isAvailable())) {
				loggerWarn(this, 'Backup service is not available');
				return [];
			}

			const increments = await this.resticWrapper.listIncrements(backupPath);
			const incrementStrings = increments.map((inc: BackupIncrement) => 
				typeof inc === 'string' ? inc : inc.timestamp || 'unknown'
			);
			
			loggerDebug(this, `Found ${incrementStrings.length} backup increments`);
			return incrementStrings;
		} catch (error) {
			loggerError(this, `Failed to list backup increments: ${backupPath}`, { error });
			return [];
		}
	}
}
