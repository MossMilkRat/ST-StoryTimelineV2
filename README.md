# Story Timeline Viewer (SillyTavern Extension)

View, organize, and tag story events by **in‑story chronology** (not message order).

## Features
- **Timeline sorting by story time** using `storyTime` (string) or `storyOrder` (number) in message metadata
- **Tag untagged**: modal lists all untagged messages with quick inputs
- **Drag & drop** (optional): reorder timeline; writes `storyOrder`
- **Settings panel** (GUI): date/time format, drag/drop, menu icon, slash command
- **Slash command**: `/storytimeline` (configurable)
- **Menu integration**: appears under **Extensions** (with auto‑fallback FAB button)
- **Event hook**: auto-refresh timeline when chat changes (if supported)

## Install
1. Create a folder under `SillyTavern/public/scripts/extensions/story-timeline-viewer/`
2. Place these files inside:
   - `index.js`
   - `styles.css`
   - `README.md`
3. In SillyTavern, reload the tab. Open **Extensions → Story Timeline Viewer**, or click the FAB (🗂️) at bottom-right.

## Usage
- Tag untagged messages in the **Tagging** modal (e.g., `Day 5, 07:15`, `10/19/2025`, `2025-10-19 18:30`).
- Open **Timeline** to see messages sorted by in‑world time.
- Enable **drag & drop** to manually reorder; the extension writes `storyOrder = 0..n-1`.

## Metadata keys
- `storyTime`: string (examples: `Day 2, 12:00`, `10/19/2025`, `2025-10-19T18:30`)
- `storyOrder`: number (used when set; overrides parsed `storyTime`)

The extension reads/writes these under `message.extra` when available (fallbacks to `message.metadata` or the root object if necessary).

## Settings persistence
- Saved to `ctx.extensionSettings.storyTimeline`. The code calls `ctx.saveSettings()` / `ctx.saveExtensionSettings()` when possible; otherwise uses `localStorage` as a fallback.

## Known Compatibility Notes
- **Events**: If `ctx.events.on("CHAT_CHANGED")` exists, the timeline refreshes when the chat updates.
- **Slash commands**: Uses `SlashCommandParser.addCommandObject()` when available; otherwise falls back to `ctx.registerSlashCommand()`.
- **Menu**: Uses `window.getExtensionMenu()` if present; otherwise shows a floating FAB button.

## License
MIT
