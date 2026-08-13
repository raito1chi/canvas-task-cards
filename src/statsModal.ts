import { Modal } from 'obsidian';
import type CanvasTaskCardsPlugin from './main';
import type { CardType, Priority, TaskCardData } from './types';
import {
  CARD_TYPES,
  PRIORITIES,
  calculateStats,
  type StatBucket,
  type TaskStats,
} from './stats';

type LabeledBucket = { label: string; bucket: StatBucket; color: string };

export class TaskStatsModal extends Modal {
  private plugin: CanvasTaskCardsPlugin;
  private lastJson = '';
  private interval: number | null = null;

  constructor(plugin: CanvasTaskCardsPlugin) {
    super(plugin.app);
    this.plugin = plugin;
  }

  onOpen(): void {
    this.contentEl.addClass('task-stats-modal');
    this.render();
    this.interval = window.setInterval(() => this.renderIfChanged(), 1500);
  }

  onClose(): void {
    if (this.interval !== null) {
      window.clearInterval(this.interval);
      this.interval = null;
    }
  }

  private getStats(): TaskStats {
    const cm = this.plugin.canvasManager;
    const path = cm?.currentCanvasPath ?? '';
    return calculateStats(
      this.plugin.storage.getAll(path),
      (id: string, data: TaskCardData) => cm?.getEffectiveProgress(id, data) ?? 0,
    );
  }

  private renderIfChanged(): void {
    const json = JSON.stringify(this.getStats());
    if (json !== this.lastJson) this.render();
  }

  private render(): void {
    const stats = this.getStats();
    this.lastJson = JSON.stringify(stats);
    const { contentEl } = this;
    contentEl.empty();

    const cm = this.plugin.canvasManager;
    const path = cm?.currentCanvasPath ?? '';
    const fileName = path.split('/').pop() ?? path;

    const header = contentEl.createDiv({ cls: 'task-stats-header' });
    header.createDiv({ cls: 'task-stats-title' }).textContent = 'Canvas Task Stats';
    if (fileName) {
      header.createDiv({ cls: 'task-stats-subtitle' }).textContent = fileName;
    }

    if (stats.total === 0) {
      const empty = contentEl.createDiv({ cls: 'task-stats-empty' });
      empty.textContent = 'No task cards on this canvas yet.';
      return;
    }

    this.renderSummary(contentEl, stats);
    this.renderBars(contentEl, 'By Type', this.typeBuckets(stats));
    this.renderBars(contentEl, 'By Priority', this.priorityBuckets(stats));
    this.renderProgress(contentEl, stats);
    this.renderSubtasks(contentEl, stats);
  }

  private renderSummary(contentEl: HTMLElement, stats: TaskStats): void {
    const summary = contentEl.createDiv({ cls: 'task-stats-summary' });

    const gauge = summary.createDiv({ cls: 'task-stats-gauge' });
    const gaugeRing = gauge.createDiv({ cls: 'task-stats-ring' });
    gaugeRing.style.setProperty('--task-ring-progress', `${Math.round(stats.completionRate * 3.6)}deg`);
    gaugeRing.style.setProperty('--task-ring-color', stats.completionRate === 100
      ? this.plugin.settings.completedBorderColor
      : this.plugin.settings.progressBarColor);
    gaugeRing.createDiv({ cls: 'task-stats-ring-value' }).textContent = `${stats.completionRate}%`;

    const info = summary.createDiv({ cls: 'task-stats-summary-info' });
    const line = info.createDiv({ cls: 'task-stats-summary-line' });
    line.createSpan({ cls: 'task-stats-summary-big' }).textContent = String(stats.completed);
    line.createSpan({ cls: 'task-stats-summary-sep' }).textContent = 'of';
    line.createSpan({ cls: 'task-stats-summary-big' }).textContent = String(stats.total);
    line.createSpan({ cls: 'task-stats-summary-suffix' }).textContent = 'completed';
    info.createDiv({ cls: 'task-stats-summary-sub' }).textContent =
      `${stats.manualCount} manual · ${stats.autoCount} auto progress`;
  }

  private typeBuckets(stats: TaskStats): LabeledBucket[] {
    const labels: Record<CardType, string> = {
      task: 'Task',
      question: 'Question',
      important: 'Important',
      idea: 'Idea',
      info: 'Info',
    };
    const colors: Record<CardType, string> = {
      task: this.plugin.settings.typeTaskColor,
      question: this.plugin.settings.typeQuestionColor,
      important: this.plugin.settings.typeImportantColor,
      idea: this.plugin.settings.typeIdeaColor,
      info: this.plugin.settings.typeInfoColor,
    };
    return CARD_TYPES.map(type => ({
      label: labels[type],
      bucket: stats.byType[type],
      color: colors[type],
    }));
  }

  private priorityBuckets(stats: TaskStats): LabeledBucket[] {
    const labels: Record<Priority, string> = {
      none: 'None',
      low: 'Low',
      medium: 'Medium',
      high: 'High',
    };
    const colors: Record<Priority, string> = {
      none: 'var(--text-muted)',
      low: this.plugin.settings.priorityLowColor,
      medium: this.plugin.settings.priorityMediumColor,
      high: this.plugin.settings.priorityHighColor,
    };
    return PRIORITIES.map(prio => ({
      label: labels[prio],
      bucket: stats.byPriority[prio],
      color: colors[prio],
    }));
  }

  private renderBars(contentEl: HTMLElement, title: string, buckets: LabeledBucket[]): void {
    const hasData = buckets.some(b => b.bucket.count > 0);
    const section = contentEl.createDiv({ cls: 'task-stats-section' });
    section.createDiv({ cls: 'task-stats-section-title' }).textContent = title;

    if (!hasData) {
      section.createDiv({ cls: 'task-stats-muted' }).textContent = 'None';
      return;
    }

    for (const { label, bucket, color } of buckets) {
      const row = section.createDiv({ cls: 'task-stats-bar-row' });
      const meta = row.createDiv({ cls: 'task-stats-bar-meta' });
      meta.createSpan({ cls: 'task-stats-bar-label' }).textContent = label;
      meta.createSpan({ cls: 'task-stats-bar-value' }).textContent =
        bucket.count > 0 ? `${bucket.count} (${bucket.percent}%)` : '0';
      const track = row.createDiv({ cls: 'task-stats-bar-track' });
      const fill = track.createDiv({ cls: 'task-stats-bar-fill' });
      if (bucket.count > 0) {
        fill.style.width = `${Math.max(2, bucket.percent)}%`;
        fill.style.background = color;
      } else {
        fill.setCssProps({ width: '0%' });
      }
    }
  }

  private renderProgress(contentEl: HTMLElement, stats: TaskStats): void {
    const section = contentEl.createDiv({ cls: 'task-stats-section' });
    section.createDiv({ cls: 'task-stats-section-title' }).textContent = 'Progress';

    const row = section.createDiv({ cls: 'task-stats-bar-row' });
    const meta = row.createDiv({ cls: 'task-stats-bar-meta' });
    meta.createSpan({ cls: 'task-stats-bar-label' }).textContent = 'Average';
    meta.createSpan({ cls: 'task-stats-bar-value' }).textContent = `${stats.avgProgress}%`;
    const track = row.createDiv({ cls: 'task-stats-bar-track' });
    const fill = track.createDiv({ cls: 'task-stats-bar-fill' });
    fill.style.width = `${Math.max(stats.avgProgress > 0 ? 2 : 0, stats.avgProgress)}%`;
    fill.setCssProps({ background: 'var(--interactive-accent)' });
  }

  private renderSubtasks(contentEl: HTMLElement, stats: TaskStats): void {
    const section = contentEl.createDiv({ cls: 'task-stats-section' });
    section.createDiv({ cls: 'task-stats-section-title' }).textContent = 'Subtasks';

    if (!stats.hasSubtasks) {
      section.createDiv({ cls: 'task-stats-muted' }).textContent = 'No subtasks yet.';
      return;
    }

    const row = section.createDiv({ cls: 'task-stats-bar-row' });
    const meta = row.createDiv({ cls: 'task-stats-bar-meta' });
    meta.createSpan({ cls: 'task-stats-bar-label' }).textContent = `${stats.completedSubtasks} of ${stats.totalSubtasks} done`;
    meta.createSpan({ cls: 'task-stats-bar-value' }).textContent = `${stats.subtaskRate}%`;
    const track = row.createDiv({ cls: 'task-stats-bar-track' });
    const fill = track.createDiv({ cls: 'task-stats-bar-fill' });
    fill.style.width = `${Math.max(stats.subtaskRate > 0 ? 2 : 0, stats.subtaskRate)}%`;
    fill.style.background = this.plugin.settings.progressBarColor;
  }
}