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

// packages/mat-ui/src/client/logo-data.ts
var matLogoDataUrl = "data:image/png;base64,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";

// packages/mat-ui/src/client/Brand.tsx
var import_jsx_runtime = require("react/jsx-runtime");
function MatBrandName() {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "mat-brand-name", children: "Harness" });
}
function MatBrandMark({ size }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "img",
    {
      className: "mat-brand-mark",
      src: matLogoDataUrl,
      alt: "",
      style: { height: size }
    }
  );
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
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "mat-status-strip__label", children: selected.phase === "settled" ? "Computation finished" : "Computation running" }),
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
function extensionOf(name) {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}
function classifyFile(name) {
  const base = name.split("/").at(-1) ?? name;
  if (base.toLowerCase() === "poscar") return "structure";
  const extension = extensionOf(base);
  if (STRUCTURE_EXTENSIONS.has(extension)) return "structure";
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (extension === "pdf") return "pdf";
  if (TEXT_EXTENSIONS.has(extension)) return "text";
  return "unsupported";
}
function isPoscarFamily(name) {
  const base = name.split("/").at(-1) ?? name;
  if (base.toLowerCase() === "poscar") return true;
  const extension = extensionOf(base);
  return extension === "poscar" || extension === "vasp";
}
function emitCif(lengths, angles, sites) {
  const rows2 = sites.map((site, index) => `${site.symbol}${index + 1} ${site.symbol} ${site.fraction.map((value) => value.toFixed(6)).join(" ")} 1.000000`);
  return [
    "data_structure",
    `_cell_length_a    ${lengths[0].toFixed(6)}`,
    `_cell_length_b    ${lengths[1].toFixed(6)}`,
    `_cell_length_c    ${lengths[2].toFixed(6)}`,
    `_cell_angle_alpha ${angles[0].toFixed(3)}`,
    `_cell_angle_beta  ${angles[1].toFixed(3)}`,
    `_cell_angle_gamma ${angles[2].toFixed(3)}`,
    // 旧式标签：vendored NGL 的 CifParser 非可选地读 symmetry_space_group_name_H-M。
    "_symmetry_space_group_name_H-M 'P 1'",
    "loop_",
    "_atom_site_label",
    "_atom_site_type_symbol",
    "_atom_site_fract_x",
    "_atom_site_fract_y",
    "_atom_site_fract_z",
    // occupancy 的取值虽可选，但 getField 本身非可选——缺列直接崩。
    "_atom_site_occupancy",
    ...rows2,
    ""
  ].join("\n");
}
function xyzToCif(text) {
  const raw = text.split(/\r?\n/);
  let head = 0;
  while (head < raw.length && raw[head].trim() === "") head++;
  if (raw.length - head < 3) throw new Error("malformed XYZ: too few lines");
  const declared = Number(raw[head].trim());
  if (!Number.isInteger(declared) || declared < 1) throw new Error("malformed XYZ: bad atom count");
  const siteLines = raw.slice(head + 2).filter((line) => line.trim() !== "");
  if (siteLines.length < declared) throw new Error("malformed XYZ: fewer sites than declared");
  const sites = [];
  for (const line of siteLines.slice(0, declared)) {
    const tokens = line.trim().split(/\s+/);
    const symbol = tokens[0]?.match(/^[A-Za-z]+/)?.[0];
    const coordinates = tokens.slice(1, 4).map(Number);
    if (symbol === void 0 || coordinates.length < 3 || coordinates.some((value) => !Number.isFinite(value))) {
      throw new Error("malformed XYZ: bad site line");
    }
    sites.push({ symbol, cartesian: coordinates });
  }
  const MARGIN = 8;
  const extent = [0, 1, 2].map((axis) => Math.max(...sites.map((site) => site.cartesian[axis])) - Math.min(...sites.map((site) => site.cartesian[axis])));
  const origin = [0, 1, 2].map((axis) => Math.min(...sites.map((site) => site.cartesian[axis])) - MARGIN);
  const box = extent.map((value) => value + 2 * MARGIN);
  return emitCif(box, [90, 90, 90], sites.map((site) => ({
    symbol: site.symbol,
    fraction: [0, 1, 2].map((axis) => (site.cartesian[axis] - origin[axis]) / box[axis])
  })));
}
function structureBody(name, text) {
  if (isPoscarFamily(name)) return poscarToCif(text);
  if (isXyz(name)) return xyzToCif(text);
  return text;
}
function isXyz(name) {
  return extensionOf(name) === "xyz";
}
function multiplyMatrixVector(matrix, vector) {
  return [
    vector[0] * matrix[0][0] + vector[1] * matrix[1][0] + vector[2] * matrix[2][0],
    vector[0] * matrix[0][1] + vector[1] * matrix[1][1] + vector[2] * matrix[2][1],
    vector[0] * matrix[0][2] + vector[1] * matrix[1][2] + vector[2] * matrix[2][2]
  ];
}
function invertMatrix3(matrix) {
  const [[a, b, c], [d, e, f], [g, h, i]] = matrix;
  const cofactor = [
    [e * i - f * h, f * g - d * i, d * h - e * g],
    [c * h - b * i, a * i - c * g, b * g - a * h],
    [b * f - c * e, c * d - a * f, a * e - b * d]
  ];
  const determinant = a * cofactor[0][0] + b * cofactor[0][1] + c * cofactor[0][2];
  if (Math.abs(determinant) < 1e-12) throw new Error("malformed POSCAR: singular lattice");
  const transpose = (matrix2) => matrix2[0].map((_, column) => matrix2.map((row) => row[column]));
  return transpose(cofactor).map((row) => row.map((value) => value / determinant));
}
function latticeMetrics(lattice) {
  const norm = (v) => Math.hypot(v[0], v[1], v[2]);
  const angle = (u, v) => Math.acos((u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (norm(u) * norm(v))) * 180 / Math.PI;
  return {
    lengths: [norm(lattice[0]), norm(lattice[1]), norm(lattice[2])],
    angles: [angle(lattice[1], lattice[2]), angle(lattice[0], lattice[2]), angle(lattice[0], lattice[1])]
  };
}
function poscarToCif(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "");
  const numbers = (line) => line.split(/\s+/).filter(Boolean);
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
  const sites = [];
  for (const [index, symbol] of elements.entries()) {
    for (let nth = 0; nth < counts[index]; nth++) {
      const raw = numbers(lines[cursor] ?? "").map(Number).slice(0, 3);
      if (raw.length < 3 || raw.some((value) => !Number.isFinite(value))) {
        throw new Error(`malformed POSCAR: bad coordinates for ${symbol} site ${nth + 1}`);
      }
      const fraction = inverse === void 0 ? raw : multiplyMatrixVector(inverse, raw);
      sites.push({ symbol, fraction });
      cursor += 1;
    }
  }
  if (sites.length === 0) throw new Error("malformed POSCAR: no sites");
  const { lengths, angles } = latticeMetrics(scaled);
  return emitCif(lengths, angles, sites);
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
  const response = await fetch(`/mat-files/tree?${query}&path=${encodeURIComponent(path)}`, { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message ?? `tree HTTP ${response.status}`);
  return {
    entries: Array.isArray(payload.entries) ? payload.entries : [],
    primary: Array.isArray(payload.primary) ? payload.primary : [],
    preferences: payload.preferences,
    warning: payload.warning,
    ...payload.root === void 0 ? {} : { root: payload.root }
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
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "mat-files__count", children: sessionJobs.length })
            ] }),
            sidOpen && (sessionJobs.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "mat-files__row mat-files__row--loading", style: { paddingInlineStart: `${5 + 2 * 16}px` }, children: "\u65E0\u8DDF\u8E2A\u4F5C\u4E1A" }) : sessionJobs.map((job) => {
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
            }))
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
function rebuild(style2, component, unitcell) {
  component.removeAllRepresentations();
  component.addRepresentation(style2);
  if (unitcell) component.addRepresentation("unitcell");
}
function ViewerSurface({ variant = "overlay", peersNav, localPath }) {
  const [snapshot, setSnapshot] = (0, import_react4.useState)(viewerState.snapshot());
  (0, import_react4.useEffect)(() => viewerState.subscribe(() => {
    setSnapshot(viewerState.snapshot());
  }), []);
  const [style2, setStyle] = (0, import_react4.useState)("ball+stick");
  const [spin, setSpin] = (0, import_react4.useState)(false);
  const [text, setText] = (0, import_react4.useState)();
  const [truncated, setTruncated] = (0, import_react4.useState)(false);
  const [copyFailed, setCopyFailed] = (0, import_react4.useState)(false);
  const containerRef = (0, import_react4.useRef)(null);
  const stageRef = (0, import_react4.useRef)(void 0);
  const componentRef = (0, import_react4.useRef)(void 0);
  const unitcellRef = (0, import_react4.useRef)(false);
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
        stage = new NGL.Stage(containerRef.current, { backgroundColor: "white" });
        resizeObserver = new ResizeObserver(() => {
          stage?.handleResize();
        });
        resizeObserver.observe(containerRef.current);
        const component = await stage.loadFile(new Blob([structureBody(target.path, source)]), { ext: "cif", defaultRepresentation: false });
        if (disposed) return;
        stageRef.current = stage;
        componentRef.current = component;
        unitcellRef.current = !isXyz(target.path);
        rebuild("ball+stick", component, unitcellRef.current);
        stage.autoView();
        viewerState.finish();
      } catch (cause) {
        if (!disposed) viewerState.finish(cause);
      }
    })();
    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      stageRef.current = void 0;
      componentRef.current = void 0;
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
    if (componentRef.current !== void 0) rebuild(next, componentRef.current, unitcellRef.current);
  };
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
function TaskDetailsPanel({ sessionId, openTab, openDetailsTab }) {
  const [selectedJobId2, setSelectedJobId] = (0, import_react6.useState)();
  const selectFiles = () => {
    if (selectedJobId2 !== void 0) fileManagerState.selectJob(selectedJobId2);
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
        else layout.openDetails();
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
.mat-brand-mark{display:block;width:auto;max-width:100%;object-fit:contain}
body[data-ds-dark-theme] .mat-brand-mark{filter:invert(1)}
.mat-view__zoom{margin-left:auto}.mat-view__path{display:flex;align-items:center;gap:8px;padding:7px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}.mat-view__path code{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:12px/1.5 ui-monospace,SFMono-Regular,monospace;color:var(--dsw-alias-label-secondary)}.mat-view__peers{align-items:center}.mat-view__count{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;font-size:12px;white-space:nowrap}
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
  ctx.slots.inject("sidebar.brand.mark", () => ctx.slots.register({
    name: "sidebar.brand.mark"
  }, (props) => /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(MatBrandMark, { ...props })));
  ctx.slots.inject("conversation.hero.brand.mark", () => ctx.slots.register({
    name: "conversation.hero.brand.mark"
  }, (props) => /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(MatBrandMark, { ...props })));
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
  }, (props) => /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(TaskDetailsPanel, { ...props })));
  ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
    name: "conversation.input.dock",
    id: "mat-status",
    order: 15
  }, (props) => /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(StatusDock, { ...props })));
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
