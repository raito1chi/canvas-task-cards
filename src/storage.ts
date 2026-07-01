import type CanvasTaskCardsPlugin from './main';
import type { TaskCardData } from './types';

export class TaskStorage {
  private plugin: CanvasTaskCardsPlugin;
  private data: Record<string, Record<string, TaskCardData>> = {};

  constructor(plugin: CanvasTaskCardsPlugin) {
    this.plugin = plugin;
  }

  get(canvasPath: string, nodeId: string): TaskCardData | undefined {
    const raw = this.data[canvasPath]?.[nodeId];
    if (!raw) return undefined;
    return {
      taskCard: raw.taskCard ?? false,
      completed: raw.completed ?? false,
      cardType: raw.cardType ?? 'task',
      priority: raw.priority ?? 'none',
    };
  }

  getAll(canvasPath: string): Record<string, TaskCardData> {
    return { ...(this.data[canvasPath] ?? {}) };
  }

  has(canvasPath: string, nodeId: string): boolean {
    return this.data[canvasPath]?.[nodeId]?.taskCard ?? false;
  }

  isCompleted(canvasPath: string, nodeId: string): boolean {
    return this.data[canvasPath]?.[nodeId]?.completed ?? false;
  }

  set(canvasPath: string, nodeId: string, taskData: TaskCardData): void {
    if (!this.data[canvasPath]) {
      this.data[canvasPath] = {};
    }
    this.data[canvasPath][nodeId] = taskData;
  }

  remove(canvasPath: string, nodeId: string): void {
    if (this.data[canvasPath]) {
      delete this.data[canvasPath][nodeId];
    }
  }

  toggle(canvasPath: string, nodeId: string): TaskCardData {
    const existing = this.get(canvasPath, nodeId);
    if (!existing || !existing.taskCard) {
      const data: TaskCardData = { taskCard: true, completed: true, cardType: 'task', priority: 'none' };
      this.set(canvasPath, nodeId, data);
      return data;
    }
    existing.completed = !existing.completed;
    this.set(canvasPath, nodeId, existing);
    return existing;
  }

  load(data: Record<string, Record<string, TaskCardData>>): void {
    this.data = data;
  }

  export(): Record<string, Record<string, TaskCardData>> {
    return this.data;
  }
}
