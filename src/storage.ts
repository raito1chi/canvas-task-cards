import type CanvasTaskCardsPlugin from './main';
import type { TaskCardData } from './types';

/**
 * Key used to embed task card data inside the canvas file, on each node's
 * data object. Because node data is serialized verbatim into the `.canvas`
 * JSON, task state travels with the document (survives renames/moves).
 */
export const TASK_CARD_DATA_KEY = 'taskCard';

export class TaskStorage {
  private plugin: CanvasTaskCardsPlugin;
  /**
   * Runtime cache, keyed by canvas path -> node id. The authoritative copy
   * lives inside the canvas file (embedded in node data); this cache is a
   * mirror kept in sync for fast lookups.
   */
  private data: Record<string, Record<string, TaskCardData>> = {};
  /**
   * Legacy storage from before embedding (plugin-data `taskData`). Kept only
   * so it can be migrated into the canvas files, then discarded.
   */
  private legacy: Record<string, Record<string, TaskCardData>> = {};

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
      progress: raw.progress ?? -1,
      subtasks: raw.subtasks ?? [],
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
      const data: TaskCardData = { taskCard: true, completed: true, cardType: 'task', priority: 'none', progress: -1, subtasks: [] };
      this.set(canvasPath, nodeId, data);
      return data;
    }
    existing.completed = !existing.completed;
    this.set(canvasPath, nodeId, existing);
    return existing;
  }

  loadLegacy(data: Record<string, Record<string, TaskCardData>>): void {
    this.legacy = data;
  }

  hasLegacy(canvasPath: string): boolean {
    const entries = this.legacy[canvasPath];
    return !!entries && Object.keys(entries).length > 0;
  }

  getLegacyIds(canvasPath: string): string[] {
    return this.legacy[canvasPath] ? Object.keys(this.legacy[canvasPath]) : [];
  }

  getLegacy(canvasPath: string, nodeId: string): TaskCardData | undefined {
    return this.legacy[canvasPath]?.[nodeId];
  }

  removeLegacy(canvasPath: string, nodeId: string): void {
    if (this.legacy[canvasPath]) {
      delete this.legacy[canvasPath][nodeId];
    }
  }

  cleanupLegacyPath(canvasPath: string): void {
    const entries = this.legacy[canvasPath];
    if (!entries) return;
    for (const id of Object.keys(entries)) {
      if (!entries[id]) delete entries[id];
    }
    if (Object.keys(entries).length === 0) {
      delete this.legacy[canvasPath];
    }
  }

  /** Drops legacy entries whose canvas file no longer exists in the vault. */
  pruneOrphanLegacy(exists: (path: string) => boolean): number {
    let removed = 0;
    for (const path of Object.keys(this.legacy)) {
      let info;
      try {
        info = exists(path);
      } catch { /* keep on error */ }
      if (!info) {
        delete this.legacy[path];
        removed++;
      }
    }
    return removed;
  }

  /** Reads embedded task card data from a node's raw data object. */
  readEmbedded(nodeData: Record<string, unknown> | undefined): TaskCardData | undefined {
    if (!nodeData) return undefined;
    const raw = nodeData[TASK_CARD_DATA_KEY];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const rec = raw as Record<string, unknown>;
    return {
      taskCard: rec.taskCard !== false,
      completed: rec.completed === true,
      cardType: (rec.cardType as TaskCardData['cardType']) ?? 'task',
      priority: (rec.priority as TaskCardData['priority']) ?? 'none',
      progress: typeof rec.progress === 'number' ? rec.progress : -1,
      subtasks: Array.isArray(rec.subtasks) ? (rec.subtasks as TaskCardData['subtasks']) : [],
    };
  }

  export(): Record<string, Record<string, TaskCardData>> {
    return this.legacy;
  }
}
