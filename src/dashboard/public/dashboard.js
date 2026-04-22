/**
 * dashboard.js — All client-side logic for the Voyager-G real-time dashboard.
 *
 * Communicates with server.js via Socket.IO.
 * Renders an ECharts line chart (tech-tree curve), a Canvas bird's-eye map,
 * a skills table, and an items icon bar.
 */

//  Icon helper (proxied through Express to avoid CORS in ECharts canvas) 
function iconUrl(name) { return '/api/icon/' + name; }

//  ECharts setup 
const chartEl = document.getElementById('chart');
const myChart = echarts.init(chartEl, 'dark');

// ECharts grid margins — must match the timeline strip alignment logic
const CHART_LEFT   = 60;
const CHART_RIGHT  = 40;
const CHART_TOP    = 40;
const CHART_BOTTOM = 50;

let seriesData = [];

const chartOption = {
  backgroundColor: 'transparent',
  tooltip: {
    trigger: 'item',
    backgroundColor: '#1e1e1e',
    borderColor: '#444',
    textStyle: { color: '#ddd', fontSize: 12 },
    formatter: function (params) {
      const d = params.data;
      const elapsed = formatElapsed(d.timestamp - sessionStartTime);
      const itemsHtml = (d.newItems && d.newItems.length > 0)
        ? d.newItems.map(n =>
            `<img src="${iconUrl(n)}" style="width:16px;height:16px;vertical-align:middle;image-rendering:pixelated" onerror="this.style.display='none'"> ${n}`
          ).join('<br>')
        : '<span style="color:#666">no new items</span>';
      return `<b>Prompts:</b> ${d.value[0]}<br>`
           + `<b>Distinct items:</b> ${d.value[1]}<br>`
           + `<b>Elapsed:</b> ${elapsed}<br>`
           + `<hr style="border-color:#333;margin:4px 0">`
           + itemsHtml;
    },
  },
  grid: { left: CHART_LEFT, right: CHART_RIGHT, top: CHART_TOP, bottom: CHART_BOTTOM },
  xAxis: {
    type: 'value',
    name: 'Prompting Iterations (Agent Only)',
    nameLocation: 'middle',
    nameGap: 28,
    nameTextStyle: { color: '#aaa', fontSize: 12 },
    splitLine: { lineStyle: { color: '#1f1f1f' } },
    min: 0,
  },
  yAxis: {
    type: 'value',
    name: 'Distinct Items',
    nameLocation: 'middle',
    nameGap: 40,
    nameTextStyle: { color: '#aaa', fontSize: 12 },
    splitLine: { lineStyle: { color: '#1f1f1f' } },
    min: 0,
  },
  series: [{
    name: 'Voyager-G',
    type: 'line',
    smooth: true,
    symbol: 'circle',
    symbolSize: 7,
    lineStyle: { color: '#ff9800', width: 3 },
    itemStyle: { color: '#ff9800' },
    areaStyle: {
      color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
        { offset: 0, color: 'rgba(255,152,0,0.22)' },
        { offset: 1, color: 'rgba(255,152,0,0.02)' },
      ]),
    },
    data: seriesData,
  }],
};

myChart.setOption(chartOption);
new ResizeObserver(() => { myChart.resize(); updateTimeline(); }).observe(chartEl);

//  Timeline strip (elapsed-time ticks aligned under the chart) 
function updateTimeline() {
  const strip = document.getElementById('timeline');
  strip.innerHTML = '';
  if (seriesData.length < 2) return;

  const maxX = seriesData[seriesData.length - 1].value[0];
  if (maxX === 0) return;

  const W      = strip.clientWidth;
  const usable = W - CHART_LEFT - CHART_RIGHT;

  for (const d of seriesData) {
    const isMilestone = d.newItems && d.newItems.length > 0;
    const idx = seriesData.indexOf(d);
    // Keep ticks sparse — milestones always show, others only every ~20th point
    if (!isMilestone && idx % Math.max(1, Math.floor(seriesData.length / 20)) !== 0) continue;

    const px      = CHART_LEFT + (d.value[0] / maxX) * usable;
    const elapsed = formatElapsed(d.timestamp - sessionStartTime);
    const tick    = document.createElement('div');
    tick.className  = 't-tick' + (isMilestone ? ' milestone' : '');
    tick.style.left = px + 'px';
    tick.innerHTML  = `<div class="t-line"></div><div class="t-label">${elapsed}</div>`;
    strip.appendChild(tick);
  }
}

//  Icon preloader — ensures ECharts has the image cached before rendering 
function preloadIcon(name) {
  return new Promise((resolve) => {
    const img   = new Image();
    img.onload  = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src     = iconUrl(name);
  });
}

// xAxisMode controls which counter drives the X axis ('codeGen' | 'agent').
let xAxisMode = 'codeGen';

/**
 * Switches the X axis between Code Gen iterations and Agent calls.
 * Rebuilds X values from stored raw counts — no data reload needed.
 */
function setXAxisMode(mode) {
  xAxisMode = mode;

  document.getElementById('btn-xaxis-codegen').className = mode === 'codeGen'
    ? 'px-2 py-0.5 rounded border border-accent bg-accent/20 text-accent hover:bg-accent/30 transition-colors'
    : 'px-2 py-0.5 rounded border border-[#444] text-muted hover:border-accent hover:text-[#d0d0d0] transition-colors';
  document.getElementById('btn-xaxis-agent').className = mode === 'agent'
    ? 'px-2 py-0.5 rounded border border-accent bg-accent/20 text-accent hover:bg-accent/30 transition-colors'
    : 'px-2 py-0.5 rounded border border-[#444] text-muted hover:border-accent hover:text-[#d0d0d0] transition-colors';

  myChart.setOption({ xAxis: { name: mode === 'codeGen'
    ? 'Prompting Iterations (Code Gen Only)'
    : 'Prompting Iterations (All Agent Calls)' } });

  for (const entry of seriesData) {
    entry.value[0] = mode === 'codeGen' ? entry.rawPromptCount : entry.rawAgentCount;
  }
  myChart.setOption({ series: [{ data: seriesData }] });
  updateTimeline();
}

// Data point handler (called for each history replay + live event)
// A point is only added to the chart series if it introduces at least one new
// distinct item, OR if this is the first point (to start the curve at 0).
// Counter updates always happen regardless.
async function addPoint(point) {
  const firstNew = (point.newItems || [])[0];

  // Always update the stat counters
  document.getElementById('stat-prompts').textContent    = point.promptCount;
  document.getElementById('stat-items').textContent      = point.distinctItems;
  document.getElementById('stat-agent').textContent      = point.agentCount       ?? 0;
  document.getElementById('stat-curriculum').textContent = point.curriculumCount  ?? 0;
  document.getElementById('stat-used').textContent       = point.usedLearnedCount ?? 0;

  // Only plot a point when at least one new item was discovered, or if it's the first point
  const isFirstPoint = seriesData.length === 0;
  if (!firstNew && !isFirstPoint) return;

  const xVal = xAxisMode === 'codeGen' ? point.promptCount : (point.agentCount ?? point.promptCount);

  const entry = {
    value:          [xVal, point.distinctItems],
    rawPromptCount: point.promptCount,
    rawAgentCount:  point.agentCount ?? point.promptCount,
    newItems:       point.newItems || [],
    timestamp:      point.timestamp,
    symbol:         'circle',
    symbolSize:     7,
  };
  seriesData.push(entry);
  myChart.setOption({ series: [{ data: seriesData }] });
  updateTimeline();

  // Upgrade to item icon after the browser has fully loaded the image
  if (firstNew) {
    const loaded = await preloadIcon(firstNew);
    if (loaded) {
      entry.symbol     = `image://${iconUrl(firstNew)}`;
      entry.symbolSize = 30;
      myChart.setOption({ series: [{ data: seriesData }] });
    }
  }
}

//  Items bar (icon strip at the bottom) 
let allSeenItems = [];
function renderItemsBar() {
  const bar = document.getElementById('items-bar');
  bar.innerHTML = '';
  for (const name of allSeenItems) {
    const chip = document.createElement('div');
    chip.className = 'item-chip';
    chip.innerHTML =
      `<img src="${iconUrl(name)}" alt="${name}" onerror="this.style.opacity='0.2'">`
      + `<span>${name}</span>`;
    bar.appendChild(chip);
  }
}

//  Session timer 
let sessionStartTime = Date.now();

function formatElapsed(ms) {
  if (!ms || ms < 0) return '00:00:00';
  const s   = Math.floor(ms / 1000);
  const h   = Math.floor(s / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return String(h).padStart(2, '0') + ':'
       + String(m).padStart(2, '0') + ':'
       + String(sec).padStart(2, '0');
}

function formatTime(ts) {
  const d = new Date(ts);
  return d.getDate().toString().padStart(2, '0') + '/'
       + (d.getMonth() + 1).toString().padStart(2, '0') + ' '
       + d.getHours().toString().padStart(2, '0') + ':'
       + d.getMinutes().toString().padStart(2, '0') + ':'
       + d.getSeconds().toString().padStart(2, '0');
}

setInterval(() => {
  document.getElementById('stat-time').textContent = formatElapsed(Date.now() - sessionStartTime);
}, 1000);

//  Skills table 
let allSkills = [];
let sortField = 'savedAt';
let sortAsc   = true;

function sortSkills(field) {
  if (sortField === field) { sortAsc = !sortAsc; }
  else { sortField = field; sortAsc = true; }
  document.getElementById('si-name').textContent = (sortField === 'name')    ? (sortAsc ? '↑' : '↓') : '↕';
  document.getElementById('si-time').textContent = (sortField === 'savedAt') ? (sortAsc ? '↑' : '↓') : '↕';
  renderSkillsTable();
}

function renderSkillsTable(flashName) {
  document.getElementById('skill-count').textContent = allSkills.length + ' skills';
  document.getElementById('stat-skills').textContent = allSkills.length;

  const sorted = [...allSkills].sort((a, b) => {
    const r = sortField === 'name'
      ? a.name.localeCompare(b.name)
      : a.savedAt - b.savedAt;
    return sortAsc ? r : -r;
  });

  const tbody = document.getElementById('skills-body');
  tbody.innerHTML = '';
  for (const s of sorted) {
    const tr = document.createElement('tr');
    tr.className = 'skill-row' + (s.name === flashName ? ' new-skill-flash' : '');
    tr.innerHTML = `<td>${s.name}</td><td>${formatTime(s.savedAt)}</td>`;
    tbody.appendChild(tr);
  }
}

//  Bird's-eye view map 
const MAP_CANVAS    = document.getElementById('map');
const MAP_CTX       = MAP_CANVAS.getContext('2d');
const CHUNK_PX      = 5;             // pixels per chunk on canvas
const BLOCKS_PER_PX = 16 / CHUNK_PX; // Minecraft blocks that map to one pixel

let mapOriginX    = null;
let mapOriginZ    = null;
let visitedChunks = new Set();
let currentBotPos = null;
let terrainBlocks = {};  // { "x,z": "#hexcolor" } — real block colors from server

function worldToMap(wx, wz) {
  const centerX = Math.floor(MAP_CANVAS.width  / 2);
  const centerZ = Math.floor(MAP_CANVAS.height / 2);
  return {
    px: centerX + Math.round((wx - (mapOriginX || 0)) / BLOCKS_PER_PX),
    py: centerZ + Math.round((wz - (mapOriginZ || 0)) / BLOCKS_PER_PX),
  };
}

function addPositionToMap(x, z) {
  if (mapOriginX === null) { mapOriginX = x; mapOriginZ = z; }
  visitedChunks.add(`${Math.floor(x / 16)},${Math.floor(z / 16)}`);
  currentBotPos = { x, z };
}

function renderMap() {
  const W = MAP_CANVAS.width;
  const H = MAP_CANVAS.height;

  MAP_CTX.fillStyle = '#0d1117';
  MAP_CTX.fillRect(0, 0, W, H);

  // Grid lines every 10 chunks (160 blocks)
  MAP_CTX.save();
  MAP_CTX.strokeStyle = '#1e2533';
  MAP_CTX.lineWidth   = 0.5;
  for (let gx = 0; gx < W; gx += CHUNK_PX * 10) {
    MAP_CTX.beginPath(); MAP_CTX.moveTo(gx, 0); MAP_CTX.lineTo(gx, H); MAP_CTX.stroke();
  }
  for (let gy = 0; gy < H; gy += CHUNK_PX * 10) {
    MAP_CTX.beginPath(); MAP_CTX.moveTo(0, gy); MAP_CTX.lineTo(W, gy); MAP_CTX.stroke();
  }
  MAP_CTX.restore();

  // Render real terrain blocks (1 block = 1 pixel scaled by BLOCKS_PER_PX)
  const blockKeys = Object.keys(terrainBlocks);
  if (blockKeys.length > 0) {
    for (const key of blockKeys) {
      const [bx, bz] = key.split(',').map(Number);
      const { px, py } = worldToMap(bx, bz);
      MAP_CTX.fillStyle = terrainBlocks[key];
      MAP_CTX.fillRect(px, py, 1, 1);
    }
  } else {
    // Fallback: visited chunks as orange overlay when no terrain data
    MAP_CTX.fillStyle = 'rgba(255,152,0,0.28)';
    for (const key of visitedChunks) {
      const [cx, cz] = key.split(',').map(Number);
      const { px, py } = worldToMap(cx * 16, cz * 16);
      MAP_CTX.fillRect(px, py, CHUNK_PX, CHUNK_PX);
    }
  }

  // World-origin crosshair
  if (mapOriginX !== null) {
    const o = worldToMap(0, 0);
    MAP_CTX.save();
    MAP_CTX.strokeStyle = 'rgba(255,255,255,0.15)';
    MAP_CTX.lineWidth   = 1;
    MAP_CTX.beginPath();
    MAP_CTX.moveTo(o.px - 6, o.py); MAP_CTX.lineTo(o.px + 6, o.py);
    MAP_CTX.moveTo(o.px, o.py - 6); MAP_CTX.lineTo(o.px, o.py + 6);
    MAP_CTX.stroke();
    MAP_CTX.restore();
  }

  // Bot position (red dot + pulse ring)
  if (currentBotPos && mapOriginX !== null) {
    const { px, py } = worldToMap(currentBotPos.x, currentBotPos.z);
    MAP_CTX.save();
    MAP_CTX.fillStyle = '#ff4400';
    MAP_CTX.beginPath();
    MAP_CTX.arc(px + CHUNK_PX / 2, py + CHUNK_PX / 2, 4, 0, 2 * Math.PI);
    MAP_CTX.fill();
    MAP_CTX.strokeStyle = 'rgba(255,68,0,0.4)';
    MAP_CTX.lineWidth   = 2;
    MAP_CTX.beginPath();
    MAP_CTX.arc(px + CHUNK_PX / 2, py + CHUNK_PX / 2, 7, 0, 2 * Math.PI);
    MAP_CTX.stroke();
    MAP_CTX.restore();
  }

  // Scale legend
  const scaleBlocks = 10 * 16;
  const scalePx     = CHUNK_PX * 10;
  MAP_CTX.save();
  MAP_CTX.strokeStyle = '#aaa';
  MAP_CTX.lineWidth   = 1;
  MAP_CTX.beginPath();
  MAP_CTX.moveTo(8, H - 10); MAP_CTX.lineTo(8 + scalePx, H - 10);
  MAP_CTX.stroke();
  MAP_CTX.fillStyle = '#888';
  MAP_CTX.font      = '10px monospace';
  MAP_CTX.fillText(`${scaleBlocks} blocks`, 10 + scalePx, H - 7);
  MAP_CTX.restore();

  document.getElementById('map-info').textContent = visitedChunks.size + ' chunks';
}

setInterval(renderMap, 1000);

//  Socket.IO event handlers 
const socket = io();

socket.on('history', (data) => {
  sessionStartTime  = data.sessionStartTime || Date.now();
  seriesData.length = 0;
  allSeenItems      = data.seenItems || [];
  allSkills         = data.skills    || [];

  for (const pt  of (data.dataPoints || [])) addPoint(pt);
  for (const pos of (data.positions  || [])) addPositionToMap(pos.x, pos.z);

  // Restore terrain block data from server history
  terrainBlocks = data.mapBlocks || {};

  renderItemsBar();
  renderSkillsTable();
  renderMap();
});

socket.on('datapoint', (point) => {
  allSeenItems = Array.from(new Set([...allSeenItems, ...(point.newItems || [])]));
  addPoint(point);
  renderItemsBar();
});

socket.on('skill_added', (skill) => {
  allSkills.push(skill);
  renderSkillsTable(skill.name);
});

socket.on('position', (pos) => {
  addPositionToMap(pos.x, pos.z);
});

socket.on('map_blocks', (blocks) => {
  for (const b of blocks) {
    terrainBlocks[b.x + ',' + b.z] = b.color;
  }
});

//  Session selector 
let isLiveMode = true;

/**
 * Resets all dashboard state to blank before loading new data.
 */
function resetDashboardState() {
  seriesData.length = 0;
  allSeenItems      = [];
  allSkills         = [];
  visitedChunks.clear();
  terrainBlocks     = {};
  currentBotPos     = null;
  mapOriginX        = null;
  mapOriginZ        = null;

  document.getElementById('stat-prompts').textContent    = '0';
  document.getElementById('stat-items').textContent      = '0';
  document.getElementById('stat-skills').textContent     = '0';
  document.getElementById('stat-agent').textContent      = '0';
  document.getElementById('stat-curriculum').textContent = '0';
  document.getElementById('stat-used').textContent       = '0';
}

/**
 * Replays a full session dataset into the dashboard (same shape as the
 * 'history' Socket event, or the saved JSON file).
 */
function replaySessionData(data) {
  resetDashboardState();
  sessionStartTime  = data.sessionStartTime || Date.now();
  allSeenItems      = data.seenItems || [];
  allSkills         = data.skills    || [];

  for (const pt  of (data.dataPoints || [])) addPoint(pt);
  for (const pos of (data.positions  || [])) addPositionToMap(pos.x, pos.z);

  terrainBlocks = data.mapBlocks || {};

  renderItemsBar();
  renderSkillsTable();
  renderMap();
  myChart.setOption({ series: [{ data: seriesData }] });
}

/**
 * Fetches the list of past sessions from the server and populates the dropdown.
 */
async function loadSessionList() {
  const sel = document.getElementById('session-selector');
  try {
    const res   = await fetch('/api/sessions');
    const files = await res.json();

    // Remove old options except "Live"
    while (sel.options.length > 1) sel.remove(1);

    for (const name of files) {
      const opt   = document.createElement('option');
      opt.value   = name;
      // Display a friendlier label: "2025-01-15 14:30:00"
      opt.textContent = name.replace('.json', '').replace('_', ' ').replace(/-/g, (m, i) => i > 9 ? ':' : '-');
      sel.appendChild(opt);
    }
  } catch (_) {
    // Silently ignore — dropdown stays with "Live" only
  }
}

/**
 * Loads a specific saved session by filename and replays it.
 */
async function loadSession(name) {
  try {
    const res  = await fetch('/api/sessions/' + encodeURIComponent(name));
    if (!res.ok) return;
    const data = await res.json();
    replaySessionData(data);
  } catch (_) {
    // Ignore load errors
  }
}

// Dropdown change handler
document.getElementById('session-selector').addEventListener('change', async (e) => {
  const val = e.target.value;
  if (val === 'live') {
    isLiveMode = true;
    // Reconnect to live data: the server will re-emit 'history' on connect
    socket.connect();
  } else {
    isLiveMode = false;
    socket.disconnect();
    await loadSession(val);
  }
});

// Prevent live events from updating the UI when viewing a past session
const _origEmit = socket.onevent;
socket.onevent = function (packet) {
  if (!isLiveMode) return; // Ignore all socket events in replay mode
  _origEmit.call(this, packet);
};

// Populate the session list on page load
loadSessionList();
// Refresh the session list periodically (every 60 s) to pick up new saves
setInterval(loadSessionList, 60000);
