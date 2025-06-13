import type { Plugin } from 'obsidian';

export enum LogLevel {
	DEBUG = 'DEBUG',
	INFO = 'INFO',
	WARN = 'WARN',
	ERROR = 'ERROR',
	NONE = 'NONE' // No logging
}

export interface AssetIncrementSettings {
	backupFrequency: number;
	maxBackupAgeDays: number;
	resticPath: string;
	showBackupNotifications: boolean;
	autoBackupOnSave: boolean;
	autoBackupIntervalMinutes: number;
	storeBackupsAdjacent: boolean;
	logLevel: LogLevel; // Keep LogLevel
	backupFileExtensions: string[];
	excludePatterns: string[];
	useGlobalBackupDir: boolean;
	globalBackupDir: string;
	showEfficiencyNotifications: boolean;
	preventDuplicateBackups: boolean;
	minBackupIntervalSeconds: number;
}

export interface BackupOptions {
	apiVersion?: string;
	compression?: boolean;
	exclude?: string[];
	include?: string[];
	force?: boolean;
	tag?: string;
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
	sourceFiles?: number;
	sourceSize?: number;
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

export interface ResticCommand {
	command: string;
	args: string[];
	workingDirectory?: string;
	env?: Record<string, string>;
}

export const DEFAULT_SETTINGS: AssetIncrementSettings = {
	backupFrequency: 24 * 60 * 60 * 1000, // Default to 1 day
	maxBackupAgeDays: 30,
	resticPath: 'restic', // Default path, user should configure if not in PATH
	showBackupNotifications: true,
	autoBackupOnSave: true,
	autoBackupIntervalMinutes: 5,
	storeBackupsAdjacent: true,
	logLevel: LogLevel.INFO, // Keep LogLevel
	backupFileExtensions: ['.blend', '.psd', '.kra', '.xcf', '.pdf', '.ai', '.svg', '.indd', '.afphoto', '.afdesign', '.afpub'],
	excludePatterns: [],
	useGlobalBackupDir: false,
	globalBackupDir: '',
	showEfficiencyNotifications: true,
	preventDuplicateBackups: true,
	minBackupIntervalSeconds: 60,
};

export const SUPPORTED_ASSET_EXTENSIONS = [
	'.blend', '.psd', '.ai', '.sketch', '.fig',
	'.mp4', '.mov', '.avi', '.mkv',
	'.wav', '.mp3', '.flac', '.aac',
	'.zip', '.rar', '.7z', '.tar.gz',
	'.exe', '.dmg', '.app',
	'.pdf', '.docx', '.xlsx', '.pptx'
];
