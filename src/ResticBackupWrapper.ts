/**
 * Cross-platform wrapper for restic executable
 * 
 * Supports:
 * - Windows: PowerShell execution with proper path quoting
 * - macOS/Linux: Bash execution with proper path quoting
 * - Individual file backup using per-file adjacent repositories
 * - Incremental snapshots with deduplication
 */

import {
	BackupOptions,
	RestoreOptions,
	BackupResult,
	BackupStatistics,
	BackupIncrement,
	ResticCommand
} from './types';
import { ASSET_META_SUFFIX } from './constants';
import {
	loggerDebug,
	loggerInfo,
	loggerWarn,
	loggerError,
	registerLoggerClass
} from './utils/obsidian-logger';

// Use require for Node.js modules in Obsidian
const { spawn } = require('child_process');
const { promisify } = require('util');
const fs = require('fs/promises');
const path = require('path');

export class ResticBackupWrapper {
	private resticPath: string;
	private pluginDir?: string;

	constructor(resticPath: string = 'restic', pluginDir?: string) {
		this.pluginDir = pluginDir;
		this.resticPath = resticPath;
		registerLoggerClass(this, 'ResticBackupWrapper');
		loggerInfo(this, `ResticBackupWrapper initialized with pluginDir: ${pluginDir}, resticPath: ${resticPath}`);
	}

	/**
	 * Initialize the wrapper by detecting the best restic executable
	 */
	async initialize(): Promise<void> {
		try {
			loggerInfo(this, 'Starting restic wrapper initialization...');
			const detectedPath = await this.detectResticExecutable();
			if (detectedPath) {
				this.resticPath = detectedPath;
				loggerInfo(this, `Restic wrapper initialized successfully with path: ${this.resticPath}`);
			} else {
				throw new Error('No working restic executable found');
			}
		} catch (error) {
			loggerError(this, `Failed to initialize restic wrapper: ${error}`);
			throw error;
		}
	}

	/**
	 * Detect the best available restic executable
	 */
	private async detectResticExecutable(): Promise<string | null> {
		const candidates = [
			'restic',
			'restic.exe',
			path.join(process.cwd(), 'restic.exe'),
			path.join(process.cwd(), 'restic')
		];

		for (const candidate of candidates) {
			loggerDebug(this, `Testing restic candidate: ${candidate}`);
			if (await this.testResticExecutable(candidate)) {
				loggerInfo(this, `Found working restic executable: ${candidate}`);
				return candidate;
			}
		}

		loggerWarn(this, 'No working restic executable found');
		return null;
	}

	/**
	 * Test if a restic executable path works
	 */
	private async testResticExecutable(executablePath: string): Promise<boolean> {
		try {
			// Check if path exists (for absolute paths)
			if (executablePath.includes('/') || executablePath.includes('\\')) {
				try {
					await fs.access(executablePath);
					loggerInfo(this, `File exists at: ${executablePath}`);
				} catch (accessError) {
					loggerInfo(this, `File does not exist at: ${executablePath}`, { accessError });
					return false;
				}
			}

			const command: ResticCommand = {
				command: executablePath,
				args: ['version']
			};
			loggerInfo(this, `Executing command: ${command.command} ${command.args.join(' ')}`);
			const result = await this.executeCommand(command);
			loggerInfo(this, `Command result: success=${result.success}, stdout="${result.stdout}", stderr="${result.stderr}"`);

			const isValid = result.success && result.stdout.includes('restic');
			loggerInfo(this, `Test result for ${executablePath}: ${isValid}`);
			return isValid;
		} catch (error) {
			loggerDebug(this, `Exception during test of ${executablePath}:`, { error });
			return false;
		}
	}

	/**
	 * Check if restic is available and working
	 */
	async isAvailable(): Promise<boolean> {
		try {
			const command: ResticCommand = {
				command: this.resticPath,
				args: ['version']
			};
			const result = await this.executeCommand(command);
			const isAvailable = result.success && result.stdout.includes('restic');
			loggerInfo(this, `restic availability check: ${isAvailable}`);
			return isAvailable;
		} catch (error) {
			loggerDebug(this, `restic availability check failed: ${error}`);
			return false;
		}
	}

	/**
	 * Perform a backup operation with adjacent storage support
	 * 
	 * For adjacent storage, this treats the source file as the working copy
	 * and creates the backup repository in a subfolder of the .meta directory
	 */
	async backupAdjacent(sourcePath: string, destinationPath: string, options: BackupOptions = {}): Promise<BackupResult> {
		loggerInfo(this, `Starting adjacent backup: ${sourcePath} -> ${destinationPath}`);
		
		try {
			// Validate source exists
			await fs.access(sourcePath);

			const stats = await fs.stat(sourcePath);
			if (!stats.isFile()) {
				throw new Error('Adjacent backup only supports individual files');
			}

			const fileName = path.basename(sourcePath);
			
			// Create repository path as a subfolder within the .meta directory
			const repositoryPath = path.join(destinationPath, 'restic-repository');
			
			loggerInfo(this, `Adjacent backup: backing up file ${fileName} to repository ${repositoryPath}`);

			// Ensure repository directory exists and initialize if needed
			await this.ensureRepository(repositoryPath, options);			// Create backup snapshot
			const { snapshotId, stats: statistics } = await this.createSnapshot(sourcePath, repositoryPath, options);

			loggerInfo(this, `Adjacent backup completed successfully for ${fileName}, snapshot: ${snapshotId}`);
			loggerDebug(this, `Backup statistics:`, statistics);

			return {
				success: true,
				stdout: `Snapshot ${snapshotId} created successfully`,
				stderr: '',
				exitCode: 0,
				statistics,
				versionInfo: {
					snapshotId,
					repositoryPath
				}
			};

		} catch (error) {
			loggerError(this, `Adjacent backup failed: ${error}`);
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
	 * Perform a backup operation (delegates to backupAdjacent for consistency)
	 */
	async backup(sourcePath: string, destinationPath: string, options: BackupOptions = {}): Promise<BackupResult> {
		return this.backupAdjacent(sourcePath, destinationPath, options);
	}

	/**
	 * Ensure repository exists and is initialized
	 */
	private async ensureRepository(repositoryPath: string, options: BackupOptions): Promise<void> {
		// Check if repository already exists
		const repoConfigPath = path.join(repositoryPath, 'config');
		try {
			await fs.access(repoConfigPath);
			loggerDebug(this, `Repository already exists at: ${repositoryPath}`);
			return;
		} catch {
			// Repository doesn't exist, create it
			loggerInfo(this, `Creating new repository at: ${repositoryPath}`);
		}

		// Ensure directory exists
		await fs.mkdir(repositoryPath, { recursive: true });

		// Initialize repository
		const command: ResticCommand = {
			command: this.resticPath,
			args: ['init', '--insecure-no-password'],
			env: {
				RESTIC_REPOSITORY: repositoryPath
			}
		};

		const result = await this.executeCommand(command);
		if (!result.success) {
			throw new Error(`Failed to initialize repository: ${result.stderr}`);
		}

		loggerInfo(this, `Repository initialized successfully at: ${repositoryPath}`);
	}
	/**
	 * Create a backup snapshot and return statistics
	 */
	private async createSnapshot(sourcePath: string, repositoryPath: string, options: BackupOptions): Promise<{ snapshotId: string; stats: BackupStatistics }> {
		const args = ['backup', sourcePath, '--insecure-no-password'];
		
		// Add tag if provided
		if (options.tag) {
			args.push('--tag', options.tag);
		}

		const command: ResticCommand = {
			command: this.resticPath,
			args,
			env: {
				RESTIC_REPOSITORY: repositoryPath
			}
		};

		const result = await this.executeCommand(command);
		if (!result.success) {
			throw new Error(`Failed to create snapshot: ${result.stderr}`);
		}
		// Extract snapshot ID from output
		const snapshotMatch = result.stdout.match(/snapshot ([a-f0-9]{8}) saved/);
		const snapshotId = snapshotMatch ? snapshotMatch[1] : 'unknown';

		// Parse backup statistics from output
		loggerDebug(this, `Restic backup output: ${result.stdout}`);
		const stats = this.parseBackupOutput(result.stdout);
		loggerDebug(this, `Parsed backup statistics:`, stats);

		loggerInfo(this, `Snapshot created: ${snapshotId}`);
		return { snapshotId, stats };
	}

	/**
	 * Get repository statistics
	 */
	private async getRepositoryStats(repositoryPath: string, options: BackupOptions): Promise<BackupStatistics> {
		const command: ResticCommand = {
			command: this.resticPath,
			args: ['stats', '--insecure-no-password'],
			env: {
				RESTIC_REPOSITORY: repositoryPath
			}
		};

		const result = await this.executeCommand(command);
				// Parse basic stats from output (restic stats output format)
		const stats: BackupStatistics = {
			changedFiles: 0,
			changedSourceSize: 0,
			incrementFileSize: 0,
			totalDestinationSizeChange: 0,
			elapsedTime: 0,
			sourceFiles: 0,
			sourceSize: 0
		};

		if (result.success) {
			// Parse restic stats output
			const totalSizeMatch = result.stdout.match(/Total Size:\s*([\d.]+)\s*([KMGT]?iB)/);
			if (totalSizeMatch) {
				stats.sourceSize = this.parseSize(totalSizeMatch[1], totalSizeMatch[2]);
			}
		}

		return stats;
	}

	/**
	 * Parse size string to bytes
	 */
	private parseSize(value: string, unit: string): number {
		const num = parseFloat(value);
		switch (unit) {
			case 'KiB': return num * 1024;
			case 'MiB': return num * 1024 * 1024;
			case 'GiB': return num * 1024 * 1024 * 1024;
			case 'TiB': return num * 1024 * 1024 * 1024 * 1024;
			default: return num;
		}
	}

	/**
	 * Parse backup output to extract statistics
	 */
	private parseBackupOutput(output: string): BackupStatistics {
		const stats: BackupStatistics = {
			changedFiles: 0,
			changedSourceSize: 0,
			incrementFileSize: 0,
			totalDestinationSizeChange: 0,
			elapsedTime: 0,
			sourceFiles: 0,
			sourceSize: 0
		};

		// Parse Files line: "Files: 0 new, 1 changed, 0 unmodified"
		const filesMatch = output.match(/Files:\s*(\d+)\s*new,\s*(\d+)\s*changed,\s*(\d+)\s*unmodified/);
		if (filesMatch) {
			const newFiles = parseInt(filesMatch[1]);
			const changedFiles = parseInt(filesMatch[2]);
			const unmodifiedFiles = parseInt(filesMatch[3]);
			
			stats.changedFiles = newFiles + changedFiles;
			stats.sourceFiles = newFiles + changedFiles + unmodifiedFiles;
		}

		// Parse "Added to the repository: 1.331 MiB (367.652 KiB stored)"
		const addedMatch = output.match(/Added to the repository:\s*([\d.]+)\s*([KMGT]?iB)/);
		if (addedMatch) {
			stats.incrementFileSize = this.parseSize(addedMatch[1], addedMatch[2]);
			stats.totalDestinationSizeChange = stats.incrementFileSize;
		}

		// Parse "processed 1 files, 1.330 MiB in 0:00"
		const processedMatch = output.match(/processed\s+\d+\s+files?,\s*([\d.]+)\s*([KMGT]?iB)\s+in\s+(\d+):(\d+)/);
		if (processedMatch) {
			stats.changedSourceSize = this.parseSize(processedMatch[1], processedMatch[2]);
			stats.sourceSize = stats.changedSourceSize;
			
			const minutes = parseInt(processedMatch[3]);
			const seconds = parseInt(processedMatch[4]);
			stats.elapsedTime = minutes * 60 + seconds;
		}

		// Calculate compression ratio if we have both values
		if (stats.incrementFileSize > 0 && stats.changedSourceSize > 0) {
			stats.compressionRatio = (stats.incrementFileSize / stats.changedSourceSize) * 100;
			stats.spaceSavings = ((stats.changedSourceSize - stats.incrementFileSize) / stats.changedSourceSize) * 100;
		}

		return stats;
	}

	/**
	 * List snapshots in repository
	 */
	async listSnapshots(repositoryPath: string, options: BackupOptions = {}): Promise<BackupIncrement[]> {
		const command: ResticCommand = {
			command: this.resticPath,
			args: ['snapshots', '--json', '--insecure-no-password'],
			env: {
				RESTIC_REPOSITORY: repositoryPath
			}
		};

		const result = await this.executeCommand(command);
		if (!result.success) {
			throw new Error(`Failed to list snapshots: ${result.stderr}`);
		}

		try {
			const snapshots = JSON.parse(result.stdout);
			return snapshots.map((snapshot: any) => ({
				time: new Date(snapshot.time),
				name: snapshot.short_id,
				size: 0 // restic doesn't provide size in snapshots list
			}));
		} catch (error) {
			loggerError(this, `Failed to parse snapshots JSON: ${error}`);
			return [];
		}
	}

	/**
	 * List increments (alias for listSnapshots for compatibility)
	 */
	async listIncrements(repositoryPath: string, options: BackupOptions = {}): Promise<BackupIncrement[]> {
		return this.listSnapshots(repositoryPath, options);
	}

	/**
	 * Restore a file from a specific snapshot
	 */
	async restore(repositoryPath: string, snapshotId: string, targetPath: string, options: RestoreOptions = {}): Promise<BackupResult> {
		const args = ['restore', snapshotId, '--target', targetPath, '--insecure-no-password'];

		if (options.force) {
			args.push('--overwrite');
		}

		const command: ResticCommand = {
			command: this.resticPath,
			args,
			env: {
				RESTIC_REPOSITORY: repositoryPath
			}
		};

		const result = await this.executeCommand(command);
		return result;
	}

	/**
	 * Execute a restic command
	 */
	private executeCommand(command: ResticCommand): Promise<BackupResult> {
		return new Promise((resolve, reject) => {
			loggerInfo(this, `Full command being executed: ${command.command} ${command.args.join(' ')}`);
			
			// Convert paths to forward slashes for cross-platform compatibility
			const commandString = `${command.command} ${command.args.join(' ')}`;
			loggerInfo(this, `Command string for PowerShell: ${commandString}`);

			const options: any = {
				shell: true,
				env: { ...process.env, ...command.env }
			};

			const child = spawn(command.command, command.args, options);

			let stdout = '';
			let stderr = '';

			child.stdout?.on('data', (data: Buffer) => {
				stdout += data.toString();
			});

			child.stderr?.on('data', (data: Buffer) => {
				stderr += data.toString();
			});

			child.on('close', (code: number) => {
				const result: BackupResult = {
					success: code === 0,
					stdout: stdout.trim(),
					stderr: stderr.trim(),
					exitCode: code
				};

				if (code === 0) {
					loggerDebug(this, `Command completed successfully`);
				} else {
					loggerError(this, `Command failed with exit code ${code}: ${stderr}`);
					result.error = stderr || `Process exited with code ${code}`;
				}

				resolve(result);
			});

			child.on('error', (error: Error) => {
				loggerError(this, `Command execution error: ${error}`);
				resolve({
					success: false,
					stdout: '',
					stderr: error.message,
					exitCode: -1,
					error: error.message
				});
			});
		});
	}
}
