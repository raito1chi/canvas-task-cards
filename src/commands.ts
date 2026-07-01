import type CanvasTaskCardsPlugin from './main';
import type { CardType, Priority } from './types';

export function registerCommands(plugin: CanvasTaskCardsPlugin): void {
  plugin.addCommand({
    id: 'convert-selection-to-task-card',
    name: 'Convert selected card to Task Card',
    checkCallback: (checking: boolean) => {
      if (!plugin.canvasManager?.activeCanvas) return false;
      if (checking) return true;
      for (const node of plugin.canvasManager.getSelectedNodes()) {
        plugin.canvasManager.convertToTask(node.id);
      }
    },
  });

  plugin.addCommand({
    id: 'convert-selection-to-normal-card',
    name: 'Convert selected card to Normal Card',
    checkCallback: (checking: boolean) => {
      if (!plugin.canvasManager?.activeCanvas) return false;
      if (checking) return true;
      for (const node of plugin.canvasManager.getSelectedNodes()) {
        plugin.canvasManager.convertToNormal(node.id);
      }
    },
  });

  plugin.addCommand({
    id: 'toggle-task-completed',
    name: 'Toggle task completed',
    checkCallback: (checking: boolean) => {
      if (!plugin.canvasManager?.activeCanvas) return false;
      if (checking) return true;
      for (const node of plugin.canvasManager.getSelectedNodes()) {
        plugin.canvasManager.toggleTask(node.id);
      }
    },
  });

  plugin.addCommand({
    id: 'mark-task-completed',
    name: 'Mark task completed',
    checkCallback: (checking: boolean) => {
      if (!plugin.canvasManager?.activeCanvas) return false;
      if (checking) return true;
      for (const node of plugin.canvasManager.getSelectedNodes()) {
        plugin.canvasManager.markCompleted(node.id);
      }
    },
  });

  plugin.addCommand({
    id: 'mark-task-todo',
    name: 'Mark task todo',
    checkCallback: (checking: boolean) => {
      if (!plugin.canvasManager?.activeCanvas) return false;
      if (checking) return true;
      for (const node of plugin.canvasManager.getSelectedNodes()) {
        plugin.canvasManager.markTodo(node.id);
      }
    },
  });

  plugin.addCommand({
    id: 'add-task-card',
    name: 'Add Task Card to canvas',
    checkCallback: (checking: boolean) => {
      if (!plugin.canvasManager?.activeCanvas) return false;
      if (checking) return true;
      plugin.canvasManager.addNewTaskCard();
    },
  });

  // ── Card Type commands ──

  const cardTypes: Array<[CardType, string]> = [
    ['task', 'Task'],
    ['question', 'Question'],
    ['important', 'Important'],
    ['idea', 'Idea'],
    ['info', 'Info'],
  ];

  for (const [type, label] of cardTypes) {
    plugin.addCommand({
      id: `set-card-type-${type}`,
      name: `Set card type: ${label}`,
      checkCallback: (checking: boolean) => {
        if (!plugin.canvasManager?.activeCanvas) return false;
        if (checking) return true;
        for (const node of plugin.canvasManager.getSelectedNodes()) {
          plugin.canvasManager.setCardType(node.id, type);
        }
      },
    });
  }

  // ── Priority commands ──

  const priorities: Array<[Priority, string]> = [
    ['none', 'None'],
    ['low', 'Low'],
    ['medium', 'Medium'],
    ['high', 'High'],
  ];

  for (const [prio, label] of priorities) {
    plugin.addCommand({
      id: `set-priority-${prio}`,
      name: `Set priority: ${label}`,
      checkCallback: (checking: boolean) => {
        if (!plugin.canvasManager?.activeCanvas) return false;
        if (checking) return true;
        for (const node of plugin.canvasManager.getSelectedNodes()) {
          plugin.canvasManager.setPriority(node.id, prio);
        }
      },
    });
  }

  // ── Filter commands ──

  for (const [type, label] of cardTypes) {
    plugin.addCommand({
      id: `filter-card-type-${type}`,
      name: `[FILTER] Only show: ${label}`,
      checkCallback: (checking: boolean) => {
        if (!plugin.canvasManager?.activeCanvas) return false;
        if (checking) return true;
        plugin.canvasManager.setFilter({ cardType: type });
      },
    });
  }

  for (const [prio, label] of priorities) {
    plugin.addCommand({
      id: `filter-priority-${prio}`,
      name: `[FILTER] Only show: ${label === 'None' ? 'No priority' : label}`,
      checkCallback: (checking: boolean) => {
        if (!plugin.canvasManager?.activeCanvas) return false;
        if (checking) return true;
        if (prio === 'none') {
          plugin.canvasManager.setFilter({ priority: prio });
        } else {
          plugin.canvasManager.setFilter({ priority: prio });
        }
      },
    });
  }

  plugin.addCommand({
    id: 'clear-filter',
    name: '[FILTER] Clear filter',
    checkCallback: (checking: boolean) => {
      if (!plugin.canvasManager?.activeCanvas) return false;
      if (checking) return true;
      plugin.canvasManager.setFilter(null);
    },
  });
}
