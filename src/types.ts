export type CardType = 'task' | 'question' | 'important' | 'idea' | 'info';
export type Priority = 'none' | 'low' | 'medium' | 'high';

export interface TaskCardData {
  taskCard: boolean;
  completed: boolean;
  cardType: CardType;
  priority: Priority;
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
};

export interface CanvasNode {
  id: string;
  type: string;
  text?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  elementEl?: HTMLElement;
  containerEl: HTMLElement;
  contentEl: HTMLElement;
  isEditing: boolean;
  setColor(color: string): void;
  setData(data: Record<string, unknown>): void;
  getData(): Record<string, unknown>;
}

export interface Canvas {
  nodes: Map<string, CanvasNode>;
  edges: Map<string, unknown>;
  wrapperEl: HTMLElement;
  view: {
    currentZoom: number;
  };
  selection: Set<CanvasNode> | Map<string, CanvasNode> | CanvasNode[];
  on(event: string, cb: (...args: unknown[]) => void): void;
  off(event: string, cb: (...args: unknown[]) => void): void;
  requestSave(): void;
}

export interface CanvasView {
  canvas: Canvas;
  file: { path: string } | null;
}

export interface PersistedPluginData {
  settings?: Partial<PluginSettings>;
  taskData?: Record<string, Record<string, TaskCardData>>;
}
