import { Plugin, Notice } from 'obsidian';
import { DEFAULT_SETTINGS, type PluginSettings, type PersistedPluginData } from './types';
import { SettingsTab } from './settings';
import { TaskStorage } from './storage';
import { CanvasManager } from './canvasManager';
import { registerCommands } from './commands';

export default class CanvasTaskCardsPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };
  storage: TaskStorage;
  canvasManager: CanvasManager;

  async onload(): Promise<void> {
    this.storage = new TaskStorage(this);
    this.canvasManager = new CanvasManager(this);

    await this.loadPluginData();
    this.applySettingsToCSS();

    this.addSettingTab(new SettingsTab(this.app, this));

    registerCommands(this);

    this.canvasManager.initialize();

    new Notice('Canvas Task Cards loaded');
  }

  onunload(): void {
    this.canvasManager?.destroy();
  }

  async loadPluginData(): Promise<void> {
    try {
      const data = (await this.loadData()) as PersistedPluginData | null;
      this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings ?? {});
      this.storage.load(data?.taskData ?? {});
    } catch (e) {
      console.error('Canvas Task Cards: Error loading data', e);
      this.settings = { ...DEFAULT_SETTINGS };
    }
  }

  async saveSettings(): Promise<void> {
    try {
      await this.saveData({
        settings: this.settings,
        taskData: this.storage.export(),
      } satisfies PersistedPluginData);
    } catch (e) {
      console.error('Canvas Task Cards: Error saving data', e);
    }
  }

  private applySettingsToCSS(): void {
    const root = document.documentElement;
    root.style.setProperty('--task-completed-color', this.settings.completedBorderColor);
    root.style.setProperty('--task-completed-border-color', this.settings.completedBorderColor);
    root.style.setProperty('--task-completed-opacity', String(this.settings.completedOpacity));
    root.style.setProperty('--task-indicator-size', `${this.settings.checkboxSize}px`);
    root.style.setProperty('--task-indicator-offset', `${this.settings.checkboxOffset}px`);
    root.style.setProperty('--priority-high-color', this.settings.priorityHighColor);
    root.style.setProperty('--priority-medium-color', this.settings.priorityMediumColor);
    root.style.setProperty('--priority-low-color', this.settings.priorityLowColor);
    root.style.setProperty('--type-task-color', this.settings.typeTaskColor);
    root.style.setProperty('--type-question-color', this.settings.typeQuestionColor);
    root.style.setProperty('--type-important-color', this.settings.typeImportantColor);
    root.style.setProperty('--type-idea-color', this.settings.typeIdeaColor);
    root.style.setProperty('--type-info-color', this.settings.typeInfoColor);

    if (this.settings.enableAnimations) {
      root.classList.add('task-card-animations');
    } else {
      root.classList.remove('task-card-animations');
    }
  }
}
