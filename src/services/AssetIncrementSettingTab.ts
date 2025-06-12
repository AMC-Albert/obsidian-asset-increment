/**
 * Settings tab for the Asset Increment Plugin
 * 
 * Provides UI for configuring plugin settings using the service-based architecture.
 * Integrates with the PluginSettingsService for settings management.
 */

import { App, Plugin, PluginSettingTab, Setting, Notice } from 'obsidian';
import { ISettingsService, IAssetService } from './interfaces';
import { AssetIncrementSettings } from '../types';
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

		// Header
		containerEl.createEl('h2', { text: 'Asset Increment Settings' });

		// rdiff-backup Configuration
		new Setting(containerEl).setName('rdiff-backup Configuration').setHeading();
		
		new Setting(containerEl)
			.setName('rdiff-backup executable path')
			.setDesc('Path to the rdiff-backup executable. Use "rdiff-backup" if it\'s in your PATH, or drop the executable in the plugin folder for auto-detection.')
			.addText(text => {
				text.setPlaceholder('rdiff-backup')
					.setValue(settings.rdiffExecutablePath);

				const handleValidation = async () => {
					const currentValue = text.inputEl.value.trim();
					if (currentValue.length > 0) {
						if (settings.rdiffExecutablePath !== currentValue) {
							try {
								await this.settingsService.updateSetting('rdiffExecutablePath', currentValue);
								loggerInfo(this, 'Updated rdiff executable path', { path: currentValue });
							} catch (error) {
								new Notice('Failed to update rdiff-backup executable path.');
								text.setValue(settings.rdiffExecutablePath);
								loggerError(this, 'Failed to update rdiff path', { error });
							}
						}
					} else {
						new Notice('rdiff-backup executable path cannot be empty.');
						text.setValue(settings.rdiffExecutablePath);
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

		new Setting(containerEl)
			.setName('Auto-detection info')
			.setDesc('The plugin will automatically detect rdiff-backup in the following order: 1) Plugin directory, 2) Specified path above, 3) System PATH')
			.then(setting => {
				// Make this a read-only informational setting
				setting.settingEl.style.opacity = '0.8';
			});

		new Setting(containerEl)
			.setName('Backup directory')
			.setDesc('Directory where backup repositories will be stored. Can be relative to vault or absolute path.')
			.addText(text => {
				text.setPlaceholder('.asset-backups')
					.setValue(settings.backupDirectory);

				const handleValidation = async () => {
					const currentValue = text.inputEl.value.trim();
					if (currentValue.length > 0) {
						if (settings.backupDirectory !== currentValue) {
							try {
								await this.settingsService.updateSetting('backupDirectory', currentValue);
								loggerInfo(this, 'Updated backup directory', { directory: currentValue });
							} catch (error) {
								new Notice('Failed to update backup directory.');
								text.setValue(settings.backupDirectory);
								loggerError(this, 'Failed to update backup directory', { error });
							}
						}
					} else {
						new Notice('Backup directory cannot be empty.');
						text.setValue(settings.backupDirectory);
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

		new Setting(containerEl)
			.setName('Test rdiff-backup installation')
			.setDesc('Verify that rdiff-backup is properly installed and accessible.')
			.addButton(button => button
				.setButtonText('Test Installation')
				.setCta()
				.onClick(async () => {
					try {
						new Notice('Testing rdiff-backup installation...');
						const isReady = await this.assetService.testBackupSystem();
						if (isReady) {
							new Notice('✅ rdiff-backup is working!');
							loggerInfo(this, 'rdiff-backup test successful');
						} else {
							new Notice('❌ rdiff-backup test failed');
							loggerWarn(this, 'rdiff-backup test failed');
						}
					} catch (error) {
						new Notice(`❌ Failed to test rdiff-backup: ${error instanceof Error ? error.message : 'Unknown error'}`);
						loggerError(this, 'rdiff-backup test error', { error });
					}
				}));

		// Asset Management
		new Setting(containerEl).setName('Asset Management').setHeading();

		new Setting(containerEl)
			.setName('Auto-backup on file save')
			.setDesc('Automatically create incremental backups when monitored asset files are modified.')
			.addToggle(toggle => toggle
				.setValue(settings.autoBackupOnSave)
				.onChange(async (value) => {
					await this.settingsService.updateSetting('autoBackupOnSave', value);
					loggerDebug(this, 'Updated auto-backup setting', { enabled: value });
				}));

		new Setting(containerEl)
			.setName('Show efficiency notifications')
			.setDesc('Display notifications showing backup efficiency (delta size vs original file size).')
			.addToggle(toggle => toggle
				.setValue(settings.showEfficiencyNotifications)
				.onChange(async (value) => {
					await this.settingsService.updateSetting('showEfficiencyNotifications', value);
					loggerDebug(this, 'Updated efficiency notifications setting', { enabled: value });
				}));

		new Setting(containerEl)
			.setName('Compression threshold (MB)')
			.setDesc('Files larger than this size will be recommended for compression. Set to 0 to disable warnings.')
			.addSlider(slider => slider
				.setLimits(0, 1000, 10)
				.setValue(settings.compressionWarningThreshold)
				.setDynamicTooltip()
				.onChange(async (value) => {
					await this.settingsService.updateSetting('compressionWarningThreshold', value);
					loggerDebug(this, 'Updated compression threshold', { thresholdMB: value });
				}));

		// File Types
		new Setting(containerEl).setName('Monitored File Types').setHeading();

		new Setting(containerEl)
			.setName('Blender files')
			.setDesc('Monitor Blender project files for incremental backups:')
			.then(setting => {
				const desc = setting.descEl;
				const ex = document.createElement('div');
				ex.classList.add('asset-margin-top');
				['blend', 'blend1', 'blend2'].forEach((ext, i, arr) => {
					const code = document.createElement('code');
					code.textContent = ext;
					ex.appendChild(code);
					if (i < arr.length - 1) ex.appendChild(document.createTextNode(', '));
				});
				desc.appendChild(ex);
				setting.addToggle(toggle => toggle
					.setValue(this.getToggleStateForExtensions(['blend', 'blend1', 'blend2']))
					.onChange(async (value) => {
						await this.updateExtensionGroup(['blend', 'blend1', 'blend2'], value);
					}));
			});

		new Setting(containerEl)
			.setName('Custom file types')
			.setDesc('List additional file types to monitor (one per line).')
			.then(setting => {
				setting.controlEl.empty();
				const textarea = document.createElement('textarea');
				textarea.placeholder = 'c4d\nprproj\naep';
				textarea.value = settings.monitoredExtensions.join('\n');
				textarea.addEventListener('change', async () => {
					const extensions = textarea.value
						.split(/\r?\n/)
						.map(item => item.trim())
						.filter(item => item.length > 0)
						.map(ext => ext.replace(/^\./, '').toLowerCase());
					await this.settingsService.updateSetting('monitoredExtensions', extensions);
					loggerDebug(this, 'Updated monitored extensions', { extensions });
				});
				setting.controlEl.classList.add('multiple-text-component');
				setting.controlEl.appendChild(textarea);
			});

		// Backup Management
		new Setting(containerEl).setName('Backup Management').setHeading();

		new Setting(containerEl)
			.setName('Cleanup old backups')
			.setDesc('Automatically remove increments older than the specified number of days. Set to 0 to keep all backups.')
			.addSlider(slider => slider
				.setLimits(0, 365, 1)
				.setValue(settings.cleanupAfterDays)
				.setDynamicTooltip()
				.onChange(async (value) => {
					await this.settingsService.updateSetting('cleanupAfterDays', value);
					loggerDebug(this, 'Updated cleanup days', { days: value });
				}));

		new Setting(containerEl)
			.setName('Maximum backup size (GB)')
			.setDesc('Maximum total size for all backup repositories. Set to 0 for unlimited.')
			.addSlider(slider => slider
				.setLimits(0, 100, 1)
				.setValue(settings.maxBackupSizeGB)
				.setDynamicTooltip()
				.onChange(async (value) => {
					await this.settingsService.updateSetting('maxBackupSizeGB', value);
					loggerDebug(this, 'Updated max backup size', { sizeGB: value });
				}));

		// Advanced Settings
		new Setting(containerEl).setName('Advanced Settings').setHeading();

		new Setting(containerEl)
			.setName('Verbose logging')
			.setDesc('Enable detailed logging for debugging purposes.')
			.addToggle(toggle => toggle
				.setValue(settings.verboseLogging)
				.onChange(async (value) => {
					await this.settingsService.updateSetting('verboseLogging', value);
					loggerDebug(this, 'Updated verbose logging', { enabled: value });
				}));

		new Setting(containerEl)
			.setName('Parallel operations')
			.setDesc('Allow multiple backup operations to run simultaneously (experimental).')
			.addToggle(toggle => toggle
				.setValue(settings.allowParallelOperations)
				.onChange(async (value) => {
					await this.settingsService.updateSetting('allowParallelOperations', value);
					loggerDebug(this, 'Updated parallel operations', { enabled: value });
				}));

		new Setting(containerEl)
			.setName('Custom rdiff-backup arguments')
			.setDesc('Additional command-line arguments to pass to rdiff-backup (for advanced users).')
			.addText(text => {
				text.setPlaceholder('--verbosity 3')
					.setValue(settings.customRdiffArgs);
				text.inputEl.addEventListener('blur', async () => {
					await this.settingsService.updateSetting('customRdiffArgs', text.getValue());
					loggerDebug(this, 'Updated custom rdiff args', { args: text.getValue() });
				});
			});

		// Danger Zone
		new Setting(containerEl).setName('Danger Zone').setHeading();

		new Setting(containerEl)
			.setName('Reset all settings')
			.setDesc('Restore all Asset Increment settings to their default values. This cannot be undone.')
			.addButton(button => {
				button.setButtonText('Reset to defaults')
					.onClick(async () => {
						if (confirm('Are you sure you want to reset all settings to defaults? This cannot be undone.')) {
							try {
								await this.settingsService.resetToDefaults();
								new Notice('Asset Increment settings reset to defaults.');
								this.display(); // Refresh the UI
								loggerInfo(this, 'All settings reset to default values');
							} catch (error) {
								new Notice('Failed to reset settings.');
								loggerError(this, 'Failed to reset settings', { error });
							}
						}
					});
				button.buttonEl.classList.add('asset-reset-destructive-text');
			});
	}

	private getToggleStateForExtensions(extensions: string[]): boolean {
		const settings = this.settingsService.getSettings();
		const current = new Set(settings.monitoredExtensions.map((e: string) => e.toLowerCase()));
		return extensions.some(ext => current.has(ext.toLowerCase()));
	}

	private async updateExtensionGroup(extensions: string[], enabled: boolean): Promise<void> {
		const settings = this.settingsService.getSettings();
		const current = new Set(settings.monitoredExtensions.map((e: string) => e.toLowerCase()));
		let newExtensions = [...settings.monitoredExtensions];
		let changed = false;

		if (enabled) {
			for (const ext of extensions) {
				if (!current.has(ext.toLowerCase())) {
					newExtensions.push(ext.toLowerCase());
					changed = true;
				}
			}
		} else {
			newExtensions = newExtensions.filter(
				(ext: string) => !extensions.some(groupExt => groupExt.toLowerCase() === ext.toLowerCase())
			);
			changed = true;
		}

		if (changed) {
			await this.settingsService.updateSetting('monitoredExtensions', newExtensions);
			loggerDebug(this, 'Updated extension group', { extensions, enabled, newExtensions });
		}
	}
}
