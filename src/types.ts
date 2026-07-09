export type CardType = 'task' | 'question' | 'important' | 'idea' | 'info';
export type Priority = 'none' | 'low' | 'medium' | 'high';

export interface Subtask {
  id: string;
  text: string;
  completed: boolean;
}

export interface TaskCardData {
  taskCard: boolean;
  completed: boolean;
  cardType: CardType;
  priority: Priority;
  progress: number;
  subtasks: Subtask[];
}

export interface PluginSettings {
  completedBorderColor: string;
  completedOpacity: number;
  checkboxSize: number;
  checkboxOffset: number;
  enableAnimations: boolean;
  priorityHighColor: string;
  priorityMediumColor: string;
  priorityLowColor: string;
  typeTaskColor: string;
  typeQuestionColor: string;
  typeImportantColor: string;
  typeIdeaColor: string;
  typeInfoColor: string;
  progressBarHeight: number;
  progressBarColor: string;
  progressBarAutoColor: boolean;
}

export const DEFAULT_SETTINGS: PluginSettings = {
  completedBorderColor: '#4caf50',
  completedOpacity: 0.7,
  checkboxSize: 18,
  checkboxOffset: -14,
  enableAnimations: false,
  priorityHighColor: '#e53935',
  priorityMediumColor: '#fb8c00',
  priorityLowColor: '#43a047',
  typeTaskColor: '#4caf50',
  typeQuestionColor: '#1e88e5',
  typeImportantColor: '#e53935',
  typeIdeaColor: '#fdd835',
  typeInfoColor: '#00acc1',
  progressBarHeight: 4,
  progressBarColor: '#4caf50',
  progressBarAutoColor: true,
};

export interface PersistedPluginData {
  settings?: Partial<PluginSettings>;
  taskData?: Record<string, Record<string, TaskCardData>>;
}

// ── Canvas API types ──

export interface CanvasNodeData {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  file?: string;
  color?: string;
}

export interface ExtendedCanvasNode {
  id: string;
  type: string;
  text?: string;
  file?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  elementEl?: HTMLElement;
  containerEl?: HTMLElement;
  contentEl?: HTMLElement;
  getData(): Record<string, unknown>;
  setData(data: Record<string, unknown>): void;
}

export interface SelectionData {
  nodes: Array<{ id: string }>;
}

export interface CanvasMenu {
  menuEl: HTMLElement;
  render(...args: unknown[]): void;
}

export interface CanvasSelection {
  size: number;
  values(): IterableIterator<unknown>;
  forEach(fn: (...args: unknown[]) => void): void;
  [Symbol.iterator](): IterableIterator<unknown>;
}

export interface ExtendedCanvas {
  nodes: Map<string, ExtendedCanvasNode> | Record<string, ExtendedCanvasNode>;
  wrapperEl: HTMLElement;
  nodeEl?: HTMLElement;
  containerEl?: HTMLElement;
  selection: CanvasSelection | Set<unknown> | Map<string, unknown>;
  menu?: CanvasMenu;
  on(event: string, cb: (...args: unknown[]) => void): void;
  off(event: string, cb: (...args: unknown[]) => void): void;
  requestSave(): void;
  getData(): { nodes: CanvasNodeData[] };
  setData(data: { nodes: CanvasNodeData[] }): void;
  getSelectionData(): SelectionData;
  posFromEvt(evt: MouseEvent): { x: number; y: number } | null;
  createTextNode(config: {
    pos: { x: number; y: number };
    size: { width: number; height: number };
    text: string;
  }): ExtendedCanvasNode | null;
  createNode(
    type: string,
    config: { x: number; y: number; width: number; height: number; text: string },
  ): ExtendedCanvasNode | null;
  addNode(
    type: string,
    config: { x: number; y: number; width: number; height: number; text: string },
  ): ExtendedCanvasNode | null;
}
