# Canvas Task Cards

An Obsidian plugin that turns Canvas cards into task cards with completion states, card types, and priority levels.

## Features

- **Task cards** — any card can be converted to a task card with a completion indicator on the left border
- **Card types** — assign a type to each task card:
  - `☐` **Task** (green)
  - `?` **Question** (blue)
  - `!` **Important** (red)
  - `💡` **Idea** (yellow)
  - `ℹ` **Info** (cyan)
- **Priority levels** — set priority with a colored dot on the indicator (High, Medium, Low, None)
- **Completion toggle** — click the indicator to mark a card as completed/incomplete (state persists across restarts)
- **Visual feedback** — completed cards get a colored border and reduced opacity; types have distinct accent colors
- **Floating popup toolbar** — when you click a task card, type and priority controls appear in the card appearance area (alongside Obsidian's color picker and Advanced Canvas shape controls)
- **Right-click context menu** — "Mark Completed/Mark Todo", "Convert to Normal Card"
- **Empty-space context menu** — "Add Task Card" when right-clicking empty canvas space
- **Filter system** — filter cards by type or priority via Command Palette (e.g., "Only show: Important")
- **Progress bar** — each task card can show a progress bar; subtasks are managed via the "Edit subtasks" command
- **Auto-complete** — when all subtasks are checked, the task card auto-completes
- **Settings** — customize progress bar height, color, and auto-color by card type; customize all colors (completed border, priority dots, card type accents), indicator size/offset, animations, and completed opacity
- **Works alongside Advanced Canvas** — both plugins' controls coexist in the popup toolbar

## How it looks

Each task card has a small indicator on its left border containing a priority dot and a type symbol:

<img width="1232" height="343" alt="Screenshot_20260701_124824" src="https://github.com/user-attachments/assets/2ad448a4-d61d-43ad-8563-41508fdebcae" />

## Usage

### Creating a Task Card
1. **Right-click empty space** on a canvas → "Add Task Card"
2. **Command Palette** (`Ctrl+P`) → "Add Task Card to canvas"

### Converting Existing Cards
- **Right-click a card** → "Convert to Task Card" / "Convert to Normal Card"

### Changing Type & Priority
- **Click a task card** → type and priority buttons appear in the floating popup toolbar (top of the card appearance area)
- **Command Palette** → "Set card type: ..." / "Set priority: ..."

### Filtering
- **Command Palette** → `[FILTER] Only show: ...` (by type or priority)
- **Command Palette** → `[FILTER] Clear filter`
- Filtered-out cards are dimmed (opacity 0.12)

### Commands (Command Palette)

| Command | Description |
|---------|-------------|
| Convert selected card to Task Card | Marks selected cards as task cards |
| Convert selected card to Normal Card | Reverts task cards back to normal |
| Toggle task completed | Toggles completion state |
| Mark task completed | Sets completion to true |
| Mark task todo | Sets completion to false |
| Add Task Card to canvas | Creates a new task card |
| Set card type: Task / Question / Important / Idea / Info | Changes the type of selected cards |
| Set priority: None / Low / Medium / High | Changes the priority of selected cards |
| [FILTER] Only show: Task / Question / Important / Idea / Info | Filters canvas by card type |
| [FILTER] Only show: No priority / Low / Medium / High | Filters canvas by priority |
| Edit subtasks | Opens a modal to manage subtasks for the selected card |
| [FILTER] Clear filter | Removes active filter |

### Settings
- **Completed border color** — color of the card border when completed
- **Completed opacity** — opacity of completed cards (default: 0.7)
- **Indicator size** — size of the indicator in pixels
- **Indicator position offset** — horizontal offset from the left edge
- **Enable animations** — subtle CSS transitions on state changes
- **Priority Colors** — custom colors for High, Medium, Low priority dots
- **Card Type Colors** — custom accent colors for Task, Question, Important, Idea, Info types

## Installation

### From Obsidian Community Plugins (once published)
1. Open **Settings** → **Community plugins**
2. Disable **Safe mode**
3. Click **Browse** and search for "Canvas Task Cards"
4. Install and enable

### Manual (BRAT)
1. Install [BRAT](https://obsidian.md/plugins?id=obsidian42-brat)
2. Add `https://github.com/raito1chi/canvas-task-cards`

### Manual (from source)
1. Download `main.js`, `styles.css`, `manifest.json`
2. Copy to `.obsidian/plugins/canvas-task-cards/`
3. Enable in Community plugins

## Development

```bash
git clone https://github.com/raito1chi/canvas-task-cards
cd canvas-task-cards
npm install
npm run build     # production build
npm run dev       # watch mode
```

## Structure

```
src/
  main.ts           Plugin entry, data load/save, CSS variable setup
  canvasManager.ts  Canvas integration, popup toolbar, context menus, node creation, filtering
  renderer.ts       Indicator DOM management (type symbols, priority dots)
  storage.ts        Completion state persistence
  commands.ts       Command palette entries
  settings.ts       Settings tab with color pickers
  types.ts          TypeScript interfaces (CardType, Priority, PluginSettings)
styles.css          Plugin styles
```

## Compatibility

- Requires Obsidian v1.5.0+
- Tested with Advanced Canvas plugin
- Works on desktop and mobile

## License

MIT
