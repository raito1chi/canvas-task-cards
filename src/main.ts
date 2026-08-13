import { Plugin, Notice, activeDocument, setTooltip } from 'obsidian';
import { DEFAULT_SETTINGS, type PluginSettings, type PersistedPluginData, type FilterState } from './types';
import { SettingsTab } from './settings';
import { TaskStorage } from './storage';
import { CanvasManager } from './canvasManager';
import { registerCommands } from './commands';
import { calculateStats } from './stats';
import { TaskStatsModal } from './statsModal';

export default class CanvasTaskCardsPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };
  storage: TaskStorage;
  canvasManager: CanvasManager;
  savedFilter: FilterState | null = null;
  private statusBarEl: HTMLElement | null = null;

  async onload(): Promise<void> {
    this.storage = new TaskStorage(this);
    this.canvasManager = new CanvasManager(this);

    await this.loadPluginData();
    this.applySettingsToCSS();

    this.addSettingTab(new SettingsTab(this.app, this));

    registerCommands(this);

    this.canvasManager.initialize();
    this.setupStatusBarStats();

    new Notice('Canvas Task Cards loaded');
  }

  onunload(): void {
    this.canvasManager?.destroy();
    this.canvasManager.onDataChanged = null;
    this.statusBarEl = null;
  }

  async loadPluginData(): Promise<void> {
    try {
      const data = (await this.loadData()) as PersistedPluginData | null;
      this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings ?? {});
      this.storage.loadLegacy(data?.taskData ?? {});
      this.savedFilter = data?.filter ?? null;

      // Drop legacy entries whose canvas files were moved/renamed/deleted.
      const cleaned = this.storage.pruneOrphanLegacy(
        (path: string) => !!this.app.vault.getAbstractFileByPath(path),
      );
      if (cleaned > 0) await this.saveSettings();
    } catch (e: unknown) {
      console.error('Canvas Task Cards: Error loading data', e);
      this.settings = { ...DEFAULT_SETTINGS };
    }
  }

  async saveSettings(): Promise<void> {
    try {
      await this.saveData({
        settings: this.settings,
        taskData: this.storage.export(),
        filter: this.savedFilter ?? null,
      } satisfies PersistedPluginData);
    } catch (e: unknown) {
      console.error('Canvas Task Cards: Error saving data', e);
    }
  }

  private applySettingsToCSS(): void {
    const root = (activeDocument ?? document).documentElement;
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

    root.style.setProperty('--task-progress-height', `${this.settings.progressBarHeight}px`);
    root.style.setProperty('--task-progress-color', this.settings.progressBarColor);

    if (this.settings.enableAnimations) {
      root.classList.add('task-card-animations');
    } else {
      root.classList.remove('task-card-animations');
    }
  }

  private setupStatusBarStats(): void {
    this.canvasManager.onDataChanged = () => this.refreshStatusBar();
    this.applyStatusBarToggle(this.settings.showStatusBarStats);
    this.registerInterval(window.setInterval(() => this.refreshStatusBar(), 2000));
    this.refreshStatusBar();
  }

  applyStatusBarToggle(enabled: boolean): void {
    if (enabled && !this.statusBarEl) {
      this.statusBarEl = this.addStatusBarItem();
      this.statusBarEl.addClass('task-card-status-bar');
      this.statusBarEl.addEventListener('click', () => this.openStatsModal());
      this.refreshStatusBar();
    } else if (!enabled && this.statusBarEl) {
      this.statusBarEl.remove();
      this.statusBarEl = null;
    }
  }

  private refreshStatusBar(): void {
    const el = this.statusBarEl;
    if (!el) return;

    const cm = this.canvasManager;
    if (!cm?.activeCanvas || !cm.currentCanvasPath) {
      el.hide();
      return;
    }

    const stats = calculateStats(
      this.storage.getAll(cm.currentCanvasPath),
      (id, data) => cm.getEffectiveProgress(id, data),
    );
    if (stats.total === 0) {
      el.hide();
      return;
    }

    el.show();
    el.empty();

    const pill = el.createDiv({ cls: 'task-status-pill' });
    const track = pill.createDiv({ cls: 'task-status-mini-track' });
    const fill = track.createDiv({ cls: 'task-status-mini-fill' });
    fill.style.width = `${stats.completionRate}%`;
    if (stats.completionRate === 100) fill.style.background = this.settings.completedBorderColor;
    else fill.style.background = this.settings.progressBarColor;

    pill.createDiv({ cls: 'task-status-label' }).textContent =
      `${stats.completed}/${stats.total} · ${stats.completionRate}%`;

    setTooltip(
      el,
      `Task Cards: ${stats.completed}/${stats.total} done (${stats.completionRate}%)\n` +
      `${stats.totalSubtasks} subtasks (${stats.completedSubtasks} done)\n` +
      `Avg progress: ${stats.avgProgress}% — click for details`,
      { placement: 'top' },
    );
  }

  openStatsModal(): void {
    if (!this.canvasManager?.activeCanvas) {
      new Notice('Open a canvas to view task stats');
      return;
    }
    new TaskStatsModal(this).open();
  }
}
