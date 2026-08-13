import type { CardType, Priority, TaskCardData } from './types';

export const CARD_TYPES: CardType[] = ['task', 'question', 'important', 'idea', 'info'];
export const PRIORITIES: Priority[] = ['none', 'low', 'medium', 'high'];

export interface StatBucket {
  count: number;
  percent: number;
}

export interface TaskStats {
  total: number;
  completed: number;
  completionRate: number;
  byType: Record<CardType, StatBucket>;
  byPriority: Record<Priority, StatBucket>;
  avgProgress: number;
  manualCount: number;
  autoCount: number;
  totalSubtasks: number;
  completedSubtasks: number;
  subtaskRate: number;
  hasSubtasks: boolean;
}

export type ProgressResolver = (nodeId: string, data: TaskCardData) => number;

export function emptyStats(): TaskStats {
  return {
    total: 0,
    completed: 0,
    completionRate: 0,
    byType: {
      task: { count: 0, percent: 0 },
      question: { count: 0, percent: 0 },
      important: { count: 0, percent: 0 },
      idea: { count: 0, percent: 0 },
      info: { count: 0, percent: 0 },
    },
    byPriority: {
      none: { count: 0, percent: 0 },
      low: { count: 0, percent: 0 },
      medium: { count: 0, percent: 0 },
      high: { count: 0, percent: 0 },
    },
    avgProgress: 0,
    manualCount: 0,
    autoCount: 0,
    totalSubtasks: 0,
    completedSubtasks: 0,
    subtaskRate: 0,
    hasSubtasks: false,
  };
}

/**
 * Best-effort progress for a card when no live node is available: uses the
 * explicit progress, falls back to 100 when completed, then to the subtask
 * ratio, and finally 0 (mirroring what the card's own progress bar shows).
 */
function fallbackProgress(data: TaskCardData): number {
  if (data.progress >= 0) return data.progress;
  if (data.completed) return 100;
  if (Array.isArray(data.subtasks) && data.subtasks.length > 0) {
    const done = data.subtasks.filter(s => s.completed).length;
    return Math.round((done / data.subtasks.length) * 100);
  }
  return 0;
}

/**
 * Walks every cached task card for a canvas and produces a snapshot of
 * aggregated statistics. `resolveProgress` may be supplied by the caller to
 * compute the live (checkbox-synced) progress of each card.
 */
export function calculateStats(
  cards: Record<string, TaskCardData>,
  resolveProgress?: ProgressResolver,
): TaskStats {
  const stats = emptyStats();
  const entries = Object.entries(cards);
  const total = entries.filter(([, data]) => data?.taskCard).length;
  stats.total = total;

  if (total === 0) return stats;

  let progressSum = 0;
  for (const [id, data] of entries) {
    if (!data || !data.taskCard) continue;

    if (data.completed) stats.completed++;

    const typeBucket = stats.byType[data.cardType];
    if (typeBucket) typeBucket.count++;

    const prioBucket = stats.byPriority[data.priority];
    if (prioBucket) prioBucket.count++;

    if (data.progress >= 0) stats.manualCount++;
    else stats.autoCount++;

    if (Array.isArray(data.subtasks) && data.subtasks.length > 0) {
      stats.totalSubtasks += data.subtasks.length;
      stats.completedSubtasks += data.subtasks.filter(s => s.completed).length;
    }

    let eff = 0;
    if (resolveProgress) {
      try {
        eff = resolveProgress(id, data);
      } catch { /* keep 0 */ }
    } else {
      eff = fallbackProgress(data);
    }
    progressSum += Number.isFinite(eff) ? Math.max(0, Math.min(100, eff)) : 0;
  }

  stats.completionRate = Math.round((stats.completed / total) * 100);
  stats.avgProgress = Math.round(progressSum / total);
  stats.hasSubtasks = stats.totalSubtasks > 0;
  stats.subtaskRate = stats.hasSubtasks
    ? Math.round((stats.completedSubtasks / stats.totalSubtasks) * 100)
    : 0;

  for (const type of CARD_TYPES) {
    stats.byType[type].percent = Math.round((stats.byType[type].count / total) * 100);
  }
  for (const prio of PRIORITIES) {
    stats.byPriority[prio].percent = Math.round((stats.byPriority[prio].count / total) * 100);
  }

  return stats;
}
