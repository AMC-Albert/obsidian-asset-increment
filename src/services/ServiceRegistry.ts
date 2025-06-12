/**
 * Service registry for dependency injection and service management
 * 
 * Provides centralized service management with proper dependency injection,
 * initialization order, and lifecycle management.
 */

import { Plugin } from 'obsidian';
import { 
	IAssetService, 
	IBackupService, 
	IFileService, 
	ICommandService, 
	ISettingsService 
} from './interfaces';
import { DefaultFileService } from './DefaultFileService';
import { RdiffBackupService } from './RdiffBackupService';
import { DefaultAssetService } from './DefaultAssetService';
import { PluginSettingsService } from './PluginSettingsService';
import { CommandService } from './CommandService';
import { 
	loggerDebug, 
	loggerInfo, 
	loggerWarn, 
	loggerError,
	registerLoggerClass 
} from '../utils/obsidian-logger';

export class ServiceRegistry {
	private plugin: Plugin;
	private pluginDir: string;
	private services: Map<string, any> = new Map();
	private initialized = false;

	constructor(plugin: Plugin, pluginDir: string) {
		this.plugin = plugin;
		this.pluginDir = pluginDir;
		
		registerLoggerClass(this, 'ServiceRegistry');
		loggerDebug(this, 'ServiceRegistry created', { pluginDir });
	}

	/**
	 * Initialize all services in the correct dependency order
	 */
	async initialize(): Promise<void> {
		try {
			loggerInfo(this, 'Initializing service registry...');

			// Create services in dependency order
			await this.createServices();
			
			// Initialize services that require async initialization
			await this.initializeServices();
			
			this.initialized = true;
			loggerInfo(this, 'Service registry initialized successfully');
		} catch (error) {
			loggerError(this, 'Failed to initialize service registry', { error });
			throw error;
		}
	}

	/**
	 * Create all service instances
	 */
	private async createServices(): Promise<void> {
		loggerDebug(this, 'Creating service instances...');

		// 1. Settings service (no dependencies)
		const settingsService = new PluginSettingsService(this.plugin);
		this.services.set('settings', settingsService);
		
		// Load settings early so other services can use them
		await settingsService.loadSettings();
		loggerDebug(this, 'Settings service created and loaded');
		// 2. Command service (no dependencies)
		const commandService = new CommandService();
		this.services.set('command', commandService);
		loggerDebug(this, 'Command service created');
		// 3. File service (needs app context)
		const fileService = new DefaultFileService(this.plugin.app);
		this.services.set('file', fileService);
		loggerDebug(this, 'File service created');

		// 4. Backup service (depends on file and command services)
		const settings = settingsService.getSettings();
		const backupService = new RdiffBackupService(
			fileService,
			commandService,
			this.pluginDir,
			settings.rdiffExecutablePath
		);
		this.services.set('backup', backupService);
		loggerDebug(this, 'Backup service created');

		// 5. Asset service (depends on backup, file, and settings services)
		const assetService = new DefaultAssetService(
			backupService,
			fileService,
			settingsService
		);
		this.services.set('asset', assetService);
		loggerDebug(this, 'Asset service created');

		loggerInfo(this, 'All service instances created');
	}	/**
	 * Initialize services that require async initialization
	 */
	private async initializeServices(): Promise<void> {
		loggerDebug(this, 'Initializing services...');

		try {
			// Initialize backup service
			loggerDebug(this, 'About to initialize backup service...');
			const backupService = this.getServiceInternal<IBackupService>('backup');
			if (backupService) {
				await backupService.initialize();
				loggerDebug(this, 'Backup service initialized');
			} else {
				loggerWarn(this, 'Backup service not found, skipping initialization');
			}

			// Initialize asset service
			loggerDebug(this, 'About to initialize asset service...');
			const assetService = this.getServiceInternal<IAssetService>('asset');
			if (assetService) {
				await assetService.initialize();
				loggerDebug(this, 'Asset service initialized');
			} else {
				loggerWarn(this, 'Asset service not found, skipping initialization');
			}

			loggerInfo(this, 'All services initialized');
		} catch (error) {
			loggerError(this, 'Failed to initialize services', { 
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
	 * Get a service by name with type safety
	 */
	getService<T>(name: string): T {
		if (!this.initialized && name !== 'settings') {
			throw new Error('Service registry not initialized. Call initialize() first.');
		}

		const service = this.services.get(name);
		if (!service) {
			throw new Error(`Service '${name}' not found`);
		}

		return service as T;
	}

	/**
	 * Internal method to get services during initialization (bypasses initialization check)
	 */
	private getServiceInternal<T>(name: string): T | undefined {
		const service = this.services.get(name);
		return service as T | undefined;
	}

	/**
	 * Convenience methods for getting specific services
	 */
	getSettingsService(): ISettingsService {
		return this.getService<ISettingsService>('settings');
	}

	getFileService(): IFileService {
		return this.getService<IFileService>('file');
	}

	getCommandService(): ICommandService {
		return this.getService<ICommandService>('command');
	}

	getBackupService(): IBackupService {
		return this.getService<IBackupService>('backup');
	}

	getAssetService(): IAssetService {
		return this.getService<IAssetService>('asset');
	}

	/**
	 * Check if all services are ready
	 */
	async isReady(): Promise<boolean> {
		try {
			if (!this.initialized) {
				return false;
			}

			// Test if backup service is available
			const backupService = this.getBackupService();
			const backupReady = await backupService.isAvailable();
			
			if (!backupReady) {
				loggerWarn(this, 'Backup service is not ready');
				return false;
			}

			loggerDebug(this, 'All services are ready');
			return true;
		} catch (error) {
			loggerError(this, 'Error checking service readiness', { error });
			return false;
		}
	}

	/**
	 * Cleanup resources
	 */
	async cleanup(): Promise<void> {
		loggerInfo(this, 'Cleaning up services...');
		
		// Services don't currently need cleanup, but this provides
		// a hook for future implementations that might need it
		
		this.services.clear();
		this.initialized = false;
		
		loggerInfo(this, 'Service cleanup completed');
	}

	/**
	 * Reload settings and reinitialize services that depend on them
	 */
	async reloadSettings(): Promise<void> {
		try {
			loggerInfo(this, 'Reloading settings...');
			
			const settingsService = this.getSettingsService();
			await settingsService.loadSettings();
			
			// For now, we don't need to reinitialize other services
			// In the future, we might need to recreate services that depend on settings
			
			loggerInfo(this, 'Settings reloaded successfully');
		} catch (error) {
			loggerError(this, 'Failed to reload settings', { error });
			throw error;
		}
	}

	/**
	 * Get diagnostic information about services
	 */
	async getDiagnostics(): Promise<{
		initialized: boolean;
		serviceCount: number;
		services: string[];
		backupAvailable: boolean;
	}> {
		const diagnostics = {
			initialized: this.initialized,
			serviceCount: this.services.size,
			services: Array.from(this.services.keys()),
			backupAvailable: false
		};

		if (this.initialized) {
			try {
				const backupService = this.getBackupService();
				diagnostics.backupAvailable = await backupService.isAvailable();
			} catch (error) {
				loggerWarn(this, 'Could not check backup availability during diagnostics', { error });
			}
		}

		return diagnostics;
	}
}
