/**
 * Asset versioning service
 * 
 * Handles creation, management, and tracking of asset versions with 3-digit numbering.
 * Provides utilities for version increment, rollback, and version-aware file operations.
 */

import { TFile } from 'obsidian';
import { IFileService } from './interfaces';
import { 
	loggerDebug, 
	loggerInfo, 
	loggerWarn, 
	loggerError,
	registerLoggerClass 
} from '../utils/obsidian-logger';

export interface AssetVersion {
	version: string;          // e.g., "001", "002", "003"
	originalPath: string;     // Original file path
	versionedPath: string;    // Path with version number
	timestamp: Date;          // When this version was created
	size: number;            // File size in bytes
	description?: string;     // Optional description of changes
	isActive: boolean;       // Whether this is the current active version
}

export interface VersionedAsset {
	baseName: string;        // File name without version (e.g., "model.blend")
	basePath: string;        // Directory path
	currentVersion: string;  // Current active version (e.g., "003")
	versions: AssetVersion[]; // All versions of this asset
	nextVersion: string;     // Next version number (e.g., "004")
}

export interface VersioningOptions {
	versionDigits?: number;  // Number of digits for version (default: 3)
	versionSeparator?: string; // Separator before version (default: "_v")
	preserveOriginal?: boolean; // Keep original file without version suffix
	autoIncrement?: boolean; // Automatically increment on backup
}

export class AssetVersioningService {
	private fileService: IFileService;
	private versioningOptions: Required<VersioningOptions>;

	constructor(fileService: IFileService, options: VersioningOptions = {}) {
		this.fileService = fileService;
		this.versioningOptions = {
			versionDigits: options.versionDigits || 3,
			versionSeparator: options.versionSeparator || '_v',
			preserveOriginal: options.preserveOriginal !== false, // default true
			autoIncrement: options.autoIncrement !== false, // default true
		};
		
		registerLoggerClass(this, 'VersioningService');
		loggerDebug(this, 'AssetVersioningService initialized', { options: this.versioningOptions });
	}

	/**
	 * Parse a file path to determine if it's versioned and extract version info
	 */
	parseVersionedPath(filePath: string): {
		isVersioned: boolean;
		baseName: string;
		version?: string;
		extension: string;
		basePath: string;
	} {
		const fileName = filePath.split(/[/\\]/).pop() || '';
		const lastDotIndex = fileName.lastIndexOf('.');
		const extension = lastDotIndex !== -1 ? fileName.substring(lastDotIndex) : '';
		const nameWithoutExt = lastDotIndex !== -1 ? fileName.substring(0, lastDotIndex) : fileName;
		const basePath = filePath.substring(0, filePath.length - fileName.length);

		// Check for version pattern: filename_vXXX.ext
		const versionPattern = new RegExp(`(.+)${this.versioningOptions.versionSeparator}(\\d{${this.versioningOptions.versionDigits}})$`);
		const match = nameWithoutExt.match(versionPattern);

		if (match) {
			return {
				isVersioned: true,
				baseName: match[1] + extension,
				version: match[2],
				extension,
				basePath
			};
		}

		return {
			isVersioned: false,
			baseName: fileName,
			extension,
			basePath
		};
	}

	/**
	 * Generate a versioned file path
	 */
	generateVersionedPath(originalPath: string, version: string): string {
		const parsed = this.parseVersionedPath(originalPath);
		const nameWithoutExt = parsed.baseName.replace(parsed.extension, '');
		
		// Ensure version is properly padded
		const paddedVersion = version.padStart(this.versioningOptions.versionDigits, '0');
		
		const versionedName = `${nameWithoutExt}${this.versioningOptions.versionSeparator}${paddedVersion}${parsed.extension}`;
		return parsed.basePath + versionedName;
	}

	/**
	 * Get the next version number for an asset
	 */
	async getNextVersion(filePath: string): Promise<string> {
		const versioned = await this.getVersionedAsset(filePath);
		
		if (versioned) {
			const currentVersionNum = parseInt(versioned.currentVersion, 10);
			const nextVersionNum = currentVersionNum + 1;
			return nextVersionNum.toString().padStart(this.versioningOptions.versionDigits, '0');
		}
		
		// First version
		return '1'.padStart(this.versioningOptions.versionDigits, '0');
	}

	/**
	 * Get all versions of an asset
	 */
	async getVersionedAsset(filePath: string): Promise<VersionedAsset | null> {
		try {
			const parsed = this.parseVersionedPath(filePath);
			const baseName = parsed.baseName;
			const basePath = parsed.basePath;
			
			loggerDebug(this, `Getting versioned asset info for: ${filePath}`, { parsed });

			// Find all files in the directory that match the base name pattern
			const files = await this.fileService.readDirectory(basePath || '.');
			const versionPattern = new RegExp(
				`^${this.escapeRegex(baseName.replace(parsed.extension, ''))}${this.versioningOptions.versionSeparator}(\\d{${this.versioningOptions.versionDigits}})\\${parsed.extension}$`
			);

			const versions: AssetVersion[] = [];
			let currentVersion = '000';

			for (const file of files) {
				const match = file.match(versionPattern);
				if (match) {
					const version = match[1];
					const versionedPath = basePath + file;
					
					try {
						const stats = await this.fileService.getStats(versionedPath);
						versions.push({
							version,
							originalPath: filePath,
							versionedPath,
							timestamp: stats.lastModified,
							size: stats.size,
							isActive: false // Will be set below
						});
						
						// Track the highest version number
						if (parseInt(version, 10) > parseInt(currentVersion, 10)) {
							currentVersion = version;
						}
					} catch (error) {
						loggerWarn(this, `Could not read stats for version: ${versionedPath}`, { error });
					}
				}
			}

			// Check for original file without version
			if (this.versioningOptions.preserveOriginal) {
				const originalExists = await this.fileService.exists(filePath);
				if (originalExists) {
					const stats = await this.fileService.getStats(filePath);
					versions.push({
						version: '000', // Original file is version 000
						originalPath: filePath,
						versionedPath: filePath,
						timestamp: stats.lastModified,
						size: stats.size,
						isActive: true
					});
				}
			}

			if (versions.length === 0) {
				return null;
			}

			// Sort versions by version number
			versions.sort((a, b) => parseInt(a.version, 10) - parseInt(b.version, 10));

			// Mark the current version as active
			const activeVersion = versions.find(v => v.version === currentVersion);
			if (activeVersion) {
				activeVersion.isActive = true;
			}

			const nextVersionNum = parseInt(currentVersion, 10) + 1;
			const nextVersion = nextVersionNum.toString().padStart(this.versioningOptions.versionDigits, '0');

			const result: VersionedAsset = {
				baseName,
				basePath,
				currentVersion,
				versions,
				nextVersion
			};

			loggerDebug(this, `Found versioned asset`, { 
				baseName, 
				currentVersion, 
				nextVersion, 
				versionCount: versions.length 
			});

			return result;
		} catch (error) {
			loggerError(this, `Failed to get versioned asset info: ${filePath}`, { error });
			return null;
		}
	}

	/**
	 * Create a new version of an asset
	 */
	async createNewVersion(originalPath: string, description?: string): Promise<AssetVersion | null> {
		try {
			loggerInfo(this, `Creating new version for: ${originalPath}`);

			const nextVersion = await this.getNextVersion(originalPath);
			const versionedPath = this.generateVersionedPath(originalPath, nextVersion);

			// Check if original file exists
			if (!(await this.fileService.exists(originalPath))) {
				loggerError(this, `Original file does not exist: ${originalPath}`);
				return null;
			}

			// For now, we'll just track the version info - actual file copying would need more implementation
			const stats = await this.fileService.getStats(originalPath);
			
			const version: AssetVersion = {
				version: nextVersion,
				originalPath,
				versionedPath,
				timestamp: new Date(),
				size: stats.size,
				description,
				isActive: true
			};

			loggerInfo(this, `Created new version: ${nextVersion} for ${originalPath}`);
			return version;
		} catch (error) {
			loggerError(this, `Failed to create new version: ${originalPath}`, { error });
			return null;
		}
	}

	/**
	 * Get version information for display
	 */
	formatVersionInfo(version: AssetVersion): string {
		const sizeStr = this.fileService.formatFileSize(version.size);
		const dateStr = version.timestamp.toLocaleDateString();
		const activeStr = version.isActive ? ' (Active)' : '';
		const descStr = version.description ? ` - ${version.description}` : '';
		
		return `v${version.version}${activeStr} • ${sizeStr} • ${dateStr}${descStr}`;
	}

	/**
	 * List all versions of an asset in a formatted way
	 */
	async listVersions(filePath: string): Promise<string[]> {
		const versioned = await this.getVersionedAsset(filePath);
		if (!versioned) {
			return [`No versions found for: ${filePath}`];
		}

		const versionList = versioned.versions.map(version => 
			this.formatVersionInfo(version)
		);

		versionList.unshift(`Asset: ${versioned.baseName}`);
		versionList.unshift(`Current Version: v${versioned.currentVersion}`);
		versionList.unshift(`Next Version: v${versioned.nextVersion}`);
		versionList.push(''); // Empty line

		return versionList;
	}

	/**
	 * Check if a file appears to be an asset that should be versioned
	 */
	isVersionableAsset(filePath: string): boolean {
		const supportedExtensions = [
			'.blend', '.blend1', '.blend2',
			'.psd', '.ai', '.sketch', '.fig',
			'.mp4', '.mov', '.avi', '.mkv',
			'.wav', '.mp3', '.flac', '.aac',
			'.zip', '.rar', '.7z', '.tar.gz',
			'.exe', '.dmg', '.app',
			'.pdf', '.docx', '.xlsx', '.pptx'
		];

		const extension = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
		return supportedExtensions.includes(extension);
	}

	/**
	 * Utility to escape regex special characters
	 */
	private escapeRegex(str: string): string {
		return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}
}
