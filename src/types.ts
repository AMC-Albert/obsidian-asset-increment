import type { Plugin } from 'obsidian';

export interface AssetIncrementSettings {
	rdiffExecutablePath: string;
	backupDirectory: string;
	monitoredExtensions: string[];
	autoBackupOnSave: boolean;
	showEfficiencyNotifications: boolean;
	compressionWarningThreshold: number; // MB
	cleanupAfterDays: number;
	maxBackupSizeGB: number;
	verboseLogging: boolean;
	allowParallelOperations: boolean;
	customRdiffArgs: string;
}

export interface BackupOptions {
	apiVersion?: string;
	compression?: boolean;
	exclude?: string[];
	include?: string[];
	force?: boolean;
}

export interface RestoreOptions {
	at?: string; // ISO date string or increment identifier
	force?: boolean;
}

export interface BackupResult {
	success: boolean;
	stdout: string;
	stderr: string;
	exitCode: number;
	error?: string;
	statistics?: BackupStatistics;
	versionInfo?: any; // Will be BackupVersionInfo from backup-versioning-service
}

export interface BackupStatistics {
	changedFiles: number;
	changedSourceSize: number;
	incrementFileSize: number;
	totalDestinationSizeChange: number;
	elapsedTime: number;
	compressionRatio?: number;
	spaceSavings?: number;
}

export interface BackupIncrement {
	timestamp: string;
	size: number;
	isSnapshot: boolean;
	description?: string;
}

export interface AssetInfo {
	path: string;
	originalSize: number;
	backupLocation: string;
	lastBackup?: Date;
	incrementCount: number;
	totalBackupSize: number;
	compressionRatio: number;
}

export interface RdiffCommand {
	command: string;
	args: string[];
	workingDirectory?: string;
}

export const DEFAULT_SETTINGS: AssetIncrementSettings = {
	rdiffExecutablePath: 'rdiff-backup',
	backupDirectory: '.asset-backups',
	monitoredExtensions: ['blend', 'blend1', 'blend2'],
	autoBackupOnSave: false,
	showEfficiencyNotifications: true,
	compressionWarningThreshold: 50, // MB
	cleanupAfterDays: 30,
	maxBackupSizeGB: 10,
	verboseLogging: false,
	allowParallelOperations: false,
	customRdiffArgs: ''
};

export const SUPPORTED_ASSET_EXTENSIONS = [
	'.blend', '.psd', '.ai', '.sketch', '.fig',
	'.mp4', '.mov', '.avi', '.mkv',
	'.wav', '.mp3', '.flac', '.aac',
	'.zip', '.rar', '.7z', '.tar.gz',
	'.exe', '.dmg', '.app',
	'.pdf', '.docx', '.xlsx', '.pptx'
];
