import { Notice, Menu } from 'obsidian';
import type CanvasTaskCardsPlugin from './main';
import type { CardType, Priority } from './types';
import { TaskRenderer } from './renderer';

export class CanvasManager {
  plugin: CanvasTaskCardsPlugin;
  renderer: TaskRenderer;
  activeCanvas: any = null;
  currentCanvasPath: string = '';
  private cleanupFns: Array<() => void> = [];
  private mutationObserver: MutationObserver | null = null;
  private canvasRetryCount: number = 0;
  private canvasRetryTimeout: number | null = null;
  private lastContextMenuEvent: MouseEvent | null = null;
  private filterState: { cardType?: CardType; priority?: Priority } | null = null;
  private toolbarEl: HTMLElement | null = null;
  private selectedTaskNodeId: string | null = null;

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
      const leaf = this.plugin.app.workspace.activeLeaf;
      if (!leaf || !leaf.view) {
        this.scheduleRetry();
        return;
      }

      if (typeof leaf.view.getViewType !== 'function') {
        this.scheduleRetry();
        return;
      }

      if (leaf.view.getViewType() !== 'canvas') {
        this.teardownCanvas();
        return;
      }

      const canvas = (leaf.view as any).canvas;
      if (!canvas) {
        this.scheduleRetry();
        return;
      }

      const filePath = ((leaf.view as any).file?.path ?? '') as string;
      if (canvas !== this.activeCanvas) {
        this.setupCanvas(canvas, filePath);
      }
      this.canvasRetryCount = 0;
    } catch (e) {
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

  private setupCanvas(canvas: any, path: string): void {
    this.teardownCanvas();

    // Remove legacy floating button if any
    document.querySelectorAll('.task-card-floating-btn').forEach(el => el.remove());

    this.activeCanvas = canvas;
    this.currentCanvasPath = path;

    try {
      this.processExistingNodes();
      this.attachCanvasEvents();
      this.attachMutationObserver();
      this.setupContextMenu();
      this.setupPopupMenu();
      this.setupToolbar();
    } catch (e) {
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

    const processNode = (node: any) => {
      if (node && node.id) this.checkAndRender(node);
    };

    if (typeof nodes.forEach === 'function') {
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

    const onNodeAdded = (node: any) => {
      this.checkAndRender(node);
    };
    const onNodeRemoved = (node: any) => {
      const nodeEl = this.getNodeEl(node);
      if (nodeEl) this.renderer.remove(nodeEl);
    };

    try {
      canvas.on('nodeAdded', onNodeAdded);
      canvas.on('nodeRemoved', onNodeRemoved);
      this.cleanupFns.push(() => {
        try {
          canvas.off('nodeAdded', onNodeAdded);
        } catch {}
        try {
          canvas.off('nodeRemoved', onNodeRemoved);
        } catch {}
      });
    } catch {}
  }

  private attachMutationObserver(): void {
    const wrapper = this.getCanvasWrapper();
    if (!wrapper) {
      return;
    }

    this.mutationObserver = new MutationObserver((mutations) => {
      for (let mi = 0; mi < mutations.length; mi++) {
        const added = mutations[mi].addedNodes;
        for (let i = 0; i < added.length; i++) {
          const nodeEl = added[i] as HTMLElement;
          if (!nodeEl.classList?.contains('canvas-node')) continue;

          // Strategy 1: data-id attribute
          const dataId = nodeEl.dataset?.id;
          if (dataId) {
            const node = this.activeCanvas?.nodes?.get?.(dataId) ?? this.activeCanvas?.nodes?.[dataId];
            if (node) { this.renderNodeOnElement(nodeEl, node); continue; }
          }

          // Strategy 2: elementEl reference
          if (this.activeCanvas?.nodes) {
            const entries = this.getNodeEntries();
            let matched = false;
            for (const n of entries) {
              if (n.elementEl === nodeEl) {
                this.renderNodeOnElement(nodeEl, n);
                matched = true;
                break;
              }
            }
            if (matched) continue;
          }

          // Strategy 3: position matching (parse transform style)
          const pos = this.parseTransformPosition(nodeEl.style.transform);
          if (pos && this.activeCanvas?.nodes) {
            const entries = this.getNodeEntries();
            for (const n of entries) {
              if (typeof n.x === 'number' && typeof n.y === 'number' &&
                  Math.abs(n.x - pos.x) < 5 && Math.abs(n.y - pos.y) < 5) {
                this.renderNodeOnElement(nodeEl, n);
                break;
              }
            }
          }
        }
        const removed = mutations[mi].removedNodes;
        for (let i = 0; i < removed.length; i++) {
          const nodeEl = removed[i] as HTMLElement;
          if (nodeEl.classList?.contains('canvas-node')) {
            const checkbox = nodeEl.querySelector('.task-checkbox');
            if (checkbox) checkbox.remove();
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

  private getCanvasWrapper(): HTMLElement | null {
    const canvas = this.activeCanvas;
    if (!canvas) return null;
    return canvas.wrapperEl || canvas.nodeEl || canvas.containerEl || null;
  }

  private setupContextMenu(): void {
    this.trackRightClickPosition();

    // Method 1: Try workspace event (modern Obsidian)
    this.tryWorkspaceContextMenu();

    // Method 2: Inject "Add Task Card" into empty-space menu
    this.setupEmptySpaceMenu();
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
      const handler = (menu: any, node: any) => {
        try {
          if (!node || !node.id) return;
          let resolvedNode = node;
          if (!node.type || (!node.file && !node.text)) {
            const resolved = this.resolveNode(node.id);
            if (resolved) resolvedNode = resolved;
          }
          if (resolvedNode.type !== 'text' && resolvedNode.type !== 'file') return;
          this.handleNodeContextMenuViaApi(menu, resolvedNode);
        } catch (e) {
          console.error('Canvas Task Cards: canvas:node-menu handler error', e);
        }
      };
      (this.plugin.app.workspace as any).on(eventName, handler);
      this.cleanupFns.push(() => {
        try { (this.plugin.app.workspace as any).off(eventName, handler); } catch {}
      });
    } catch (e) {
      console.error('Canvas Task Cards: Error registering workspace event', e);
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

  private handleNodeContextMenuViaApi(menu: any, node: any): void {
    const isTask = this.plugin.storage.has(this.currentCanvasPath, node.id);
    const data = isTask ? this.plugin.storage.get(this.currentCanvasPath, node.id) : null;

    menu.addSeparator();

    if (isTask && data) {
      menu.addItem((item: any) => {
        item.setTitle(data.completed ? '↩ Mark Todo' : '✓ Mark Completed');
        item.onClick(() => this.handleCheckboxClick(node.id));
      });

      menu.addItem((item: any) => {
        item.setTitle('Convert to Normal Card');
        item.onClick(() => this.convertToNormal(node.id));
      });
    } else {
      menu.addItem((item: any) => {
        item.setTitle('Convert to Task Card');
        item.onClick(() => this.convertToTask(node.id));
      });
    }
  }

  // ── Empty-space "Add Task Card" (injects into Obsidian's menu) ──

  private setupEmptySpaceMenu(): void {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const nodeEl = target.closest('.canvas-node') as HTMLElement | null;
      if (nodeEl) return;

      setTimeout(() => {
        this.injectAddTaskCardIntoEmptyMenu();
      }, 200);
    };

    document.addEventListener('contextmenu', handler, true);
    this.cleanupFns.push(() => {
      document.removeEventListener('contextmenu', handler, true);
    });
  }

  private injectAddTaskCardIntoEmptyMenu(): void {
    const menus = document.body.querySelectorAll('.menu');
    if (menus.length === 0) return;

    for (let mi = 0; mi < menus.length; mi++) {
      if (menus[mi].querySelector('.task-card-add-item')) return;
    }

    const menuEl = menus[menus.length - 1] as HTMLElement;

    const sep = document.createElement('div');
    sep.className = 'menu-separator';
    menuEl.appendChild(sep);

    const item = document.createElement('div');
    item.className = 'menu-item task-card-add-item';
    item.innerHTML = '<span class="menu-item-icon"></span><span class="menu-item-title">Add Task Card</span>';
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      this.addNewTaskCard();
      menuEl.remove();
    });
    menuEl.appendChild(item);
  }

  // ── Floating popup toolbar injection (card appearance area) ──

  private setupPopupMenu(): void {
    const canvas = this.activeCanvas;
    if (!canvas?.menu?.menuEl) return;

    const menu = canvas.menu;
    const origRender = menu.render.bind(menu);
    const self = this;

    menu.render = function (...args: any[]) {
      origRender.apply(this, args);
      try { self.injectIntoPopupMenu(menu); }
      catch (e) { console.error('Canvas Task Cards: popup inject error', e); }
    };

    this.cleanupFns.push(() => { menu.render = origRender; });
  }

  private injectIntoPopupMenu(menu: any): void {
    const menuEl = menu.menuEl;
    if (!menuEl) return;

    // Remove old injected controls so we start fresh each render
    menuEl.querySelectorAll('.task-card-popup-controls').forEach((el: Element) => el.remove());

    // Find the currently selected node (single selection)
    const nodeId = this.getSelectedNodeId();
    if (!nodeId) return;

    const data = this.plugin.storage.get(this.currentCanvasPath, nodeId);
    if (!data?.taskCard) return;

    // ── Row 1: Card Type buttons ──
    const typeRow = document.createElement('div');
    typeRow.className = 'task-card-popup-controls';

    const typeGroup = document.createElement('span');
    typeGroup.style.cssText = 'display:inline-flex;gap:2px;align-items:center;margin:4px 8px 2px 8px;';

    const typeLabel = document.createElement('span');
    typeLabel.textContent = 'Type:';
    typeLabel.style.cssText = 'font-size:11px;font-weight:600;margin-right:4px;color:var(--text-muted);';
    typeGroup.appendChild(typeLabel);

    const typeSymbols: Record<CardType, string> = {
      task: '☐', question: '?', important: '!', idea: '💡', info: 'ℹ',
    };

    for (const [t, _label] of this.cardTypeLabels) {
      const btn = document.createElement('button');
      btn.textContent = typeSymbols[t as CardType] || t;
      btn.title = _label;
      btn.dataset.cardType = t;
      btn.className = 'clickable-icon task-card-type-btn';
      btn.classList.toggle('is-active', t === data.cardType);
      btn.addEventListener('click', () => this.setCardType(nodeId, t as CardType));
      typeGroup.appendChild(btn);
    }

    typeRow.appendChild(typeGroup);

    // ── Row 2: Priority buttons ──
    const prioGroup = document.createElement('span');
    prioGroup.style.cssText = 'display:inline-flex;gap:2px;align-items:center;margin:0 8px 4px 8px;';

    const prioLabel = document.createElement('span');
    prioLabel.textContent = 'Priority:';
    prioLabel.style.cssText = 'font-size:11px;font-weight:600;margin-right:4px;color:var(--text-muted);';
    prioGroup.appendChild(prioLabel);

    for (const [p, label] of this.priorityLabels) {
      const btn = document.createElement('button');
      btn.textContent = label === 'None' ? '–' : label === 'Low' ? '▼' : label === 'Medium' ? '◆' : '▲';
      btn.title = label;
      btn.dataset.priority = p;
      btn.className = 'clickable-icon task-card-prio-btn';
      btn.classList.toggle('is-active', p === data.priority);
      btn.addEventListener('click', () => this.setPriority(nodeId, p as Priority));
      prioGroup.appendChild(btn);
    }

    typeRow.appendChild(prioGroup);

    // ── Insert after the first separator or at the end ──
    const firstSep = menuEl.querySelector('.menu-separator');
    if (firstSep) {
      menuEl.insertBefore(typeRow, firstSep.nextSibling);
    } else {
      menuEl.appendChild(typeRow);
    }
  }

  private getSelectedNodeId(): string | null {
    const canvas = this.activeCanvas;
    if (!canvas) return null;
    try {
      const sel = canvas.getSelectionData?.()?.nodes;
      if (sel && sel.length === 1) return sel[0].id;
      // Fallback: iterate selection
      if (canvas.selection && typeof canvas.selection.size === 'number' && canvas.selection.size === 1) {
        for (const id of canvas.selection) return id;
      }
    } catch {}
    return null;
  }

  // ── Top toolbar (card type, priority, toggle) ──

  private setupToolbar(): void {
    const wrapper = this.getCanvasWrapper();
    if (!wrapper) return;

    const toolbar = document.createElement('div');
    toolbar.className = 'task-toolbar';
    toolbar.style.display = 'none';

    // Card Type buttons
    const typeGroup = document.createElement('div');
    typeGroup.className = 'task-toolbar-group';

    const typeLabel = document.createElement('span');
    typeLabel.className = 'task-toolbar-label';
    typeLabel.textContent = 'Type';
    typeGroup.appendChild(typeLabel);

    for (const [t, label] of this.cardTypeLabels) {
      const btn = document.createElement('button');
      btn.className = 'task-type-btn';
      btn.dataset.cardType = t;
      btn.textContent = label;
      btn.addEventListener('click', () => {
        if (this.selectedTaskNodeId) {
          this.setCardType(this.selectedTaskNodeId, t);
          this.updateToolbarState();
        }
      });
      typeGroup.appendChild(btn);
    }

    toolbar.appendChild(typeGroup);

    // Priority buttons
    const prioGroup = document.createElement('div');
    prioGroup.className = 'task-toolbar-group';

    const prioLabel = document.createElement('span');
    prioLabel.className = 'task-toolbar-label';
    prioLabel.textContent = 'Priority';
    prioGroup.appendChild(prioLabel);

    for (const [p, label] of this.priorityLabels) {
      const btn = document.createElement('button');
      btn.className = 'task-prio-btn';
      btn.dataset.priority = p;
      btn.textContent = label;
      btn.addEventListener('click', () => {
        if (this.selectedTaskNodeId) {
          this.setPriority(this.selectedTaskNodeId, p);
          this.updateToolbarState();
        }
      });
      prioGroup.appendChild(btn);
    }

    toolbar.appendChild(prioGroup);

    // Toggle button
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'task-toolbar-toggle';
    toggleBtn.textContent = '✓ Done';
    toggleBtn.addEventListener('click', () => {
      if (this.selectedTaskNodeId) {
        this.handleCheckboxClick(this.selectedTaskNodeId);
        this.updateToolbarState();
      }
    });
    toolbar.appendChild(toggleBtn);

    document.body.appendChild(toolbar);
    this.toolbarEl = toolbar;

    // Show/hide on card click via document mousedown (capture phase)
    // This fires before Obsidian's own handlers
    const mousedownHandler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      // Don't hide when clicking inside the toolbar
      if (target.closest('.task-toolbar')) return;

      const nodeEl = target.closest('.canvas-node') as HTMLElement | null;
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
    document.addEventListener('mousedown', mousedownHandler, true);
    this.cleanupFns.push(() => document.removeEventListener('mousedown', mousedownHandler, true));
  }

  private showToolbar(nodeId: string): void {
    if (!this.toolbarEl) return;
    this.selectedTaskNodeId = nodeId;
    this.updateToolbarState();
    this.toolbarEl.style.display = 'flex';
  }

  private hideToolbar(): void {
    if (this.toolbarEl) this.toolbarEl.style.display = 'none';
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

    if (typeof nodes.forEach === 'function') {
      let found: string | null = null;
      nodes.forEach((n: any) => {
        if (n && n.elementEl === nodeEl) found = n.id;
      });
      return found;
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

  private createNodeViaCreateTextNode(canvas: any, x: number, y: number): boolean {
    try {
      let node: any = null;

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
    } catch (e) {
      console.warn('Canvas Task Cards: createTextNode failed', e.message?.slice(0, 100));
      return false;
    }
  }

  private createNodeViaData(canvas: any, x: number, y: number): string | null {
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
        const n = canvas.nodes?.get?.(id) ?? canvas.nodes?.[id];
        if (n) {
          return;
        }
        if (attempts < 30) {
          setTimeout(check, 100);
        } else {
          console.error('Canvas Task Cards: node never appeared after setData');
        }
      };
      setTimeout(check, 100);

      return id;
    } catch (e) {
      console.warn('Canvas Task Cards: createNodeViaData failed', e.message?.slice(0, 100));
      return null;
    }
  }

  private createNodeViaAddNode(canvas: any, x: number, y: number): void {
    try {
      let node: any = null;
      try {
        if (typeof canvas.addNode === 'function') {
          node = canvas.addNode('text', { x, y, width: 300, height: 200, text: '' });
        } else if (typeof canvas.createNode === 'function') {
          node = canvas.createNode({ type: 'text', x, y, width: 300, height: 200, text: '' });
        } else if (typeof canvas.createTextNode === 'function') {
          node = canvas.createTextNode({ pos: { x, y }, size: { width: 300, height: 200 }, text: '' });
        }
      } catch (e) {
        console.warn('Canvas Task Cards: addNode threw', e.message?.slice(0, 100));
        try {
          const proto = Object.getPrototypeOf(canvas);
          const unpatched = proto?.addNode;
          if (typeof unpatched === 'function' && unpatched !== canvas.addNode) {
            node = unpatched.call(canvas, 'text', { x, y, width: 300, height: 200, text: '' });
          }
        } catch (e2) {
          console.warn('Canvas Task Cards: unpatched addNode also failed', e2.message?.slice(0, 100));
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
        const tryRender = (n: any, attempts: number) => {
          if (n.elementEl && n.elementEl.isConnected) {
            this.checkAndRender(n);
            return;
          }
          if (attempts > 0) setTimeout(() => tryRender(n, attempts - 1), 150);
        };
        tryRender(node, 10);
      } else {
        console.error('Canvas Task Cards: all addNode methods failed');
        new Notice('Canvas Task Cards: Could not create node');
      }
    } catch (e) {
      console.error('Canvas Task Cards: createNodeViaAddNode error', e);
      new Notice('Canvas Task Cards: Could not create node');
    }
  }

  private finalizeNode(canvas: any, nodeId: string): void {
    this.plugin.storage.set(this.currentCanvasPath, nodeId, {
      taskCard: true,
      completed: false,
      cardType: 'task',
      priority: 'none',
    });
    this.plugin.saveSettings();

    const renderCheck = (retries: number) => {
      const n = canvas.nodes?.get?.(nodeId) ?? canvas.nodes?.[nodeId];
      const el = n ? this.getNodeEl(n) : null;

      if (el && el.isConnected) {
        this.checkAndRender(n);
        return;
      }
      if (retries > 0) {
        setTimeout(() => renderCheck(retries - 1), 200);
      } else {
        // Final try: mutation observer may still fire
        if (n) this.checkAndRender(n);
      }
    };
    renderCheck(30);
  }

  private findNodeAtPosition(canvas: any, x: number, y: number): any {
    const nodes = canvas.nodes;
    if (!nodes) return null;

    const matches: any[] = [];
    if (typeof nodes.forEach === 'function') {
      nodes.forEach((n: any) => {
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

  private getNodeEl(node: any): HTMLElement | null {
    if (node?.elementEl) return node.elementEl;
    if (!node?.id) return null;

    // Try data-id query
    let el = document.querySelector(`.canvas-node[data-id="${node.id}"]`) as HTMLElement | null;
    if (el) return el;

    // Try within wrapper
    const wrapper = this.getCanvasWrapper();
    if (wrapper) {
      el = wrapper.querySelector(`.canvas-node[data-id="${node.id}"]`) as HTMLElement | null;
      if (el) return el;
    }

    // Fallback: position matching
    if (typeof node.x === 'number' && typeof node.y === 'number') {
      const allNodes = (wrapper || document).querySelectorAll('.canvas-node');
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

  private getNodeEntries(): any[] {
    if (!this.activeCanvas?.nodes) return [];
    if (typeof this.activeCanvas.nodes.forEach === 'function') {
      const arr: any[] = [];
      this.activeCanvas.nodes.forEach((n: any) => arr.push(n));
      return arr;
    }
    return Object.values(this.activeCanvas.nodes);
  }

  private parseTransformPosition(transform: string): { x: number; y: number } | null {
    if (!transform) return null;
    const m = transform.match(/translate\(\s*([\d.-]+)px?\s*,\s*([\d.-]+)px?\s*\)/);
    if (m) return { x: parseFloat(m[1]), y: parseFloat(m[2]) };
    const mm = transform.match(/matrix\([^,]+,[^,]+,[^,]+,[^,]+,([^,]+),([^)]+)\)/);
    if (mm) return { x: parseFloat(mm[1]), y: parseFloat(mm[2]) };
    return null;
  }

  private renderNodeOnElement(nodeEl: HTMLElement, node: any): void {
    if (!node || !node.id) return;
    let nodeType = node.type;
    if (!nodeType && typeof node.getData === 'function') {
      try { nodeType = node.getData().type; } catch {}
    }
    if (!nodeType && node.text !== undefined) nodeType = 'text';
    if (!nodeType && node.file) nodeType = 'file';
    if (nodeType !== 'text' && nodeType !== 'file') return;
    const data = this.plugin.storage.get(this.currentCanvasPath, node.id);
    if (!data?.taskCard) return;
    this.renderer.render(nodeEl, node.id, data);
  }

  private checkAndRender(node: any): void {
    if (!node || !node.id) return;
    const nodeEl = this.getNodeEl(node);
    if (!nodeEl) return;
    const nodeType = node.type || node.getData?.()?.type;
    if (nodeType !== 'text' && nodeType !== 'file') return;
    const data = this.plugin.storage.get(this.currentCanvasPath, node.id);
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
      } catch {}
    }
    this.cleanupFns = [];
  }

  private resolveNode(nodeId: string): any {
    return (
      this.activeCanvas?.nodes?.get?.(nodeId) ??
      this.activeCanvas?.nodes?.[nodeId]
    );
  }

  async handleCheckboxClick(nodeId: string): Promise<void> {
    const node = this.resolveNode(nodeId);
    if (!node) return;
    const nodeEl = this.getNodeEl(node);
    if (!nodeEl) return;

    const data = this.plugin.storage.toggle(
      this.currentCanvasPath,
      nodeId,
    );
    await this.plugin.saveSettings();
    this.renderer.update(nodeEl, data);
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
    };
    this.plugin.storage.set(this.currentCanvasPath, nodeId, data);
    await this.plugin.saveSettings();
    this.renderer.render(nodeEl, nodeId, data);
  }

  async convertToNormal(nodeId: string): Promise<void> {
    const node = this.resolveNode(nodeId);
    if (!node) return;
    const nodeEl = this.getNodeEl(node);
    if (!nodeEl) return;

    this.plugin.storage.remove(this.currentCanvasPath, nodeId);
    await this.plugin.saveSettings();
    this.renderer.remove(nodeEl);
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
        completed: true,
        cardType: 'task',
        priority: 'none',
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
  }

  async markCompleted(nodeId: string): Promise<void> {
    const node = this.resolveNode(nodeId);
    if (!node) return;
    const nodeEl = this.getNodeEl(node);
    if (!nodeEl) return;

    const data: import('./types').TaskCardData = {
      taskCard: true,
      completed: true,
      cardType: 'task',
      priority: 'none',
    };
    this.plugin.storage.set(this.currentCanvasPath, nodeId, data);
    await this.plugin.saveSettings();
    this.renderer.render(nodeEl, nodeId, data);
  }

  async markTodo(nodeId: string): Promise<void> {
    const node = this.resolveNode(nodeId);
    if (!node) return;
    const nodeEl = this.getNodeEl(node);
    if (!nodeEl) return;

    const data: import('./types').TaskCardData = {
      taskCard: true,
      completed: false,
      cardType: 'task',
      priority: 'none',
    };
    this.plugin.storage.set(this.currentCanvasPath, nodeId, data);
    await this.plugin.saveSettings();
    this.renderer.render(nodeEl, nodeId, data);
  }

  getSelectedNodes(): any[] {
    if (!this.activeCanvas) return [];
    try {
      const sel = this.activeCanvas.selection;
      if (!sel) return [];
      if (typeof sel.values === 'function') return [...sel.values()];
      if (typeof sel.forEach === 'function') {
        const arr: any[] = [];
        sel.forEach((v: any) => arr.push(v));
        return arr;
      }
      if (Array.isArray(sel)) return sel;
    } catch {}
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
  }

  setFilter(filter: { cardType?: CardType; priority?: Priority } | null): void {
    this.filterState = filter;
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

  getFilterState(): { cardType?: CardType; priority?: Priority } | null {
    return this.filterState;
  }

  private applyFilterToAll(): void {
    const canvas = this.activeCanvas;
    if (!canvas?.nodes) return;
    const entries = this.getNodeEntries();
    for (const node of entries) {
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
