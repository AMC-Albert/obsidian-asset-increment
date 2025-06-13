/**
 * Cross-platform wrapper for rdiff-backup executable
 * 
 * Supports:
 * - Windows: PowerShell execution with proper path quoting
 * - macOS/Linux: Bash execution with proper path quoting
 * - Automatic executable detection (.exe on Windows, binary on Unix)
 * - Individual file backup using include/exclude patterns
 */

import {
	BackupOptions,
	RestoreOptions,
	BackupResult,
	BackupStatistics,
	BackupIncrement,
	RdiffCommand
} from './types';
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

export class RdiffBackupWrapper {
	private rdiffPath: string;
	private pluginDir?: string;
	constructor(rdiffPath: string = 'rdiff-backup', pluginDir?: string) {
		this.pluginDir = pluginDir;
		this.rdiffPath = rdiffPath;
		registerLoggerClass(this, 'RdiffBackupWrapper');
		loggerInfo(this, `RdiffBackupWrapper initialized with pluginDir: ${pluginDir}, rdiffPath: ${rdiffPath}`);
	}
	/**
	 * Initialize the wrapper by detecting the best rdiff-backup executable
	 */
	async initialize(): Promise<void> {
		try {
			loggerInfo(this, 'Starting rdiff-backup wrapper initialization...');
			const detectedPath = await this.detectRdiffExecutable();
			if (detectedPath) {
				this.rdiffPath = detectedPath;
				loggerInfo(this, `Detected rdiff-backup at: ${detectedPath}`);
			} else {
				loggerWarn(this, 'No rdiff-backup executable found - backup functionality will be limited');
			}
			loggerInfo(this, 'Rdiff-backup wrapper initialization completed');
		} catch (error) {
			loggerError(this, 'Failed to initialize rdiff-backup wrapper', { 
				error: error instanceof Error ? {
					name: error.name,
					message: error.message,
					stack: error.stack
				} : error 
			});
			throw error;
		}
	}
	
	/**
	 * Detect rdiff-backup executable in order of preference:
	 * 1. Plugin directory
	 * 2. User-specified path
	 * 3. System PATH
	 */
	private async detectRdiffExecutable(): Promise<string | null> {
		const candidates = [];

		// 1. Check plugin directory first (cross-platform executable names)
		if (this.pluginDir) {
			loggerInfo(this, `Plugin directory detected: ${this.pluginDir}`);

			// Add platform-specific executable names
			if (globalThis.process.platform === 'win32') {
				// Windows: try .exe first
				candidates.push(
					path.join(this.pluginDir, 'rdiff-backup.exe'),
					path.join(this.pluginDir, 'rdiff-backup')
				);
			} else {
				// macOS/Linux: try without extension first
				candidates.push(
					path.join(this.pluginDir, 'rdiff-backup'),
					path.join(this.pluginDir, 'rdiff-backup.exe')  // In case someone copied a Windows binary
				);
			}

			const exePath = path.join(this.pluginDir, 'rdiff-backup.exe');
			const binPath = path.join(this.pluginDir, 'rdiff-backup');
			loggerInfo(this, `Adding candidates: ${candidates.join(', ')}`);
		} else {
			loggerWarn(this, 'No plugin directory provided for rdiff-backup detection');
		}

		// 2. User-specified path
		if (this.rdiffPath !== 'rdiff-backup') {
			candidates.push(this.rdiffPath);
		}
		// 3. System PATH
		candidates.push('rdiff-backup');

		loggerInfo(this, `Testing rdiff-backup candidates: ${JSON.stringify(candidates)}`);

		for (const candidate of candidates) {
			try {
				loggerInfo(this, `Testing candidate: ${candidate}`);
				const result = await this.testExecutable(candidate);
				if (result) {
					loggerInfo(this, `Successfully found rdiff-backup at: ${candidate}`);
					return candidate;
				} else {
					loggerInfo(this, `Candidate failed test: ${candidate}`);
				}
			} catch (error) {
				// Continue to next candidate
				loggerInfo(this, `Failed to test candidate: ${candidate}`, { error });
			}
		}

		loggerError(this, 'No working rdiff-backup executable found in any candidate location');
		return null;
	}

	/**
	 * Test if an rdiff-backup executable is working
	 */
	private async testExecutable(executablePath: string): Promise<boolean> {
		try {
			loggerInfo(this, `Testing executable at path: ${executablePath}`);
			// First check if the file exists (for local paths)
			if (executablePath.includes('/') || executablePath.includes('\\')) {
				try {
					await fs.access(executablePath);
					loggerInfo(this, `File exists at: ${executablePath}`);
				} catch (accessError) {
					loggerInfo(this, `File does not exist at: ${executablePath}`, { accessError });
					return false;
				}
			}
			const command: RdiffCommand = {
				command: executablePath,
				args: ['--version']
			};
			loggerInfo(this, `Executing command: ${command.command} ${command.args.join(' ')}`);
			const result = await this.executeCommand(command);
			loggerInfo(this, `Command result: success=${result.success}, stdout="${result.stdout}", stderr="${result.stderr}"`);

			const isValid = result.success && result.stdout.includes('rdiff-backup');
			loggerInfo(this, `Test result for ${executablePath}: ${isValid}`);
			return isValid;
		} catch (error) {
			loggerDebug(this, `Exception during test of ${executablePath}:`, { error });
			return false;
		}
	}

	/**
	 * Perform a backup operation with adjacent storage support
	 * 
	 * For adjacent storage, this treats the source file as the working copy
	 * and creates the backup repository in the same directory
	 */
	async backupAdjacent(sourcePath: string, destinationPath: string, options: BackupOptions = {}): Promise<BackupResult> {
		loggerDebug(this, `Starting adjacent backup: ${sourcePath} -> ${destinationPath}`);
		try {
			// Validate source exists
			await fs.access(sourcePath);

			const stats = await fs.stat(sourcePath);
			if (!stats.isFile()) {
				throw new Error('Adjacent backup only supports individual files');
			}

			// For adjacent backup with parent directory as repository:
			// - sourcePath: the file to backup (e.g., /path/to/file.blend)
			// - destinationPath: the parent directory (e.g., /path/to/)
			// - Result: /path/to/rdiff-backup-data/ created alongside the original file
			
			const fileName = path.basename(sourcePath);
			const parentDir = path.dirname(sourcePath);
			
			// Verify that destinationPath is indeed the parent directory
			if (path.resolve(destinationPath) !== path.resolve(parentDir)) {
				throw new Error(`Adjacent backup requires destination to be parent directory. Expected: ${parentDir}, Got: ${destinationPath}`);
			}
			// For adjacent backup, we backup the directory itself
			// rdiff-backup will create rdiff-backup-data alongside the files
			// Use --force to allow backing up to the same directory (required for first backup)
			const modifiedOptions = { 
				...options,
				force: true // Always use force for adjacent backups since source = destination
			};

			loggerInfo(this, `Adjacent backup: backing up directory ${parentDir} to preserve ${fileName} (using --force)`);

			const command = this.buildBackupCommand(parentDir, destinationPath, modifiedOptions);
			const result = await this.executeCommand(command);

			// Check if backup actually succeeded even if there were warnings (exit code 1)
			if (result.success || (result.exitCode === 1 && await this.verifyBackupSuccess(destinationPath))) {
				if (!result.success) {
					// Override the success status if backup was actually created despite warnings
					result.success = true;
					loggerInfo(this, `Adjacent backup completed successfully despite warnings for ${fileName}`);
				} else {
					loggerInfo(this, `Adjacent backup completed successfully for ${fileName}`);
				}
				result.statistics = await this.parseBackupStatistics(destinationPath);
			}

			return result;
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
	 * Perform a backup operation
	 */
	async backup(sourcePath: string, destinationPath: string, options: BackupOptions = {}): Promise<BackupResult> {
		loggerDebug(this, `Starting backup: ${sourcePath} -> ${destinationPath}`);

		try {
			// Validate source exists
			await fs.access(sourcePath);

			// Check if source is a file or directory
			const stats = await fs.stat(sourcePath);
			let actualSourcePath = sourcePath;
			let modifiedOptions = { ...options };
			if (stats.isFile()) {
				// For individual files, backup the parent directory with include filter
				const parentDir = path.dirname(sourcePath);
				const relativePath = sourcePath.substring(parentDir.length + 1);
				// Convert to forward slashes for rdiff-backup patterns (required on Windows)
				const normalizedPath = relativePath.replace(/\\/g, '/');
				actualSourcePath = parentDir;

				// Create include pattern that matches from the base directory
				// Use ** prefix to match any path structure, then the specific file
				modifiedOptions.include = [`**/${normalizedPath}`];
				modifiedOptions.exclude = ['**']; // Exclude everything else

				loggerInfo(this, `Backing up single file: **/${normalizedPath} from directory: ${parentDir}`);
			}			const command = this.buildBackupCommand(actualSourcePath, destinationPath, modifiedOptions);
			const result = await this.executeCommand(command);

			// Check if backup actually succeeded even if there were warnings (exit code 1)
			if (result.success || (result.exitCode === 1 && await this.verifyBackupSuccess(destinationPath))) {
				if (!result.success) {
					// Override the success status if backup was actually created despite warnings
					result.success = true;
					loggerInfo(this, `Backup completed successfully despite warnings for ${path.basename(sourcePath)}`);
				} else {
					loggerInfo(this, `Backup completed successfully for ${path.basename(sourcePath)}`);
				}
				result.statistics = await this.parseBackupStatistics(destinationPath);
			}

			return result;
		} catch (error) {
			loggerError(this, `Backup failed: ${error}`);
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
	 * Restore files from backup
	 */
	async restore(destinationPath: string, restorePath: string, options: RestoreOptions = {}): Promise<BackupResult> {
		loggerDebug(this, `Starting restore: ${destinationPath} -> ${restorePath}`);

		try {
			await fs.access(destinationPath);

			const command = this.buildRestoreCommand(destinationPath, restorePath, options);
			const result = await this.executeCommand(command);

			if (result.success) {
				loggerInfo(this, `Restore completed successfully to ${restorePath}`);
			}

			return result;
		} catch (error) {
			loggerError(this, `Restore failed: ${error}`);
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
	 * List all increments for a backup destination
	 */
	async listIncrements(destinationPath: string): Promise<BackupIncrement[]> {
		loggerDebug(this, `Listing increments for: ${destinationPath}`);

		try {
			const command: RdiffCommand = {
				command: this.rdiffPath,
				args: ['--api-version', '201', 'list', 'increments', destinationPath]
			};

			const result = await this.executeCommand(command);

			if (result.success) {
				return this.parseIncrements(result.stdout);
			} else {
				loggerWarn(this, `Failed to list increments: ${result.stderr}`);
				return [];
			}
		} catch (error) {
			loggerError(this, `Error listing increments: ${error}`);
			return [];
		}
	}

	/**
	 * Get backup repository information
	 */
	async getInfo(destinationPath: string): Promise<BackupResult> {
		loggerDebug(this, `Getting info for: ${destinationPath}`);
		try {
			const command: RdiffCommand = {
				command: this.rdiffPath,
				args: ['--api-version', '201', 'info', destinationPath]
			};

			return await this.executeCommand(command);
		} catch (error) {
			loggerError(this, `Error getting info: ${error}`);
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
	 * Verify backup repository integrity
	 */
	async verify(destinationPath: string): Promise<BackupResult> {
		loggerDebug(this, `Verifying repository: ${destinationPath}`);
		try {
			const command: RdiffCommand = {
				command: this.rdiffPath,
				args: ['--api-version', '201', 'verify', destinationPath]
			};

			const result = await this.executeCommand(command);

			if (result.success) {
				loggerInfo(this, `Repository verification completed successfully`);
			}

			return result;
		} catch (error) {
			loggerError(this, `Verification failed: ${error}`);
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
	 * Check if rdiff-backup is available
	 */
	async isAvailable(): Promise<boolean> {
		try {
			const command: RdiffCommand = {
				command: this.rdiffPath,
				args: ['--version']
			};

			const result = await this.executeCommand(command);
			loggerDebug(this, `rdiff-backup availability check: ${result.success}`);
			return result.success;
		} catch (error) {
			loggerWarn(this, `rdiff-backup not available: ${error}`);
			return false;
		}
	}	private buildBackupCommand(sourcePath: string, destinationPath: string, options: BackupOptions): RdiffCommand {
		const args = [];

		// Add API version first (global argument)
		args.push('--api-version', '201');
		
		// Add force flag if needed (global argument)
		if (options.force) {
			args.push('--force');
		}
		
		// Add the backup subcommand
		args.push('backup');

		// Add create-full-path to ensure destination directory is created
		args.push('--create-full-path');

		// Handle compression option
		if (options.compression !== undefined) {
			if (options.compression) {
				args.push('--compression');
			} else {
				args.push('--no-compression');
			}
		}

		// Handle include patterns FIRST (they take precedence)
		if (options.include) {
			options.include.forEach(pattern => {
				args.push('--include', pattern);
			});
		}

		// Handle exclude patterns AFTER includes
		if (options.exclude) {
			options.exclude.forEach(pattern => {
				args.push('--exclude', pattern);
			});
		}

		// Note: --force moved to global arguments section above

		// Ensure paths use forward slashes for rdiff-backup on Windows
		const normalizedSourcePath = sourcePath.replace(/\\/g, '/');
		const normalizedDestPath = destinationPath.replace(/\\/g, '/');

		args.push(normalizedSourcePath, normalizedDestPath);

		return {
			command: this.rdiffPath,
			args
		};
	}
	private buildRestoreCommand(destinationPath: string, restorePath: string, options: RestoreOptions): RdiffCommand {
		const args = ['--api-version', '201', 'restore'];

		if (options.at) {
			args.push('--at', options.at);
		}

		if (options.force) {
			args.push('--force');
		}

		args.push(destinationPath, restorePath);

		return {
			command: this.rdiffPath,
			args
		};
	}

	private executeCommand(command: RdiffCommand): Promise<BackupResult> {
		return new Promise((resolve, reject) => {
			// Log the full command for debugging
			const fullCommand = `${command.command} ${command.args.join(' ')}`;
			loggerInfo(this, `Full command being executed: ${fullCommand}`);
			// Platform-specific command execution
			let shellCommand: string;
			let shellArgs: string[];

			if (globalThis.process.platform === 'win32') {
				// Windows: Use PowerShell with proper call operator syntax
				let commandString;

				if (command.command.includes(' ')) {
					// If the executable path has spaces, use PowerShell call operator syntax
					const quotedCommand = `"${command.command}"`;
					const quotedArgs = command.args.map(arg => {
						if (arg.includes(' ')) {
							return `"${arg}"`;
						}
						return arg;
					});
					commandString = `& ${quotedCommand} ${quotedArgs.join(' ')}`;
				} else {
					// If no spaces in executable path, use simple syntax
					const quotedArgs = command.args.map(arg => {
						if (arg.includes(' ')) {
							return `"${arg}"`;
						}
						return arg;
					});
					commandString = `${command.command} ${quotedArgs.join(' ')}`;
				}

				loggerInfo(this, `Command string for PowerShell: ${commandString}`);
				shellCommand = 'powershell.exe';
				shellArgs = ['-Command', commandString];
			} else {
				// macOS/Linux: Use bash with proper quoting
				const quotedCommand = command.command.includes(' ') ? `"${command.command}"` : command.command;
				const quotedArgs = command.args.map(arg => {
					if (arg.includes(' ')) {
						return `"${arg}"`;
					}
					return arg;
				});

				const commandString = `${quotedCommand} ${quotedArgs.join(' ')}`;
				loggerInfo(this, `Command string for bash: ${commandString}`);
				shellCommand = '/bin/bash';
				shellArgs = ['-c', commandString];
			}

			const childProcess = spawn(shellCommand, shellArgs, {
				cwd: command.workingDirectory,
				stdio: ['pipe', 'pipe', 'pipe']
			});
			let stdout = '';
			let stderr = '';
			childProcess.stdout.on('data', (data: any) => {
				stdout += data.toString();
			});

			childProcess.stderr.on('data', (data: any) => {
				stderr += data.toString();
			});

			childProcess.on('close', (code: any) => {
				const result: BackupResult = {
					success: code === 0,
					stdout,
					stderr,
					exitCode: code || 0
				};

				if (code === 0) {
					loggerDebug(this, `Command completed successfully`);
					resolve(result);
				} else {
					result.error = `rdiff-backup exited with code ${code}`;
					loggerWarn(this, `Command failed with exit code ${code}: ${stderr}`);
					resolve(result); // Don't reject, let caller handle the error
				}
			});

			childProcess.on('error', (error: any) => {
				loggerError(this, `Process error: ${error.message}`);
				resolve({
					success: false,
					stdout,
					stderr,
					exitCode: -1,
					error: error.message
				});
			});
		});
	}
	private async parseBackupStatistics(destinationPath: string): Promise<BackupStatistics | undefined> {
		try {
			const statsDir = path.join(destinationPath, 'rdiff-backup-data');
			const files = await fs.readdir(statsDir);

			// Find the latest session_statistics file
			const sessionFiles = files
				.filter((f: any) => f.startsWith('session_statistics.') && f.endsWith('.data'))
				.sort()
				.reverse();

			if (sessionFiles.length === 0) {
				loggerWarn(this, 'No session statistics found');
				return undefined;
			}

			const latestStatsFile = path.join(statsDir, sessionFiles[0]);
			const content = await fs.readFile(latestStatsFile, 'utf-8');

			return this.parseStatisticsContent(content);
		} catch (error) {
			loggerWarn(this, `Failed to parse backup statistics: ${error}`);
			return undefined;
		}
	}

	private parseStatisticsContent(content: string): BackupStatistics {
		const stats: Partial<BackupStatistics> = {};

		// Parse key metrics from session statistics
		const lines = content.split('\n');
		for (const line of lines) {
			if (line.includes('ChangedFiles')) {
				const match = line.match(/(\d+)/);
				if (match) stats.changedFiles = parseInt(match[1]);
			} else if (line.includes('ChangedSourceSize')) {
				const match = line.match(/\((\d+\.?\d*)/);
				if (match) stats.changedSourceSize = parseFloat(match[1]);
			} else if (line.includes('IncrementFileSize')) {
				const match = line.match(/\((\d+\.?\d*)/);
				if (match) stats.incrementFileSize = parseFloat(match[1]);
			} else if (line.includes('TotalDestinationSizeChange')) {
				const match = line.match(/\((\d+\.?\d*)/);
				if (match) stats.totalDestinationSizeChange = parseFloat(match[1]);
			} else if (line.includes('ElapsedTime')) {
				const match = line.match(/(\d+\.?\d*)/);
				if (match) stats.elapsedTime = parseFloat(match[1]);
			}
		}

		// Calculate derived metrics
		if (stats.incrementFileSize && stats.changedSourceSize) {
			stats.compressionRatio = (stats.incrementFileSize / stats.changedSourceSize) * 100;
			stats.spaceSavings = (1 - (stats.incrementFileSize / stats.changedSourceSize)) * 100;
		}

		return stats as BackupStatistics;
	}
	private parseIncrements(output: string): BackupIncrement[] {
		const increments: BackupIncrement[] = [];
		const lines = output.trim().split('\n');

		for (const line of lines) {
			if (line.trim() === '' || line.includes('Found') || line.includes('Current mirror')) continue;

			// Parse rdiff-backup increment output format (API v201)
			// Format: "    increments.2025-06-13T12-25-58+10-00.dir   Fri Jun 13 12:25:58 2025"
			const match = line.match(/increments\.(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}[+-]\d{2}-\d{2})\.dir/);
			if (match) {
				// Convert the timestamp format from 2025-06-13T12-25-58+10-00 to 2025-06-13T12:25:58+10:00
				const timestamp = match[1].replace(/-(\d{2})-(\d{2})\+(\d{2})-(\d{2})$/, ':$1:$2+$3:$4');
				
				increments.push({
					timestamp: timestamp,
					size: 0, // Would need additional parsing for size
					isSnapshot: line.includes('snapshot'),
					description: line.trim()
				});
			}
		}

		return increments;
	}

	/**
	 * Verify if a backup was actually successful by checking for rdiff-backup-data directory
	 */
	private async verifyBackupSuccess(destinationPath: string): Promise<boolean> {
		try {
			const rdiffDataPath = path.join(destinationPath, 'rdiff-backup-data');
			await fs.access(rdiffDataPath);
			loggerDebug(this, `Backup verification successful: rdiff-backup-data exists at ${rdiffDataPath}`);
			return true;
		} catch (error) {
			loggerDebug(this, `Backup verification failed: rdiff-backup-data not found at ${destinationPath}`);
			return false;
		}
	}
}
