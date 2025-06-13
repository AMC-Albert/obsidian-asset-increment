/**
 * Service exports for the Asset Increment Plugin
 * 
 * This file provides clean imports for all services and interfaces.
 */

// Interfaces
export * from './interfaces';

// Services
export { DefaultFileService } from './DefaultFileService';
export { RdiffBackupService } from './RdiffBackupService';
export { DefaultAssetService } from './DefaultAssetService';
export { PluginSettingsService } from './PluginSettingsService';
export { CommandService } from './CommandService';
export { ServiceRegistry } from './ServiceRegistry';
export { AssetIncrementSettingTab } from './AssetIncrementSettingTab';
export { BackupIntegrityService } from './BackupIntegrityService';
export type { IBackupIntegrityService } from './BackupIntegrityService';

// Re-export DEFAULT_SETTINGS from types.ts for convenience
export { DEFAULT_SETTINGS } from '../types';

// Versioning services
export { BackupVersioningService } from './BackupVersioningService';
export type { 
	BackupVersionInfo,
	AssetBackupHistory 
} from './BackupVersioningService';
