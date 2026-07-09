import { App, PluginSettingTab, Setting, activeDocument } from 'obsidian';
import type CanvasTaskCardsPlugin from './main';

export class SettingsTab extends PluginSettingTab {
  plugin: CanvasTaskCardsPlugin;

  constructor(app: App, plugin: CanvasTaskCardsPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName('Appearance').setHeading();

    const doc = activeDocument ?? document;
    const root = doc.documentElement;

    new Setting(containerEl)
      .setName('Completed border color')
      .setDesc('Border color for completed task cards')
      .addText(text => text
        .setPlaceholder('#4caf50')
        .setValue(this.plugin.settings.completedBorderColor)
        .onChange(async value => {
          this.plugin.settings.completedBorderColor = value;
          root.style.setProperty('--task-completed-color', value);
          root.style.setProperty('--task-completed-border-color', value);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Completed opacity')
      .setDesc('Opacity of completed cards (0.1 - 1.0)')
      .addSlider(slider => slider
        .setLimits(0.1, 1, 0.05)
        .setValue(this.plugin.settings.completedOpacity)
        .onChange(async value => {
          this.plugin.settings.completedOpacity = value;
          root.style.setProperty('--task-completed-opacity', String(value));
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Indicator size')
      .setDesc('Size of the task indicator in pixels')
      .addSlider(slider => slider
        .setLimits(12, 28, 1)
        .setValue(this.plugin.settings.checkboxSize)
        .onChange(async value => {
          this.plugin.settings.checkboxSize = value;
          root.style.setProperty('--task-indicator-size', `${value}px`);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Indicator position offset')
      .setDesc('Horizontal offset from the left edge (negative = left)')
      .addSlider(slider => slider
        .setLimits(-30, 0, 1)
        .setValue(this.plugin.settings.checkboxOffset)
        .onChange(async value => {
          this.plugin.settings.checkboxOffset = value;
          root.style.setProperty('--task-indicator-offset', `${value}px`);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Enable animations')
      .setDesc('Show subtle transitions when toggling task states')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableAnimations)
        .onChange(async value => {
          this.plugin.settings.enableAnimations = value;
          root.classList.toggle('task-card-animations', value);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl).setName('Progress Bar').setHeading();

    new Setting(containerEl)
      .setName('Bar height')
      .setDesc('Height of the progress bar in pixels')
      .addSlider(slider => slider
        .setLimits(2, 12, 1)
        .setValue(this.plugin.settings.progressBarHeight)
        .onChange(async value => {
          this.plugin.settings.progressBarHeight = value;
          root.style.setProperty('--task-progress-height', `${value}px`);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Bar color')
      .setDesc('Color of the progress bar (only used when auto-color is off)')
      .addText(text => text
        .setPlaceholder('#4caf50')
        .setValue(this.plugin.settings.progressBarColor)
        .onChange(async value => {
          this.plugin.settings.progressBarColor = value;
          root.style.setProperty('--task-progress-color', value);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Auto color by card type')
      .setDesc('Match progress bar color to card type color')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.progressBarAutoColor)
        .onChange(async value => {
          this.plugin.settings.progressBarAutoColor = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl).setName('Priority Colors').setHeading();

    new Setting(containerEl)
      .setName('High priority')
      .setDesc('Dot color for high priority cards')
      .addText(text => text
        .setPlaceholder('#e53935')
        .setValue(this.plugin.settings.priorityHighColor)
        .onChange(async value => {
          this.plugin.settings.priorityHighColor = value;
          root.style.setProperty('--priority-high-color', value);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Medium priority')
      .setDesc('Dot color for medium priority cards')
      .addText(text => text
        .setPlaceholder('#fb8c00')
        .setValue(this.plugin.settings.priorityMediumColor)
        .onChange(async value => {
          this.plugin.settings.priorityMediumColor = value;
          root.style.setProperty('--priority-medium-color', value);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Low priority')
      .setDesc('Dot color for low priority cards')
      .addText(text => text
        .setPlaceholder('#43a047')
        .setValue(this.plugin.settings.priorityLowColor)
        .onChange(async value => {
          this.plugin.settings.priorityLowColor = value;
          root.style.setProperty('--priority-low-color', value);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl).setName('Card Type Colors').setHeading();

    new Setting(containerEl)
      .setName('Task type')
      .setDesc('Accent color for task-type cards')
      .addText(text => text
        .setPlaceholder('#4caf50')
        .setValue(this.plugin.settings.typeTaskColor)
        .onChange(async value => {
          this.plugin.settings.typeTaskColor = value;
          root.style.setProperty('--type-task-color', value);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Question type')
      .setDesc('Accent color for question-type cards')
      .addText(text => text
        .setPlaceholder('#1e88e5')
        .setValue(this.plugin.settings.typeQuestionColor)
        .onChange(async value => {
          this.plugin.settings.typeQuestionColor = value;
          root.style.setProperty('--type-question-color', value);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Important type')
      .setDesc('Accent color for important-type cards')
      .addText(text => text
        .setPlaceholder('#e53935')
        .setValue(this.plugin.settings.typeImportantColor)
        .onChange(async value => {
          this.plugin.settings.typeImportantColor = value;
          root.style.setProperty('--type-important-color', value);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Idea type')
      .setDesc('Accent color for idea-type cards')
      .addText(text => text
        .setPlaceholder('#8e24aa')
        .setValue(this.plugin.settings.typeIdeaColor)
        .onChange(async value => {
          this.plugin.settings.typeIdeaColor = value;
          root.style.setProperty('--type-idea-color', value);
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Info type')
      .setDesc('Accent color for info-type cards')
      .addText(text => text
        .setPlaceholder('#00acc1')
        .setValue(this.plugin.settings.typeInfoColor)
        .onChange(async value => {
          this.plugin.settings.typeInfoColor = value;
          root.style.setProperty('--type-info-color', value);
          await this.plugin.saveSettings();
        }));
  }
}
