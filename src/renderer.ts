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
    nodeEl.classList.remove('is-task-card', 'is-completed');
    nodeEl.removeAttribute('data-card-type');
    nodeEl.removeAttribute('data-priority');
  }

  removeAll(canvasEl: HTMLElement): void {
    canvasEl.querySelectorAll('.task-indicator').forEach(el => el.remove());
    canvasEl.querySelectorAll('.is-task-card, .is-completed').forEach(el => {
      el.classList.remove('is-task-card', 'is-completed');
    });
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
  }
}
