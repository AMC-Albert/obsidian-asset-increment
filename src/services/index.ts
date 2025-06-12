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
export { PluginSettingsService, DEFAULT_SETTINGS } from './PluginSettingsService';
export { CommandService } from './CommandService';
export { ServiceRegistry } from './ServiceRegistry';
export { AssetIncrementSettingTab } from './AssetIncrementSettingTab';

// Versioning services
export { BackupVersioningService } from './BackupVersioningService';
export type { 
	BackupVersionInfo,
	AssetBackupHistory 
} from './BackupVersioningService';
