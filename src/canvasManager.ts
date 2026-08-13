import { Menu, Notice, activeDocument, setIcon, setTooltip } from 'obsidian';
import type CanvasTaskCardsPlugin from './main';
import type {
  CardType,
  Priority,
  ExtendedCanvas,
  ExtendedCanvasNode,
  FilterState,
} from './types';
import { TaskRenderer } from './renderer';
import { TASK_CARD_DATA_KEY } from './storage';

export class CanvasManager {
  plugin: CanvasTaskCardsPlugin;
  renderer: TaskRenderer;
  activeCanvas: ExtendedCanvas | null = null;
  currentCanvasPath: string = '';
  private cleanupFns: Array<() => void> = [];
  private mutationObserver: MutationObserver | null = null;
  private canvasRetryCount: number = 0;
  private canvasRetryTimeout: number | null = null;
  private lastContextMenuEvent: MouseEvent | null = null;
  private filterState: FilterState | null = null;
  private toolbarEl: HTMLElement | null = null;
  private selectedTaskNodeId: string | null = null;

  private get doc(): Document {
    return activeDocument ?? document;
  }

  private getNodeFromCanvas(canvas: ExtendedCanvas | null, nodeId: string): ExtendedCanvasNode | null {
    if (!canvas?.nodes) return null;
    const nodes = canvas.nodes;
    if (nodes instanceof Map) {
      return nodes.get(nodeId) ?? null;
    }
    return nodes[nodeId] ?? null;
  }

  constructor(plugin: CanvasTaskCardsPlugin) {
    this.plugin = plugin;
    this.renderer = new TaskRenderer(plugin);
  }

  initialize(): void {
    this.plugin.registerEvent(
      this.plugin.app.workspace.on('active-leaf-change', () => {
        this.handleActiveLeaf();
      }),
    );
    this.plugin.registerEvent(
      this.plugin.app.workspace.on('layout-change', () => {
        this.handleActiveLeaf();
      }),
    );

    this.handleActiveLeaf();
  }

  private handleActiveLeaf(): void {
    try {
      const activeLeaf = this.plugin.app.workspace.activeLeaf;
      if (!activeLeaf?.view) {
        this.scheduleRetry();
        return;
      }

      const view = activeLeaf.view as unknown as {
        getViewType: () => string;
        canvas?: ExtendedCanvas;
        file?: { path: string };
      };

      if (typeof view.getViewType !== 'function') {
        this.scheduleRetry();
        return;
      }

      if (view.getViewType() !== 'canvas') {
        this.teardownCanvas();
        return;
      }

      const canvas = view.canvas;
      if (!canvas) {
        this.scheduleRetry();
        return;
      }

      const filePath = view.file?.path ?? '';
      if (canvas !== this.activeCanvas) {
        this.setupCanvas(canvas, filePath);
      }
      this.canvasRetryCount = 0;
    } catch (e: unknown) {
      console.error('Canvas Task Cards: handleActiveLeaf error', e);
      this.teardownCanvas();
    }
  }

  private scheduleRetry(): void {
    if (this.canvasRetryCount < 10) {
      this.canvasRetryCount++;
      this.canvasRetryTimeout = window.setTimeout(
        () => this.handleActiveLeaf(),
        300,
      );
    } else {
      this.teardownCanvas();
    }
  }

  private setupCanvas(canvas: ExtendedCanvas, path: string): void {
    this.teardownCanvas();

    // Remove legacy floating button if any
    this.doc.querySelectorAll('.task-card-floating-btn').forEach(el => el.remove());

    this.activeCanvas = canvas;
    this.currentCanvasPath = path;

    try {
      this.setupSaveHook();
      this.migrateLegacyForPath(path);
      this.filterState = this.plugin.savedFilter ?? null;
      this.patchAllNodesSetData();
      this.processExistingNodes();
      this.applyFilterToAll();
      this.attachCanvasEvents();
      this.attachMutationObserver();
      this.setupContextMenu();
      this.setupPopupMenu();
      this.setupToolbar();
    } catch (e: unknown) {
      console.error('Canvas Task Cards: setupCanvas error', e);
    }
  }

  private teardownCanvas(): void {
    if (this.canvasRetryTimeout !== null) {
      window.clearTimeout(this.canvasRetryTimeout);
      this.canvasRetryTimeout = null;
    }
    this.destroyToolbar();
    this.runCleanup();
    this.activeCanvas = null;
    this.currentCanvasPath = '';
  }

  private processExistingNodes(): void {
    if (!this.activeCanvas) return;
    const nodes = this.activeCanvas.nodes;
    if (!nodes) return;

    const processNode = (node: ExtendedCanvasNode) => {
      if (node && node.id) this.checkAndRender(node);
    };

    if (nodes instanceof Map) {
      nodes.forEach(processNode);
    } else if (typeof nodes === 'object') {
      for (const id of Object.keys(nodes)) {
        processNode(nodes[id]);
      }
    }
  }

  private attachCanvasEvents(): void {
    const canvas = this.activeCanvas;
    if (!canvas || typeof canvas.on !== 'function') return;

    const onNodeAdded = (node: ExtendedCanvasNode) => {
      this.patchNodeSetData(node);
      this.checkAndRender(node);
      if (this.filterState) this.applyFilterToNode(node);
    };
    const onNodeRemoved = (node: ExtendedCanvasNode) => {
      const nodeEl = this.getNodeEl(node);
      if (nodeEl) this.renderer.remove(nodeEl);
      if (node?.id) this.plugin.storage.remove(this.currentCanvasPath, node.id);
    };

    try {
      canvas.on('nodeAdded', onNodeAdded);
      canvas.on('nodeRemoved', onNodeRemoved);
      this.cleanupFns.push(() => {
        try {
          canvas.off('nodeAdded', onNodeAdded);
        } catch { /* noop */ }
        try {
          canvas.off('nodeRemoved', onNodeRemoved);
        } catch { /* noop */ }
      });
    } catch { /* noop */ }
  }

  private attachMutationObserver(): void {
    const wrapper = this.getCanvasWrapper();
    if (!wrapper) return;

    this.mutationObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (let i = 0; i < mutation.addedNodes.length; i++) {
          const el = mutation.addedNodes[i] as HTMLElement;
          if (el.classList?.contains('canvas-node')) {
            this.renderNewNode(el);
          }
        }
      }
    });

    this.mutationObserver.observe(wrapper, {
      childList: true,
      subtree: true,
    });

    this.cleanupFns.push(() => {
      this.mutationObserver?.disconnect();
      this.mutationObserver = null;
    });
  }

  private setupSaveHook(): void {
    const canvas = this.activeCanvas;
    if (!canvas || typeof canvas.requestSave !== 'function') return;
    const orig = canvas.requestSave.bind(canvas);
    const self = this;
    canvas.requestSave = function(...args: unknown[]) {
      self.persistTaskDataToNodes();
      self.pruneCacheRemovedNodes();
      self.syncAllTaskCards();
      // Text-sync may have updated completion; re-inject so the file
      // is written with the latest state.
      self.persistTaskDataToNodes();
      const result = orig(...args);
      return result;
    };
    this.cleanupFns.push(() => {
      canvas.requestSave = orig;
    });
  }

  /**
   * Writes/removes the embedded task-card field on each node's data so the
   * next save serializes it into the `.canvas` file. Must go through
   * `node.setData()` (not raw mutation) — that is the only mechanism Obsidian
   * reliably persists custom node fields (as used by Advanced Canvas).
   */
  private persistTaskDataToNodes(): void {
    const canvas = this.activeCanvas;
    if (!canvas?.nodes) return;
    for (const node of this.getNodeEntries()) {
      if (!node?.id) continue;
      this.patchNodeSetData(node);
      const cache = this.plugin.storage.get(this.currentCanvasPath, node.id);
      try {
        const d = node.getData?.();
        if (!d || typeof d !== 'object') continue;
        const rec = d as Record<string, unknown>;
        if (cache?.taskCard) {
          if (JSON.stringify(rec[TASK_CARD_DATA_KEY]) !== JSON.stringify(cache)) {
            node.setData({ ...rec });
          }
        } else if (rec[TASK_CARD_DATA_KEY] !== undefined) {
          node.setData({ ...rec });
        }
      } catch { /* noop */ }
    }
  }

  /**
   * Wraps a node's `setData` so the latest task-card state from storage is
   * merged into whatever Obsidian writes next. This keeps the embedded field
   * alive across Obsidian's own setData calls (text edits, moves, resizes).
   */
  private patchNodeSetData(node: ExtendedCanvasNode): void {
    if (!node || typeof node.setData !== 'function' || typeof node.getData !== 'function') return;
    const rec = node as unknown as { __ctcSetDataPatched?: boolean };
    if (rec.__ctcSetDataPatched) return;
    rec.__ctcSetDataPatched = true;

    const path = this.currentCanvasPath;
    const id = node.id;
    const origSetData = node.setData.bind(node);
    const self = this;

    node.setData = ((data: Record<string, unknown>) => {
      const cache = self.plugin.storage.get(path, id);
      if (cache?.taskCard) {
        return origSetData({ ...data, [TASK_CARD_DATA_KEY]: cache });
      }
      if (data && data[TASK_CARD_DATA_KEY] !== undefined) {
        const stripped = { ...data };
        delete stripped[TASK_CARD_DATA_KEY];
        return origSetData(stripped);
      }
      return origSetData(data);
    }) as ExtendedCanvasNode['setData'];
  }

  private patchAllNodesSetData(): void {
    if (!this.activeCanvas?.nodes) return;
    for (const node of this.getNodeEntries()) {
      if (node?.id) this.patchNodeSetData(node);
    }
  }

  /** Drops cached data for nodes that no longer exist on the canvas. */
  private pruneCacheRemovedNodes(): void {
    const canvas = this.activeCanvas;
    if (!canvas?.nodes) return;
    const ids = new Set(
      this.getNodeEntries().filter(n => n && n.id).map(n => n.id as string),
    );
    const cached = this.plugin.storage.getAll(this.currentCanvasPath);
    for (const id of Object.keys(cached)) {
      if (!ids.has(id)) {
        this.plugin.storage.remove(this.currentCanvasPath, id);
      }
    }
  }

  /**
   * One-time migration from the old plugin-data store into the embedded
   * canvas-file fields. Orphaned legacy entries (deleted/renamed nodes) are
   * dropped here as well.
   */
  private migrateLegacyForPath(path: string): void {
    if (!this.plugin.storage.hasLegacy(path)) return;
    const nodeIds = new Set(
      this.getNodeEntries().filter(n => n && n.id).map(n => n.id as string),
    );
    let migrated = 0;
    for (const id of this.plugin.storage.getLegacyIds(path)) {
      const legacy = this.plugin.storage.getLegacy(path, id);
      if (!legacy) {
        this.plugin.storage.removeLegacy(path, id);
        migrated++;
        continue;
      }
      if (nodeIds.has(id)) {
        if (!this.plugin.storage.has(path, id)) {
          this.plugin.storage.set(path, id, legacy);
        }
        migrated++;
      } else {
        // Node was deleted; drop the dangling record.
        migrated++;
      }
      this.plugin.storage.removeLegacy(path, id);
    }
    this.plugin.storage.cleanupLegacyPath(path);
    if (migrated > 0) {
      void this.plugin.saveSettings();
      this.flushTaskData();
    }
  }

  /** Forces a canvas save so embedded task data is written to the file. */
  private flushTaskData(): void {
    this.activeCanvas?.requestSave?.();
  }

  private syncAllTaskCards(): void {
    const canvas = this.activeCanvas;
    if (!canvas?.nodes) return;
    const entries = this.getNodeEntries();
    for (const node of entries) {
      if (!node?.id) continue;
      const cardData = this.ensureTaskData(node);
      if (!cardData?.taskCard || cardData.progress >= 0) continue;
      const text = node.text || (node.getData ? (node.getData() as Record<string, unknown>).text as string : '') || '';
      const cp = this.renderer.calcCheckboxProgressFromText(text);
      if (cp < 0) continue;
      const nodeEl = this.getNodeEl(node);
      if (!nodeEl) continue;
      this.applySync(nodeEl, node.id, cardData, cp);
    }
  }

  private applySync(nodeEl: HTMLElement, nodeId: string, data: import('./types').TaskCardData, cp: number): void {
    const container = nodeEl.querySelector('.canvas-node-container') as HTMLElement;
    if (container) container.dataset.pbLastCp = String(cp);

    if (cp === 100 && !data.completed) {
      data.completed = true;
      this.plugin.storage.set(this.currentCanvasPath, nodeId, data);
      void this.plugin.saveSettings();
      this.renderer.update(nodeEl, data);
    } else if (cp !== 100 && data.completed) {
      data.completed = false;
      this.plugin.storage.set(this.currentCanvasPath, nodeId, data);
      void this.plugin.saveSettings();
      this.renderer.update(nodeEl, data);
    } else {
      const fill = container?.querySelector('.task-progress-fill') as HTMLElement;
      if (fill) fill.style.height = `${cp}%`;
    }
  }

  private getCanvasWrapper(): HTMLElement | null {
    const canvas = this.activeCanvas;
    if (!canvas) return null;
    return canvas.wrapperEl || canvas.nodeEl || canvas.containerEl || null;
  }

  private renderNewNode(nodeEl: HTMLElement): void {
    const dataId = nodeEl.dataset?.id;
    if (dataId) {
      const node = this.getNodeFromCanvas(this.activeCanvas, dataId);
      if (node) { this.renderNodeOnElement(nodeEl, node); return; }
    }
    if (this.activeCanvas?.nodes) {
      const entries = this.getNodeEntries();
      for (const n of entries) {
        if (n.elementEl === nodeEl) {
          this.renderNodeOnElement(nodeEl, n);
          return;
        }
      }
    }
    const pos = this.parseTransformPosition(nodeEl.style.transform);
    if (pos && this.activeCanvas?.nodes) {
      const entries = this.getNodeEntries();
      for (const n of entries) {
        if (typeof n.x === 'number' && typeof n.y === 'number' &&
            Math.abs(n.x - pos.x) < 5 && Math.abs(n.y - pos.y) < 5) {
          this.renderNodeOnElement(nodeEl, n);
          return;
        }
      }
    }
  }

  private setupContextMenu(): void {
    this.trackRightClickPosition();

    // Method 1: Try workspace event (modern Obsidian)
    this.tryWorkspaceContextMenu();

    // Method 2: Native "Add Task Card" in the empty-space menu
    this.patchEmptySpaceMenu();
  }

  private trackRightClickPosition(): void {
    const wrapper = this.getCanvasWrapper();
    if (!wrapper) return;

    const handler = (e: MouseEvent) => {
      this.lastContextMenuEvent = e;
    };
    wrapper.addEventListener('contextmenu', handler, true);
    this.cleanupFns.push(() => {
      wrapper.removeEventListener('contextmenu', handler, true);
    });
  }

  private tryWorkspaceContextMenu(): void {
    try {
      const eventName = 'canvas:node-menu';
      const handler = (menu: {
        addSeparator: () => void;
        addItem: (cb: (item: { setTitle: (t: string) => void; onClick: (fn: () => void) => void }) => void) => void;
      }, node: ExtendedCanvasNode) => {
        try {
          if (!node || !node.id) return;
          let resolvedNode = node;
          if (!node.type || (!node.file && !node.text)) {
            const resolved = this.resolveNode(node.id);
            if (resolved) resolvedNode = resolved;
          }
          if (resolvedNode.type !== 'text' && resolvedNode.type !== 'file') return;
          this.handleNodeContextMenuViaApi(menu, resolvedNode);
        } catch (e: unknown) {
          console.error('Canvas Task Cards: canvas:node-menu handler error', e);
        }
      };
      const ws = this.plugin.app.workspace;
      const wsOn = (ws as unknown as Record<string, (...args: unknown[]) => void>).on;
      wsOn(eventName, handler);
      this.cleanupFns.push(() => {
        try { (ws as unknown as Record<string, (...args: unknown[]) => void>).off?.(eventName, handler); } catch { /* noop */ }
      });
    } catch (e: unknown) {
      console.error('Canvas Task Cards: Error registering workspace event', e);
    }
  }

  /**
   * Adds a native "Add Task Card" entry to Obsidian's empty-space canvas
   * context menu.
   *
   * Obsidian builds that menu with a plain `Menu` and opens it via
   * `Menu.prototype.showAtMouseEvent` without firing any workspace event
   * (the canvas only emits `canvas:node-menu`, `canvas:edge-menu` and
   * `canvas:selection-menu`). We therefore wrap `showAtMouseEvent` and, when
   * the clicked target is the `.canvas-wrapper` element itself (Obsidian's
   * own empty-space guard is `event.targetNode === wrapperEl`), append a
   * native item with the "create" section so it groups with Obsidian's
   * own "Add card / Add note / ..." actions.
   */
  private patchEmptySpaceMenu(): void {
    try {
      const proto = Menu.prototype as unknown as {
        showAtMouseEvent: (evt: MouseEvent) => Menu;
      } & Record<string, unknown>;
      if (proto.__ctcMenuPatched) return;
      proto.__ctcMenuPatched = true;

      const origShowAtMouseEvent = proto.showAtMouseEvent;
      const self = this;

      proto.showAtMouseEvent = function (this: Menu, evt: MouseEvent) {
        try {
          const target = evt?.target as Element | null;
          if (target && target.classList.contains('canvas-wrapper')) {
            this.addItem((item) => {
              item
                .setSection('create')
                .setTitle('Add Task Card')
                .setIcon('list-todo')
                .onClick(() => self.addNewTaskCard());
              (item as unknown as { dom?: HTMLElement }).dom?.addClass?.('task-card-add-item');
            });
          }
        } catch (e: unknown) {
          console.error('Canvas Task Cards: empty-space menu injection error', e);
        }
        return origShowAtMouseEvent.call(this, evt);
      };

      this.cleanupFns.push(() => {
        proto.showAtMouseEvent = origShowAtMouseEvent;
        delete proto.__ctcMenuPatched;
      });
    } catch (e: unknown) {
      console.error('Canvas Task Cards: Error patching empty-space menu', e);
    }
  }

  private cardTypeLabels: Array<[CardType, string]> = [
    ['task', 'Task'],
    ['question', 'Question'],
    ['important', 'Important'],
    ['idea', 'Idea'],
    ['info', 'Info'],
  ];

  private priorityLabels: Array<[Priority, string]> = [
    ['none', 'None'],
    ['low', 'Low'],
    ['medium', 'Medium'],
    ['high', 'High'],
  ];

  private handleNodeContextMenuViaApi(menu: {
    addSeparator: () => void;
    addItem: (cb: (item: { setTitle: (t: string) => void; onClick: (fn: () => void) => void }) => void) => void;
  }, node: ExtendedCanvasNode): void {
    const isTask = this.plugin.storage.has(this.currentCanvasPath, node.id);
    const data = isTask ? this.plugin.storage.get(this.currentCanvasPath, node.id) : null;

    menu.addSeparator();

    if (isTask && data) {
      menu.addItem((item: { setTitle: (t: string) => void; onClick: (fn: () => void) => void }) => {
        item.setTitle(data.completed ? '↩ Mark Todo' : '✓ Mark Completed');
        item.onClick(() => void this.handleCheckboxClick(node.id));
      });

      menu.addItem((item: { setTitle: (t: string) => void; onClick: (fn: () => void) => void }) => {
        item.setTitle('Convert to Normal Card');
        item.onClick(() => void this.convertToNormal(node.id));
      });
    } else {
      menu.addItem((item: { setTitle: (t: string) => void; onClick: (fn: () => void) => void }) => {
        item.setTitle('Convert to Task Card');
        item.onClick(() => void this.convertToTask(node.id));
      });
    }
  }

  // ── Floating popup toolbar injection (card appearance area) ──

  private setupPopupMenu(): void {
    const canvas = this.activeCanvas;
    if (!canvas?.menu?.menuEl) return;

    const menu = canvas.menu;
    if (!menu) return;
    const origRender = menu.render.bind(menu);

    menu.render = (...args: unknown[]) => {
      origRender.call(menu, ...args);
      try { this.injectIntoPopupMenu(menu); }
      catch (e: unknown) { console.error('Canvas Task Cards: popup inject error', e); }
    };

    this.cleanupFns.push(() => { menu.render = origRender; });
  }

  private injectIntoPopupMenu(menu: { menuEl: HTMLElement }): void {
    const menuEl = menu.menuEl;
    if (!menuEl) return;

    // Remove old injected controls
    menuEl.querySelectorAll('.task-card-popup-controls, .task-card-type-btn, .task-card-prio-btn, .canvas-submenu').forEach((el: Element) => el.remove());

    const nodeId = this.getSelectedNodeId();
    if (!nodeId) return;

    const data = this.plugin.storage.get(this.currentCanvasPath, nodeId);
    if (!data?.taskCard) return;

    const typeIcons: Record<CardType, string> = {
      task: 'checkbox-glyph',
      question: 'help',
      important: 'alert-triangle',
      idea: 'lightbulb',
      info: 'info',
    };

    const priorityIcons: Record<Priority, string> = {
      none: 'minus',
      low: 'arrow-down',
      medium: 'equal',
      high: 'arrow-up',
    };

    // ── Build type submenu options ──
    const typeOptions = this.cardTypeLabels.map(([t, label]) => ({
      label,
      icon: typeIcons[t],
      callback: () => void this.setCardType(nodeId, t),
    }));

    // ── Build priority submenu options ──
    const priorityOptions = this.priorityLabels.map(([p, label]) => ({
      label,
      icon: priorityIcons[p],
      callback: () => void this.setPriority(nodeId, p),
    }));

    // ── Create Type button (expandable) ──
    const typeBtn = this.doc.createElement('button');
    typeBtn.className = 'clickable-icon task-card-type-btn';
    setIcon(typeBtn, typeIcons[data.cardType]);
    setTooltip(typeBtn, `Type: ${this.cardTypeLabels.find(([t]) => t === data.cardType)?.[1] ?? data.cardType}`, { placement: 'top' });
    this.setupExpandableButton(typeBtn, menuEl, typeOptions);
    menuEl.insertBefore(typeBtn, menuEl.firstChild);

    // ── Create Priority button (expandable) ──
    const prioBtn = this.doc.createElement('button');
    prioBtn.className = 'clickable-icon task-card-prio-btn';
    setIcon(prioBtn, priorityIcons[data.priority]);
    setTooltip(prioBtn, `Priority: ${this.priorityLabels.find(([p]) => p === data.priority)?.[1] ?? data.priority}`, { placement: 'top' });
    this.setupExpandableButton(prioBtn, menuEl, priorityOptions);
    menuEl.insertBefore(prioBtn, menuEl.firstChild);
  }

  private setupExpandableButton(btn: HTMLElement, parentEl: HTMLElement, options: Array<{ label: string; icon: string; callback: () => void }>): void {
    btn.addEventListener('click', () => {
      const existingSubmenu = parentEl.querySelector('.canvas-submenu');
      if (existingSubmenu) {
        existingSubmenu.remove();
        btn.classList.remove('has-active-menu');
        return;
      }

      // Close any other open submenus
      parentEl.querySelectorAll('.canvas-submenu').forEach(el => el.remove());
      parentEl.querySelectorAll('.has-active-menu').forEach(el => el.classList.remove('has-active-menu'));

      btn.classList.add('has-active-menu');

      const submenu = this.doc.createElement('div');
      submenu.className = 'canvas-submenu';

      for (const opt of options) {
        const optBtn = this.doc.createElement('button');
        optBtn.className = 'clickable-icon';
        setIcon(optBtn, opt.icon);
        setTooltip(optBtn, opt.label, { placement: 'top' });
        optBtn.addEventListener('click', (e: MouseEvent) => {
          e.stopPropagation();
          opt.callback();
          submenu.remove();
          btn.classList.remove('has-active-menu');
          // Update the button icon to reflect new selection
          setIcon(btn, opt.icon);
          setTooltip(btn, opt.label, { placement: 'top' });
        });
        submenu.appendChild(optBtn);
      }

      parentEl.appendChild(submenu);
    });
  }

  private getSelectedNodeId(): string | null {
    const canvas = this.activeCanvas;
    if (!canvas) return null;
    try {
      const sel = canvas.getSelectionData?.()?.nodes;
      if (sel && sel.length === 1) return sel[0].id;
      // Fallback: iterate selection
      if (canvas.selection && typeof canvas.selection.size === 'number' && canvas.selection.size === 1) {
        for (const id of canvas.selection as Iterable<string>) return id;
      }
    } catch { /* noop */ }
    return null;
  }

  // ── Top toolbar (card type, priority, toggle) ──

  private setupToolbar(): void {
    const wrapper = this.getCanvasWrapper();
    if (!wrapper) return;

    const toolbar = this.doc.createElement('div');
    toolbar.className = 'task-toolbar';

    // Card Type buttons
    const typeGroup = this.doc.createElement('div');
    typeGroup.className = 'task-toolbar-group';

    const typeLabel = this.doc.createElement('span');
    typeLabel.className = 'task-toolbar-label';
    typeLabel.textContent = 'Type';
    typeGroup.appendChild(typeLabel);

    for (const [t, label] of this.cardTypeLabels) {
      const btn = this.doc.createElement('button');
      btn.className = 'task-type-btn';
      btn.dataset.cardType = t;
      btn.textContent = label;
      btn.addEventListener('click', () => {
        if (this.selectedTaskNodeId) {
          void this.setCardType(this.selectedTaskNodeId, t);
          this.updateToolbarState();
        }
      });
      typeGroup.appendChild(btn);
    }

    toolbar.appendChild(typeGroup);

    // Priority buttons
    const prioGroup = this.doc.createElement('div');
    prioGroup.className = 'task-toolbar-group';

    const prioLabel = this.doc.createElement('span');
    prioLabel.className = 'task-toolbar-label';
    prioLabel.textContent = 'Priority';
    prioGroup.appendChild(prioLabel);

    for (const [p, label] of this.priorityLabels) {
      const btn = this.doc.createElement('button');
      btn.className = 'task-prio-btn';
      btn.dataset.priority = p;
      btn.textContent = label;
      btn.addEventListener('click', () => {
        if (this.selectedTaskNodeId) {
          void this.setPriority(this.selectedTaskNodeId, p);
          this.updateToolbarState();
        }
      });
      prioGroup.appendChild(btn);
    }

    toolbar.appendChild(prioGroup);

    // Toggle button
    const toggleBtn = this.doc.createElement('button');
    toggleBtn.className = 'task-toolbar-toggle';
    toggleBtn.textContent = '✓ Done';
    toggleBtn.addEventListener('click', () => {
      if (this.selectedTaskNodeId) {
        void this.handleCheckboxClick(this.selectedTaskNodeId);
        this.updateToolbarState();
      }
    });
    toolbar.appendChild(toggleBtn);

    this.doc.body.appendChild(toolbar);
    this.toolbarEl = toolbar;

    // Show/hide on card click via document mousedown (capture phase)
    // This fires before Obsidian's own handlers
    const mousedownHandler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      // Don't hide when clicking inside the toolbar
      if (target.closest('.task-toolbar')) return;

      const nodeEl = target.closest<HTMLElement>('.canvas-node');
      if (nodeEl) {
        let nodeId: string | null = nodeEl.dataset?.id ?? null;
        if (!nodeId) nodeId = this.findNodeIdByElement(nodeEl);
        if (nodeId && this.plugin.storage.has(this.currentCanvasPath, nodeId)) {
          this.showToolbar(nodeId);
          return;
        }
      }
      this.hideToolbar();
    };
    this.doc.addEventListener('mousedown', mousedownHandler, true);
    this.cleanupFns.push(() => this.doc.removeEventListener('mousedown', mousedownHandler, true));
  }

  private showToolbar(nodeId: string): void {
    if (!this.toolbarEl) return;
    this.selectedTaskNodeId = nodeId;
    this.updateToolbarState();
    this.toolbarEl.classList.add('is-visible');
  }

  private hideToolbar(): void {
    if (this.toolbarEl) this.toolbarEl.classList.remove('is-visible');
    this.selectedTaskNodeId = null;
  }

  private updateToolbarState(): void {
    if (!this.toolbarEl || !this.selectedTaskNodeId) return;
    const data = this.plugin.storage.get(this.currentCanvasPath, this.selectedTaskNodeId);
    if (!data) return;

    this.toolbarEl.querySelectorAll('.task-type-btn').forEach(btn => {
      btn.classList.toggle('is-active', (btn as HTMLElement).dataset.cardType === data.cardType);
    });
    this.toolbarEl.querySelectorAll('.task-prio-btn').forEach(btn => {
      btn.classList.toggle('is-active', (btn as HTMLElement).dataset.priority === data.priority);
    });
    const toggleBtn = this.toolbarEl.querySelector('.task-toolbar-toggle');
    if (toggleBtn) toggleBtn.textContent = data.completed ? '↩ Todo' : '✓ Done';
  }

  private destroyToolbar(): void {
    this.hideToolbar();
    if (this.toolbarEl) {
      this.toolbarEl.remove();
      this.toolbarEl = null;
    }
  }

  private findNodeIdByElement(nodeEl: HTMLElement): string | null {
    const nodes = this.activeCanvas?.nodes;
    if (!nodes) return null;

    if (nodes instanceof Map) {
      for (const n of nodes.values()) {
        if (n.elementEl === nodeEl) return n.id;
      }
      return null;
    }
    if (typeof nodes === 'object') {
      for (const id of Object.keys(nodes)) {
        if (nodes[id]?.elementEl === nodeEl) return id;
      }
    }
    return null;
  }

  addNewTaskCard(): void {
    const canvas = this.activeCanvas;
    if (!canvas) return;

    let x = 100;
    let y = 100;

    if (this.lastContextMenuEvent) {
      if (typeof canvas.posFromEvt === 'function') {
        const p = canvas.posFromEvt(this.lastContextMenuEvent);
        if (p && typeof p.x === 'number' && typeof p.y === 'number') {
          x = p.x;
          y = p.y;
        }
      }
    }


    // Method 1: Use createTextNode (works with advanced-canvas, returns initialized node)
    if (this.createNodeViaCreateTextNode(canvas, x, y)) return;

    // Method 2: Use canvas data API (bypasses addNode patching)
    const created = this.createNodeViaData(canvas, x, y);
    if (created) {
      this.finalizeNode(canvas, created);
      return;
    }

    // Method 3: try addNode as fallback
    this.createNodeViaAddNode(canvas, x, y);
  }

  private createNodeViaCreateTextNode(canvas: ExtendedCanvas, x: number, y: number): boolean {
    try {
      let node: ExtendedCanvasNode | null = null;

      if (typeof canvas.createTextNode === 'function') {
        node = canvas.createTextNode({
          pos: { x, y },
          size: { width: 300, height: 200 },
          text: '',
        });
      }

      if (!node || !node.id) {
        console.warn('Canvas Task Cards: createTextNode returned no node');
        return false;
      }

      this.finalizeNode(canvas, node.id);

      // Immediately render if element is available
      if (node.elementEl) {
        this.checkAndRender(node);
      }

      return true;
    } catch (e: unknown) {
      console.warn('Canvas Task Cards: createTextNode failed', e instanceof Error ? e.message.slice(0, 100) : e);
      return false;
    }
  }

  private createNodeViaData(canvas: ExtendedCanvas, x: number, y: number): string | null {
    try {
      if (typeof canvas.getData !== 'function' || typeof canvas.setData !== 'function') {
        console.warn('Canvas Task Cards: getData/setData not available');
        return null;
      }

      const data = canvas.getData();
      if (!data || !data.nodes || !Array.isArray(data.nodes)) {
        console.warn('Canvas Task Cards: invalid canvas data format');
        return null;
      }

      const id = Array.from({ length: 16 }, () =>
        Math.floor(Math.random() * 16).toString(16)
      ).join('');

      data.nodes.push({
        id,
        type: 'text',
        x,
        y,
        width: 300,
        height: 200,
        text: '',
      });

      canvas.setData(data);
      canvas.requestSave();


      // Wait for canvas to create the node (logging only — finalizeNode already called from addNewTaskCard)
      let attempts = 0;
      const check = () => {
        attempts++;
        const n = this.getNodeFromCanvas(canvas, id);
        if (n) {
          return;
        }
        if (attempts < 30) {
          window.setTimeout(check, 100);
        } else {
          console.error('Canvas Task Cards: node never appeared after setData');
        }
      };
      window.setTimeout(check, 100);

      return id;
    } catch (e: unknown) {
      console.warn('Canvas Task Cards: createNodeViaData failed', e instanceof Error ? e.message.slice(0, 100) : e);
      return null;
    }
  }

  private createNodeViaAddNode(canvas: ExtendedCanvas, x: number, y: number): void {
    try {
      let node: ExtendedCanvasNode | null = null;
      try {
        if (typeof canvas.addNode === 'function') {
          node = canvas.addNode('text', { x, y, width: 300, height: 200, text: '' });
        } else if (typeof canvas.createNode === 'function') {
          node = (canvas as unknown as Record<string, (...args: unknown[]) => ExtendedCanvasNode | null>).createNode?.({ type: 'text', x, y, width: 300, height: 200, text: '' }) ?? null;
        } else if (typeof canvas.createTextNode === 'function') {
          node = canvas.createTextNode({ pos: { x, y }, size: { width: 300, height: 200 }, text: '' });
        }
      } catch (e: unknown) {
        console.warn('Canvas Task Cards: addNode threw', e instanceof Error ? e.message.slice(0, 100) : e);
        try {
          const proto = Object.getPrototypeOf(canvas) as Record<string, unknown>;
          const unpatched = proto.addNode;
          if (typeof unpatched === 'function' && unpatched !== canvas.addNode) {
            node = unpatched.call(canvas, 'text', { x, y, width: 300, height: 200, text: '' }) as ExtendedCanvasNode | null;
          }
        } catch (e2: unknown) {
          console.warn('Canvas Task Cards: unpatched addNode also failed', e2 instanceof Error ? e2.message.slice(0, 100) : e2);
        }
      }

      if (!node || !node.id) {
        const found = this.findNodeAtPosition(canvas, x, y);
        if (found) {
          node = found;
        }
      }

      if (node && node.id) {
        this.finalizeNode(canvas, node.id);
        const tryRender = (n: ExtendedCanvasNode, attempts: number) => {
          if (n.elementEl && n.elementEl.isConnected) {
            this.checkAndRender(n);
            return;
          }
          if (attempts > 0) window.setTimeout(() => tryRender(n, attempts - 1), 150);
        };
        tryRender(node, 10);
      } else {
        console.error('Canvas Task Cards: all addNode methods failed');
        new Notice('Canvas Task Cards: Could not create node');
      }
    } catch (e: unknown) {
      console.error('Canvas Task Cards: createNodeViaAddNode error', e);
      new Notice('Canvas Task Cards: Could not create node');
    }
  }

  private finalizeNode(canvas: ExtendedCanvas, nodeId: string): void {
    this.plugin.storage.set(this.currentCanvasPath, nodeId, {
      taskCard: true,
      completed: false,
      cardType: 'task',
      priority: 'none',
      progress: -1,
      subtasks: [],
    });
    void this.plugin.saveSettings();
    this.flushTaskData();

    const renderCheck = (retries: number) => {
      const n = this.getNodeFromCanvas(canvas, nodeId);
      const el = n ? this.getNodeEl(n) : null;

      if (el && el.isConnected) {
        this.checkAndRender(n!);
        return;
      }
      if (retries > 0) {
        window.setTimeout(() => renderCheck(retries - 1), 200);
      } else {
        // Final try: mutation observer may still fire
        if (n) this.checkAndRender(n);
      }
    };
    renderCheck(30);
  }

  private findNodeAtPosition(canvas: ExtendedCanvas, x: number, y: number): ExtendedCanvasNode | null {
    const nodes = canvas.nodes;
    if (!nodes) return null;

    const matches: ExtendedCanvasNode[] = [];
    if (nodes instanceof Map) {
      nodes.forEach((n: ExtendedCanvasNode) => {
        if (n && Math.abs(n.x - x) < 2 && Math.abs(n.y - y) < 2) {
          matches.push(n);
        }
      });
    } else if (typeof nodes === 'object') {
      for (const id of Object.keys(nodes)) {
        const n = nodes[id];
        if (n && Math.abs(n.x - x) < 2 && Math.abs(n.y - y) < 2) {
          matches.push(n);
        }
      }
    }

    if (matches.length > 0) {
      matches.sort((a, b) => b.y - a.y);
      return matches[0];
    }
    return null;
  }

  private getNodeEl(node: ExtendedCanvasNode): HTMLElement | null {
    if (node?.elementEl) return node.elementEl;
    if (!node?.id) return null;

    // Try data-id query
    let el = this.doc.querySelector<HTMLElement>(`.canvas-node[data-id="${node.id}"]`);
    if (el) return el;

    // Try within wrapper
    const wrapper = this.getCanvasWrapper();
    if (wrapper) {
      el = wrapper.querySelector<HTMLElement>(`.canvas-node[data-id="${node.id}"]`);
      if (el) return el;
    }

    // Fallback: position matching
    if (typeof node.x === 'number' && typeof node.y === 'number') {
      const allNodes = (wrapper || this.doc).querySelectorAll('.canvas-node');
      for (let i = 0; i < allNodes.length; i++) {
        const nodeEl = allNodes[i] as HTMLElement;
        const pos = this.parseTransformPosition(nodeEl.style.transform);
        if (pos && Math.abs(node.x - pos.x) < 5 && Math.abs(node.y - pos.y) < 5) {
          return nodeEl;
        }
      }
    }

    return null;
  }

  private getNodeEntries(): ExtendedCanvasNode[] {
    if (!this.activeCanvas?.nodes) return [];
    const nodes = this.activeCanvas.nodes;
    if (nodes instanceof Map) {
      return [...nodes.values()];
    }
    return Object.values(nodes);
  }

  private parseTransformPosition(transform: string): { x: number; y: number } | null {
    if (!transform) return null;
    const m = transform.match(/translate\(\s*([\d.-]+)px?\s*,\s*([\d.-]+)px?\s*\)/);
    if (m) return { x: parseFloat(m[1]), y: parseFloat(m[2]) };
    const mm = transform.match(/matrix\([^,]+,[^,]+,[^,]+,[^,]+,([^,]+),([^)]+)\)/);
    if (mm) return { x: parseFloat(mm[1]), y: parseFloat(mm[2]) };
    return null;
  }

  /**
   * Returns task data for a node, loading it from the embedded canvas-file
   * field when the cache doesn't have it yet.
   */
  private ensureTaskData(node: ExtendedCanvasNode): import('./types').TaskCardData | undefined {
    if (!node?.id) return undefined;
    if (this.plugin.storage.has(this.currentCanvasPath, node.id)) {
      this.patchNodeSetData(node);
      return this.plugin.storage.get(this.currentCanvasPath, node.id);
    }
    try {
      const d = node.getData?.() as Record<string, unknown> | undefined;
      const embedded = this.plugin.storage.readEmbedded(d);
      if (embedded?.taskCard) {
        this.plugin.storage.set(this.currentCanvasPath, node.id, embedded);
        this.patchNodeSetData(node);
        return embedded;
      }
    } catch { /* noop */ }
    return undefined;
  }

  private renderNodeOnElement(nodeEl: HTMLElement, node: ExtendedCanvasNode): void {
    if (!node || !node.id) return;
    let nodeType = node.type;
    if (!nodeType && typeof node.getData === 'function') {
      try { nodeType = node.getData().type as string; } catch { /* noop */ }
    }
    if (!nodeType && node.text !== undefined) nodeType = 'text' as const;
    if (!nodeType && node.file) nodeType = 'file' as const;
    if (nodeType !== 'text' && nodeType !== 'file') return;
    const data = this.ensureTaskData(node);
    if (!data?.taskCard) return;
    this.renderer.render(nodeEl, node.id, data);
  }

  private checkAndRender(node: ExtendedCanvasNode): void {
    if (!node || !node.id) return;
    const nodeEl = this.getNodeEl(node);
    if (!nodeEl) return;
    const nodeType = node.type || (node.getData?.()?.type as string);
    if (nodeType !== 'text' && nodeType !== 'file') return;
    const data = this.ensureTaskData(node);
    if (!data?.taskCard) return;
    this.renderer.render(nodeEl, node.id, data);
  }

  private runCleanup(): void {
    if (this.activeCanvas) {
      const wrapper = this.getCanvasWrapper();
      if (wrapper) {
        wrapper
          .querySelectorAll('.task-indicator')
          .forEach((el) => el.remove());
        wrapper
          .querySelectorAll('.is-task-card, .is-completed, .filtered-out')
          .forEach((el) => {
            el.classList.remove('is-task-card', 'is-completed', 'filtered-out');
          });
      }
    }
    for (const fn of this.cleanupFns) {
      try {
        fn();
      } catch { /* noop */ }
    }
    this.cleanupFns = [];
  }

  private resolveNode(nodeId: string): ExtendedCanvasNode | null {
    return this.getNodeFromCanvas(this.activeCanvas, nodeId);
  }

  async handleCheckboxClick(nodeId: string): Promise<void> {
    const node = this.resolveNode(nodeId);
    if (!node) return;
    const nodeEl = this.getNodeEl(node);
    if (!nodeEl) return;

    const data = this.plugin.storage.toggle(this.currentCanvasPath, nodeId);
    this.setAllCardCheckboxes(nodeId, data.completed);
    await this.plugin.saveSettings();
    this.renderer.update(nodeEl, data);
    this.flushTaskData();
  }

  private setAllCardCheckboxes(nodeId: string, checked: boolean): void {
    const canvas = this.activeCanvas;
    if (!canvas) return;
    const node = this.resolveNode(nodeId);
    if (!node || typeof node.getData !== 'function' || typeof node.setData !== 'function') return;
    try {
      const nd = node.getData() as { text?: string };
      const text = nd.text || '';
      const newText = text.replace(/- \[[ xX]?\]/g, checked ? '- [x]' : '- [ ]');
      if (newText === text) return;
      nd.text = newText;
      node.setData(nd);
      canvas.requestSave();
    } catch (e) {
      console.error('Canvas Task Cards: setAllCardCheckboxes error', e);
    }
  }

  async convertToTask(nodeId: string): Promise<void> {
    const node = this.resolveNode(nodeId);
    if (!node) return;
    const nodeEl = this.getNodeEl(node);
    if (!nodeEl) return;

    const data: import('./types').TaskCardData = {
      taskCard: true,
      completed: false,
      cardType: 'task',
      priority: 'none',
      progress: -1,
      subtasks: [],
    };
    this.plugin.storage.set(this.currentCanvasPath, nodeId, data);
    await this.plugin.saveSettings();
    this.renderer.render(nodeEl, nodeId, data);
    this.flushTaskData();
  }

  async convertToNormal(nodeId: string): Promise<void> {
    const node = this.resolveNode(nodeId);
    if (!node) return;
    const nodeEl = this.getNodeEl(node);
    if (!nodeEl) return;

    this.plugin.storage.remove(this.currentCanvasPath, nodeId);
    await this.plugin.saveSettings();
    this.renderer.remove(nodeEl);
    // Remove the embedded field from the node's data. The patched setData
    // strips it (storage no longer has an entry); flush persists the change.
    const nodeData = node.getData?.() as Record<string, unknown> | undefined;
    if (nodeData && nodeData[TASK_CARD_DATA_KEY] !== undefined) {
      const clean = { ...nodeData };
      delete clean[TASK_CARD_DATA_KEY];
      node.setData(clean);
    }
    this.flushTaskData();
  }

  async toggleTask(nodeId: string): Promise<void> {
    const node = this.resolveNode(nodeId);
    if (!node) return;
    const nodeEl = this.getNodeEl(node);
    if (!nodeEl) return;

    const existing = this.plugin.storage.get(
      this.currentCanvasPath,
      nodeId,
    );
    if (!existing?.taskCard) {
    const data: import('./types').TaskCardData = {
      taskCard: true,
      completed: false,
      cardType: 'task',
      priority: 'none',
      progress: -1,
      subtasks: [],
    };
      this.plugin.storage.set(this.currentCanvasPath, nodeId, data);
      await this.plugin.saveSettings();
      this.renderer.render(nodeEl, nodeId, data);
    } else {
      const data = this.plugin.storage.toggle(
        this.currentCanvasPath,
        nodeId,
      );
      await this.plugin.saveSettings();
      this.renderer.update(nodeEl, data);
    }
    this.flushTaskData();
  }

  async markCompleted(nodeId: string): Promise<void> {
    const node = this.resolveNode(nodeId);
    if (!node) return;
    const nodeEl = this.getNodeEl(node);
    if (!nodeEl) return;

    const existing = this.plugin.storage.get(this.currentCanvasPath, nodeId);
    const data: import('./types').TaskCardData = {
      taskCard: true,
      completed: true,
      cardType: existing?.cardType ?? 'task',
      priority: existing?.priority ?? 'none',
      progress: existing?.progress ?? -1,
      subtasks: existing?.subtasks ?? [],
    };
    this.plugin.storage.set(this.currentCanvasPath, nodeId, data);
    await this.plugin.saveSettings();
    this.renderer.render(nodeEl, nodeId, data);
    this.flushTaskData();
  }

  async markTodo(nodeId: string): Promise<void> {
    const node = this.resolveNode(nodeId);
    if (!node) return;
    const nodeEl = this.getNodeEl(node);
    if (!nodeEl) return;

    const existing = this.plugin.storage.get(this.currentCanvasPath, nodeId);
    const data: import('./types').TaskCardData = {
      taskCard: true,
      completed: false,
      cardType: existing?.cardType ?? 'task',
      priority: existing?.priority ?? 'none',
      progress: existing?.progress ?? -1,
      subtasks: existing?.subtasks ?? [],
    };
    this.plugin.storage.set(this.currentCanvasPath, nodeId, data);
    await this.plugin.saveSettings();
    this.renderer.render(nodeEl, nodeId, data);
    this.flushTaskData();
  }

  async openSubtaskModal(nodeId: string): Promise<void> {
    const node = this.resolveNode(nodeId);
    if (!node) return;
    const data = this.plugin.storage.get(this.currentCanvasPath, nodeId);
    if (!data?.taskCard) return;
    const modal = new (await import('./subtaskModal')).SubtaskEditModal(
      this.plugin,
      this.currentCanvasPath,
      nodeId,
      data,
    );
    modal.open();
  }

  refreshNodeRendering(nodeId: string): void {
    const node = this.resolveNode(nodeId);
    if (!node) return;
    const nodeEl = this.getNodeEl(node);
    if (!nodeEl) return;
    const data = this.plugin.storage.get(this.currentCanvasPath, nodeId);
    if (!data?.taskCard) return;
    this.renderer.render(nodeEl, nodeId, data);
  }

  updateNodeTextWithSubtasks(nodeId: string, subtasks: import('./types').Subtask[]): void {
    const canvas = this.activeCanvas;
    if (!canvas) return;
    const node = this.resolveNode(nodeId);
    if (!node) return;
    if (typeof node.getData !== 'function' || typeof node.setData !== 'function') return;
    try {
      const nd = node.getData() as { text?: string };
      const lines = (nd.text || '').split('\n');
      const clean: string[] = [];
      for (const line of lines) {
        if (/^\s*- \[[ xX]?\]\s/.test(line)) continue;
        clean.push(line);
      }
      for (const sub of subtasks) {
        clean.push(`- [${sub.completed ? 'x' : ' '}] ${sub.text}`);
      }
      nd.text = clean.join('\n');
      node.setData(nd);
      canvas.requestSave();
    } catch (e) {
      console.error('Canvas Task Cards: updateNodeTextWithSubtasks error', e);
    }
  }

  parseSubtasksFromCardText(nodeId: string): Array<{ text: string; completed: boolean }> {
    const node = this.resolveNode(nodeId);
    if (!node) return [];
    const text = node.text || (node.getData ? (node.getData() as Record<string, unknown>).text as string : '') || '';
    const results: Array<{ text: string; completed: boolean }> = [];
    const regex = /^\s*- \[([ xX])\]\s+(.+)$/gm;
    let match;
    while ((match = regex.exec(text)) !== null) {
      results.push({ text: match[2].trim(), completed: match[1] !== ' ' });
    }
    return results;
  }

  syncTextCheckboxesWithState(nodeId: string, subtasks: import('./types').Subtask[]): void {
    const canvas = this.activeCanvas;
    if (!canvas) return;
    const node = this.resolveNode(nodeId);
    if (!node) return;
    if (typeof node.getData !== 'function' || typeof node.setData !== 'function') return;
    try {
      const nd = node.getData() as { text?: string };
      const lines = (nd.text || '').split('\n');
      let subIdx = 0;
      const newLines: string[] = [];
      for (const line of lines) {
        const m = line.match(/^(\s*)- \[[ xX]?\]\s+(.*)$/);
        if (m && subIdx < subtasks.length) {
          newLines.push(`${m[1]}- [${subtasks[subIdx].completed ? 'x' : ' '}] ${subtasks[subIdx].text}`);
          subIdx++;
        } else {
          newLines.push(line);
        }
      }
      nd.text = newLines.join('\n');
      node.setData(nd);
      canvas.requestSave();
    } catch (e) {
      console.error('Canvas Task Cards: syncTextCheckboxesWithState error', e);
    }
  }

  getSelectedNodes(): ExtendedCanvasNode[] {
    if (!this.activeCanvas) return [];
    try {
      const sel = this.activeCanvas.selection;
      if (!sel) return [];
      if (typeof sel.values === 'function') return [...sel.values()] as ExtendedCanvasNode[];
      if (typeof sel.forEach === 'function') {
        const arr: ExtendedCanvasNode[] = [];
        sel.forEach((v: ExtendedCanvasNode) => arr.push(v));
        return arr;
      }
      if (Array.isArray(sel)) return sel;
    } catch { /* noop */ }
    return [];
  }

  // ── New type / priority / filter API ──

  async setCardType(nodeId: string, cardType: CardType): Promise<void> {
    const node = this.resolveNode(nodeId);
    if (!node) return;
    const nodeEl = this.getNodeEl(node);
    if (!nodeEl) return;
    const data = this.plugin.storage.get(this.currentCanvasPath, nodeId);
    if (!data?.taskCard) return;
    data.cardType = cardType;
    this.plugin.storage.set(this.currentCanvasPath, nodeId, data);
    await this.plugin.saveSettings();
    this.renderer.update(nodeEl, data);
    this.flushTaskData();
  }

  async setPriority(nodeId: string, priority: Priority): Promise<void> {
    const node = this.resolveNode(nodeId);
    if (!node) return;
    const nodeEl = this.getNodeEl(node);
    if (!nodeEl) return;
    const data = this.plugin.storage.get(this.currentCanvasPath, nodeId);
    if (!data?.taskCard) return;
    data.priority = priority;
    this.plugin.storage.set(this.currentCanvasPath, nodeId, data);
    await this.plugin.saveSettings();
    this.renderer.update(nodeEl, data);
    this.flushTaskData();
  }

  setFilter(filter: FilterState | null): void {
    this.filterState = filter;
    this.plugin.savedFilter = filter;
    void this.plugin.saveSettings();
    this.applyFilterToAll();
    if (filter) {
      const parts: string[] = [];
      if (filter.cardType) parts.push(`Type: ${filter.cardType}`);
      if (filter.priority) parts.push(`Priority: ${filter.priority}`);
      new Notice(`Filter: ${parts.join(', ')}`);
    } else {
      new Notice('Filter cleared');
    }
  }

  getFilterState(): FilterState | null {
    return this.filterState;
  }

  private applyFilterToNode(node: ExtendedCanvasNode): void {
    if (!this.filterState) return;
    const nodeEl = this.getNodeEl(node);
    if (!nodeEl) return;
    const data = this.ensureTaskData(node);
    if (!data?.taskCard) {
      nodeEl.classList.add('filtered-out');
      return;
    }
    const matchType = !this.filterState.cardType || data.cardType === this.filterState.cardType;
    const matchPriority = !this.filterState.priority || data.priority === this.filterState.priority;
    nodeEl.classList.toggle('filtered-out', !matchType || !matchPriority);
  }

  private applyFilterToAll(): void {
    const canvas = this.activeCanvas;
    if (!canvas?.nodes) return;
    const entries = this.getNodeEntries();
    for (const node of entries) {
      if (!node?.id) continue;
      const nodeEl = this.getNodeEl(node);
      if (!nodeEl) continue;
      if (!this.filterState) {
        nodeEl.classList.remove('filtered-out');
        continue;
      }
      const data = this.plugin.storage.get(this.currentCanvasPath, node.id);
      if (!data?.taskCard) {
        nodeEl.classList.add('filtered-out');
        continue;
      }
      const matchType = !this.filterState.cardType || data.cardType === this.filterState.cardType;
      const matchPriority = !this.filterState.priority || data.priority === this.filterState.priority;
      nodeEl.classList.toggle('filtered-out', !matchType || !matchPriority);
    }
  }

  destroy(): void {
    if (this.canvasRetryTimeout !== null) {
      window.clearTimeout(this.canvasRetryTimeout);
      this.canvasRetryTimeout = null;
    }
    this.destroyToolbar();
    this.teardownCanvas();
  }
}
