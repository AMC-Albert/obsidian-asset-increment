import { Plugin, TFile, Notice, FileSystemAdapter } from 'obsidian';
import { ServiceRegistry, IAssetService, ISettingsService, AssetIncrementSettingTab } from './services';
import { AssetIncrementSettings } from './types';
import { 
	loggerDebug, 
	loggerInfo, 
	loggerWarn, 
	loggerError,
	registerLoggerClass,
	initLogger,
	initializeDebugSystem
} from './utils/obsidian-logger';

// Use require for Node.js modules in Obsidian
const path = require('path');

export default class AssetIncrementPluginImpl extends Plugin {
	private serviceRegistry!: ServiceRegistry;
	private assetService!: IAssetService;
	private settingsService!: ISettingsService;
	settings!: AssetIncrementSettings;

	async onload(): Promise<void> {
		// Initialize logging
		initLogger(this);
		registerLoggerClass(this, 'AssetIncrementPlugin');
		
		// Enable debug logging automatically for development
		initializeDebugSystem();
		
		// Get the debug API and enable debug logging
		if (window.DEBUG && window.DEBUG[this.manifest.id]) {
			window.DEBUG[this.manifest.id].enable('debug');
			console.log(`Debug logging enabled for ${this.manifest.id}`);
		}

		loggerInfo(this, 'Loading Asset Increment Plugin with service-based architecture');
		try {
			// Initialize service registry
			const pluginDir = this.getPluginDirectory();
			loggerDebug(this, `Plugin directory: ${pluginDir}`);
			
			this.serviceRegistry = new ServiceRegistry(this, pluginDir);
			loggerDebug(this, 'ServiceRegistry created, initializing...');
			
			await this.serviceRegistry.initialize();
			loggerDebug(this, 'ServiceRegistry initialized');

			// Get service references
			this.settingsService = this.serviceRegistry.getSettingsService();
			loggerDebug(this, 'SettingsService obtained');
			
			this.assetService = this.serviceRegistry.getAssetService();
			loggerDebug(this, 'AssetService obtained');
			
			this.settings = this.settingsService.getSettings();
			loggerDebug(this, 'Settings loaded');			// Register commands
			this.registerCommands();
			loggerDebug(this, 'Commands registered');

			// Register file event handlers
			this.registerEventHandlers();
			loggerDebug(this, 'Event handlers registered');

			// Register settings tab
			this.addSettingTab(new AssetIncrementSettingTab(
				this.app, 
				this, 
				this.settingsService, 
				this.assetService
			));
			loggerDebug(this, 'Settings tab registered');

			// Test if backup system is ready
			loggerDebug(this, 'Testing backup system readiness...');
			const isReady = await this.serviceRegistry.isReady();
			if (isReady) {
				loggerInfo(this, 'Asset Increment Plugin loaded successfully - backup system ready');
			} else {
				loggerWarn(this, 'Asset Increment Plugin loaded but backup system is not ready');
			}

			this.app.workspace.onLayoutReady(async () => {
				initializeDebugSystem();
			});
		} catch (error) {
			loggerError(this, 'Failed to load Asset Increment Plugin', { error });
			console.error('Asset Increment Plugin detailed error:', error);
			new Notice(`Failed to load Asset Increment Plugin: ${error instanceof Error ? error.message : 'Unknown error'}`);
		}
	}

	async onunload(): Promise<void> {
		loggerInfo(this, 'Unloading Asset Increment Plugin');
		
		if (this.serviceRegistry) {
			await this.serviceRegistry.cleanup();
		}
	}

	async saveSettings(): Promise<void> {
		if (this.settingsService) {
			await this.settingsService.saveSettings(this.settings);
		}
	}
	/**
	 * Get the plugin directory path
	 */
	private getPluginDirectory(): string {
		try {
			const adapter = this.app.vault.adapter;
			if (adapter instanceof FileSystemAdapter) {
				const vaultPath = adapter.getBasePath();
				const pluginDir = path.join(vaultPath, '.obsidian', 'plugins', this.manifest.id);
				loggerDebug(this, `Plugin directory: ${pluginDir}`);
				return pluginDir;
			} else {
				// Fallback for non-filesystem adapters
				const fallbackDir = path.join('.obsidian', 'plugins', this.manifest.id);
				loggerWarn(this, `Using fallback plugin directory: ${fallbackDir}`);
				return fallbackDir;
			}
		} catch (error) {
			loggerError(this, 'Failed to get plugin directory', { error });
			// Return a safe fallback
			const fallbackDir = path.join('.obsidian', 'plugins', this.manifest.id);
			loggerWarn(this, `Using error fallback plugin directory: ${fallbackDir}`);
			return fallbackDir;
		}
	}

	/**
	 * Check if a file is a supported asset type
	 */
	private isSupportedAsset(file: TFile): boolean {
		const settings = this.settingsService?.getSettings();
		if (!settings) return false;
		
		const extension = file.extension.toLowerCase();
		return settings.monitoredExtensions.some(ext => 
			ext.toLowerCase() === extension || ext.toLowerCase() === `.${extension}`
		);
	}
	private registerCommands(): void {
		// Backup selected asset
		this.addCommand({
			id: 'backup-current-asset',
			name: 'Backup current asset file',
			callback: async () => {
				const file = this.app.workspace.getActiveFile();
				if (!file) {
					new Notice('No file selected');
					return;
				}

				if (!this.isSupportedAsset(file)) {
					new Notice('Current file is not a supported asset type');
					return;
				}

				try {
					new Notice('Starting backup...');
					const result = await this.assetService.backupAsset(file);
					
					if (result.success) {
						const message = this.settings.showEfficiencyNotifications && result.statistics 
							? `Backup successful! Delta size: ${this.formatBytes(result.statistics.incrementFileSize)}`
							: 'Backup completed successfully';
						new Notice(message);
					} else {
						new Notice(`Backup failed: ${result.error || 'Unknown error'}`);
					}
				} catch (error) {
					new Notice(`Backup error: ${error instanceof Error ? error.message : 'Unknown error'}`);
				}
			}
		});

		// Restore asset
		this.addCommand({
			id: 'restore-asset',
			name: 'Restore asset from backup',
			callback: async () => {
				const file = this.app.workspace.getActiveFile();
				if (!file) {
					new Notice('No file selected');
					return;
				}

				if (!this.isSupportedAsset(file)) {
					new Notice('Current file is not a supported asset type');
					return;
				}

				try {
					new Notice('Starting restore...');
					const result = await this.assetService.restoreAsset(file);
					
					if (result.success) {
						new Notice('Restore completed successfully');
					} else {
						new Notice(`Restore failed: ${result.error || 'Unknown error'}`);
					}
				} catch (error) {
					new Notice(`Restore error: ${error instanceof Error ? error.message : 'Unknown error'}`);
				}
			}
		});

		// List asset history
		this.addCommand({
			id: 'list-asset-history',
			name: 'Show asset backup history',
			callback: async () => {
				const file = this.app.workspace.getActiveFile();
				if (!file) {
					new Notice('No file selected');
					return;
				}

				if (!this.isSupportedAsset(file)) {
					new Notice('Current file is not a supported asset type');
					return;
				}

				try {
					const backupInfo = await this.assetService.getAssetBackupInfo(file);
					
					if (backupInfo.hasBackup && backupInfo.increments) {
						const message = `Asset has ${backupInfo.increments.length} backup(s):\n` +
							backupInfo.increments.slice(0, 5).map((increment: string) => 
								`• ${increment}`
							).join('\n') +
							(backupInfo.increments.length > 5 ? '\n... and more' : '');
						new Notice(message, 8000);
					} else {
						new Notice('No backups found for this asset');
					}
				} catch (error) {
					new Notice(`Failed to get history: ${error instanceof Error ? error.message : 'Unknown error'}`);
				}
			}
		});

		// Test rdiff-backup
		this.addCommand({
			id: 'test-rdiff-backup',
			name: 'Test rdiff-backup installation',
			callback: async () => {
				try {
					const isReady = await this.assetService.testBackupSystem();
					if (isReady) {
						new Notice(`✅ rdiff-backup is working!`);
					} else {
						new Notice(`❌ rdiff-backup test failed`);
					}
				} catch (error) {
					new Notice(`❌ Test failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
				}
			}
		});

		// Show service diagnostics
		this.addCommand({
			id: 'show-diagnostics',
			name: 'Show service diagnostics',
			callback: async () => {
				try {
					const diagnostics = await this.serviceRegistry.getDiagnostics();
					const message = `Service Diagnostics:\n` +
						`• Initialized: ${diagnostics.initialized}\n` +
						`• Services: ${diagnostics.services.join(', ')}\n` +
						`• Backup Available: ${diagnostics.backupAvailable}`;
					new Notice(message, 8000);
				} catch (error) {
					new Notice(`Failed to get diagnostics: ${error instanceof Error ? error.message : 'Unknown error'}`);
				}
			}
		});
	}
	private registerEventHandlers(): void {
		if (this.settings.autoBackupOnSave) {
			// Listen for file modifications
			this.registerEvent(
				this.app.vault.on('modify', async (file: TFile) => {
					if (this.isSupportedAsset(file)) {
						try {
							loggerDebug(this, `Auto-backup triggered for: ${file.path}`);
							await this.assetService.backupAsset(file);
						} catch (error) {
							loggerError(this, 'Auto-backup failed', { file: file.path, error });
						}
					}
				})
			);
		}
	}

	private formatBytes(bytes: number): string {
		if (bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
	}
}
