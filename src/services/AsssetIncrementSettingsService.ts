/**
 * Settings management service
 * 
 * Handles loading, saving, and managing plugin settings with proper error handling
 * and validation. Provides a clean interface for settings operations.
 */

import { Plugin } from 'obsidian';
import { ISettingsService } from './interfaces';
import { AssetIncrementSettings, DEFAULT_SETTINGS } from '../types';
import { 
	loggerDebug, 
	loggerInfo, 
	loggerWarn, 
	loggerError,
	registerLoggerClass 
} from '../utils/obsidian-logger';

export class AsssetIncrementSettingsService implements ISettingsService {
	private plugin: Plugin;
	private currentSettings: AssetIncrementSettings;

	constructor(plugin: Plugin) {
		this.plugin = plugin;
		this.currentSettings = { ...DEFAULT_SETTINGS };
		
		registerLoggerClass(this, 'AsssetIncrementSettingsService');
		loggerDebug(this, 'AsssetIncrementSettingsService initialized');
	}

	async loadSettings(): Promise<AssetIncrementSettings> {
		try {
			loggerDebug(this, 'Loading settings from storage...');
			
			const loadedData = await this.plugin.loadData();
			
			if (loadedData) {
				// Merge loaded settings with defaults to ensure all properties exist
				this.currentSettings = {
					...DEFAULT_SETTINGS,
					...loadedData
				};
				loggerInfo(this, 'Settings loaded successfully');
			} else {
				loggerInfo(this, 'No existing settings found, using defaults');
				this.currentSettings = { ...DEFAULT_SETTINGS };
			}
			
			// Validate settings
			this.validateSettings(this.currentSettings);			loggerDebug(this, 'Current settings', { 
				rdiffBackupPath: this.currentSettings.rdiffBackupPath,
				globalBackupDir: this.currentSettings.globalBackupDir,
				autoBackupOnSave: this.currentSettings.autoBackupOnSave,
				logLevel: this.currentSettings.logLevel
			});
			
			return this.currentSettings;
		} catch (error) {
			loggerError(this, 'Failed to load settings', { error });
			// Return defaults if loading fails
			this.currentSettings = { ...DEFAULT_SETTINGS };
			return this.currentSettings;
		}
	}

	async saveSettings(settings: AssetIncrementSettings): Promise<void> {
		try {
			loggerDebug(this, 'Saving settings to storage...');
			
			// Validate settings before saving
			this.validateSettings(settings);
			
			await this.plugin.saveData(settings);
			this.currentSettings = { ...settings };
			
			loggerInfo(this, 'Settings saved successfully');
		} catch (error) {
			loggerError(this, 'Failed to save settings', { error });
			throw error;
		}
	}

	getSettings(): AssetIncrementSettings {
		return { ...this.currentSettings };
	}

	async updateSettings(updates: Partial<AssetIncrementSettings>): Promise<void> {
		try {
			loggerDebug(this, 'Updating settings', { updates });
			
			const newSettings: AssetIncrementSettings = {
				...this.currentSettings,
				...updates
			};
			
			await this.saveSettings(newSettings);
			
			loggerInfo(this, 'Settings updated successfully');
		} catch (error) {
			loggerError(this, 'Failed to update settings', { error });
			throw error;
		}
	}
	/**
	 * Validate settings object to ensure all required properties are present and valid
	 */
	private validateSettings(settings: AssetIncrementSettings): void {
		const errors: string[] = [];

		// Validate required string properties
		if (!settings.rdiffBackupPath || typeof settings.rdiffBackupPath !== 'string') {
			errors.push('rdiffExecutablePath must be a non-empty string');
		}

		if (!settings.globalBackupDir || typeof settings.globalBackupDir !== 'string') {
			errors.push('backupDirectory must be a non-empty string');
		}



		if (typeof settings.maxBackupAgeDays !== 'number' || settings.maxBackupAgeDays < 0) {
			errors.push('cleanupAfterDays must be a non-negative number');
		}


		// Validate boolean properties
		if (typeof settings.autoBackupOnSave !== 'boolean') {
			errors.push('autoBackupOnSave must be a boolean');
		}

		if (typeof settings.showEfficiencyNotifications !== 'boolean') {
			errors.push('showEfficiencyNotifications must be a boolean');
		}


		if (typeof settings.storeBackupsAdjacent !== 'boolean') {
			errors.push('storeBackupsAdjacent must be a boolean');		}

		// Validate array properties
		if (!Array.isArray(settings.backupFileExtensions)) {
			errors.push('backupFileExtensions must be an array');
		} else if (settings.backupFileExtensions.some((ext: any) => typeof ext !== 'string')) {
			errors.push('all backupFileExtensions must be strings');
		}

		if (errors.length > 0) {
			const errorMessage = `Invalid settings: ${errors.join(', ')}`;
			loggerError(this, errorMessage);
			throw new Error(errorMessage);
		}

		loggerDebug(this, 'Settings validation passed');
	}

	/**
	 * Reset settings to defaults
	 */
	async resetToDefaults(): Promise<void> {
		loggerInfo(this, 'Resetting settings to defaults');
		await this.saveSettings({ ...DEFAULT_SETTINGS });
	}

	/**
	 * Get a specific setting value with type safety
	 */
	getSetting<K extends keyof AssetIncrementSettings>(key: K): AssetIncrementSettings[K] {
		return this.currentSettings[key];
	}

	/**
	 * Update a specific setting value with type safety
	 */
	async updateSetting<K extends keyof AssetIncrementSettings>(
		key: K, 
		value: AssetIncrementSettings[K]
	): Promise<void> {
		await this.updateSettings({ [key]: value } as Partial<AssetIncrementSettings>);
	}
}
