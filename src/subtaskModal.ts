import { Modal, Notice } from 'obsidian';
import type CanvasTaskCardsPlugin from './main';
import type { TaskCardData, Subtask } from './types';

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export class SubtaskEditModal extends Modal {
  private plugin: CanvasTaskCardsPlugin;
  private canvasPath: string;
  private nodeId: string;
  private data: TaskCardData;
  private saved = false;

  constructor(
    plugin: CanvasTaskCardsPlugin,
    canvasPath: string,
    nodeId: string,
    data: TaskCardData,
  ) {
    super(plugin.app);
    this.plugin = plugin;
    this.canvasPath = canvasPath;
    this.nodeId = nodeId;
    this.data = { ...data, subtasks: data.subtasks.map(s => ({ ...s })) };
  }

  onOpen(): void {
    const fromText = this.plugin.canvasManager.parseSubtasksFromCardText(this.nodeId);
    if (fromText.length > 0) {
      this.data.subtasks = fromText.map(s => ({ id: genId(), text: s.text, completed: s.completed }));
    }

    const { contentEl } = this;
    contentEl.empty();

    const title = contentEl.createDiv({ cls: 'task-subtask-modal-title' });
    title.textContent = 'Subtasks & Progress';

    this.renderSubtaskList(contentEl);
    this.renderAddSubtask(contentEl);
    this.renderProgressSettings(contentEl);
    this.renderButtons(contentEl);
  }

  onClose(): void {
    if (this.saved) {
      this.plugin.storage.set(this.canvasPath, this.nodeId, this.data);
      void this.plugin.saveSettings();
      this.plugin.canvasManager.updateNodeTextWithSubtasks(this.nodeId, this.data.subtasks);
      this.plugin.canvasManager.refreshNodeRendering(this.nodeId);
    }
  }

  private renderSubtaskList(container: HTMLElement): void {
    const list = container.createDiv({ cls: 'task-subtask-list' });

    if (this.data.subtasks.length === 0) {
      const empty = list.createDiv({ cls: 'task-subtask-empty' });
      empty.textContent = 'No subtasks yet. Add one below.';
      return;
    }

    for (let i = 0; i < this.data.subtasks.length; i++) {
      const sub = this.data.subtasks[i];
      const row = list.createDiv({ cls: 'task-subtask-row' });

      const cb = row.createEl('input', { type: 'checkbox', cls: 'task-subtask-checkbox' });
      cb.checked = sub.completed;
      cb.addEventListener('change', () => {
        this.data.subtasks[i].completed = cb.checked;
        this.refreshProgressDisplay();
      });

      const text = row.createEl('input', {
        type: 'text',
        cls: 'task-subtask-text',
        value: sub.text,
      });
      text.addEventListener('input', () => {
        this.data.subtasks[i].text = text.value;
      });

      const delBtn = row.createEl('button', { cls: 'task-subtask-del' });
      delBtn.textContent = '\u2715';
      delBtn.addEventListener('click', () => {
        this.data.subtasks.splice(i, 1);
        this.refresh();
      });
    }
  }

  private renderAddSubtask(container: HTMLElement): void {
    const addRow = container.createDiv({ cls: 'task-subtask-add' });
    const input = addRow.createEl('input', {
      type: 'text',
      cls: 'task-subtask-add-input',
    });
    const btn = addRow.createEl('button', { cls: 'task-subtask-add-btn' });
    btn.textContent = '+';
    btn.addEventListener('click', () => {
      const text = input.value.trim();
      if (!text) return;
      this.data.subtasks.push({ id: genId(), text, completed: false });
      input.value = '';
      this.refresh();
    });
    input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') btn.click();
    });
  }

  private renderProgressSettings(container: HTMLElement): void {
    const section = container.createDiv({ cls: 'task-subtask-progress-section' });

    const header = section.createDiv({ cls: 'task-subtask-section-title' });
    header.textContent = 'Progress';

    const toggleRow = section.createDiv({ cls: 'task-subtask-toggle-row' });

    const autoBtn = toggleRow.createEl('button', { cls: 'task-subtask-mode-btn' });
    autoBtn.textContent = 'Auto';
    autoBtn.classList.toggle('is-active', this.data.progress === -1);
    autoBtn.addEventListener('click', () => {
      this.data.progress = -1;
      this.refresh();
    });

    const manualBtn = toggleRow.createEl('button', { cls: 'task-subtask-mode-btn' });
    manualBtn.textContent = 'Manual';
    manualBtn.classList.toggle('is-active', this.data.progress >= 0);
    manualBtn.addEventListener('click', () => {
      this.data.progress = 50;
      this.refresh();
    });

    const sliderRow = section.createDiv({ cls: 'task-subtask-slider-row' });
    if (this.data.progress >= 0) {
      const slider = sliderRow.createEl('input', { type: 'range', cls: 'task-subtask-slider' });
      slider.min = '0';
      slider.max = '100';
      slider.value = String(this.data.progress);
      const label = sliderRow.createSpan({ cls: 'task-subtask-slider-label' });
      label.textContent = `${this.data.progress}%`;
      slider.addEventListener('input', () => {
        this.data.progress = parseInt(slider.value, 10);
        label.textContent = `${this.data.progress}%`;
      });
    } else {
      const pct = this.calcAutoProgress();
      const bar = sliderRow.createDiv({ cls: 'task-subtask-auto-bar' });
      const fill = bar.createDiv({ cls: 'task-subtask-auto-fill' });
      fill.style.width = `${pct}%`;
      const label2 = sliderRow.createSpan({ cls: 'task-subtask-slider-label' });
      label2.textContent = `${pct}% (${this.data.subtasks.filter(s => s.completed).length}/${this.data.subtasks.length})`;
    }
  }

  private refreshProgressDisplay(): void {
    const old = this.contentEl.querySelector('.task-subtask-progress-section');
    if (old) {
      const parent = old.parentElement;
      if (parent) {
        old.remove();
        this.renderProgressSettings(parent);
      }
    }
  }

  private calcAutoProgress(): number {
    if (this.data.subtasks.length === 0) return 0;
    const done = this.data.subtasks.filter(s => s.completed).length;
    return Math.round((done / this.data.subtasks.length) * 100);
  }

  private renderButtons(container: HTMLElement): void {
    const btnRow = container.createDiv({ cls: 'task-subtask-buttons' });

    const cancelBtn = btnRow.createEl('button', { cls: 'task-subtask-cancel-btn' });
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => this.close());

    const saveBtn = btnRow.createEl('button', { cls: 'task-subtask-save-btn' });
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', () => {
      this.saved = true;
      this.close();
      new Notice('Subtasks saved');
    });
  }

  private refresh(): void {
    const { contentEl } = this;
    const scrollPos = contentEl.scrollTop;
    contentEl.empty();

    const title = contentEl.createDiv({ cls: 'task-subtask-modal-title' });
    title.textContent = 'Subtasks & Progress';

    this.renderSubtaskList(contentEl);
    this.renderAddSubtask(contentEl);
    this.renderProgressSettings(contentEl);
    this.renderButtons(contentEl);

    contentEl.scrollTop = scrollPos;
  }
}
