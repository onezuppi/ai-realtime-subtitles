/** Markup and styles of the caption box. Constant text only: captions are added with textContent. */
export const OVERLAY_HTML = `
  <style>
    .box { position: fixed; pointer-events: auto; touch-action: none; cursor: grab; display: none;
      padding: .45em .8em; border-radius: .5em; box-sizing: border-box; color: #fff; text-align: center;
      font: 600 16px/1.35 system-ui, sans-serif; text-shadow: 0 1px 2px rgba(0,0,0,.8);
      background: rgba(0,0,0,var(--opacity)); backdrop-filter: blur(4px); user-select: none; }
    .box.dragging { cursor: grabbing; }
    .grip { position: absolute; right: 2px; bottom: 2px; width: 14px; height: 14px; cursor: nwse-resize; opacity: 0;
      background: linear-gradient(135deg, transparent 50%, rgba(255,255,255,.8) 50%); border-radius: 0 0 .4em 0; }
    .box:hover .grip { opacity: 1; }
    .pip { position: absolute; right: 4px; top: 4px; width: 22px; height: 22px; padding: 3px; border: 0; border-radius: 5px;
      background: rgba(255,255,255,.14); color: #fff; opacity: 0; cursor: pointer; display: none; }
    .box:hover .pip { opacity: 1; }
    .pip:hover { background: rgba(255,255,255,.3); }
    .pip[aria-pressed="true"] { background: rgba(111,148,255,.7); }
    .pip svg { width: 100%; height: 100%; fill: none; stroke: currentColor; stroke-width: 2; }
  </style>
  <div class="box" part="box"><span class="text"></span>
    <button class="pip" type="button" aria-label="Show subtitles in a Picture-in-Picture window" title="Picture-in-Picture" aria-pressed="false">
      <svg viewBox="0 0 24 24"><rect x="2.5" y="4.5" width="19" height="15" rx="2"/><rect x="11" y="11" width="8" height="6" rx="1" fill="currentColor" stroke="none"/></svg>
    </button>
    <div class="grip"></div></div>`;
