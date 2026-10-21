window.__ModuleLoader__.load({ id: "mat-ui", factory: (require) => { var module = { exports: {} }; var exports = module.exports;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// packages/mat-ui/src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// packages/mat-ui/src/client/Brand.tsx
var import_jsx_runtime = require("react/jsx-runtime");
function MatBrandName() {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "mat-brand-name", children: "Harness" });
}

// packages/mat-ui/src/client/StatusDock.tsx
var import_react = require("react");
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// packages/mat-ui/src/client/file-manager-state.ts
var open = false;
var selectedJobId;
var openScopes = [];
var activeTab = "files";
var refresh = "idle";
var download = "idle";
var deleting = "idle";
var opening = [];
var expanding = [];
var jobs = /* @__PURE__ */ new Map();
var listeners = /* @__PURE__ */ new Set();
function emit() {
  for (const listener of listeners) listener();
}
function stateOf(scope) {
  const key = scope ?? selectedJobId;
  if (key === void 0) return { expanded: [], selectedPaths: [], pins: [] };
  let state = jobs.get(key);
  if (state === void 0) {
    state = { expanded: [], selectedPaths: [], pins: [] };
    jobs.set(key, state);
  }
  return state;
}
function currentJob() {
  return stateOf(void 0);
}
function toggle(values, path) {
  return values.includes(path) ? values.filter((value) => value !== path) : [...values, path];
}
function openScopeIn(key) {
  if (!openScopes.includes(key)) openScopes = [...openScopes, key];
}
var fileManagerState = {
  snapshot: () => ({
    open,
    selectedJobId,
    openScopes,
    activeTab,
    refresh,
    download,
    deleting,
    opening,
    expanding,
    ...currentJob(),
    scopes: Object.fromEntries(jobs)
  }),
  subscribe(listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  open(jobId) {
    open = true;
    activeTab = "files";
    if (jobId !== void 0) {
      selectedJobId = jobId;
      openScopeIn(jobId);
    }
    emit();
  },
  close() {
    open = false;
    emit();
  },
  /** 聚焦某 scope（顺带展开其虚拟根——跨面板 selectJob 联动）。 */
  select(jobId) {
    selectedJobId = jobId;
    openScopeIn(jobId);
    emit();
  },
  selectJob(jobId) {
    selectedJobId = jobId;
    openScopeIn(jobId);
    emit();
  },
  /** 只改焦点、不展开（作业目录默认折叠；展开由用户点 scope 行触发）。 */
  focus(jobId) {
    selectedJobId = jobId;
    emit();
  },
  /** 虚拟根展开管理：工作区与作业子树共存于统一树。 */
  openScope(key) {
    openScopeIn(key);
    emit();
  },
  closeScope(key) {
    openScopes = openScopes.filter((value) => value !== key);
    emit();
  },
  toggleScope(key) {
    openScopes.includes(key) ? fileManagerState.closeScope(key) : fileManagerState.openScope(key);
  },
  selectTab(tab) {
    activeTab = tab;
    emit();
  },
  toggleExpanded(path, scope) {
    const state = stateOf(scope);
    state.expanded = toggle(state.expanded, path);
    emit();
  },
  selectPath(path, scope) {
    const state = stateOf(scope);
    state.selectedPaths = toggle(state.selectedPaths, path);
    emit();
  },
  pin(path, scope) {
    const state = stateOf(scope);
    if (!state.pins.includes(path)) state.pins = [...state.pins, path];
    emit();
  },
  unpin(path, scope) {
    const state = stateOf(scope);
    state.pins = state.pins.filter((value) => value !== path);
    emit();
  },
  setPins(paths, scope) {
    stateOf(scope).pins = [...new Set(paths)];
    emit();
  },
  beginRefresh() {
    refresh = "pending";
    emit();
  },
  finishRefresh(error2) {
    refresh = error2 === void 0 ? "idle" : "failed";
    emit();
  },
  /** 单文件打开（按需物化）在途集合：驱动 chip 级加载指示。 */
  beginOpen(path) {
    if (!opening.includes(path)) opening = [...opening, path];
    emit();
  },
  finishOpen(path) {
    opening = opening.filter((value) => value !== path);
    emit();
  },
  /** 目录展开（远端子目录列表）在途集合：驱动目录下加载行。 */
  beginExpand(path, scope) {
    if (!expanding.includes(path)) expanding = [...expanding, path];
    emit();
  },
  finishExpand(path, scope) {
    expanding = expanding.filter((value) => value !== path);
    emit();
  },
  beginDownload(paths, scope) {
    stateOf(scope).selectedPaths = [...paths];
    refresh = "idle";
    download = "pending";
    emit();
  },
  finishDownload(error2) {
    download = error2 === void 0 ? "idle" : "failed";
    emit();
  },
  /** 本地删除在途态（与下载/刷新同族）。 */
  beginDelete() {
    deleting = "pending";
    emit();
  },
  finishDelete(error2) {
    deleting = error2 === void 0 ? "idle" : "failed";
    emit();
  },
  /** 删除落盘后清掉相关选中/展开/pin，避免树里残留死引用。 */
  removePaths(paths, scope) {
    const state = stateOf(scope);
    const gone = (path) => paths.some((target) => path === target || path.startsWith(`${target}/`));
    state.selectedPaths = state.selectedPaths.filter((path) => !gone(path));
    state.expanded = state.expanded.filter((path) => !gone(path));
    state.pins = state.pins.filter((path) => !gone(path));
    emit();
  },
  reset() {
    open = false;
    selectedJobId = void 0;
    openScopes = [];
    activeTab = "files";
    refresh = "idle";
    download = "idle";
    deleting = "idle";
    opening = [];
    expanding = [];
    jobs.clear();
    listeners.clear();
  }
};

// packages/mat-ui/src/client/layout-room.ts
var RAIL_FLOOR = 56 + 640 + 300;
function sidebarTrack() {
  const frame = document.querySelector("[data-shell-overlay]")?.parentElement ?? null;
  const tracks = frame instanceof HTMLElement ? frame.style.gridTemplateColumns : "";
  return Number.parseFloat(tracks.split(" ")[0] ?? "");
}
function openDetailsWithRoom(layout) {
  const sidebar = sidebarTrack();
  if (Number.isFinite(sidebar) && sidebar + 640 + 300 > window.innerWidth && window.innerWidth >= RAIL_FLOOR) {
    layout.toggleSidebar();
  }
  layout.openDetails();
}

// packages/mat-ui/src/client/status-model.ts
function formatCompletionTime(timestamp) {
  return new Intl.DateTimeFormat(void 0, {
    dateStyle: "short",
    timeStyle: "short"
  }).format(timestamp);
}
function jobsForSession(jobs2, sessionId) {
  if (sessionId === void 0) return [];
  return jobs2.filter((job) => job.ownerSession === sessionId);
}
function monitorMetadata(job) {
  const ids = slurmIds(job);
  return [
    ["completed", job.phase === "settled" ? formatCompletionTime(job.settledAt ?? job.updatedAt) : "in progress"],
    ["partition", job.partition ?? "\u2014"],
    ["job ID", ids.length > 0 ? ids.join(", ") : job.jobId],
    ["status", job.slurm?.[0]?.state ?? job.outcomeStatus ?? (job.phase === "settled" ? "\u2014" : "monitoring")],
    ["converged", job.converged === void 0 ? "\u2014" : job.converged ? "yes" : "no"]
  ];
}
function slurmIds(job) {
  return job.slurm?.map((entry) => entry.id) ?? [];
}
function jobOptionLabel(job) {
  const ids = slurmIds(job);
  if (ids.length === 0) return job.label ?? job.jobId;
  const base = job.label ?? job.jobId;
  return ids.every((id) => base.includes(id)) ? base : ids.join(", ");
}

// packages/mat-ui/src/client/StatusDock.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
function statusState(job) {
  if (job.phase !== "settled") return "ongoing";
  return job.outcomeStatus === "completed" ? "done" : "error";
}
function StatusDock({
  sessionId,
  openDetailsTab,
  layout,
  onOpenTask = () => {
    openDetailsTab?.("mat-task");
  }
}) {
  const [jobs2, setJobs] = (0, import_react.useState)([]);
  const visible = (0, import_react.useMemo)(() => jobsForSession(jobs2, sessionId), [jobs2, sessionId]);
  (0, import_react.useEffect)(() => {
    let alive = true;
    const load = async () => {
      try {
        const response = await fetch("/mat-status/jobs", { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json();
        if (alive) setJobs(Array.isArray(payload.jobs) ? payload.jobs : []);
      } catch {
      }
    };
    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 5e3);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);
  const [selectedId, setSelectedId] = (0, import_react.useState)(fileManagerState.snapshot().selectedJobId);
  (0, import_react.useEffect)(() => fileManagerState.subscribe(() => {
    setSelectedId(fileManagerState.snapshot().selectedJobId);
  }), []);
  const selected = visible.find((job) => job.jobId === selectedId) ?? visible.at(-1);
  if (selected === void 0) return null;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "mat-status-strip", role: "status", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.StateDot, { state: statusState(selected) }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "mat-status-strip__label", children: selected.phase === "settled" ? "Computation finished" : selected.phase === "queued" ? "Queued \u2014 waiting for partition" : "Computation running" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
      "select",
      {
        "aria-label": "Current conversation task",
        value: selected.jobId,
        onChange: (event) => {
          fileManagerState.selectJob(event.target.value);
        },
        children: visible.map((job) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: job.jobId, children: jobOptionLabel(job) }, job.jobId))
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "mat-status-strip__count", children: [
      visible.length,
      " tasks"
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.Button, { size: "sm", variant: "outline", "aria-label": `\u6253\u5F00\u4EFB\u52A1\u9762\u677F ${selected.jobId}`, onClick: onOpenTask, children: "\u4EFB\u52A1" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.Button, { size: "sm", variant: "outline", "aria-label": "\u6253\u5F00\u6587\u4EF6\u9762\u677F", onClick: () => {
      if (layout !== void 0) openDetailsWithRoom(layout);
      openDetailsTab?.("mat-files");
    }, children: "\u6587\u4EF6" })
  ] });
}

// packages/mat-ui/src/client/FileManagerPanel.tsx
var import_react2 = require("react");
var import_dsh_client_ui_primitives2 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_react3 = require("react");

// packages/mat-ui/src/client/file-tree-model.ts
function parent(path) {
  const index = path.lastIndexOf("/");
  return index < 0 ? void 0 : path.slice(0, index);
}
function visibleTreeEntries(entries, expanded) {
  const open2 = new Set(expanded);
  return [...entries].sort((a, b) => a.path.localeCompare(b.path)).filter((entry) => {
    let current2 = parent(entry.path);
    while (current2 !== void 0) {
      if (!open2.has(current2)) return false;
      current2 = parent(current2);
    }
    return true;
  }).map((entry) => ({ ...entry, depth: entry.path.split("/").length - 1 }));
}
function mergeTreeEntries(current2, root, children) {
  const prefix = `${root}/`;
  return [...current2.filter((entry) => entry.path !== root && !entry.path.startsWith(prefix)), ...current2.filter((entry) => entry.path === root), ...children].sort((a, b) => a.path.localeCompare(b.path));
}

// packages/mat-ui/src/client/viewer-state.ts
var current;
var status = "idle";
var error;
var immersive = false;
var listeners2 = /* @__PURE__ */ new Set();
function emit2() {
  for (const listener of listeners2) listener();
}
var viewerState = {
  snapshot: () => ({
    ...current === void 0 ? {} : { current },
    status,
    ...error === void 0 ? {} : { error },
    immersive
  }),
  subscribe(listener) {
    listeners2.add(listener);
    return () => {
      listeners2.delete(listener);
    };
  },
  /** 文件面板点击入口：记录目标并进入在途态（图片/PDF 由 onLoad 收尾，结构/文本由取回流程收尾）。 */
  open(jobId, path, kind) {
    current = { jobId, path, kind };
    status = "pending";
    error = void 0;
    emit2();
  },
  finish(cause) {
    status = cause === void 0 ? "idle" : "error";
    error = cause === void 0 ? void 0 : cause instanceof Error ? cause.message : String(cause);
    emit2();
  },
  clear() {
    current = void 0;
    status = "idle";
    error = void 0;
    immersive = false;
    emit2();
  },
  reset() {
    current = void 0;
    status = "idle";
    error = void 0;
    immersive = false;
    listeners2.clear();
  },
  /** 进入沉浸大画布（面板工具条「放大」）。目标仍在侧栏 tab 里继续渲染，只是被遮罩盖住。 */
  enterImmersive() {
    immersive = true;
    emit2();
  },
  /** 退出沉浸（ESC / 点遮罩 / 「收起」钮）。 */
  exitImmersive() {
    immersive = false;
    emit2();
  }
};

// packages/mat-ui/src/client/structure-model.ts
var COV_RADII = {
  H: 0.31,
  He: 0.28,
  Li: 1.28,
  Be: 0.96,
  B: 0.84,
  C: 0.76,
  N: 0.71,
  O: 0.66,
  F: 0.57,
  Ne: 0.58,
  Na: 1.66,
  Mg: 1.41,
  Al: 1.21,
  Si: 1.11,
  P: 1.07,
  S: 1.05,
  Cl: 1.02,
  Ar: 1.06,
  K: 2.03,
  Ca: 1.76,
  Sc: 1.7,
  Ti: 1.6,
  V: 1.53,
  Cr: 1.39,
  Mn: 1.39,
  Fe: 1.32,
  Co: 1.26,
  Ni: 1.24,
  Cu: 1.32,
  Zn: 1.22,
  Ga: 1.22,
  Ge: 1.2,
  As: 1.19,
  Se: 1.2,
  Br: 1.2,
  Kr: 1.16,
  Rb: 2.2,
  Sr: 1.95,
  Y: 1.9,
  Zr: 1.75,
  Nb: 1.64,
  Mo: 1.54,
  Tc: 1.47,
  Ru: 1.46,
  Rh: 1.42,
  Pd: 1.39,
  Ag: 1.45,
  Cd: 1.44,
  In: 1.42,
  Sn: 1.39,
  Sb: 1.39,
  Te: 1.38,
  I: 1.39,
  Xe: 1.4,
  Cs: 2.44,
  Ba: 2.15,
  La: 2.07,
  Ce: 2.04,
  Pr: 2.03,
  Nd: 2.01,
  Pm: 1.99,
  Sm: 1.98,
  Eu: 1.98,
  Gd: 1.96,
  Tb: 1.94,
  Dy: 1.92,
  Ho: 1.92,
  Er: 1.89,
  Tm: 1.9,
  Yb: 1.87,
  Lu: 1.87,
  Hf: 1.75,
  Ta: 1.7,
  W: 1.62,
  Re: 1.51,
  Os: 1.44,
  Ir: 1.41,
  Pt: 1.36,
  Au: 1.36,
  Hg: 1.32,
  Tl: 1.45,
  Pb: 1.46,
  Bi: 1.48,
  Po: 1.68,
  At: 1.68,
  Rn: 1.5,
  Fr: 2.6,
  Ra: 2.21,
  Ac: 2.15,
  Th: 2.06,
  Pa: 2,
  U: 1.96,
  Np: 1.9,
  Pu: 1.87,
  Am: 1.8,
  Cm: 1.69
};
var COV_FACTOR = 1.2;
var MIN_BOND_D2 = 0.01;
var MAX_BOND_ATOMS = 1600;
var ELEM_HEX = {
  H: "#ffffff",
  He: "#d9ffff",
  Li: "#cc80ff",
  Be: "#c2ff00",
  B: "#ffb5b5",
  C: "#909090",
  N: "#3050f8",
  O: "#ff0d0d",
  F: "#90e050",
  Ne: "#b3e3f5",
  Na: "#ab5cf2",
  Mg: "#8aff00",
  Al: "#bfa6a6",
  Si: "#f0c8a0",
  P: "#ff8000",
  S: "#ffff30",
  Cl: "#1ff01f",
  Ar: "#80d1e3",
  K: "#8f40d4",
  Ca: "#3dff00",
  Sc: "#e6e6e6",
  Ti: "#bfc2c7",
  V: "#a6a6ab",
  Cr: "#8a99c7",
  Mn: "#9c7ac7",
  Fe: "#e45a45",
  Co: "#f090a0",
  Ni: "#50d050",
  Cu: "#c88033",
  Zn: "#7d80b0",
  Ga: "#966733",
  Ge: "#668f8f",
  As: "#bd80e3",
  Se: "#ffa100",
  Br: "#a62929",
  Kr: "#5cb8d1",
  Rb: "#702eb0",
  Sr: "#00ff00",
  Y: "#94ffff",
  Zr: "#94e0e0",
  Nb: "#73c2c9",
  Mo: "#54b5b5",
  Tc: "#3b9e9e",
  Ru: "#248f8f",
  Rh: "#0a7d8c",
  Pd: "#006985",
  Ag: "#c0c0c0",
  Cd: "#ffd98d",
  In: "#a67573",
  Sn: "#668080",
  Sb: "#9e63b5",
  Te: "#d47a00",
  I: "#940094",
  Xe: "#429eb0",
  Cs: "#57178f",
  Ba: "#00c900",
  W: "#2194d6",
  Pt: "#d0d0e0",
  Au: "#ffd123",
  Hg: "#ff8c00",
  Tl: "#a6544d",
  Pb: "#575961"
};
var FALLBACK_RGB = [201 / 255, 209 / 255, 217 / 255];
function hexRgb(hex) {
  const h = hex.replace("#", "");
  return [0, 1, 2].map((k) => Number.parseInt(h.slice(k * 2, k * 2 + 2), 16) / 255);
}
function covRadius(elem) {
  const r = COV_RADII[elem];
  return typeof r === "number" ? r : 0.75;
}
function elemRgb(elem) {
  return ELEM_HEX[elem] === void 0 ? FALLBACK_RGB : hexRgb(ELEM_HEX[elem]);
}
function buildLattice(a, b, c, alpha, beta, gamma) {
  const al = alpha * Math.PI / 180, be = beta * Math.PI / 180, ga = gamma * Math.PI / 180;
  const cx = c * Math.cos(be);
  const cy = c * (Math.cos(al) - Math.cos(be) * Math.cos(ga)) / Math.sin(ga);
  const cz = Math.sqrt(Math.max(c * c - cx * cx - cy * cy, 0));
  return [[a, 0, 0], [b * Math.cos(ga), b * Math.sin(ga), 0], [cx, cy, cz]];
}
function invertMatrix3(matrix) {
  const [[a, b, c], [d, e, f], [g, h, i]] = matrix;
  const cofactor = [
    [e * i - f * h, f * g - d * i, d * h - e * g],
    [c * h - b * i, a * i - c * g, b * g - a * h],
    [b * f - c * e, c * d - a * f, a * e - b * d]
  ];
  const determinant = a * cofactor[0][0] + b * cofactor[0][1] + c * cofactor[0][2];
  if (Math.abs(determinant) < 1e-12) return null;
  const transpose = (m) => m[0].map((_, column) => m.map((row) => row[column]));
  return transpose(cofactor).map((row) => row.map((value) => value / determinant));
}
function mulRows(v, m) {
  return [
    v[0] * m[0][0] + v[1] * m[1][0] + v[2] * m[2][0],
    v[0] * m[0][1] + v[1] * m[1][1] + v[2] * m[2][1],
    v[0] * m[0][2] + v[1] * m[1][2] + v[2] * m[2][2]
  ];
}
function latticeMetrics(lattice) {
  const norm = (v) => Math.hypot(v[0], v[1], v[2]);
  const angle = (u, v) => Math.acos((u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (norm(u) * norm(v))) * 180 / Math.PI;
  return {
    lengths: [norm(lattice[0]), norm(lattice[1]), norm(lattice[2])],
    angles: [angle(lattice[1], lattice[2]), angle(lattice[0], lattice[2]), angle(lattice[0], lattice[1])]
  };
}
function finished(lattice, atoms, hasCell, formula) {
  const { lengths, angles } = latticeMetrics(lattice);
  return {
    a: lengths[0],
    b: lengths[1],
    c: lengths[2],
    alpha: angles[0],
    beta: angles[1],
    gamma: angles[2],
    lattice,
    atoms,
    hasCell,
    formula
  };
}
function numbers(line) {
  return line.split(/\s+/).filter(Boolean);
}
function parsePoscar(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "");
  if (lines.length < 9) throw new Error("malformed POSCAR: too few lines");
  const scale = Number(numbers(lines[1])[0]);
  if (!Number.isFinite(scale) || scale <= 0) throw new Error("malformed POSCAR: bad scaling factor");
  const lattice = lines.slice(2, 5).map((row) => numbers(row).map(Number).slice(0, 3));
  if (lattice.some((row) => row.length < 3 || row.some((value) => !Number.isFinite(value)))) {
    throw new Error("malformed POSCAR: bad lattice vectors");
  }
  const scaled = lattice.map((row) => row.map((value) => value * scale));
  let cursor = 5;
  const tokenIsCount = (token) => /^\d+$/.test(token);
  const elementsRow = numbers(lines[cursor]);
  if (elementsRow.length === 0) throw new Error("malformed POSCAR: missing element symbols (v4 layouts unsupported)");
  if (elementsRow.some((token) => !tokenIsCount(token))) {
    cursor += 1;
  } else {
    throw new Error("malformed POSCAR: missing element symbols (v4 layouts unsupported)");
  }
  const elements = elementsRow;
  const counts = numbers(lines[cursor] ?? "").map(Number);
  if (counts.length !== elements.length || counts.some((value) => !Number.isInteger(value) || value <= 0)) {
    throw new Error("malformed POSCAR: element counts do not match symbols");
  }
  cursor += 1;
  let mode;
  while (cursor < lines.length) {
    const head = numbers(lines[cursor])[0];
    if (head === void 0) {
      cursor += 1;
      continue;
    }
    if (/^s/i.test(head)) {
      cursor += 1;
      continue;
    }
    if (/^d/i.test(head)) mode = "direct";
    else if (/^c/i.test(head)) mode = "cartesian";
    break;
  }
  if (mode === void 0) throw new Error("malformed POSCAR: missing Direct/Cartesian marker");
  cursor += 1;
  const inverse = mode === "cartesian" ? invertMatrix3(scaled) : void 0;
  if (inverse === null) throw new Error("malformed POSCAR: singular lattice");
  const atoms = [];
  for (const [index, symbol] of elements.entries()) {
    for (let nth = 0; nth < counts[index]; nth++) {
      const raw = numbers(lines[cursor] ?? "").map(Number).slice(0, 3);
      if (raw.length < 3 || raw.some((value) => !Number.isFinite(value))) {
        throw new Error(`malformed POSCAR: bad coordinates for ${symbol} site ${nth + 1}`);
      }
      const f = inverse === void 0 ? raw : mulRows(raw, inverse);
      atoms.push({ elem: symbol, f, pos: mulRows(f, scaled) });
      cursor += 1;
    }
  }
  if (atoms.length === 0) throw new Error("malformed POSCAR: no sites");
  return finished(scaled, atoms, true, elements.map((symbol, index) => `${symbol}${counts[index]}`).join(""));
}
function parseXyz(text) {
  const raw = text.split(/\r?\n/);
  let head = 0;
  while (head < raw.length && raw[head].trim() === "") head++;
  if (raw.length - head < 3) throw new Error("malformed XYZ: too few lines");
  const declared = Number(raw[head].trim());
  if (!Number.isInteger(declared) || declared < 1) throw new Error("malformed XYZ: bad atom count");
  const siteLines = raw.slice(head + 2).filter((line) => line.trim() !== "");
  if (siteLines.length < declared) throw new Error("malformed XYZ: fewer sites than declared");
  const atoms = [];
  const MARGIN = 8;
  for (const line of siteLines.slice(0, declared)) {
    const tokens = line.trim().split(/\s+/);
    const symbol = tokens[0]?.match(/^[A-Za-z]+/)?.[0];
    const coordinates = tokens.slice(1, 4).map(Number);
    if (symbol === void 0 || coordinates.length < 3 || coordinates.some((value) => !Number.isFinite(value))) {
      throw new Error("malformed XYZ: bad site line");
    }
    atoms.push({ elem: symbol, f: [0, 0, 0], pos: coordinates });
  }
  const extent = [0, 1, 2].map((axis) => Math.max(...atoms.map((at) => at.pos[axis])) - Math.min(...atoms.map((at) => at.pos[axis])));
  const origin = [0, 1, 2].map((axis) => Math.min(...atoms.map((at) => at.pos[axis])) - MARGIN);
  const box = extent.map((value) => value + 2 * MARGIN);
  const lattice = [[box[0], 0, 0], [0, box[1], 0], [0, 0, box[2]]];
  for (const at of atoms) {
    at.f = [0, 1, 2].map((axis) => (at.pos[axis] - origin[axis]) / box[axis]);
  }
  const counts = /* @__PURE__ */ new Map();
  for (const at of atoms) counts.set(at.elem, (counts.get(at.elem) ?? 0) + 1);
  return finished(lattice, atoms, false, [...counts.entries()].map(([elem, n]) => `${elem}${n}`).join(""));
}
var IDENTITY_SYMOP = { rotation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], translation: [0, 0, 0] };
function parseSymop(text) {
  const parts = text.trim().replace(/^['"]|['"]$/g, "").split(",");
  if (parts.length !== 3) return null;
  const axisIndex = { x: 0, y: 1, z: 2 };
  const rotation = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const translation = [0, 0, 0];
  for (const [row, part] of parts.entries()) {
    const terms = part.trim().match(/[+-]?[^+-]+/g);
    if (terms === null) return null;
    for (const term of terms) {
      const match = term.trim().match(/^([+-])?\s*(?:(\d+)\/(\d+)|(\d*\.?\d+))?\s*([xyz])?$/i);
      if (match === null) return null;
      const sign = match[1] === "-" ? -1 : 1;
      const value = match[2] !== void 0 ? Number(match[2]) / Number(match[3]) : match[4] !== void 0 && match[4] !== "" ? Number(match[4]) : 1;
      if (!Number.isFinite(value)) return null;
      if (match[5] !== void 0) rotation[row][axisIndex[match[5].toLowerCase()]] = sign * value;
      else translation[row] += sign * value;
    }
  }
  return { rotation, translation };
}
function applySymop(f, op) {
  return [0, 1, 2].map((k) => f[0] * op.rotation[0][k] + f[1] * op.rotation[1][k] + f[2] * op.rotation[2][k] + op.translation[k]);
}
var wrap01 = (value) => value - Math.floor(value);
function sameFract(a, b) {
  return [0, 1, 2].every((k) => {
    const d = Math.abs(a[k] - b[k]);
    return Math.min(d, 1 - d) < 1e-4;
  });
}
function cifTokens(line) {
  const tokens = [];
  for (const match of line.matchAll(/'[^']*'|"[^"]*"|\S+/g)) tokens.push(match[0]);
  return tokens;
}
function cleanElem(raw) {
  const letters = raw.replace(/[^A-Za-z]/g, "");
  if (letters === "") return "X";
  const capped = letters.charAt(0).toUpperCase() + letters.slice(1).toLowerCase();
  if (COV_RADII[capped] !== void 0) return capped;
  if (capped.length > 1 && COV_RADII[capped.charAt(0)] !== void 0) return capped.charAt(0);
  return capped;
}
var MAX_EXPANSION_SITES = 2e3;
function cifLoops(block) {
  const loops = [];
  for (let i = 0; i < block.length; i++) {
    if (!/^\s*loop_\s*$/i.test(block[i])) continue;
    const headers = [];
    let j = i + 1;
    while (j < block.length && /^\s*_/.test(block[j])) {
      headers.push(block[j].trim().toLowerCase());
      j++;
    }
    const rows2 = [];
    while (j < block.length) {
      const t = block[j].trim();
      if (t === "") {
        j++;
        continue;
      }
      if (t.startsWith("_") || t.startsWith("#") || t.startsWith(";") || /^(loop_|data_|save_|stop_|global_)/i.test(t)) break;
      rows2.push(cifTokens(t));
      j++;
    }
    loops.push({ headers, rows: rows2 });
    i = j - 1;
  }
  return loops;
}
function parseCif(text) {
  if (!text) return null;
  const raw = text.split(/\r?\n/);
  const lines = [];
  for (let i = 0; i < raw.length; i++) {
    if (/^;/.test(raw[i])) {
      i += 1;
      while (i < raw.length && !/^;/.test(raw[i])) i += 1;
      continue;
    }
    lines.push(raw[i]);
  }
  const blocks = [[]];
  for (const line of lines) {
    if (/^\s*data_[^\s]*/i.test(line)) blocks.push([]);
    blocks.at(-1).push(line);
  }
  for (const block of blocks) {
    const parsed = parseCifBlock(block);
    if (parsed !== null) return parsed;
  }
  return null;
}
function parseCifBlock(block) {
  const get = (tag) => {
    const re = new RegExp(`^\\s*_${tag}(?![\\w])\\s+(\\S+)`, "i");
    for (const line of block) {
      const match = line.match(re);
      if (match) {
        const value = Number.parseFloat(match[1].replace(/^['"]|['"]$/g, "").replace(/\(\d+\)/, ""));
        return Number.isFinite(value) ? value : null;
      }
    }
    return null;
  };
  const a = get("cell_length_a"), b = get("cell_length_b"), c = get("cell_length_c");
  const alpha = get("cell_angle_alpha"), beta = get("cell_angle_beta"), gamma = get("cell_angle_gamma");
  if (a === null || b === null || c === null || alpha === null || beta === null || gamma === null) return null;
  let formula = "";
  for (const line of block) {
    const match = line.match(/^\s*_chemical_formula_sum\s+'?([^']+?)'?\s*$/i);
    if (match) {
      formula = match[1].replace(/\s+/g, "");
      break;
    }
  }
  const lattice = buildLattice(a, b, c, alpha, beta, gamma);
  const loops = cifLoops(block);
  const symopTags = ["_space_group_symop_operation_xyz", "_symmetry_equiv_pos_as_xyz"];
  const ops = [];
  for (const loop of loops) {
    const col = symopTags.findIndex((tag) => loop.headers.includes(tag));
    if (col === -1) continue;
    for (const row of loop.rows) {
      if (row.length <= col) continue;
      const op = parseSymop(row[col]);
      if (op !== null) ops.push(op);
    }
  }
  if (ops.length === 0) ops.push(IDENTITY_SYMOP);
  const sites = [];
  for (const loop of loops) {
    const idx = {};
    loop.headers.forEach((header, n) => {
      idx[header] = n;
    });
    const fx = idx["_atom_site_fract_x"], fy = idx["_atom_site_fract_y"], fz = idx["_atom_site_fract_z"];
    const cx = idx["_atom_site_cartn_x"], cy = idx["_atom_site_cartn_y"], cz = idx["_atom_site_cartn_z"];
    const hasFract = fx !== void 0 && fy !== void 0 && fz !== void 0;
    const hasCart = cx !== void 0 && cy !== void 0 && cz !== void 0;
    if (!hasFract && !hasCart) continue;
    const typeCol = idx["_atom_site_type_symbol"] !== void 0 ? idx["_atom_site_type_symbol"] : idx["_atom_site_label"];
    const inverse = hasCart && !hasFract ? invertMatrix3(lattice) : null;
    if (hasCart && !hasFract && inverse === null) return null;
    const num = (token) => Number.parseFloat(String(token).replace(/^['"]|['"]$/g, "").replace(/\(\d+\)/, ""));
    for (const row of loop.rows) {
      if (row.length < loop.headers.length) continue;
      const f = hasFract ? [num(row[fx]), num(row[fy]), num(row[fz])] : mulRows([num(row[cx]), num(row[cy]), num(row[cz])], inverse);
      if (f.some((value) => Number.isNaN(value))) continue;
      sites.push({ elem: cleanElem(typeCol !== void 0 ? row[typeCol] ?? "X" : "X"), f });
    }
    break;
  }
  if (sites.length === 0) return null;
  const expanded = [];
  if (sites.length * ops.length > MAX_EXPANSION_SITES) {
    expanded.push(...sites);
  } else {
    for (const op of ops) {
      for (const site of sites) {
        const f = applySymop(site.f, op).map(wrap01);
        if (!expanded.some((seen) => seen.elem === site.elem && sameFract(seen.f, f))) expanded.push({ elem: site.elem, f });
      }
    }
  }
  const atoms = expanded.map((site) => ({ elem: site.elem, f: site.f, pos: mulRows(site.f, lattice) }));
  if (formula === "") {
    const counts = /* @__PURE__ */ new Map();
    for (const at of atoms) counts.set(at.elem, (counts.get(at.elem) ?? 0) + 1);
    formula = [...counts.entries()].map(([elem, n]) => `${elem}${n}`).join("");
  }
  return finished(lattice, atoms, true, formula);
}
function computeBonds(atoms, lattice) {
  const bonds = [];
  if (atoms.length === 0 || atoms.length > MAX_BOND_ATOMS) return bonds;
  const images = [];
  const shifts = [];
  for (let tx = -1; tx <= 1; tx++) {
    for (let ty = -1; ty <= 1; ty++) {
      for (let tz = -1; tz <= 1; tz++) {
        images.push([tx, ty, tz]);
        shifts.push([
          tx * lattice[0][0] + ty * lattice[1][0] + tz * lattice[2][0],
          tx * lattice[0][1] + ty * lattice[1][1] + tz * lattice[2][1],
          tx * lattice[0][2] + ty * lattice[1][2] + tz * lattice[2][2]
        ]);
      }
    }
  }
  for (let i = 0; i < atoms.length; i++) {
    const pi = atoms[i].pos, ri = covRadius(atoms[i].elem);
    for (let j = i + 1; j < atoms.length; j++) {
      const pj = atoms[j].pos;
      const rmax = (ri + covRadius(atoms[j].elem)) * COV_FACTOR;
      for (let s = 0; s < shifts.length; s++) {
        const dx = pi[0] - pj[0] - shifts[s][0];
        const dy = pi[1] - pj[1] - shifts[s][1];
        const dz = pi[2] - pj[2] - shifts[s][2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > MIN_BOND_D2 && d2 < rmax * rmax) bonds.push({ i, j, image: images[s] });
      }
    }
  }
  return bonds;
}
function extensionOf(name) {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}
function parseStructure(name, text) {
  const base = name.split("/").at(-1) ?? name;
  const extension = extensionOf(base);
  if (base.toLowerCase() === "poscar" || extension === "poscar" || extension === "vasp") return parsePoscar(text);
  if (extension === "xyz") return parseXyz(text);
  if (extension === "cif") {
    const parsed = parseCif(text);
    if (parsed === null) throw new Error("malformed CIF: missing cell parameters or atom sites");
    return parsed;
  }
  throw new Error(`unsupported structure format: ${base}`);
}
function imagePos(atom, image, lattice) {
  const shift = mulRows(image, lattice);
  return [atom.pos[0] + shift[0], atom.pos[1] + shift[1], atom.pos[2] + shift[2]];
}

// packages/mat-ui/src/client/view-model.ts
var STRUCTURE_EXTENSIONS = /* @__PURE__ */ new Set(["xyz", "cif", "poscar", "vasp"]);
var IMAGE_EXTENSIONS = /* @__PURE__ */ new Set(["png", "jpg", "jpeg", "gif", "webp"]);
var TEXT_EXTENSIONS = /* @__PURE__ */ new Set([
  "log",
  "out",
  "txt",
  "json",
  "jsonl",
  "sh",
  "com",
  "gjf",
  "inp",
  "py",
  "csv",
  "md",
  "yml",
  "yaml",
  "slurm",
  "pbs",
  "job"
]);
function extensionOf2(name) {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}
function classifyFile(name) {
  const base = name.split("/").at(-1) ?? name;
  if (base.toLowerCase() === "poscar") return "structure";
  const extension = extensionOf2(base);
  if (STRUCTURE_EXTENSIONS.has(extension)) return "structure";
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (extension === "pdf") return "pdf";
  if (TEXT_EXTENSIONS.has(extension)) return "text";
  return "unsupported";
}

// packages/mat-ui/src/client/FileManagerPanel.tsx
var import_jsx_runtime3 = require("react/jsx-runtime");
async function getJobs() {
  const response = await fetch("/mat-files/jobs", { cache: "no-store" });
  if (!response.ok) throw new Error(`jobs HTTP ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload.jobs) ? payload.jobs : [];
}
async function getTree(scope, path = "") {
  const query = scope.startsWith("session:") ? `session=${encodeURIComponent(scope.slice("session:".length))}` : `jobId=${encodeURIComponent(scope)}`;
  const response = await fetch(`/mat-files/tree?${query}&path=${encodeURIComponent(path)}`, { cache: "no-store", signal: AbortSignal.timeout(15e3) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message ?? `tree HTTP ${response.status}`);
  return {
    entries: Array.isArray(payload.entries) ? payload.entries : [],
    primary: Array.isArray(payload.primary) ? payload.primary : [],
    preferences: payload.preferences,
    warning: payload.warning,
    ...payload.root === void 0 ? {} : { root: payload.root },
    ...payload.sessionFiles === void 0 ? {} : { sessionFiles: payload.sessionFiles }
  };
}
async function deleteSelection(scope, paths) {
  const body = scope.startsWith("session:") ? { session: scope.slice("session:".length), paths } : { jobId: scope, paths };
  const response = await fetch("/mat-files/delete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message ?? `delete HTTP ${response.status}`);
  return { deleted: payload.deleted ?? [], missing: payload.missing ?? [] };
}
async function syncSelection(jobId, paths) {
  const response = await fetch("/mat-files/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobId, paths })
  });
  if (!response.ok) {
    const payload = await response.json();
    throw new Error(payload.error?.message ?? `sync HTTP ${response.status}`);
  }
}
async function downloadSelection(scope, paths) {
  const body = scope.startsWith("session:") ? { session: scope.slice("session:".length), paths } : { jobId: scope, paths };
  const response = await fetch("/mat-files/download", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const payload = await response.json();
    throw new Error(payload.error?.message ?? `download HTTP ${response.status}`);
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const filename = encoded === void 0 ? "mat-download" : decodeURIComponent(encoded);
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
var treeCache = /* @__PURE__ */ new Map();
var cacheKey = (scope, path = "") => `${scope}\0${path}`;
function sourceLabel(entry) {
  if (entry.origin === "both") return "\u672C\u5730 + \u8FDC\u7AEF";
  return entry.origin === "local" ? "\u672C\u5730" : "\u8FDC\u7AEF";
}
function statusState2(entry) {
  if (entry.status === "downloading") return "ongoing";
  if (entry.status === "failed" || entry.status === "unreadable" || entry.status === "conflict") return "error";
  if (entry.status === "remote-only") return "warning";
  return "done";
}
var isSessionScope = (scope) => scope.startsWith("session:");
function jobTagTone(job) {
  const state = (job.slurm?.[0]?.state ?? "").toUpperCase();
  if (state === "RUNNING" || state === "PENDING" || state === "COMPLETING") return "running";
  if (state === "FAILED" || state === "CANCELLED" || state === "TIMEOUT" || state === "OUT_OF_MEMORY" || state === "NODE_FAIL") return "failed";
  if (state === "COMPLETED") return "done";
  if (job.phase !== "settled") return "running";
  if (job.outcomeStatus === "completed") return "done";
  if (job.outcomeStatus === "failed" || job.outcomeStatus === "killed") return "failed";
  return "idle";
}
var scopeLabel = (scope, jobs2, root) => isSessionScope(scope) ? root !== void 0 && root !== "" ? root.split("/").filter(Boolean).at(-1) ?? root : "\u5DE5\u4F5C\u533A" : jobOptionLabel(jobs2.find((job) => job.jobId === scope) ?? { jobId: scope });
function FileManagerPanel({ sessionId, openTab, openWorkspace }) {
  const [snapshot, setSnapshot] = (0, import_react2.useState)(fileManagerState.snapshot());
  const [jobs2, setJobs] = (0, import_react2.useState)([]);
  const [trees, setTrees] = (0, import_react2.useState)({});
  const [roots, setRoots] = (0, import_react2.useState)({});
  const [primaries, setPrimaries] = (0, import_react2.useState)({});
  const [sessionFilesByScope, setSessionFilesByScope] = (0, import_react2.useState)({});
  const [warning, setWarning] = (0, import_react2.useState)();
  const [error2, setError] = (0, import_react2.useState)();
  const visible = (0, import_react2.useMemo)(() => jobsForSession(jobs2, sessionId), [jobs2, sessionId]);
  const sessionKey = sessionId !== void 0 && sessionId !== "" ? `session:${sessionId}` : void 0;
  const scopeOrder = (0, import_react2.useMemo)(() => [
    ...sessionKey !== void 0 ? [sessionKey] : [],
    ...visible.map((job) => job.jobId)
  ], [sessionKey, visible]);
  const openScopes2 = snapshot.openScopes.filter((scope) => scopeOrder.includes(scope));
  (0, import_react2.useEffect)(() => fileManagerState.subscribe(() => {
    setSnapshot(fileManagerState.snapshot());
  }), []);
  (0, import_react2.useEffect)(() => {
    let live = true;
    const load = async () => {
      try {
        const value = await getJobs();
        if (live) setJobs(value);
      } catch (cause) {
        if (live) setError(cause instanceof Error ? cause.message : String(cause));
      }
    };
    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 5e3);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [sessionId]);
  const [wsSessions, setWsSessions] = (0, import_react2.useState)([]);
  const [openSessions, setOpenSessions] = (0, import_react2.useState)([]);
  const toggleSessionRow = (sid) => {
    setOpenSessions((current2) => current2.includes(sid) ? current2.filter((value) => value !== sid) : [...current2, sid]);
  };
  const workspaceOpen = sessionKey !== void 0 && openScopes2.includes(sessionKey);
  (0, import_react2.useEffect)(() => {
    if (!workspaceOpen || sessionId === void 0) return;
    let live = true;
    void (async () => {
      try {
        const response = await fetch(`/mat-files/workspace-sessions?session=${encodeURIComponent(sessionId)}`, { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json();
        if (live) setWsSessions(Array.isArray(payload.sessions) ? payload.sessions : []);
      } catch {
      }
    })();
    return () => {
      live = false;
    };
  }, [workspaceOpen, sessionId]);
  const sessionGroups = (0, import_react2.useMemo)(() => {
    if (sessionKey === void 0) return [];
    const byOwner = /* @__PURE__ */ new Map();
    for (const job of jobs2) {
      const owner = job.ownerSession ?? "";
      byOwner.set(owner, [...byOwner.get(owner) ?? [], job]);
    }
    const listed = wsSessions.filter((record) => record.sessionId === sessionId || (byOwner.get(record.sessionId)?.length ?? 0) > 0);
    const groups = [
      ...listed.filter((record) => record.sessionId === sessionId).map((record) => ({ session: record, jobs: byOwner.get(record.sessionId) ?? [] })),
      ...listed.filter((record) => record.sessionId !== sessionId).map((record) => ({ session: record, jobs: byOwner.get(record.sessionId) ?? [] }))
    ];
    const unowned = byOwner.get("") ?? [];
    if (unowned.length > 0) groups.push({ session: { sessionId: "", title: "\u672A\u5F52\u5C5E\u4F1A\u8BDD" }, jobs: unowned });
    return groups;
  }, [wsSessions, jobs2, sessionId, sessionKey]);
  (0, import_react2.useEffect)(() => {
    if (sessionKey === void 0) return;
    fileManagerState.openScope(sessionKey);
    if (sessionId !== void 0) setOpenSessions((current2) => current2.includes(sessionId) ? current2 : [...current2, sessionId]);
  }, [sessionKey, sessionId]);
  (0, import_react2.useEffect)(() => {
    const last = scopeOrder.at(-1);
    if (scopeOrder.length > 0 && (snapshot.selectedJobId === void 0 || !scopeOrder.includes(snapshot.selectedJobId))) {
      fileManagerState.focus(last);
    }
  }, [scopeOrder, snapshot.selectedJobId]);
  const treeRef = (0, import_react2.useRef)(null);
  (0, import_react2.useEffect)(() => {
    const scope = snapshot.selectedJobId;
    if (scope === void 0 || !openScopes2.includes(scope)) return;
    const row = treeRef.current?.querySelector(`[data-scope="${scope}"]`);
    row?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [snapshot.selectedJobId, openScopes2.join("\0")]);
  const seenRef = (0, import_react2.useRef)(void 0);
  (0, import_react2.useEffect)(() => {
    const ids = visible.map((job) => job.jobId);
    if (seenRef.current === void 0) {
      seenRef.current = ids;
      return;
    }
    const fresh = ids.filter((id) => !seenRef.current.includes(id));
    seenRef.current = ids;
    for (const id of fresh) {
      fileManagerState.focus(id);
      if (sessionId !== void 0) setOpenSessions((current2) => current2.includes(sessionId) ? current2 : [...current2, sessionId]);
    }
  }, [visible]);
  const loadScope = async (scope) => {
    try {
      const tree = await getTree(scope);
      treeCache.set(cacheKey(scope), tree);
      setTrees((current2) => ({ ...current2, [scope]: tree.entries }));
      setRoots((current2) => ({ ...current2, [scope]: tree.root }));
      if (tree.sessionFiles !== void 0) setSessionFilesByScope((current2) => ({ ...current2, [scope]: tree.sessionFiles }));
      if (!isSessionScope(scope)) {
        setPrimaries((current2) => ({ ...current2, [scope]: tree.primary }));
        fileManagerState.setPins(tree.preferences?.pins ?? [], scope);
      }
      setWarning(tree.warning);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  (0, import_react2.useEffect)(() => {
    for (const scope of openScopes2) {
      if (trees[scope] === void 0) {
        const cached = treeCache.get(cacheKey(scope));
        if (cached !== void 0) setTrees((current2) => ({ ...current2, [scope]: cached.entries }));
        else void loadScope(scope);
      }
    }
  }, [openScopes2.join("\0")]);
  const pollSignatures = (0, import_react2.useRef)(/* @__PURE__ */ new Map());
  (0, import_react2.useEffect)(() => {
    if (sessionKey === void 0) return;
    const timer = window.setInterval(() => {
      void (async () => {
        const live = fileManagerState.snapshot();
        if (!live.openScopes.includes(sessionKey)) return;
        const paths = ["", ...new Set(live.scopes[sessionKey]?.expanded ?? [])].sort((a, b) => a.split("/").length - b.split("/").length);
        for (const path of paths) {
          try {
            const tree = await getTree(sessionKey, path);
            setError(void 0);
            if (path === "" && tree.sessionFiles !== void 0) {
              setSessionFilesByScope((current2) => ({ ...current2, [sessionKey]: tree.sessionFiles }));
            }
            const key = cacheKey(sessionKey, path);
            const signature = tree.entries.map((entry) => `${entry.path}:${entry.directory ? "d" : "f"}:${entry.size}`).join("\n");
            if (pollSignatures.current.get(key) === signature) continue;
            pollSignatures.current.set(key, signature);
            treeCache.set(key, tree);
            setTrees((current2) => ({ ...current2, [sessionKey]: mergeTreeEntries(current2[sessionKey] ?? [], path, tree.entries) }));
          } catch {
          }
        }
      })();
    }, 5e3);
    return () => {
      window.clearInterval(timer);
    };
  }, [sessionKey]);
  const loadDirectory = async (path, scope) => {
    const cached = treeCache.get(cacheKey(scope, path));
    if (cached !== void 0) {
      setTrees((current2) => ({ ...current2, [scope]: mergeTreeEntries(current2[scope] ?? [], path, cached.entries) }));
    }
    fileManagerState.beginExpand(path);
    try {
      const tree = await getTree(scope, path);
      treeCache.set(cacheKey(scope, path), tree);
      setTrees((current2) => ({ ...current2, [scope]: mergeTreeEntries(current2[scope] ?? [], path, tree.entries) }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      fileManagerState.finishExpand(path);
    }
  };
  const refresh2 = async () => {
    fileManagerState.beginRefresh();
    setError(void 0);
    setWarning(void 0);
    try {
      await Promise.all(openScopes2.map((scope) => loadScope(scope)));
      fileManagerState.finishRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      fileManagerState.finishRefresh(cause);
    }
  };
  const busy = snapshot.refresh === "pending" || snapshot.download === "pending";
  const [elapsed, setElapsed] = (0, import_react2.useState)(0);
  (0, import_react2.useEffect)(() => {
    if (!busy) return;
    setElapsed(0);
    const timer = setInterval(() => {
      setElapsed((value) => value + 1);
    }, 1e3);
    return () => {
      clearInterval(timer);
    };
  }, [busy]);
  const slowHint = elapsed >= 10 ? "\uFF0C\u8FDC\u7AEF\u54CD\u5E94\u7F13\u6162\uFF0C\u53EF\u80FD\u7F51\u7EDC\u4E0D\u901A" : "";
  const selectionsByScope = openScopes2.filter((scope) => (snapshot.scopes[scope]?.selectedPaths?.length ?? 0) > 0);
  const selectedCount = selectionsByScope.reduce((total, scope) => total + snapshot.scopes[scope].selectedPaths.length, 0);
  const selectedEntries = (0, import_react2.useMemo)(
    () => selectionsByScope.flatMap((scope) => (trees[scope] ?? []).filter((entry) => snapshot.scopes[scope].selectedPaths.includes(entry.path))),
    [selectionsByScope, trees, snapshot.scopes]
  );
  const disabledReason = selectedEntries.some((entry) => entry.symbolicLink || !entry.readable) ? "\u7B26\u53F7\u94FE\u63A5\u6216\u4E0D\u53EF\u8BFB\u6761\u76EE\u4E0D\u80FD\u4E0B\u8F7D" : selectedCount === 0 ? "\u8BF7\u5148\u9009\u62E9\u6587\u4EF6\u6216\u76EE\u5F55" : void 0;
  const deleteDisabledReason = selectedCount === 0 ? "\u8BF7\u5148\u9009\u62E9\u6587\u4EF6\u6216\u76EE\u5F55" : void 0;
  const focused = snapshot.selectedJobId;
  const focusedJob = visible.find((job) => job.jobId === focused);
  const focusedRoot = focused !== void 0 ? roots[focused] : void 0;
  const persistPins = async (pins, job) => {
    const response = await fetch("/mat-files/preferences", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId: job.jobId, pins, exclusions: [] })
    });
    if (!response.ok) throw new Error(`preferences HTTP ${response.status}`);
  };
  const togglePin = (path, scope) => {
    const job = visible.find((value) => value.jobId === scope);
    if (job === void 0) return;
    const pins = snapshot.scopes[scope]?.pins ?? [];
    const pinned = pins.includes(path);
    if (pinned) fileManagerState.unpin(path, scope);
    else fileManagerState.pin(path, scope);
    const next = pinned ? pins.filter((value) => value !== path) : [...pins, path];
    void persistPins(next, job).catch((cause) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  };
  const syncScopes = selectionsByScope.filter((scope) => !isSessionScope(scope));
  const syncDisabledReason = selectedCount === 0 ? "\u8BF7\u5148\u9009\u62E9\u6587\u4EF6\u6216\u76EE\u5F55" : syncScopes.length === 0 ? "\u5DE5\u4F5C\u533A\u6587\u4EF6\u5DF2\u5728\u672C\u5730\uFF0C\u65E0\u9700\u540C\u6B65" : void 0;
  const syncToLocal = async () => {
    if (syncDisabledReason !== void 0) return;
    fileManagerState.beginRefresh();
    setError(void 0);
    try {
      for (const scope of syncScopes) {
        await syncSelection(scope, snapshot.scopes[scope].selectedPaths);
        for (const key of [...treeCache.keys()]) if (key.startsWith(`${scope}\0`)) treeCache.delete(key);
        await loadScope(scope);
      }
      fileManagerState.finishRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      fileManagerState.finishRefresh(cause);
    }
  };
  const [locationCopied, setLocationCopied] = (0, import_react2.useState)(false);
  const copyLocationPath = async (path) => {
    const ok = await (0, import_dsh_client_ui_primitives2.writeClipboard)(path);
    setLocationCopied(ok);
    if (ok) window.setTimeout(() => {
      setLocationCopied(false);
    }, 1500);
  };
  const download2 = async () => {
    if (disabledReason !== void 0) return;
    fileManagerState.beginDownload(selectionsByScope.map((scope) => snapshot.scopes[scope].selectedPaths).flat());
    setError(void 0);
    try {
      for (const scope of selectionsByScope) {
        await downloadSelection(scope, snapshot.scopes[scope].selectedPaths);
      }
      fileManagerState.finishDownload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      fileManagerState.finishDownload(cause);
    }
  };
  const [confirmingDelete, setConfirmingDelete] = (0, import_react2.useState)(false);
  const confirmDelete = async () => {
    if (selectionsByScope.length === 0) return;
    fileManagerState.beginDelete();
    setError(void 0);
    try {
      for (const scope of selectionsByScope) {
        const { deleted } = await deleteSelection(scope, snapshot.scopes[scope].selectedPaths);
        fileManagerState.removePaths(deleted, scope);
        for (const key of [...treeCache.keys()]) if (key.startsWith(`${scope}\0`)) treeCache.delete(key);
        await loadScope(scope);
      }
      setConfirmingDelete(false);
      fileManagerState.finishDelete();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      fileManagerState.finishDelete(cause);
    }
  };
  const openFile = (path, scope) => {
    const kind = classifyFile(path);
    fileManagerState.selectPath(path, scope);
    if (kind === "unsupported") {
      setError("\u8BE5\u7C7B\u578B\u6682\u4E0D\u652F\u6301\u9884\u89C8\uFF1A\u8BF7\u52FE\u9009\u540E\u4E0B\u8F7D");
      return;
    }
    viewerState.open(scope, path, kind);
    viewerState.enterImmersive();
  };
  const onTreeKeyDown = (event) => {
    if (event.key !== " " && event.key !== "Enter") return;
    const path = event.target.dataset.path;
    const scope = event.target.dataset.scope;
    if (path === void 0 || scope === void 0) return;
    event.preventDefault();
    fileManagerState.selectPath(path, scope);
  };
  const primary = focused !== void 0 && !isSessionScope(focused) ? primaries[focused] ?? [] : [];
  const selectionNote = selectedCount === 0 ? "\u672A\u9009\u62E9\u6587\u4EF6" : `\u5DF2\u9009\u62E9 ${selectedCount} \u9879${selectionsByScope.length > 1 ? `\uFF08\u8DE8 ${selectionsByScope.length} \u4E2A\u8303\u56F4\uFF0C\u4E0B\u8F7D\u5C06\u5206\u8303\u56F4\u8FDB\u884C\uFF09` : selectedEntries.some((entry) => entry.directory) || snapshot.scopes[selectionsByScope[0]].selectedPaths.length > 1 ? "\uFF0C\u5C06\u4E0B\u8F7D ZIP" : ""}`;
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { className: "mat-files", "aria-label": "HPC \u5DE5\u4F5C\u533A\u6587\u4EF6", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("header", { className: "mat-files__toolbar", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "mat-files__scopetitle", children: "\u7EDF\u4E00\u5DE5\u4F5C\u533A\u6811" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.Tooltip, { label: "\u5237\u65B0\u5168\u90E8\u5C55\u5F00\u8303\u56F4", side: "bottom", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.Button, { size: "sm", variant: "outline", "aria-label": "\u5237\u65B0\u6587\u4EF6", disabled: snapshot.refresh === "pending" || openScopes2.length === 0, icon: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.IconRefreshOutline16, {}), onClick: () => {
        void refresh2();
      } }) }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.Tooltip, { label: syncDisabledReason ?? "\u628A\u8FDC\u7AEF\u6587\u4EF6\u540C\u6B65\u8FDB\u672C\u5730\u5DE5\u4F5C\u6811\uFF08\u4F5C\u4E1A\u955C\u50CF\u76EE\u5F55\uFF09", side: "bottom", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.Button, { size: "sm", variant: "primary", "aria-label": "\u540C\u6B65\u5230\u672C\u5730\u5DE5\u4F5C\u6811", disabled: syncDisabledReason !== void 0 || snapshot.refresh === "pending", icon: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.IconDownloadOutline16, {}), onClick: () => {
        void syncToLocal();
      }, children: snapshot.refresh === "pending" ? `\u540C\u6B65\u4E2D\u2026${elapsed}s` : "\u540C\u6B65\u5230\u672C\u5730" }) }) }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.Tooltip, { label: disabledReason ?? "\u5BFC\u51FA\u5230\u8FD9\u53F0\u7535\u8111\u7684\u4E0B\u8F7D\u76EE\u5F55", side: "bottom", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.Button, { size: "sm", variant: "outline", "aria-label": "\u5BFC\u51FA\u5230\u672C\u673A", disabled: disabledReason !== void 0 || snapshot.download === "pending", icon: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.IconDownloadOutline16, {}), onClick: () => {
        void download2();
      }, children: snapshot.download === "pending" ? `\u5BFC\u51FA\u4E2D\u2026${elapsed}s` : "\u5BFC\u51FA" }) }) }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.Tooltip, { label: deleteDisabledReason ?? "\u5220\u9664\u9009\u4E2D\u9879\u7684\u672C\u5730\u526F\u672C", side: "bottom", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.Button, { size: "sm", variant: "outline", "aria-label": "\u5220\u9664\u9009\u4E2D\u9879\u7684\u672C\u5730\u526F\u672C", disabled: deleteDisabledReason !== void 0 || snapshot.deleting === "pending", icon: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.IconTrashOutline16, {}), onClick: () => {
        setConfirmingDelete(true);
      }, children: "\u5220\u9664" }) }) })
    ] }),
    confirmingDelete && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { role: "alertdialog", "aria-label": "\u786E\u8BA4\u5220\u9664\u672C\u5730\u6587\u4EF6", className: "mat-files__confirm", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { children: [
        "\u5C06\u5220\u9664 ",
        selectedCount,
        " \u9879\uFF08\u4F5C\u4E1A\u8303\u56F4\u4E3A\u672C\u5730\u526F\u672C\u3001\u8FDC\u7AEF\u4E0D\u52A8\uFF1B\u5DE5\u4F5C\u533A\u6587\u4EF6\u4E3A\u672C\u5730\u539F\u4EF6\uFF0C\u5747\u4E0D\u53EF\u6062\u590D\uFF09\u3002"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "mat-files__confirm-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.Button, { size: "sm", variant: "outline", disabled: snapshot.deleting === "pending", onClick: () => {
          setConfirmingDelete(false);
        }, children: "\u53D6\u6D88" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.Button, { size: "sm", variant: "primary", disabled: snapshot.deleting === "pending", onClick: () => {
          void confirmDelete();
        }, children: snapshot.deleting === "pending" ? `\u5220\u9664\u4E2D\u2026${elapsed}s` : "\u786E\u8BA4\u5220\u9664" })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "mat-files__location", children: focused !== void 0 && isSessionScope(focused) ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: "\u672C\u5730\u5DE5\u4F5C\u76EE\u5F55" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", title: focusedRoot ?? void 0, "aria-label": "\u590D\u5236\u672C\u5730\u5DE5\u4F5C\u76EE\u5F55\u8DEF\u5F84", disabled: focusedRoot === void 0, onClick: () => {
        if (focusedRoot !== void 0) void copyLocationPath(focusedRoot);
      }, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("code", { children: focusedRoot ?? "\u6B63\u5728\u5B9A\u4F4D\u4F1A\u8BDD\u5DE5\u4F5C\u76EE\u5F55\u2026" }) }),
      locationCopied && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "mat-files__copied", children: "\u5DF2\u590D\u5236" })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: "\u672C\u5730\u5DE5\u4F5C\u533A" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", title: focusedJob?.localWorkspace ?? void 0, "aria-label": "\u590D\u5236\u672C\u5730\u955C\u50CF\u76EE\u5F55\u8DEF\u5F84", disabled: focusedJob?.localWorkspace === void 0, onClick: () => {
        if (focusedJob?.localWorkspace !== void 0) void copyLocationPath(focusedJob.localWorkspace);
      }, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("code", { children: focusedJob === void 0 ? "\u672A\u805A\u7126\u4F5C\u4E1A" : focusedJob.localWorkspace ?? "\u672C\u5730\u5DE5\u4F5C\u533A\u672A\u7EA6\u5B9A" }) }),
      locationCopied && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "mat-files__copied", children: "\u5DF2\u590D\u5236" })
    ] }) }),
    primary.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { className: "mat-files__primary", "aria-labelledby": "mat-primary-title", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { id: "mat-primary-title", children: "\u4E3B\u8981\u6587\u4EF6" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "mat-files__chips", children: primary.map((path) => {
        const opening2 = snapshot.opening.includes(path);
        return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("button", { type: "button", onClick: () => {
          if (focused !== void 0) openFile(path, focused);
        }, "aria-pressed": snapshot.selectedPaths.includes(path), "aria-busy": opening2, disabled: opening2, className: opening2 ? "mat-files__chip--busy" : void 0, children: [
          path.split("/").at(-1),
          opening2 ? "\u2026" : ""
        ] }, path);
      }) })
    ] }),
    warning !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { role: "status", className: "mat-files__warning", children: [
      "\u8FDC\u7AEF\u76EE\u5F55\u6682\u4E0D\u53EF\u7528\uFF0C\u4EC5\u663E\u793A\u672C\u5730\u5DE5\u4F5C\u533A\uFF1A",
      warning
    ] }),
    busy && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { role: "status", "aria-live": "polite", className: "mat-files__loading", children: [
      snapshot.download === "pending" ? `\u4E0B\u8F7D\u4E2D\u2026 ${elapsed}s` : `\u6B63\u5728\u540C\u6B65\u76EE\u5F55\u2026 ${elapsed}s`,
      slowHint
    ] }),
    error2 !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { role: "alert", className: "mat-files__error", children: error2 }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { ref: treeRef, className: "mat-files__tree", role: "tree", "aria-label": "\u7EDF\u4E00\u5DE5\u4F5C\u533A\u6587\u4EF6\u6811", "aria-multiselectable": "true", onKeyDown: onTreeKeyDown, children: scopeOrder.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "mat-files__empty", children: "\u5F53\u524D\u4F1A\u8BDD\u6CA1\u6709\u53EF\u663E\u793A\u7684\u5DE5\u4F5C\u533A\u3002" }) : (() => {
      const scope = sessionKey;
      const expanded = openScopes2.includes(scope);
      const scopeEntries = trees[scope] ?? [];
      const rows2 = expanded ? visibleTreeEntries(scopeEntries, snapshot.scopes[scope]?.expanded ?? []) : [];
      return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_react3.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { role: "treeitem", tabIndex: 0, "data-scope": scope, "aria-expanded": expanded, "aria-selected": false, className: "mat-files__row mat-files__row--scope", style: { paddingInlineStart: "5px" }, onClick: () => {
          fileManagerState.toggleScope(scope);
        }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "mat-files__kind", children: expanded ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.IconFolderOpenOutline16, {}) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.IconFolderClose16, {}) }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "mat-files__tag mat-files__tag--workspace", children: "\u5DE5\u4F5C\u533A" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "mat-files__name", onClick: (event) => {
            event.stopPropagation();
            fileManagerState.toggleScope(scope);
          }, children: scopeLabel(scope, visible, roots[scope]) }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "mat-files__origin mat-files__origin--local", children: "\u672C\u5730" })
        ] }),
        expanded && sessionGroups.map(({ session, jobs: sessionJobs }) => {
          const sidOpen = openSessions.includes(session.sessionId);
          const sessionTitle = session.title ?? (session.sessionId === "" ? "" : session.sessionId.replace(/^session-/, "").slice(0, 8));
          const archived = session.sessionId === "" ? [] : sessionFilesByScope[scope]?.[session.sessionId] ?? [];
          return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_react3.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { role: "treeitem", tabIndex: 0, "data-scope": sessionKey, "aria-expanded": sidOpen, "aria-selected": false, className: "mat-files__row mat-files__row--session", style: { paddingInlineStart: `${5 + 16}px` }, onClick: () => {
              toggleSessionRow(session.sessionId);
            }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "mat-files__kind", children: sidOpen ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.IconFolderOpenOutline16, {}) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.IconFolderClose16, {}) }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: `mat-files__tag mat-files__tag--session${session.sessionId === sessionId ? " mat-files__tag--current" : ""}`, children: session.sessionId === sessionId ? "\u672C\u4F1A\u8BDD" : "\u4F1A\u8BDD" }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "mat-files__name", onClick: (event) => {
                event.stopPropagation();
                toggleSessionRow(session.sessionId);
              }, children: sessionTitle }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "mat-files__count", children: sessionJobs.length + archived.length })
            ] }),
            sidOpen && (sessionJobs.length === 0 && archived.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "mat-files__row mat-files__row--loading", style: { paddingInlineStart: `${5 + 2 * 16}px` }, children: "\u65E0\u6587\u4EF6\u4E0E\u4F5C\u4E1A" }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
              archived.map((path) => {
                const selected = snapshot.scopes[scope]?.selectedPaths.includes(path) ?? false;
                return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { role: "treeitem", tabIndex: 0, "data-path": path, "data-scope": scope, "aria-selected": selected, className: "mat-files__row", style: { paddingInlineStart: `${5 + 2 * 16}px` }, children: [
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("input", { type: "checkbox", "aria-label": `\u9009\u62E9 ${path}`, checked: selected, onChange: () => {
                    fileManagerState.selectPath(path, scope);
                  }, onClick: (event) => {
                    event.stopPropagation();
                  } }),
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "mat-files__kind", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.StateDot, { state: "done" }) }),
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "mat-files__name", title: path, onClick: () => {
                    openFile(path, scope);
                  }, children: path }),
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "mat-files__origin mat-files__origin--local", children: "\u672C\u5730" })
                ] }, `${session.sessionId}\0${path}`);
              }),
              sessionJobs.map((job) => {
                const jobOpen = openScopes2.includes(job.jobId);
                const jobEntries = trees[job.jobId] ?? [];
                const jobRows = jobOpen ? visibleTreeEntries(jobEntries, snapshot.scopes[job.jobId]?.expanded ?? []) : [];
                return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_react3.Fragment, { children: [
                  /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { role: "treeitem", tabIndex: 0, "data-scope": job.jobId, "aria-expanded": jobOpen, "aria-selected": false, className: "mat-files__row mat-files__row--scope", style: { paddingInlineStart: `${5 + 2 * 16}px` }, onClick: () => {
                    fileManagerState.toggleScope(job.jobId);
                  }, children: [
                    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "mat-files__kind", children: jobOpen ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.IconFolderOpenOutline16, {}) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.IconFolderClose16, {}) }),
                    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: `mat-files__tag mat-files__tag--job mat-files__tag--job-${jobTagTone(job)}`, children: "\u4F5C\u4E1A" }),
                    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "mat-files__name", onClick: (event) => {
                      event.stopPropagation();
                      fileManagerState.toggleScope(job.jobId);
                    }, children: scopeLabel(job.jobId, [job], void 0) }),
                    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: `mat-files__origin ${job.workdir === void 0 ? "mat-files__origin--local" : "mat-files__origin--both"}`, children: job.workdir === void 0 ? "\u672C\u5730" : "\u672C\u5730 + \u8FDC\u7AEF" })
                  ] }),
                  jobRows.map((entry) => {
                    const selected = snapshot.scopes[job.jobId]?.selectedPaths.includes(entry.path) ?? false;
                    const pinned = snapshot.scopes[job.jobId]?.pins.includes(entry.path) ?? false;
                    const listing = entry.directory && (snapshot.scopes[job.jobId]?.expanded.includes(entry.path) ?? false) && snapshot.expanding.includes(entry.path);
                    return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_react3.Fragment, { children: [
                      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { role: "treeitem", tabIndex: 0, "data-path": entry.path, "data-scope": job.jobId, "aria-selected": selected, "aria-expanded": entry.directory ? snapshot.scopes[job.jobId]?.expanded.includes(entry.path) : void 0, className: "mat-files__row", style: { paddingInlineStart: `${5 + (entry.depth + 3) * 16}px` }, children: [
                        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("input", { type: "checkbox", "aria-label": `\u9009\u62E9 ${entry.name}`, checked: selected, onChange: () => {
                          fileManagerState.selectPath(entry.path, job.jobId);
                        }, onClick: (event) => {
                          event.stopPropagation();
                        } }),
                        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "mat-files__kind", children: entry.directory ? snapshot.scopes[job.jobId]?.expanded.includes(entry.path) ?? false ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.IconFolderOpenOutline16, {}) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.IconFolderClose16, {}) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.StateDot, { state: statusState2(entry) }) }),
                        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "mat-files__name", onClick: () => {
                          entry.directory ? (fileManagerState.toggleExpanded(entry.path, job.jobId), void loadDirectory(entry.path, job.jobId)) : openFile(entry.path, job.jobId);
                        }, children: entry.name }),
                        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: `mat-files__origin mat-files__origin--${entry.origin}`, children: sourceLabel(entry) }),
                        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.Tooltip, { label: pinned ? "\u4ECE\u4E3B\u8981\u6587\u4EF6\u79FB\u9664" : "\u56FA\u5B9A\u4E3A\u4E3B\u8981\u6587\u4EF6", side: "bottom", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "mat-files__pin", "aria-label": `${pinned ? "\u53D6\u6D88\u56FA\u5B9A" : "\u56FA\u5B9A"} ${entry.name}`, "aria-pressed": pinned, onClick: () => {
                          togglePin(entry.path, job.jobId);
                        }, children: "\u2605" }) })
                      ] }),
                      listing && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { role: "status", className: "mat-files__row mat-files__row--loading", style: { paddingInlineStart: `${5 + (entry.depth + 4) * 16}px` }, children: "\u6B63\u5728\u52A0\u8F7D\u5B50\u76EE\u5F55\u2026" })
                    ] }, `${job.jobId}\0${entry.path}`);
                  }),
                  jobOpen && jobEntries.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "mat-files__row mat-files__row--loading", style: { paddingInlineStart: `${5 + 3 * 16}px` }, children: "\u6682\u65E0\u6587\u4EF6" })
                ] }, job.jobId);
              })
            ] }))
          ] }, session.sessionId || "unowned");
        }),
        rows2.map((entry) => {
          const selected = snapshot.scopes[scope]?.selectedPaths.includes(entry.path) ?? false;
          const listing = entry.directory && (snapshot.scopes[scope]?.expanded.includes(entry.path) ?? false) && snapshot.expanding.includes(entry.path);
          return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_react3.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { role: "treeitem", tabIndex: 0, "data-path": entry.path, "data-scope": scope, "aria-selected": selected, "aria-expanded": entry.directory ? snapshot.scopes[scope]?.expanded.includes(entry.path) : void 0, className: "mat-files__row", style: { paddingInlineStart: `${5 + (entry.depth + 1) * 16}px` }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("input", { type: "checkbox", "aria-label": `\u9009\u62E9 ${entry.name}`, checked: selected, onChange: () => {
                fileManagerState.selectPath(entry.path, scope);
              }, onClick: (event) => {
                event.stopPropagation();
              } }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "mat-files__kind", children: entry.directory ? snapshot.scopes[scope]?.expanded.includes(entry.path) ?? false ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.IconFolderOpenOutline16, {}) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.IconFolderClose16, {}) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives2.StateDot, { state: statusState2(entry) }) }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "mat-files__name", onClick: () => {
                entry.directory ? (fileManagerState.toggleExpanded(entry.path, scope), void loadDirectory(entry.path, scope)) : openFile(entry.path, scope);
              }, children: entry.name }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: `mat-files__origin mat-files__origin--${entry.origin}`, children: sourceLabel(entry) })
            ] }),
            listing && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { role: "status", className: "mat-files__row mat-files__row--loading", style: { paddingInlineStart: `${5 + (entry.depth + 2) * 16}px` }, children: "\u6B63\u5728\u52A0\u8F7D\u5B50\u76EE\u5F55\u2026" })
          ] }, `${scope}\0${entry.path}`);
        }),
        expanded && scopeEntries.length === 0 && wsSessions.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "mat-files__row mat-files__row--loading", style: { paddingInlineStart: "25px" }, children: "\u6682\u65E0\u6587\u4EF6" })
      ] }, scope);
    })() }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "mat-files__status", role: "status", "aria-live": "polite", children: selectionNote })
  ] });
}

// packages/mat-ui/src/client/ViewerOverlay.tsx
var import_react5 = require("react");

// packages/mat-ui/src/client/ViewerPanel.tsx
var import_react4 = require("react");
var import_dsh_client_ui_primitives3 = require("@deepseek-ai/dsh-client-ui-primitives");

// packages/mat-ui/src/client/load-script.ts
var pending = /* @__PURE__ */ new Map();
function loadScript(src) {
  const existing = pending.get(src);
  if (existing !== void 0) return existing;
  const loading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => {
      resolve();
    };
    script.onerror = () => {
      pending.delete(src);
      reject(new Error(`failed to load ${src}`));
    };
    document.head.appendChild(script);
  });
  pending.set(src, loading);
  return loading;
}

// packages/mat-ui/src/client/ViewerPanel.tsx
var import_jsx_runtime4 = require("react/jsx-runtime");
var TEXT_PREVIEW_LIMIT = 512 * 1024;
var SPHERE_R = 0.5;
var BOND_R = 0.075;
var EDGE_R = 0.04;
var LINE_SPHERE_R = 0.15;
var LINE_BOND_R = 0.03;
var ATOM_OPACITY = 0.9;
var BOND_OPACITY = 0.6;
var CELL_OPACITY = 0.4;
var BOND_RGB = [110 / 255, 118 / 255, 129 / 255];
var CELL_RGB = [88 / 255, 166 / 255, 255 / 255];
var SPACEFILL_FACTOR = 1.25;
var SPACEFILL_CAP = 1.6;
var CELL_EDGES = [[0, 1], [0, 2], [0, 3], [1, 4], [1, 5], [2, 4], [2, 6], [3, 5], [3, 6], [4, 7], [5, 7], [6, 7]];
function sphereRadiusOf(style2, elem) {
  if (style2 === "line") return LINE_SPHERE_R;
  if (style2 === "spacefill") return Math.min(SPACEFILL_CAP, covRadius(elem) * SPACEFILL_FACTOR);
  return SPHERE_R;
}
var contentUrl = (target) => (
  // session:<id> 是工作区目标（服务端解析共享 cwd）——走 content 路由的 session 参数。
  target.jobId.startsWith("session:") ? `/mat-files/content?session=${encodeURIComponent(target.jobId.slice("session:".length))}&path=${encodeURIComponent(target.path)}` : `/mat-files/content?jobId=${encodeURIComponent(target.jobId)}&path=${encodeURIComponent(target.path)}`
);
var KIND_LABELS = {
  structure: "\u7ED3\u6784",
  image: "\u56FE\u7247",
  pdf: "\u6587\u6863",
  text: "\u6587\u672C"
};
function drawStructure(stage, shapeFactory, parsed, bonds, style2, showOuter) {
  const showBonds = style2 !== "spacefill";
  const crossesCell = (bond) => Boolean(bond.image[0] || bond.image[1] || bond.image[2]);
  stage.removeAllComponents();
  const addShape = (shape, opacity) => {
    stage.addComponentFromObject(shape).addRepresentation("buffer", { opacity });
  };
  const atomsShape = new shapeFactory("atoms");
  for (const atom of parsed.atoms) {
    atomsShape.addSphere(atom.pos, elemRgb(atom.elem), sphereRadiusOf(style2, atom.elem));
  }
  if (showBonds && showOuter) {
    const seen = /* @__PURE__ */ new Set();
    for (const bond of bonds) {
      if (!crossesCell(bond)) continue;
      const atom = parsed.atoms[bond.j];
      const q = imagePos(atom, bond.image, parsed.lattice);
      const key = `${bond.j}|${q.map((value) => value.toFixed(2)).join(",")}`;
      if (!seen.has(key)) {
        seen.add(key);
        atomsShape.addSphere(q, elemRgb(atom.elem), sphereRadiusOf(style2, atom.elem));
      }
    }
  }
  addShape(atomsShape, ATOM_OPACITY);
  if (showBonds) {
    const bondShape = new shapeFactory("bonds");
    for (const bond of bonds) {
      if (!showOuter && crossesCell(bond)) continue;
      bondShape.addCylinder(parsed.atoms[bond.i].pos, imagePos(parsed.atoms[bond.j], bond.image, parsed.lattice), BOND_RGB, style2 === "line" ? LINE_BOND_R : BOND_R);
    }
    addShape(bondShape, BOND_OPACITY);
  }
  if (parsed.hasCell) {
    const cellShape = new shapeFactory("cell");
    const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, 0, 1], [0, 1, 1], [1, 1, 1]].map((fraction) => mulRows(fraction, parsed.lattice));
    for (const [from, to] of CELL_EDGES) {
      cellShape.addCylinder(corners[from], corners[to], CELL_RGB, EDGE_R);
    }
    addShape(cellShape, CELL_OPACITY);
  }
  stage.autoView();
}
function ViewerSurface({ variant = "overlay", peersNav, localPath }) {
  const [snapshot, setSnapshot] = (0, import_react4.useState)(viewerState.snapshot());
  (0, import_react4.useEffect)(() => viewerState.subscribe(() => {
    setSnapshot(viewerState.snapshot());
  }), []);
  const [style2, setStyle] = (0, import_react4.useState)("ball+stick");
  const [outer, setOuter] = (0, import_react4.useState)(true);
  const [text, setText] = (0, import_react4.useState)();
  const [truncated, setTruncated] = (0, import_react4.useState)(false);
  const [copyFailed, setCopyFailed] = (0, import_react4.useState)(false);
  const [structInfo, setStructInfo] = (0, import_react4.useState)();
  const containerRef = (0, import_react4.useRef)(null);
  const stageRef = (0, import_react4.useRef)(void 0);
  const shapeFactoryRef = (0, import_react4.useRef)(void 0);
  const structureRef = (0, import_react4.useRef)(void 0);
  const target = snapshot.current;
  (0, import_react4.useEffect)(() => {
    if (target?.kind !== "structure") return;
    let disposed = false;
    let stage;
    let resizeObserver;
    void (async () => {
      try {
        await loadScript("/mat-vendor/ngl.js");
        const response = await fetch(contentUrl(target), { cache: "no-store" });
        if (!response.ok) throw new Error(`content HTTP ${response.status}`);
        const source = await response.text();
        if (disposed) return;
        const NGL = window.NGL;
        if (NGL === void 0 || containerRef.current === null) throw new Error("3D \u5F15\u64CE\u672A\u5C31\u7EEA");
        const parsed = parseStructure(target.path, source);
        const bonds = computeBonds(parsed.atoms, parsed.lattice);
        stage = new NGL.Stage(containerRef.current, { backgroundColor: "white" });
        resizeObserver = new ResizeObserver(() => {
          stage?.handleResize();
        });
        resizeObserver.observe(containerRef.current);
        stageRef.current = stage;
        shapeFactoryRef.current = NGL.Shape;
        structureRef.current = { parsed, bonds };
        drawStructure(stage, NGL.Shape, parsed, bonds, "ball+stick", true);
        setOuter(true);
        setStructInfo(`${parsed.formula} \xB7 \u6676\u80DE ${parsed.a.toFixed(3)} \xD7 ${parsed.b.toFixed(3)} \xD7 ${parsed.c.toFixed(3)} \xC5\uFF0C${parsed.alpha.toFixed(1)}/${parsed.beta.toFixed(1)}/${parsed.gamma.toFixed(1)}\xB0 \xB7 ${parsed.atoms.length} \u4F4D\u70B9 \xB7 ${bonds.length} \u952E`);
        viewerState.finish();
      } catch (cause) {
        if (!disposed) viewerState.finish(cause);
      }
    })();
    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      stageRef.current = void 0;
      shapeFactoryRef.current = void 0;
      structureRef.current = void 0;
      setStructInfo(void 0);
      stage?.dispose();
      containerRef.current?.replaceChildren();
    };
  }, [target?.jobId, target?.path]);
  (0, import_react4.useEffect)(() => {
    if (target?.kind !== "text") return;
    let live = true;
    setText(void 0);
    setTruncated(false);
    void (async () => {
      try {
        const response = await fetch(contentUrl(target), { cache: "no-store" });
        if (!response.ok) throw new Error(`content HTTP ${response.status}`);
        const body = await response.text();
        if (!live) return;
        if (body.length > TEXT_PREVIEW_LIMIT) {
          setText(body.slice(0, TEXT_PREVIEW_LIMIT));
          setTruncated(true);
        } else {
          setText(body);
        }
        viewerState.finish();
      } catch (cause) {
        if (live) viewerState.finish(cause);
      }
    })();
    return () => {
      live = false;
    };
  }, [target?.jobId, target?.path]);
  const busy = snapshot.status === "pending";
  const [elapsed, setElapsed] = (0, import_react4.useState)(0);
  (0, import_react4.useEffect)(() => {
    if (!busy) return;
    setElapsed(0);
    const timer = setInterval(() => {
      setElapsed((value) => value + 1);
    }, 1e3);
    return () => {
      clearInterval(timer);
    };
  }, [busy]);
  const slowHint = elapsed >= 10 ? "\uFF0C\u8FDC\u7AEF\u54CD\u5E94\u7F13\u6162\uFF0C\u53EF\u80FD\u7F51\u7EDC\u4E0D\u901A" : "";
  const onStyle = (next) => {
    setStyle(next);
    const stage = stageRef.current;
    const structure = structureRef.current;
    if (stage !== void 0 && shapeFactoryRef.current !== void 0 && structure !== void 0) {
      drawStructure(stage, shapeFactoryRef.current, structure.parsed, structure.bonds, next, outer);
    }
  };
  const onOuter = () => {
    const next = !outer;
    setOuter(next);
    const stage = stageRef.current;
    const structure = structureRef.current;
    if (stage !== void 0 && shapeFactoryRef.current !== void 0 && structure !== void 0) {
      drawStructure(stage, shapeFactoryRef.current, structure.parsed, structure.bonds, style2, next);
    }
  };
  const [spin, setSpin] = (0, import_react4.useState)(false);
  const onSpin = () => {
    const next = !spin;
    setSpin(next);
    stageRef.current?.setSpin(next);
  };
  const copy = () => {
    setCopyFailed(false);
    void (0, import_dsh_client_ui_primitives3.writeClipboard)(text ?? "").then((ok) => {
      setCopyFailed(!ok);
    });
  };
  const [pathCopied, setPathCopied] = (0, import_react4.useState)(false);
  const copyPath = () => {
    if (localPath === void 0) return;
    void (0, import_dsh_client_ui_primitives3.writeClipboard)(localPath).then((ok) => {
      setPathCopied(ok);
      if (ok) window.setTimeout(() => {
        setPathCopied(false);
      }, 1500);
    });
  };
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("section", { className: variant === "overlay" ? "mat-view mat-view--overlay" : "mat-view", "aria-label": "HPC \u6587\u4EF6\u9884\u89C8", children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("header", { className: "mat-view__toolbar", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "mat-view__title", children: target === void 0 ? "\u672A\u9009\u62E9\u6587\u4EF6" : target.path.split("/").at(-1) }),
      target !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "mat-view__kind", children: KIND_LABELS[target.kind] }),
      peersNav !== void 0 && peersNav.peers.length > 1 && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_jsx_runtime4.Fragment, { children: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { className: "mat-view__seg mat-view__peers", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives3.Button, { size: "sm", variant: "outline", "aria-label": "\u4E0A\u4E00\u4E2A\u540C\u540E\u7F00\u6587\u4EF6", onClick: () => {
          peersNav.onNavigate(peersNav.peers[(peersNav.index - 1 + peersNav.peers.length) % peersNav.peers.length]);
        }, children: "\u2039" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { className: "mat-view__count", children: [
          peersNav.index + 1,
          "/",
          peersNav.peers.length
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives3.Button, { size: "sm", variant: "outline", "aria-label": "\u4E0B\u4E00\u4E2A\u540C\u540E\u7F00\u6587\u4EF6", onClick: () => {
          peersNav.onNavigate(peersNav.peers[(peersNav.index + 1) % peersNav.peers.length]);
        }, children: "\u203A" })
      ] }) }),
      target?.kind === "structure" && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { className: "mat-view__seg", children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives3.Button, { size: "sm", variant: style2 === "ball+stick" ? "primary" : "outline", "aria-label": "\u7403\u68CD\u98CE\u683C", onClick: () => {
            onStyle("ball+stick");
          }, children: "\u7403\u68CD" }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives3.Button, { size: "sm", variant: style2 === "line" ? "primary" : "outline", "aria-label": "\u7EBF\u6846\u98CE\u683C", onClick: () => {
            onStyle("line");
          }, children: "\u7EBF\u6846" }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives3.Button, { size: "sm", variant: style2 === "spacefill" ? "primary" : "outline", "aria-label": "\u586B\u5145\u98CE\u683C", onClick: () => {
            onStyle("spacefill");
          }, children: "\u586B\u5145" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives3.Button, { size: "sm", variant: outer ? "primary" : "outline", "aria-label": "\u80DE\u5916\u539F\u5B50", "aria-pressed": outer, title: "\u663E\u793A\u4E0E\u80DE\u5185\u539F\u5B50\u6210\u952E\u7684\u80DE\u5916\u955C\u50CF\u539F\u5B50\uFF08Draw atoms outside unit cell bonded to atoms within unit cell\uFF09", onClick: onOuter, children: "\u80DE\u5916\u539F\u5B50" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives3.Button, { size: "sm", variant: spin ? "primary" : "outline", "aria-label": "\u81EA\u8F6C", "aria-pressed": spin, onClick: onSpin, children: spin ? "\u505C\u8F6C" : "\u81EA\u8F6C" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives3.Button, { size: "sm", variant: "outline", "aria-label": "\u91CD\u7F6E\u89C6\u89D2", onClick: () => {
          stageRef.current?.autoView();
        }, children: "\u91CD\u7F6E" })
      ] }),
      target?.kind === "text" && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives3.Button, { size: "sm", variant: "outline", "aria-label": "\u590D\u5236\u6587\u672C", disabled: text === void 0, onClick: copy, children: "\u590D\u5236" }),
      variant === "overlay" && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives3.Button, { size: "sm", variant: "outline", className: "mat-view__zoom", "aria-label": "\u6536\u8D77\u6C89\u6D78\u9884\u89C8", onClick: () => {
        viewerState.exitImmersive();
      }, children: "\u6536\u8D77" })
    ] }),
    localPath !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "mat-view__path", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("code", { title: localPath, children: localPath.length > 72 ? `\u2026${localPath.slice(-71)}` : localPath }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives3.Button, { size: "sm", variant: "outline", "aria-label": "\u590D\u5236\u672C\u5730\u955C\u50CF\u8DEF\u5F84", onClick: copyPath, children: pathCopied ? "\u5DF2\u590D\u5236" : "\u590D\u5236\u8DEF\u5F84" })
    ] }),
    target?.kind === "structure" && structInfo !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "mat-view__structinfo", title: structInfo, children: structInfo }),
    target === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "mat-view__empty", children: "\u70B9\u51FB\u6587\u4EF6\u9762\u677F\u4E2D\u7684\u6587\u4EF6\u4EE5\u9884\u89C8\u3002" }) : snapshot.status === "error" ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("p", { className: "mat-view__error", role: "alert", children: [
      "\u9884\u89C8\u5931\u8D25\uFF1A",
      snapshot.error
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_jsx_runtime4.Fragment, { children: [
      busy && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("p", { role: "status", "aria-live": "polite", className: "mat-view__loading", children: [
        "\u6B63\u5728\u53D6\u56DE\u6587\u4EF6\u2026 ",
        elapsed,
        "s",
        slowHint
      ] }),
      copyFailed && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { role: "alert", className: "mat-view__error", children: "\u590D\u5236\u5931\u8D25" }),
      target.kind === "structure" && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { ref: containerRef, className: "mat-view__canvas" }, `ngl-${target.jobId}-${target.path}`),
      target.kind === "image" && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
        "img",
        {
          className: "mat-view__media",
          src: contentUrl(target),
          alt: `\u9884\u89C8 ${target.path}`,
          onLoad: () => {
            viewerState.finish();
          },
          onError: () => {
            viewerState.finish(new Error("\u56FE\u7247\u52A0\u8F7D\u5931\u8D25"));
          }
        }
      ),
      target.kind === "pdf" && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
        "iframe",
        {
          className: "mat-view__frame",
          src: contentUrl(target),
          title: `\u9884\u89C8 ${target.path}`,
          onLoad: () => {
            viewerState.finish();
          }
        }
      ),
      target.kind === "text" && /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("pre", { className: "mat-view__text", children: [
        text,
        truncated ? "\n\u2026\uFF08\u6587\u4EF6\u8D85\u8FC7 512 KB\uFF0C\u5DF2\u622A\u65AD\uFF0C\u5B8C\u6574\u5185\u5BB9\u8BF7\u4E0B\u8F7D\uFF09" : ""
      ] })
    ] })
  ] });
}

// packages/mat-ui/src/client/ViewerOverlay.tsx
var import_jsx_runtime5 = require("react/jsx-runtime");
function ViewerOverlay() {
  const [snapshot, setSnapshot] = (0, import_react5.useState)(viewerState.snapshot());
  (0, import_react5.useEffect)(() => viewerState.subscribe(() => {
    setSnapshot(viewerState.snapshot());
  }), []);
  const target = snapshot.current;
  const immersive2 = snapshot.immersive && target !== void 0;
  const [peers, setPeers] = (0, import_react5.useState)();
  const [localPath, setLocalPath] = (0, import_react5.useState)();
  const scopeQuery = (jobId) => jobId.startsWith("session:") ? `session=${encodeURIComponent(jobId.slice("session:".length))}` : `jobId=${encodeURIComponent(jobId)}`;
  (0, import_react5.useEffect)(() => {
    if (target === void 0) return;
    let live = true;
    const query = target.jobId.startsWith("session:") ? `session=${encodeURIComponent(target.jobId.slice("session:".length))}` : `jobId=${encodeURIComponent(target.jobId)}`;
    void (async () => {
      try {
        const response = await fetch(`/mat-files/peers?${query}&path=${encodeURIComponent(target.path)}`, { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json();
        if (live && Array.isArray(payload.peers)) setPeers({ peers: payload.peers, index: payload.index ?? 0 });
      } catch {
      }
    })();
    return () => {
      live = false;
    };
  }, [target?.jobId, target?.path]);
  (0, import_react5.useEffect)(() => {
    if (target === void 0) {
      setLocalPath(void 0);
      return;
    }
    let live = true;
    void (async () => {
      try {
        const response = await fetch(`/mat-files/localpath?${scopeQuery(target.jobId)}&path=${encodeURIComponent(target.path)}`, { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json();
        if (live && typeof payload.localPath === "string") setLocalPath(payload.localPath);
      } catch {
      }
    })();
    return () => {
      live = false;
    };
  }, [target?.jobId, target?.path]);
  const navigate = (path) => {
    if (target === void 0) return;
    viewerState.open(target.jobId, path, classifyFile(path));
  };
  (0, import_react5.useEffect)(() => {
    if (!immersive2) return;
    const onKey = (event) => {
      if (event.key === "Escape") viewerState.exitImmersive();
      else if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && peers !== void 0 && peers.peers.length > 1) {
        const delta = event.key === "ArrowLeft" ? -1 : 1;
        navigate(peers.peers[(peers.index + delta + peers.peers.length) % peers.peers.length]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [immersive2, peers, target?.jobId]);
  if (!immersive2) return null;
  const peersNav = peers === void 0 ? void 0 : { peers: peers.peers, index: peers.index, onNavigate: navigate };
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
    "div",
    {
      className: "mat-view-overlay",
      role: "dialog",
      "aria-modal": "true",
      "aria-label": "\u6C89\u6D78\u6587\u4EF6\u9884\u89C8",
      onClick: () => {
        viewerState.exitImmersive();
      },
      children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "mat-view-overlay__card", onClick: (event) => {
        event.stopPropagation();
      }, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(ViewerSurface, { variant: "overlay", peersNav, localPath }) })
    }
  );
}

// packages/mat-ui/src/client/TaskDetailsPanel.tsx
var import_react6 = require("react");
var import_dsh_client_ui_primitives4 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime6 = require("react/jsx-runtime");
function stateOf2(job) {
  if (job.phase !== "settled") return "ongoing";
  return job.outcomeStatus === "completed" ? "done" : "error";
}
var NUMERIC_VALUE = /^-?[0-9][0-9.,:x×+\-eE_/]*$/;
var isNumericValue = (value) => NUMERIC_VALUE.test(value) && /\d/.test(value);
function metadataStateOf(label, value) {
  const v = value.toUpperCase();
  if (label === "status") {
    if (v === "COMPLETED") return "done";
    if (v === "RUNNING" || v === "PENDING" || v === "COMPLETING") return "ongoing";
    if (v === "FAILED" || v === "CANCELLED" || v === "TIMEOUT" || v === "OUT_OF_MEMORY" || v === "NODE_FAIL") return "error";
    return void 0;
  }
  if (label === "converged") {
    if (value === "yes") return "done";
    if (value === "no") return "warning";
  }
  return void 0;
}
function TaskDetailsPanel({ sessionId, openTab, openDetailsTab, layout }) {
  const [selectedJobId2, setSelectedJobId] = (0, import_react6.useState)();
  const selectFiles = () => {
    if (selectedJobId2 !== void 0) fileManagerState.selectJob(selectedJobId2);
    if (layout !== void 0) openDetailsWithRoom(layout);
    openDetailsTab?.("mat-files");
    openTab?.("mat-files");
  };
  const [jobs2, setJobs] = (0, import_react6.useState)([]);
  const [error2, setError] = (0, import_react6.useState)();
  const visible = (0, import_react6.useMemo)(() => jobsForSession(jobs2, sessionId), [jobs2, sessionId]);
  (0, import_react6.useEffect)(() => {
    let live = true;
    const load = async () => {
      try {
        const response = await fetch("/mat-status/jobs", { cache: "no-store" });
        if (!response.ok) throw new Error(`status HTTP ${response.status}`);
        const payload = await response.json();
        if (live) setJobs(Array.isArray(payload.jobs) ? payload.jobs : []);
      } catch (cause) {
        if (live) setError(cause instanceof Error ? cause.message : String(cause));
      }
    };
    void load();
    const timer = window.setInterval(() => {
      void load();
    }, 5e3);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, []);
  (0, import_react6.useEffect)(() => {
    if (visible.length > 0 && (selectedJobId2 === void 0 || !visible.some((job2) => job2.jobId === selectedJobId2))) {
      setSelectedJobId(visible.at(-1).jobId);
    }
  }, [visible, selectedJobId2]);
  const job = visible.find((value) => value.jobId === selectedJobId2) ?? visible.at(-1);
  if (error2 !== void 0) return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("section", { className: "mat-task-details", role: "status", children: error2 });
  if (job === void 0) return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("section", { className: "mat-task-details", role: "status", children: "\u6682\u65E0\u8BA1\u7B97\u4EFB\u52A1" });
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("section", { className: "mat-task-details", "aria-label": "HPC task details", children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("header", { className: "mat-task-details__header", children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives4.StateDot, { state: stateOf2(job) }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("label", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { children: "\u4EFB\u52A1" }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("select", { value: job.jobId, onChange: (event) => {
          setSelectedJobId(event.target.value);
          fileManagerState.selectJob(event.target.value);
        }, children: visible.map((value) => /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: value.jobId, children: jobOptionLabel(value) }, value.jobId)) })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("dl", { className: "mat-task-details__metadata", children: monitorMetadata(job).map(([label, value]) => {
      const state = metadataStateOf(label, value);
      const ddClass = state !== void 0 ? `mat-task-details__dd--state mat-task-details__dd--${state}` : isNumericValue(value) ? "mat-task-details__dd--mono" : void 0;
      return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("dt", { children: label }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("dd", { className: ddClass, children: [
          state !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives4.StateDot, { state }),
          value
        ] })
      ] }, label);
    }) }),
    stateOf2(job) === "error" && job.detail !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "mat-task-details__failure", title: job.detail, children: job.detail }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("footer", { className: "mat-task-details__footer", children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("p", { className: "mat-task-details__files", children: [
        "\u7ED3\u679C\u6587\u4EF6 ",
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("b", { children: job.files?.length ?? 0 }),
        " \u4E2A"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "mat-task-details__actions", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives4.Button, { size: "sm", variant: "primary", icon: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives4.IconFolderOpen16, {}), onClick: selectFiles, children: "\u6253\u5F00\u6587\u4EF6" }) })
    ] })
  ] });
}

// packages/mat-ui/src/client/MatToolView.tsx
var import_jsx_runtime7 = require("react/jsx-runtime");
function outputOf(block) {
  if (!("kind" in block)) return "Running\u2026";
  return block.content.map((part) => part.type === "text" ? part.text : JSON.stringify(part)).join("\n");
}
function rows(text) {
  const lines = text.trim().split("\n").filter(Boolean);
  return lines.map((line) => line.includes("|") ? line.split("|") : [line]);
}
function MatToolView({ toolName, block, inspect }) {
  const table = rows(outputOf(block));
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("article", { className: "mat-toolview", onClick: inspect, role: inspect ? "button" : void 0, children: [
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("header", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "mat-status-dock__eyebrow", children: "MAT" }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("strong", { children: toolName.replace("mat_", "").replaceAll("_", " ") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("table", { children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("tbody", { children: table.slice(0, 12).map((cells, i) => /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("tr", { children: cells.map((cell, j) => j === 0 ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("th", { children: cell }, j) : /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("td", { children: cell }, j)) }, i)) }) }),
    table.length > 12 ? /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("small", { children: [
      "+ ",
      table.length - 12,
      " rows"
    ] }) : null
  ] });
}

// packages/mat-ui/src/client/DetailsRailToggle.tsx
var import_react7 = require("react");
var import_dsh_client_ui_primitives5 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime8 = require("react/jsx-runtime");
function DetailsRailToggle(props) {
  const { layout, useSessions } = props;
  const live = useSessions((s) => {
    const current2 = s.current;
    return current2 !== void 0 && s.byId[current2]?.blank === false;
  });
  const [detailsWidth, setDetailsWidth] = (0, import_react7.useState)(void 0);
  (0, import_react7.useEffect)(() => {
    if (live === false) return;
    const frame = document.querySelector("[data-shell-overlay]")?.parentElement ?? null;
    if (frame === null) return;
    const read = () => {
      const tracks = frame.style.gridTemplateColumns || getComputedStyle(frame).gridTemplateColumns;
      const lastTrack = tracks.split(" ").at(-1);
      const width = Number.parseFloat(lastTrack ?? "");
      setDetailsWidth(Number.isFinite(width) ? width : 0);
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(frame, { attributes: true, attributeFilter: ["style", "data-details-collapsed"] });
    return () => {
      observer.disconnect();
    };
  }, [live]);
  if (live === false || detailsWidth === void 0) return null;
  const open2 = detailsWidth > 0;
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
    "button",
    {
      type: "button",
      className: "mat-rail-toggle",
      "aria-expanded": open2,
      "aria-label": open2 ? "\u6536\u8D77\u4EFB\u52A1\u9762\u677F" : "\u5C55\u5F00\u4EFB\u52A1\u9762\u677F",
      title: open2 ? "\u6536\u8D77\u4EFB\u52A1\u9762\u677F" : "\u5C55\u5F00\u4EFB\u52A1\u9762\u677F",
      style: { right: `${Math.max(0, Math.round(detailsWidth) - 11)}px` },
      onClick: () => {
        if (open2) layout.closeDetails();
        else openDetailsWithRoom(layout);
      },
      children: open2 ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(import_dsh_client_ui_primitives5.IconChevronRightOutline14, {}) : /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(import_dsh_client_ui_primitives5.IconChevronLeftOutline14, {})
    }
  );
}

// packages/mat-ui/src/client/style.ts
var style = `
.mat-status-dock, section[data-testid=todo-panel]{box-sizing:border-box;width:min(calc(100% - 2 * var(--dsh-composer-side-clearance)),430px);margin-left:max(var(--dsh-composer-side-clearance),calc((100% - var(--dsh-composer-card-max-width))/2))}.mat-status-strip{box-sizing:border-box;width:min(calc(100% - 2 * var(--dsh-composer-side-clearance)),430px);margin-left:max(var(--dsh-composer-side-clearance),calc((100% - var(--dsh-composer-card-max-width))/2))}.mat-status-dock{margin-top:0;margin-bottom:8px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-base);font-variant-numeric:tabular-nums}.mat-status-dock--empty{color:var(--dsw-alias-label-secondary);font-size:12px;text-align:center;padding:8px 10px}.mat-status-dock__header,.mat-status-dock__summary,.mat-status-card__topline{display:flex;align-items:center;gap:8px}.mat-status-dock__header{justify-content:space-between}.mat-status-dock__summary{min-width:0}.mat-status-dock__toggle{display:grid;flex:none;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}.mat-status-dock__toggle:hover,.mat-status-dock__toggle:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}.mat-status-dock__eyebrow{font:600 10px/1.2 ui-monospace,SFMono-Regular,monospace;letter-spacing:.1em;color:var(--dsw-alias-label-secondary)}.mat-status-dock__count{font-size:11px;color:var(--dsw-alias-label-secondary)}.mat-status-dock__jobs{display:grid;gap:6px;max-height:240px;overflow:auto}.mat-status-card{padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-base);font-size:12px}.mat-status-card__topline{min-width:0}.mat-status-card strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}.mat-status-chip{flex:none;padding:2px 7px;border-radius:6px;font-size:11px;font-weight:600;letter-spacing:.03em}.mat-status-chip--active{color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent)}.mat-status-chip--complete{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent)}.mat-status-chip--attention{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent)}.mat-status-card__metadata{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 12px;margin:8px 0 0}.mat-status-card__metadata dt{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--dsw-alias-label-secondary)}.mat-status-card__metadata dd{overflow:hidden;margin:2px 0 0;text-overflow:ellipsis;white-space:nowrap;font:11px/1.4 ui-monospace,SFMono-Regular,monospace}.mat-status-strip{display:flex;align-items:center;gap:8px;width:min(calc(100% - 2 * var(--dsh-composer-side-clearance)),430px);margin:0 0 8px max(var(--dsh-composer-side-clearance),calc((100% - var(--dsh-composer-card-max-width))/2));padding:7px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font:12px/16px var(--dsw-font-family);text-align:left}.mat-status-strip__label{color:var(--dsw-alias-label-primary)}.mat-status-strip select{min-width:0;flex:1;padding:4px 6px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:12px/14px var(--dsw-font-family)}.mat-status-strip__count{color:var(--dsw-alias-label-tertiary);white-space:nowrap}.mat-task-details{display:flex;min-height:0;height:100%;flex-direction:column;gap:12px;padding:14px 16px;color:var(--dsw-alias-label-primary);font:13px/1.5 var(--dsw-font-family)}.mat-task-details[role=status]{justify-content:center;color:var(--dsw-alias-label-tertiary);font-size:12px}.mat-task-details__header{display:flex;align-items:center;gap:8px}.mat-task-details__header label{display:flex;min-width:0;flex:1;align-items:center;gap:8px;color:var(--dsw-alias-label-secondary)}.mat-task-details__header label>span{font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}.mat-task-details__header select{min-width:0;flex:1;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:12px/14px var(--dsw-font-family)}.mat-task-details__metadata{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}.mat-task-details__metadata>div{display:grid;gap:4px;padding:10px 14px;border-top:1px solid var(--dsw-alias-border-l1)}.mat-task-details__metadata>div:first-child,.mat-task-details__metadata>div:nth-child(2){border-top:0}.mat-task-details__metadata dt{font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}.mat-task-details__metadata dd{overflow:hidden;margin:0;text-overflow:ellipsis;white-space:nowrap;font:500 12px/1.45 var(--dsw-font-family);font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}.mat-task-details__metadata .mat-task-details__dd--mono{font:11.5px/1.45 ui-monospace,SFMono-Regular,monospace;font-variant-numeric:tabular-nums}.mat-task-details__metadata .mat-task-details__dd--state{display:inline-flex;align-items:center;gap:6px}.mat-task-details__metadata .mat-task-details__dd--done{color:var(--dsw-alias-state-success-primary)}.mat-task-details__metadata .mat-task-details__dd--error{color:var(--dsw-alias-state-error-primary)}.mat-task-details__failure{display:-webkit-box;margin:0;padding:8px 12px;border-left:2px solid var(--dsw-alias-state-error-primary);border-radius:0 8px 8px 0;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent);color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:1.5;-webkit-box-orient:vertical;-webkit-line-clamp:4;overflow:hidden}.mat-task-details__footer{display:flex;align-items:center;justify-content:space-between;gap:8px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l1)}.mat-task-details__files{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px}.mat-task-details__files b{font:600 13px/1 ui-monospace,SFMono-Regular,monospace;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}.mat-task-details__actions{display:flex;gap:8px}.mat-toolview{padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-base);cursor:pointer}.mat-toolview header{display:flex;align-items:center;gap:8px;margin-bottom:8px}.mat-toolview table{width:100%;border-collapse:collapse;font:12px/1.5 ui-monospace,SFMono-Regular,monospace}.mat-toolview th,.mat-toolview td{padding:4px 8px;border-top:1px solid var(--dsw-alias-border-l2);text-align:left;vertical-align:top}.mat-toolview th{color:var(--dsw-alias-label-secondary);font-weight:500}
.mat-files{display:flex;min-height:0;height:100%;flex-direction:column;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font:13px/1.5 var(--dsw-font-family)}.mat-files__toolbar{display:flex;align-items:center;gap:6px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);font:13px/16px var(--dsw-font-family)}.mat-files__job{display:flex;min-width:0;flex:1;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary)}.mat-files__job>span{flex:none;font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}.mat-files__job select{min-width:0;flex:1;padding:5px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:inherit;font:12px/14px var(--dsw-font-family)}.mat-files__location{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:12px}.mat-files__location>span{flex:none;font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}.mat-files__location button{min-width:0;flex:1;padding:2px 8px;border:0;border-radius:6px;background:transparent;color:inherit;cursor:pointer;text-align:left}.mat-files__location button:hover:not(:disabled),.mat-files__location button:focus-visible:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.mat-files__location button:disabled{cursor:default}.mat-files__location code{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:11px/1.5 ui-monospace,SFMono-Regular,monospace;color:var(--dsw-alias-label-tertiary)}.mat-files__primary{padding:10px 12px 8px;border-bottom:1px solid var(--dsw-alias-border-l1)}.mat-files__primary>div:first-child{margin-bottom:6px;font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}.mat-files__chips{display:flex;gap:6px;overflow:auto}.mat-files__chips button{padding:3px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font:11px/1.6 var(--dsw-font-family);white-space:nowrap;cursor:pointer}.mat-files__chips button:hover:not(:disabled){border-color:var(--dsw-alias-border-l3);color:var(--dsw-alias-label-primary)}.mat-files__chips button[aria-pressed=true]{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent);color:var(--dsw-alias-label-primary)}.mat-files__tree{min-height:0;flex:1;overflow:auto;padding:4px 8px}.mat-files__row{display:flex;align-items:center;gap:6px;min-height:32px;padding:4px 8px;border-radius:8px;font-size:12px}.mat-files__row:hover,.mat-files__row:focus-within{background:var(--dsw-alias-interactive-bg-hover)}.mat-files__row[aria-selected=true]{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent)}.mat-files__row input{accent-color:var(--dsw-alias-brand-primary)}.mat-files__kind{display:grid;flex:none;place-items:center;width:16px}.mat-files__name{min-width:0;flex:1;overflow:hidden;padding:0;border:0;background:transparent;color:inherit;text-align:left;text-overflow:ellipsis;white-space:nowrap;cursor:pointer}.mat-files__origin{flex:none;padding:1px 7px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;font-size:11px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}.mat-files__origin--remote{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 35%,transparent);color:var(--dsw-alias-brand-primary)}.mat-files__origin--local{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary)}.mat-files__origin--both{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 35%,transparent);color:var(--dsw-alias-state-success-primary)}

.mat-files__pin{display:grid;place-items:center;padding:4px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:11px}.mat-files__pin:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.mat-files__pin[aria-pressed=true]{color:var(--dsw-alias-brand-primary)}.mat-files__empty,.mat-files__error,.mat-files__warning{margin:0;padding:0 12px;color:var(--dsw-alias-label-secondary);font-size:12px}.mat-files__empty{padding:16px 12px;color:var(--dsw-alias-label-secondary)}.mat-files__error{color:var(--dsw-alias-state-error-primary)}.mat-files__warning{color:var(--dsw-alias-brand-primary)}.mat-files__status{margin:0;padding:7px 12px;border-top:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary);font-size:11px}.mat-files__loading{padding:0 12px 8px;color:var(--dsw-alias-label-secondary);font-size:12px;font-variant-numeric:tabular-nums;animation:mat-pulse 1.4s ease-in-out infinite}.mat-files__row--loading{min-height:24px;align-items:center;color:var(--dsw-alias-label-secondary);font-size:11px;animation:mat-pulse 1.4s ease-in-out infinite}.mat-files__chip--busy{cursor:progress;animation:mat-pulse 1.4s ease-in-out infinite}.mat-files__confirm{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border-bottom:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 35%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 7%,transparent);color:var(--dsw-alias-label-secondary);font-size:12px}.mat-files__confirm b{color:var(--dsw-alias-state-error-primary);font-weight:600}.mat-files__confirm-actions{display:flex;flex:none;gap:6px}
@keyframes mat-pulse{50%{opacity:.45}}
.mat-view{display:flex;min-height:0;height:100%;flex-direction:column;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font:13px/1.5 var(--dsw-font-family)}.mat-view__toolbar{display:flex;align-items:center;gap:6px;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);font:13px/16px var(--dsw-font-family)}.mat-view__title{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font:500 12px/16px var(--dsw-font-family)}.mat-view__kind{flex:none;padding:2px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;font-size:10px;font-weight:600;letter-spacing:.05em;color:var(--dsw-alias-label-tertiary)}.mat-view__seg{display:flex;flex:none;gap:4px;padding-left:10px;margin-left:4px;border-left:1px solid var(--dsw-alias-border-l2)}.mat-view__canvas{min-height:0;flex:1}.mat-view__media{flex:1;min-height:0;width:100%;object-fit:contain}.mat-view__frame{flex:1;min-height:0;width:100%;border:0}.mat-view__text{flex:1;min-height:0;overflow:auto;margin:10px 12px 12px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);font:12px/1.6 ui-monospace,SFMono-Regular,monospace;white-space:pre-wrap;word-break:break-word}.mat-view__empty,.mat-view__error,.mat-view__loading{margin:0;padding:16px;color:var(--dsw-alias-label-secondary);font-size:12px}.mat-view__error{color:var(--dsw-alias-state-error-primary)}.mat-view__loading{font-variant-numeric:tabular-nums;animation:mat-pulse 1.4s ease-in-out infinite}
.mat-rail-toggle{position:absolute;top:50%;transform:translateY(-50%);display:grid;place-items:center;width:24px;height:56px;padding:0;border:1px solid var(--dsw-alias-border-l2);border-right:0;border-radius:10px 0 0 10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.12);transition:right var(--ds-transition-duration-slow) var(--ds-ease-in-out)}[data-dragging] .mat-rail-toggle{transition:none}@media (prefers-reduced-motion: reduce){.mat-rail-toggle{transition:none}}.mat-rail-toggle:hover,.mat-rail-toggle:focus-visible{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l3);color:var(--dsw-alias-label-primary)}
.mat-brand-name{font-size:17px;letter-spacing:0;white-space:nowrap}
.mat-files__scopetitle{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase}
.mat-files__row--scope{font-weight:600;background:var(--dsw-alias-bg-layer-1);cursor:pointer}.mat-files__row--session{cursor:pointer}.mat-files__row--session .mat-files__name{color:var(--dsw-alias-label-primary)}.mat-files__count{flex:none;color:var(--dsw-alias-label-tertiary);font-size:11px;font-variant-numeric:tabular-nums}
.mat-files__row--scope .mat-files__name{font-weight:600}
.mat-files__tag{flex:none;padding:2px 7px;border:1px solid transparent;border-radius:6px;font:600 11px/1.5 var(--dsw-font-family);letter-spacing:.02em;white-space:nowrap}.mat-files__tag--workspace{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2)}.mat-files__tag--session{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 35%,transparent);color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,transparent)}.mat-files__tag--current{color:var(--dsw-alias-label-primary-inverted);background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}.mat-files__tag--job{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 35%,transparent);color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 8%,transparent)}.mat-files__tag--job-running{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 40%,transparent);color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent)}.mat-files__tag--job-failed{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,transparent);color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent)}.mat-files__tag--job-done{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 35%,transparent);color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 8%,transparent)}.mat-files__tag--job-idle{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-bg-layer-2)}
.mat-files__copied{flex:none;color:var(--dsw-alias-state-success-primary);font-size:11px}.mat-files__scope{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font:12px/14px ui-monospace,SFMono-Regular,monospace}
.mat-view__zoom{margin-left:auto}.mat-view__path{display:flex;align-items:center;gap:8px;padding:7px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}.mat-view__path code{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:12px/1.5 ui-monospace,SFMono-Regular,monospace;color:var(--dsw-alias-label-secondary)}.mat-view__peers{align-items:center}.mat-view__count{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;font-size:12px;white-space:nowrap}.mat-view__structinfo{padding:6px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font:11px/1.5 var(--dsw-font-family);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mat-view-overlay{position:fixed;inset:0;z-index:20;display:grid;place-items:center;background:color-mix(in srgb,var(--dsw-alias-label-primary) 55%,transparent);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
.mat-view-overlay__card{display:flex;min-width:0;width:min(1200px,92vw);height:min(82vh,900px);overflow:hidden;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;background:var(--dsw-alias-bg-base);box-shadow:0 40px 120px rgba(0,0,0,.5)}
.mat-view--overlay{flex:1;min-width:0}
.mat-view--overlay .mat-view__text{font-size:13px}
`;
function installStyle() {
  const node = document.createElement("style");
  node.dataset.matUi = "native";
  node.textContent = style;
  document.head.append(node);
  return () => {
    node.remove();
  };
}

// packages/mat-ui/src/client/index.tsx
var import_jsx_runtime9 = require("react/jsx-runtime");
var inject = ["slots", "theme", "layout"];
function apply(ctx) {
  ctx.slots.inject("sidebar.brand.name", () => ctx.slots.register({
    name: "sidebar.brand.name"
  }, () => /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(MatBrandName, {})));
  ctx.slots.inject("conversation.details.tab", () => ctx.slots.register({
    name: "conversation.details.tab",
    id: "mat-files",
    order: 10,
    label: "\u6587\u4EF6"
  }, (props) => /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(FileManagerPanel, { ...props })));
  ctx.effect(installStyle, "mat-ui: native details stylesheet");
  ctx.slots.inject("conversation.details.tab", () => ctx.slots.register({
    name: "conversation.details.tab",
    id: "mat-task",
    order: 0,
    label: "\u4EFB\u52A1"
  }, (props) => /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(TaskDetailsPanel, { ...props, layout: ctx.layout })));
  ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
    name: "conversation.input.dock",
    id: "mat-status",
    order: 15
  }, (props) => /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(StatusDock, { ...props, layout: ctx.layout })));
  ctx.slots.inject("shell.overlay", () => ctx.slots.register({
    name: "shell.overlay",
    id: "mat-rail-toggle",
    order: 10
  }, (props) => /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(DetailsRailToggle, { ...props, layout: ctx.layout })));
  ctx.slots.inject("shell.overlay", () => ctx.slots.register({
    name: "shell.overlay",
    id: "mat-viewer-overlay",
    order: 20
  }, () => /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(ViewerOverlay, {})));
  ctx.slots.inject("tool.call.toolview", function* () {
    for (const key of ["mat_partitions", "mat_sbatch", "mat_job_status", "mat_job_watch", "mat_gaussian", "mat_upload", "mat_download"]) {
      yield ctx.slots.register({ name: "tool.call.toolview", key }, MatToolView);
    }
  });
}
return module.exports; } });
