import type CanvasTaskCardsPlugin from './main';
import type { TaskCardData, CardType } from './types';

const SYMBOLS: Record<CardType, { unchecked: string; checked: string }> = {
  task: { unchecked: '☐', checked: '✔' },
  question: { unchecked: '?', checked: '?' },
  important: { unchecked: '!', checked: '!' },
  idea: { unchecked: '💡', checked: '💡' },
  info: { unchecked: 'ℹ', checked: 'ℹ' },
};

export class TaskRenderer {
  private plugin: CanvasTaskCardsPlugin;

  constructor(plugin: CanvasTaskCardsPlugin) {
    this.plugin = plugin;
  }

  render(nodeEl: HTMLElement, nodeId: string, data: TaskCardData): void {
    let indicator = nodeEl.querySelector('.task-indicator') as HTMLElement;
    if (!indicator) {
      indicator = nodeEl.ownerDocument.createElement('div');
      indicator.className = 'task-indicator';
      indicator.setAttribute('role', 'checkbox');
      indicator.setAttribute('tabindex', '0');
      indicator.setAttribute('aria-label', 'Toggle task completion');

      indicator.addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        void this.plugin.canvasManager.handleCheckboxClick(nodeId);
      });

      indicator.addEventListener('mousedown', (e: MouseEvent) => {
        e.stopPropagation();
      });

      indicator.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.stopPropagation();
          e.preventDefault();
        void this.plugin.canvasManager.handleCheckboxClick(nodeId);
        }
      });

      const dot = indicator.ownerDocument.createElement('span');
      dot.className = 'task-priority-dot';
      indicator.appendChild(dot);

      const symbol = indicator.ownerDocument.createElement('span');
      symbol.className = 'task-symbol';
      indicator.appendChild(symbol);

      nodeEl.insertBefore(indicator, nodeEl.firstChild);
    }

    this.applyState(indicator, nodeEl, data);
  }

  update(nodeEl: HTMLElement, data: TaskCardData): void {
    const indicator = nodeEl.querySelector('.task-indicator') as HTMLElement;
    if (indicator) {
      this.applyState(indicator, nodeEl, data);
    }
  }

  remove(nodeEl: HTMLElement): void {
    const indicator = nodeEl.querySelector('.task-indicator');
    if (indicator) indicator.remove();
    nodeEl.querySelectorAll('.task-progress').forEach(el => el.remove());
    nodeEl.classList.remove('is-task-card', 'is-completed');
    nodeEl.removeAttribute('data-card-type');
    nodeEl.removeAttribute('data-priority');
  }

  removeAll(canvasEl: HTMLElement): void {
    canvasEl.querySelectorAll('.task-indicator').forEach(el => el.remove());
    canvasEl.querySelectorAll('.task-progress').forEach(el => el.remove());
    canvasEl.querySelectorAll('.is-task-card, .is-completed').forEach(el => {
      el.classList.remove('is-task-card', 'is-completed');
    });
  }

  calcCheckboxProgress(nodeEl: HTMLElement): number {
    const content = nodeEl.querySelector('.canvas-node-content');
    if (!content) return -1;
    const checkboxes = content.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    if (checkboxes.length > 0) {
      let checked = 0;
      checkboxes.forEach(cb => { if (cb.checked) checked++; });
      return Math.round((checked / checkboxes.length) * 100);
    }
    return this.calcCheckboxProgressFromText(content.textContent || '');
  }

  calcCheckboxProgressFromText(text: string): number {
    const regex = /- \[([ xX])\]/g;
    let total = 0, done = 0, match;
    while ((match = regex.exec(text)) !== null) {
      total++;
      if (match[1] !== ' ') done++;
    }
    if (total > 0) return Math.round((done / total) * 100);
    return -1;
  }

  private applyState(indicator: HTMLElement, nodeEl: HTMLElement, data: TaskCardData): void {
    const dot = indicator.querySelector('.task-priority-dot') as HTMLElement;
    const symbol = indicator.querySelector('.task-symbol') as HTMLElement;

    if (dot) dot.dataset.priority = data.priority;
    if (symbol) {
      const sym = SYMBOLS[data.cardType] || SYMBOLS.task;
      symbol.textContent = data.completed ? sym.checked : sym.unchecked;
      symbol.dataset.cardType = data.cardType;
      symbol.classList.toggle('is-checked', data.completed);
    }

    indicator.dataset.cardType = data.cardType;
    indicator.dataset.priority = data.priority;
    indicator.setAttribute('aria-checked', String(data.completed));

    nodeEl.classList.add('is-task-card');
    nodeEl.classList.toggle('is-completed', data.completed);
    nodeEl.dataset.cardType = data.cardType;
    nodeEl.dataset.priority = data.priority;

    this.updateProgressBar(nodeEl, data);
  }

  calcBarPct(nodeEl: HTMLElement, data: TaskCardData): number {
    if (data.progress >= 0) return data.progress;
    if (data.completed) return 100;
    const container = nodeEl.querySelector('.canvas-node-container') as HTMLElement;
    const lastCp = container?.dataset?.pbLastCp;
    if (lastCp !== undefined) return parseInt(lastCp, 10);
    const cp = this.calcCheckboxProgress(nodeEl);
    return cp >= 0 ? cp : 0;
  }

  updateProgressBar(nodeEl: HTMLElement, data: TaskCardData): void {
    const container = nodeEl.querySelector('.canvas-node-container') as HTMLElement;
    if (!container) return;

    let track = container.querySelector('.task-progress') as HTMLElement;
    if (!track) {
      track = nodeEl.ownerDocument.createElement('div');
      track.className = 'task-progress';
      const fill = nodeEl.ownerDocument.createElement('div');
      fill.className = 'task-progress-fill';
      track.appendChild(fill);
      container.appendChild(track);
    }

    const fill = track.querySelector('.task-progress-fill') as HTMLElement;
    if (fill) {
      const pct = this.calcBarPct(nodeEl, data);
      fill.style.height = `${pct}%`;
    }

    container.dataset.pbManual = String(data.progress >= 0);
    container.dataset.pbAutocolor = String(this.plugin.settings.progressBarAutoColor);
  }
}
