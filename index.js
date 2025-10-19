// Story Timeline Viewer for SillyTavern
// v0.9.3 (2025-10-19)
// Supports modern and legacy SillyTavern extension APIs with graceful fallbacks.
//
// Files: index.js (this), styles.css, README.md
//
// Notes:
// - Settings are stored in ctx.extensionSettings.storyTimeline
// - Message metadata keys used: storyTime (string), storyOrder (number)
// - Works without events/slash menu by exposing a floating FAB fallback.
//
// MIT License

(function () {
  const EXT_NAME = "story-timeline-viewer";
  const EXT_TITLE = "Story Timeline Viewer";
  const SETTINGS_KEY = "storyTimeline";

  // Default settings
  const DEFAULTS = {
    enabled: true,
    dateFormat: "MM/DD/YYYY",
    timeFormat: "24h",
    enableDragDrop: true,
    showMenuIcon: true,
    menuIconText: "🗂️",
    slashCommand: "/storytimeline",
    autoShowOnLoad: false
  };

  // DOM IDs
  const IDS = {
    timelinePanel: "stv-timeline-panel",
    settingsModal: "stv-settings-modal",
    taggingModal: "stv-tagging-modal",
    fab: "stv-fab-button",
  };

  // Internal state (assigned in init)
  let ctx = null;
  let settings = null;

  // ---- Utilities -----------------------------------------------------------

  function log(...args) {
    console.log(`${EXT_TITLE}:`, ...args);
  }

  function getCtxSafe() {
    try {
      // Modern extension loader passes ctx into registerExtension callback.
      // Legacy fallback: try window.getContext?.()
      if (window.__ST_EXTENSION_CTX__) return window.__ST_EXTENSION_CTX__;
      if (typeof window.getContext === "function") return window.getContext();
      if (window.ST && window.ST.ctx) return window.ST.ctx;
    } catch (e) {
      console.warn(`${EXT_TITLE}: getCtxSafe() failed`, e);
    }
    return null;
  }

  function ensureSettingsBag() {
    if (!ctx.extensionSettings) ctx.extensionSettings = {};
    if (!ctx.extensionSettings[SETTINGS_KEY]) {
      ctx.extensionSettings[SETTINGS_KEY] = { ...DEFAULTS };
    } else {
      // Merge defaults to fill in any new keys
      ctx.extensionSettings[SETTINGS_KEY] = {
        ...DEFAULTS,
        ...ctx.extensionSettings[SETTINGS_KEY],
      };
    }
    settings = ctx.extensionSettings[SETTINGS_KEY];
  }

  function saveSettings() {
    // Some builds expose saveSettings or saveExtensionSettings; fall back to localStorage
    try {
      if (typeof ctx.saveSettings === "function") {
        ctx.saveSettings();
      } else if (typeof ctx.saveExtensionSettings === "function") {
        ctx.saveExtensionSettings();
      } else {
        localStorage.setItem(
          `ext:${SETTINGS_KEY}`,
          JSON.stringify(ctx.extensionSettings[SETTINGS_KEY])
        );
      }
      log("settings saved", settings);
    } catch (e) {
      console.warn(`${EXT_TITLE}: saveSettings failed`, e);
    }
  }

  function getChatMessages() {
    if (!ctx || !ctx.chat || !Array.isArray(ctx.chat)) return [];
    return ctx.chat;
  }

  function saveChatMetadata() {
    try {
      if (typeof ctx.saveMetadata === "function") {
        ctx.saveMetadata();
      } else if (typeof ctx.saveChat === "function") {
        ctx.saveChat(); // legacy
      } else {
        // Fallback: nothing else to do; data will be in-memory only
      }
      log("chat metadata saved");
    } catch (e) {
      console.warn(`${EXT_TITLE}: saveChatMetadata failed`, e);
    }
  }

  // Parse "storyTime" into a sortable numeric key.
  // Supports:
  // - "Day 5, 07:15" (24h or am/pm)
  // - "Day 3 12:00", "Day 3"
  // - "MM/DD/YYYY", "DD/MM/YYYY", "YYYY-MM-DD", "YYYY/MM/DD"
  // - plain ISO-ish "2025-10-19T18:30"
  function parseStoryTime(str) {
    if (!str || typeof str !== "string") return null;
    const s = str.trim();

    // Day N[, hh:mm [AM|PM]]
    let m = s.match(/^Day\s+(\d+)(?:[,\s]+(\d{1,2}):(\d{2})(?:\s*(AM|PM))?)?$/i);
    if (m) {
      let day = parseInt(m[1], 10);
      let hour = m[2] ? parseInt(m[2], 10) : 0;
      const minute = m[3] ? parseInt(m[3], 10) : 0;
      const ampm = m[4] ? m[4].toUpperCase() : null;
      if (ampm) {
        if (ampm === "PM" && hour < 12) hour += 12;
        if (ampm === "AM" && hour === 12) hour = 0;
      }
      return day * 24 * 60 + hour * 60 + minute; // minutes since Day 0 00:00
    }

    // Try "MM/DD/YYYY" or "DD/MM/YYYY" depending on settings, and "YYYY-MM-DD"
    // We normalize by detecting YYYY lead first.
    m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?$/); // YYYY-MM-DD or YYYY/MM/DD
    if (m) {
      const year = parseInt(m[1], 10);
      const month = parseInt(m[2], 10) - 1;
      const day = parseInt(m[3], 10);
      const hour = m[4] ? parseInt(m[4], 10) : 0;
      const minute = m[5] ? parseInt(m[5], 10) : 0;
      return new Date(year, month, day, hour, minute).getTime();
    }

    // Locale-ambiguous: "MM/DD/YYYY" vs "DD/MM/YYYY"
    m = s.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})(?:[ T](\d{1,2}):(\d{2}))?$/);
    if (m) {
      let a = parseInt(m[1], 10);
      let b = parseInt(m[2], 10);
      const year = parseInt(m[3], 10);
      const hour = m[4] ? parseInt(m[4], 10) : 0;
      const minute = m[5] ? parseInt(m[5], 10) : 0;
      let month, day;
      if (settings.dateFormat === "DD/MM/YYYY") {
        day = a;
        month = b - 1;
      } else {
        // default MM/DD/YYYY
        month = a - 1;
        day = b;
      }
      return new Date(year, month, day, hour, minute).getTime();
    }

    // ISO-ish fallback
    const asDate = new Date(s);
    if (!isNaN(asDate.getTime())) {
      return asDate.getTime();
    }

    // As a last resort, try to extract any number to act as ordering key
    const num = parseFloat(s.replace(/[^\d.]/g, ""));
    if (!isNaN(num)) return num;

    return null;
  }

  function getTaggedAndUntagged() {
    const msgs = getChatMessages();
    const tagged = [];
    const untagged = [];
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      const meta = m?.extra || m?.metadata || m;
      const storyTime = meta?.storyTime;
      const storyOrder = meta?.storyOrder;
      if (storyTime || Number.isFinite(storyOrder)) {
        tagged.push({ index: i, msg: m, storyTime, storyOrder });
      } else {
        untagged.push({ index: i, msg: m });
      }
    }
    return { tagged, untagged };
  }

  function buildSortedTimeline() {
    const { tagged, untagged } = getTaggedAndUntagged();
    // Compute sort keys
    const decorated = tagged.map((t) => {
      let sortKey = Number.isFinite(t.storyOrder)
        ? t.storyOrder
        : parseStoryTime(String(t.storyTime));
      // If neither parseable, keep it at the end but stable
      if (!Number.isFinite(sortKey)) sortKey = Number.MAX_SAFE_INTEGER - t.index;
      return { ...t, sortKey };
    });
    decorated.sort((a, b) => a.sortKey - b.sortKey);
    return { sorted: decorated, untagged };
  }

  function excerpt(text, n = 140) {
    if (!text) return "";
    const s = String(text).replace(/\s+/g, " ").trim();
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  // ---- UI: creation helpers -----------------------------------------------

  function injectStylesIfNeeded() {
    if (document.getElementById("stv-styles")) return;
    const link = document.createElement("link");
    link.id = "stv-styles";
    link.rel = "stylesheet";
    link.type = "text/css";
    link.href = "./styles.css"; // relative to extension folder
    document.head.appendChild(link);
  }

  function ensureFabButton() {
    if (document.getElementById(IDS.fab)) return;
    const btn = document.createElement("button");
    btn.id = IDS.fab;
    btn.className = "stv-fab";
    btn.title = EXT_TITLE;
    btn.textContent = settings.menuIconText || DEFAULTS.menuIconText;
    btn.style.display = settings.showMenuIcon ? "flex" : "none";
    btn.addEventListener("click", () => openSettingsModal());
    document.body.appendChild(btn);
  }

  function closePanels() {
    for (const id of [IDS.timelinePanel, IDS.settingsModal, IDS.taggingModal]) {
      const el = document.getElementById(id);
      if (el) el.remove();
    }
  }

  function openTimelinePanel() {
    const existing = document.getElementById(IDS.timelinePanel);
    if (existing) existing.remove();

    const { sorted, untagged } = buildSortedTimeline();
    const panel = document.createElement("div");
    panel.id = IDS.timelinePanel;
    panel.className = "stv-panel";

    const header = document.createElement("div");
    header.className = "stv-panel-header";
    header.innerHTML = `
      <div class="stv-title">${EXT_TITLE}</div>
      <div class="stv-actions">
        <button class="stv-btn" id="stv-tag-untagged-btn">Tag untagged (${untagged.length})</button>
        <button class="stv-btn" id="stv-close-timeline">✕</button>
      </div>
    `;
    panel.appendChild(header);

    const list = document.createElement("div");
    list.className = "stv-list";
    list.dataset.dragEnabled = settings.enableDragDrop ? "1" : "0";

    sorted.forEach((entry, i) => {
      const m = entry.msg;
      const who = m?.is_user ? "You" : (m?.name || m?.sender || (m?.isAssistant ? "Assistant" : "Assistant"));
      const text = m?.mes ?? m?.text ?? m?.message ?? "";
      const meta = m?.extra || m?.metadata || m;
      const item = document.createElement("div");
      item.className = "stv-item";
      item.draggable = !!settings.enableDragDrop;
      item.dataset.index = String(entry.index);

      const label = meta.storyTime ?? (Number.isFinite(meta.storyOrder) ? `Order ${meta.storyOrder}` : "—");

      item.innerHTML = `
        <div class="stv-item-row">
          <div class="stv-time">${label}</div>
          <div class="stv-who">${who}</div>
        </div>
        <div class="stv-excerpt">${escapeHtml(excerpt(text))}</div>
      `;

      if (settings.enableDragDrop) {
        item.addEventListener("dragstart", (ev) => {
          ev.dataTransfer.setData("text/plain", String(entry.index));
          item.classList.add("stv-dragging");
        });
        item.addEventListener("dragend", () => item.classList.remove("stv-dragging"));
        item.addEventListener("dragover", (ev) => ev.preventDefault());
        item.addEventListener("drop", (ev) => {
          ev.preventDefault();
          const fromIdx = parseInt(ev.dataTransfer.getData("text/plain"), 10);
          const toIdx = parseInt(item.dataset.index, 10);
          handleManualReorder(fromIdx, toIdx);
        });
      }

      list.appendChild(item);
    });

    if (sorted.length === 0) {
      const empty = document.createElement("div");
      empty.className = "stv-empty";
      empty.textContent = "No tagged messages yet. Use \"Tag untagged\" to begin.";
      list.appendChild(empty);
    }

    panel.appendChild(list);
    document.body.appendChild(panel);

    document.getElementById("stv-close-timeline").addEventListener("click", closePanels);
    document.getElementById("stv-tag-untagged-btn").addEventListener("click", openTaggingModal);
  }

  function handleManualReorder(fromMsgIndex, toMsgIndex) {
    if (!settings.enableDragDrop) return;
    const msgs = getChatMessages();
    // We only write storyOrder values; does not move actual chat order
    // Compute current order list (indices of tagged)
    const { sorted } = buildSortedTimeline();
    const currentIndices = sorted.map(s => s.index);
    const fromPos = currentIndices.indexOf(fromMsgIndex);
    const toPos = currentIndices.indexOf(toMsgIndex);
    if (fromPos < 0 || toPos < 0) return;

    // Move within array
    const moved = currentIndices.splice(fromPos, 1)[0];
    currentIndices.splice(toPos, 0, moved);

    // Assign storyOrder as 0..n-1 along new order
    currentIndices.forEach((msgIdx, order) => {
      const m = msgs[msgIdx];
      if (!m.extra) m.extra = {};
      m.extra.storyOrder = order;
    });

    saveChatMetadata();
    // Repaint
    openTimelinePanel();
  }

  function openTaggingModal() {
    const existing = document.getElementById(IDS.taggingModal);
    if (existing) existing.remove();

    const { untagged } = getTaggedAndUntagged();

    const modal = document.createElement("div");
    modal.id = IDS.taggingModal;
    modal.className = "stv-modal";

    const inner = document.createElement("div");
    inner.className = "stv-modal-inner stv-tagging";

    inner.innerHTML = `
      <div class="stv-modal-header">
        <div class="stv-title">Tag Untagged Messages</div>
        <button class="stv-btn" id="stv-close-tagging">✕</button>
      </div>
      <div class="stv-modal-body" id="stv-tagging-body"></div>
      <div class="stv-modal-footer">
        <button class="stv-btn stv-primary" id="stv-apply-tags">Save / Apply</button>
      </div>
    `;

    modal.appendChild(inner);
    document.body.appendChild(modal);

    document.getElementById("stv-close-tagging").addEventListener("click", () => modal.remove());

    const body = document.getElementById("stv-tagging-body");
    if (untagged.length === 0) {
      const none = document.createElement("div");
      none.className = "stv-empty";
      none.textContent = "All messages are already tagged.";
      body.appendChild(none);
    } else {
      untagged.forEach(entry => {
        const m = entry.msg;
        const text = m?.mes ?? m?.text ?? m?.message ?? "";
        const row = document.createElement("div");
        row.className = "stv-tag-row";
        row.innerHTML = `
          <div class="stv-excerpt">${escapeHtml(excerpt(text, 200))}</div>
          <input class="stv-input" type="text" placeholder="e.g., Day 5, 07:15 or 10/19/2025" data-index="${entry.index}" />
        `;
        body.appendChild(row);
      });
    }

    document.getElementById("stv-apply-tags").addEventListener("click", () => {
      const inputs = body.querySelectorAll("input[data-index]");
      const msgs = getChatMessages();
      inputs.forEach(inp => {
        const idx = parseInt(inp.getAttribute("data-index"), 10);
        const val = inp.value.trim();
        if (!val) return;
        const msg = msgs[idx];
        if (!msg.extra) msg.extra = {};
        msg.extra.storyTime = val;
        // Clear any previous storyOrder to let parser compute again
        if (typeof msg.extra.storyOrder !== "undefined") delete msg.extra.storyOrder;
      });
      saveChatMetadata();
      modal.remove();
      openTimelinePanel();
    });
  }

  function openSettingsModal() {
    const existing = document.getElementById(IDS.settingsModal);
    if (existing) existing.remove();

    const modal = document.createElement("div");
    modal.id = IDS.settingsModal;
    modal.className = "stv-modal";

    const inner = document.createElement("div");
    inner.className = "stv-modal-inner";

    const enableChecked = settings.enabled ? "checked" : "";
    const ddChecked = settings.enableDragDrop ? "checked" : "";
    const showIconChecked = settings.showMenuIcon ? "checked" : "";
    const tf24 = settings.timeFormat === "24h" ? "selected" : "";
    const tf12 = settings.timeFormat === "AM/PM" ? "selected" : "";
    const dfMM = settings.dateFormat === "MM/DD/YYYY" ? "selected" : "";
    const dfDD = settings.dateFormat === "DD/MM/YYYY" ? "selected" : "";
    const dfDay = settings.dateFormat === "Day #" ? "selected" : "";
    const autoShowChecked = settings.autoShowOnLoad ? "checked" : "";

    inner.innerHTML = `
      <div class="stv-modal-header">
        <div class="stv-title">${EXT_TITLE} — Settings</div>
        <button class="stv-btn" id="stv-close-settings">✕</button>
      </div>
      <div class="stv-modal-body">
        <div class="stv-field">
          <label><input type="checkbox" id="stv-enabled" ${enableChecked}/> Enable extension</label>
        </div>

        <div class="stv-grid2">
          <div class="stv-field">
            <label>Date format</label>
            <select id="stv-date-format">
              <option ${dfMM}>MM/DD/YYYY</option>
              <option ${dfDD}>DD/MM/YYYY</option>
              <option ${dfDay}>Day #</option>
            </select>
          </div>
          <div class="stv-field">
            <label>Time format</label>
            <select id="stv-time-format">
              <option ${tf24}>24h</option>
              <option ${tf12}>AM/PM</option>
            </select>
          </div>
        </div>

        <div class="stv-grid2">
          <div class="stv-field">
            <label><input type="checkbox" id="stv-dragdrop" ${ddChecked}/> Enable drag/drop</label>
          </div>
          <div class="stv-field">
            <label><input type="checkbox" id="stv-showicon" ${showIconChecked}/> Show menu icon</label>
          </div>
        </div>

        <div class="stv-grid2">
          <div class="stv-field">
            <label>Menu icon text/emoji</label>
            <input id="stv-icontext" class="stv-input" type="text" value="${escapeHtmlAttr(settings.menuIconText || "")}" maxlength="4"/>
          </div>
          <div class="stv-field">
            <label>Slash command name</label>
            <input id="stv-slash" class="stv-input" type="text" value="${escapeHtmlAttr(settings.slashCommand || "")}" placeholder="/storytimeline"/>
          </div>
        </div>

        <div class="stv-field">
          <label><input type="checkbox" id="stv-autoshow" ${autoShowChecked}/> Auto show timeline on load</label>
        </div>

        <div class="stv-field" style="margin-top:8px">
          <button class="stv-btn" id="stv-open-tagger">Tag un-tagged messages</button>
        </div>
      </div>
      <div class="stv-modal-footer">
        <button class="stv-btn stv-primary" id="stv-save-settings">Save Settings</button>
        <button class="stv-btn" id="stv-open-timeline">Open Timeline</button>
      </div>
    `;

    modal.appendChild(inner);
    document.body.appendChild(modal);

    document.getElementById("stv-close-settings").addEventListener("click", () => modal.remove());

    document.getElementById("stv-open-tagger").addEventListener("click", () => {
      modal.remove();
      openTaggingModal();
    });
    document.getElementById("stv-open-timeline").addEventListener("click", () => {
      modal.remove();
      openTimelinePanel();
    });

    document.getElementById("stv-save-settings").addEventListener("click", () => {
      settings.enabled = !!document.getElementById("stv-enabled").checked;
      settings.enableDragDrop = !!document.getElementById("stv-dragdrop").checked;
      settings.showMenuIcon = !!document.getElementById("stv-showicon").checked;
      settings.menuIconText = document.getElementById("stv-icontext").value || DEFAULTS.menuIconText;
      settings.slashCommand = (document.getElementById("stv-slash").value || DEFAULTS.slashCommand).trim();
      settings.dateFormat = document.getElementById("stv-date-format").value;
      settings.timeFormat = document.getElementById("stv-time-format").value;
      settings.autoShowOnLoad = !!document.getElementById("stv-autoshow").checked;
      saveSettings();
      ensureFabButton();
      closePanels();
      if (settings.autoShowOnLoad) openTimelinePanel();
    });
  }

  // ---- Drag helpers --------------------------------------------------------

  function handleGlobalDragEnter(ev) {
    if (!settings.enableDragDrop) return;
    ev.preventDefault();
  }

  // ---- Menu / Slash integration -------------------------------------------

  function registerMenuEntry() {
    try {
      const getMenu = window.getExtensionMenu || window.getExtensionsMenu || null;
      if (typeof getMenu === "function") {
        const menu = getMenu();
        menu.addMenuItem(EXT_TITLE, openSettingsModal);
        log("menu entry registered");
        return true;
      }
    } catch (e) {
      console.warn(`${EXT_TITLE}: menu registration failed`, e);
    }
    // Fallback: rely on FAB
    ensureFabButton();
    return false;
  }

  function registerSlashCommand() {
    const name = (settings.slashCommand || DEFAULTS.slashCommand).replace(/^\s*/, "");
    if (!name) {
      log("slashCommand setting is empty — please set it in settings panel.");
      return false;
    }
    try {
      if (ctx.SlashCommandParser && typeof ctx.SlashCommandParser.addCommandObject === "function") {
        ctx.SlashCommandParser.addCommandObject({
          name,
          help: "Open the Story Timeline Viewer settings",
          callback: () => openSettingsModal(),
        });
        log("slash command registered via SlashCommandParser", name);
        return true;
      } else if (typeof ctx.registerSlashCommand === "function") {
        ctx.registerSlashCommand(name, () => openSettingsModal(), "Open the Story Timeline Viewer settings");
        log("slash command registered via legacy registerSlashCommand", name);
        return true;
      } else {
        log("No slash command API available; using FAB only.");
        return false;
      }
    } catch (e) {
      console.warn(`${EXT_TITLE}: slash registration failed`, e);
      return false;
    }
  }

  function subscribeEvents() {
    try {
      if (ctx.events && typeof ctx.events.on === "function") {
        ctx.events.on("CHAT_CHANGED", () => {
          // If panel open, rebuild to reflect new state
          if (document.getElementById(IDS.timelinePanel)) openTimelinePanel();
        });
        log("subscribed to CHAT_CHANGED");
        return true;
      }
    } catch (e) {
      console.warn(`${EXT_TITLE}: events subscription failed`, e);
    }
    log("ctx.events.on not available");
    return false;
  }

  // ---- HTML helpers --------------------------------------------------------

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function escapeHtmlAttr(str) {
    return escapeHtml(str).replace(/`/g, "&#96;");
  }

  // ---- Bootstrapping -------------------------------------------------------

  function init(passedCtx) {
    try {
      log("init() called");
      ctx = passedCtx || getCtxSafe() || {};
      // Store a reference for legacy utilities that call getCtxSafe later
      window.__ST_EXTENSION_CTX__ = ctx;

      ensureSettingsBag();
      injectStylesIfNeeded();

      const menuOk = registerMenuEntry();
      const slashOk = registerSlashCommand();
      subscribeEvents();

      // Always show FAB as a fallback if menu/icon enabled
      ensureFabButton();

      if (settings.enabled && settings.autoShowOnLoad) {
        // Defer a tick to allow CSS to load
        setTimeout(() => openTimelinePanel(), 50);
      }

      // Global dragover to allow drops
      document.addEventListener("dragover", handleGlobalDragEnter);

      log("loaded successfully");
    } catch (e) {
      console.error(`${EXT_TITLE}: init failure`, e);
    }
  }

  // Modern: registerExtension
  if (typeof window.registerExtension === "function") {
    window.registerExtension(EXT_NAME, init);
  } else {
    // Legacy: auto-init once DOM is ready
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => init());
    } else {
      init();
    }
  }
})();
 
