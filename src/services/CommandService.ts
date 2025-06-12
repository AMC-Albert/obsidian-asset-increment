/**
 * Cross-platform command execution service
 * 
 * Handles platform-specific command execution with proper path quoting
 * and shell selection.
 */

import { spawn } from 'child_process';
import { ICommandService, CommandOptions, CommandResult } from './interfaces';
import { 
	loggerDebug, 
	loggerInfo, 
	loggerWarn, 
	loggerError,
	registerLoggerClass
} from '../utils/obsidian-logger';

export class CommandService implements ICommandService {
	constructor() {
		registerLoggerClass(this, 'CommandService');
	}

	/**
	 * Execute a command with arguments
	 */
	async execute(command: string, args: string[], options: CommandOptions = {}): Promise<CommandResult> {
		return new Promise((resolve) => {
			const fullCommand = `${command} ${args.join(' ')}`;
			loggerInfo(this, `Executing command: ${fullCommand}`);

			// Platform-specific command execution
			let shellCommand: string;
			let shellArgs: string[];

			if (globalThis.process.platform === 'win32') {
				// Windows: Use PowerShell with proper call operator syntax
				const commandString = this.buildWindowsCommand(command, args);
				loggerDebug(this, `PowerShell command: ${commandString}`);
				shellCommand = 'powershell.exe';
				shellArgs = ['-Command', commandString];
			} else {
				// macOS/Linux: Use bash with proper quoting
				const commandString = this.buildUnixCommand(command, args);
				loggerDebug(this, `Bash command: ${commandString}`);
				shellCommand = '/bin/bash';
				shellArgs = ['-c', commandString];
			}

			const childProcess = spawn(shellCommand, shellArgs, {
				cwd: options.workingDirectory,
				stdio: ['pipe', 'pipe', 'pipe']
			});

			let stdout = '';
			let stderr = '';

			childProcess.stdout.on('data', (data) => {
				stdout += data.toString();
			});

			childProcess.stderr.on('data', (data) => {
				stderr += data.toString();
			});

			// Handle timeout if specified
			let timeoutId: NodeJS.Timeout | undefined;
			if (options.timeout) {
				timeoutId = setTimeout(() => {
					childProcess.kill();
					resolve({
						success: false,
						stdout,
						stderr: 'Command timed out',
						exitCode: -1,
						error: 'Command timed out'
					});
				}, options.timeout);
			}

			childProcess.on('close', (code) => {
				if (timeoutId) {
					clearTimeout(timeoutId);
				}

				const result: CommandResult = {
					success: code === 0,
					stdout,
					stderr,
					exitCode: code || 0
				};

				if (code === 0) {
					loggerDebug(this, `Command completed successfully`);
				} else {
					result.error = `Command exited with code ${code}`;
					loggerWarn(this, `Command failed with exit code ${code}: ${stderr}`);
				}

				resolve(result);
			});

			childProcess.on('error', (error) => {
				if (timeoutId) {
					clearTimeout(timeoutId);
				}

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

	/**
	 * Check if an executable exists and is working
	 */
	async testExecutable(executablePath: string, testArgs: string[] = ['--version']): Promise<boolean> {
		try {
			loggerDebug(this, `Testing executable: ${executablePath}`);
			
			const result = await this.execute(executablePath, testArgs);
			const isWorking = result.success && result.stdout.length > 0;
			
			loggerDebug(this, `Executable test result: ${isWorking}`);
			return isWorking;
		} catch (error) {
			loggerDebug(this, `Executable test failed: ${error}`);
			return false;
		}
	}

	/**
	 * Build Windows PowerShell command string
	 */
	private buildWindowsCommand(command: string, args: string[]): string {
		if (command.includes(' ')) {
			// Use PowerShell call operator for paths with spaces
			const quotedCommand = `"${command}"`;
			const quotedArgs = args.map(arg => this.quoteIfNeeded(arg));
			return `& ${quotedCommand} ${quotedArgs.join(' ')}`;
		} else {
			// Simple syntax for paths without spaces
			const quotedArgs = args.map(arg => this.quoteIfNeeded(arg));
			return `${command} ${quotedArgs.join(' ')}`;
		}
	}

	/**
	 * Build Unix bash command string
	 */
	private buildUnixCommand(command: string, args: string[]): string {
		const quotedCommand = this.quoteIfNeeded(command);
		const quotedArgs = args.map(arg => this.quoteIfNeeded(arg));
		return `${quotedCommand} ${quotedArgs.join(' ')}`;
	}

	/**
	 * Quote argument if it contains spaces
	 */
	private quoteIfNeeded(arg: string): string {
		return arg.includes(' ') ? `"${arg}"` : arg;
	}
}
