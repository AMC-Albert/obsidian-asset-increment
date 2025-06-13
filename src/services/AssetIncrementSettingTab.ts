/**
 * Settings tab for the Asset Increment Plugin
 * 
 * Provides UI for configuring plugin settings using the service-based architecture.
 * Integrates with the PluginSettingsService for settings management.
 */

import { App, Plugin, PluginSettingTab, Setting, Notice } from 'obsidian';
import { ISettingsService, IAssetService } from './interfaces';
import { AssetIncrementSettings, LogLevel } from '../types';
import { 
	loggerDebug, 
	loggerInfo, 
	loggerWarn, 
	loggerError,
	registerLoggerClass 
} from '../utils/obsidian-logger';

export class AssetIncrementSettingTab extends PluginSettingTab {
	private settingsService: ISettingsService;
	private assetService: IAssetService;

	constructor(
		app: App, 
		plugin: Plugin, 
		settingsService: ISettingsService, 
		assetService: IAssetService
	) {
		super(app, plugin);
		this.settingsService = settingsService;
		this.assetService = assetService;
		
		registerLoggerClass(this, 'AssetIncrementSettingTab');
		loggerDebug(this, 'Settings tab initialized');
	}

	display(): void {
		const { containerEl } = this;
		const settings = this.settingsService.getSettings();

		containerEl.empty();

		// restic Configuration
		new Setting(containerEl).setName('restic Configuration').setHeading();
		
		new Setting(containerEl)
			.setName('restic executable path')
			.setDesc('Path to the restic executable. Use "restic" if it\'s in your PATH.')
			.addText(text => {
				text.setPlaceholder('restic')
					.setValue(settings.resticPath);

				const handleValidation = async () => {
					const currentValue = text.inputEl.value.trim();
					if (currentValue.length > 0) {
						if (settings.resticPath !== currentValue) {
							try {
								await this.settingsService.updateSetting('resticPath', currentValue);
								loggerInfo(this, 'Updated rdiff executable path', { path: currentValue });
							} catch (error) {
								new Notice('Failed to update restic executable path.');
								text.setValue(settings.resticPath);
								loggerError(this, 'Failed to update rdiff path', { error });
							}
						}
					} else {
						new Notice('restic executable path cannot be empty.');
						text.setValue(settings.resticPath);
					}
				};

				text.inputEl.addEventListener('blur', handleValidation);
				text.inputEl.addEventListener('keydown', async (event: KeyboardEvent) => {
					if (event.key === 'Enter') {
						event.preventDefault();
						await handleValidation();
					}
				});
			});

		// Backup Storage Configuration
		new Setting(containerEl).setName('Backup Storage').setHeading();

		new Setting(containerEl)
			.setName('Store backups adjacent to files')
			.setDesc('If enabled, backup data will be stored in restic-data directories next to the original files. If disabled, backups will be stored in a global backup directory.')
			.addToggle(toggle => toggle
				.setValue(settings.storeBackupsAdjacent)
				.onChange(async (value) => {
					await this.settingsService.updateSetting('storeBackupsAdjacent', value);
					this.display(); // Refresh to show/hide dependent settings
				}));

		new Setting(containerEl)
			.setName('Use global backup directory')
			.setDesc('If enabled, all backups will be stored in the specified global directory instead of adjacent to files.')
			.addToggle(toggle => toggle
				.setValue(settings.useGlobalBackupDir)
				.onChange(async (value) => {
					await this.settingsService.updateSetting('useGlobalBackupDir', value);
					this.display(); // Refresh to show/hide dependent settings
				}));

		if (settings.useGlobalBackupDir) {
			new Setting(containerEl)
				.setName('Global backup directory')
				.setDesc('Directory where all backup repositories will be stored. Can be relative to vault or absolute path.')
				.addText(text => {
					text.setPlaceholder('.asset-backups')
						.setValue(settings.globalBackupDir);

					const handleValidation = async () => {
						const currentValue = text.inputEl.value.trim();
						if (settings.globalBackupDir !== currentValue) {
							try {
								await this.settingsService.updateSetting('globalBackupDir', currentValue);
								loggerInfo(this, 'Updated global backup directory', { path: currentValue });
							} catch (error) {
								new Notice('Failed to update global backup directory.');
								text.setValue(settings.globalBackupDir);
								loggerError(this, 'Failed to update global backup dir', { error });
							}
						}
					};

					text.inputEl.addEventListener('blur', handleValidation);
					text.inputEl.addEventListener('keydown', async (event: KeyboardEvent) => {
						if (event.key === 'Enter') {
							event.preventDefault();
							await handleValidation();
						}
					});
				});
		}

		// Auto-backup Configuration
		new Setting(containerEl).setName('Auto-backup Settings').setHeading();

		new Setting(containerEl)
			.setName('Auto-backup on save')
			.setDesc('Automatically create backups when monitored files are saved.')
			.addToggle(toggle => toggle
				.setValue(settings.autoBackupOnSave)
				.onChange(async (value) => {
					await this.settingsService.updateSetting('autoBackupOnSave', value);
					this.display(); // Refresh to show/hide dependent settings
				}));

		if (settings.autoBackupOnSave) {
			new Setting(containerEl)
				.setName('Auto-backup interval (minutes)')
				.setDesc('Minimum time between automatic backups for the same file.')
				.addSlider(slider => slider
					.setLimits(1, 60, 1)
					.setValue(settings.autoBackupIntervalMinutes)
					.setDynamicTooltip()
					.onChange(async (value) => {
						await this.settingsService.updateSetting('autoBackupIntervalMinutes', value);
					}));

			new Setting(containerEl)
				.setName('Minimum backup interval (seconds)')
				.setDesc('Absolute minimum time between backups to prevent excessive backup creation.')
				.addSlider(slider => slider
					.setLimits(10, 300, 10)
					.setValue(settings.minBackupIntervalSeconds)
					.setDynamicTooltip()
					.onChange(async (value) => {
						await this.settingsService.updateSetting('minBackupIntervalSeconds', value);
					}));

			new Setting(containerEl)
				.setName('Prevent duplicate backups')
				.setDesc('Skip backup if file hasn\'t changed since last backup.')
				.addToggle(toggle => toggle
					.setValue(settings.preventDuplicateBackups)
					.onChange(async (value) => {
						await this.settingsService.updateSetting('preventDuplicateBackups', value);
					}));
		}

		// File Monitoring
		new Setting(containerEl).setName('File Monitoring').setHeading();

		new Setting(containerEl)
			.setName('Backup file extensions')
			.setDesc('File extensions to monitor for backup (one per line, include the dot)')
			.addTextArea(textarea => {
				textarea.setPlaceholder('.blend\n.psd\n.kra')
					.setValue(settings.backupFileExtensions.join('\n'));

				const updateExtensions = async () => {
					const value = textarea.getValue();
					const extensions = value.split('\n')
						.map(ext => ext.trim())
						.filter(ext => ext.length > 0);
					
					await this.settingsService.updateSetting('backupFileExtensions', extensions);
				};

				textarea.inputEl.addEventListener('blur', updateExtensions);
			});

		new Setting(containerEl)
			.setName('Exclude patterns')
			.setDesc('Glob patterns for files/directories to exclude from backup (one per line)')
			.addTextArea(textarea => {
				textarea.setPlaceholder('**/temp/**\n**/.git/**')
					.setValue(settings.excludePatterns.join('\n'));

				const updatePatterns = async () => {
					const value = textarea.getValue();
					const patterns = value.split('\n')
						.map(pattern => pattern.trim())
						.filter(pattern => pattern.length > 0);
					
					await this.settingsService.updateSetting('excludePatterns', patterns);
				};

				textarea.inputEl.addEventListener('blur', updatePatterns);
			});

		// Cleanup and Maintenance
		new Setting(containerEl).setName('Cleanup and Maintenance').setHeading();

		new Setting(containerEl)
			.setName('Maximum backup age (days)')
			.setDesc('Automatically remove backups older than this many days. Set to 0 to disable cleanup.')
			.addSlider(slider => slider
				.setLimits(0, 365, 1)
				.setValue(settings.maxBackupAgeDays)
				.setDynamicTooltip()
				.onChange(async (value) => {
					await this.settingsService.updateSetting('maxBackupAgeDays', value);
				}));

		new Setting(containerEl)
			.setName('Backup frequency (hours)')
			.setDesc('Default interval between scheduled backups (in hours).')
			.addSlider(slider => slider
				.setLimits(1, 168, 1)
				.setValue(settings.backupFrequency / (60 * 60 * 1000)) // Convert from milliseconds to hours
				.setDynamicTooltip()
				.onChange(async (value) => {
					const milliseconds = value * 60 * 60 * 1000; // Convert hours to milliseconds
					await this.settingsService.updateSetting('backupFrequency', milliseconds);
				}));

		// Notifications
		new Setting(containerEl).setName('Notifications').setHeading();

		new Setting(containerEl)
			.setName('Show backup notifications')
			.setDesc('Display notifications when backups are created or when errors occur.')
			.addToggle(toggle => toggle
				.setValue(settings.showBackupNotifications)
				.onChange(async (value) => {
					await this.settingsService.updateSetting('showBackupNotifications', value);
				}));

		new Setting(containerEl)
			.setName('Show efficiency notifications')
			.setDesc('Display notifications showing backup efficiency (compression ratio, space saved).')
			.addToggle(toggle => toggle
				.setValue(settings.showEfficiencyNotifications)
				.onChange(async (value) => {
					await this.settingsService.updateSetting('showEfficiencyNotifications', value);
				}));

		// Logging
		new Setting(containerEl).setName('Logging').setHeading();

		new Setting(containerEl)
			.setName('Log level')
			.setDesc('Set the verbosity of plugin logging.')
			.addDropdown(dropdown => {
				dropdown.addOption(LogLevel.NONE, 'None');
				dropdown.addOption(LogLevel.ERROR, 'Error');
				dropdown.addOption(LogLevel.WARN, 'Warning');
				dropdown.addOption(LogLevel.INFO, 'Info');
				dropdown.addOption(LogLevel.DEBUG, 'Debug');
				
				dropdown.setValue(settings.logLevel)
					.onChange(async (value) => {
						await this.settingsService.updateSetting('logLevel', value as LogLevel);
					});
			});
	}
}