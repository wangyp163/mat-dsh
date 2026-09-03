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

// packages/mat-ui/src/client/StatusDock.tsx
var import_react = require("react");
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// packages/mat-ui/src/client/file-manager-state.ts
var open = false;
var selectedJobId;
var activeTab = "files";
var refresh = "idle";
var download = "idle";
var opening = [];
var expanding = [];
var jobs = /* @__PURE__ */ new Map();
var listeners = /* @__PURE__ */ new Set();
function emit() {
  for (const listener of listeners) listener();
}
function currentJob() {
  if (selectedJobId === void 0) return { expanded: [], selectedPaths: [], pins: [] };
  let state = jobs.get(selectedJobId);
  if (state === void 0) {
    state = { expanded: [], selectedPaths: [], pins: [] };
    jobs.set(selectedJobId, state);
  }
  return state;
}
function toggle(values, path) {
  return values.includes(path) ? values.filter((value) => value !== path) : [...values, path];
}
var fileManagerState = {
  snapshot: () => ({ open, selectedJobId, activeTab, refresh, download, opening, expanding, ...currentJob() }),
  subscribe(listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  open(jobId) {
    open = true;
    activeTab = "files";
    selectedJobId = jobId ?? selectedJobId;
    emit();
  },
  close() {
    open = false;
    emit();
  },
  select(jobId) {
    selectedJobId = jobId;
    emit();
  },
  selectJob(jobId) {
    selectedJobId = jobId;
    emit();
  },
  selectTab(tab) {
    activeTab = tab;
    emit();
  },
  toggleExpanded(path) {
    currentJob().expanded = toggle(currentJob().expanded, path);
    emit();
  },
  selectPath(path) {
    currentJob().selectedPaths = toggle(currentJob().selectedPaths, path);
    emit();
  },
  pin(path) {
    const state = currentJob();
    if (!state.pins.includes(path)) state.pins = [...state.pins, path];
    emit();
  },
  unpin(path) {
    currentJob().pins = currentJob().pins.filter((value) => value !== path);
    emit();
  },
  setPins(paths) {
    currentJob().pins = [...new Set(paths)];
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
  beginExpand(path) {
    if (!expanding.includes(path)) expanding = [...expanding, path];
    emit();
  },
  finishExpand(path) {
    expanding = expanding.filter((value) => value !== path);
    emit();
  },
  beginDownload(paths) {
    currentJob().selectedPaths = [...paths];
    refresh = "idle";
    download = "pending";
    emit();
  },
  finishDownload(error2) {
    download = error2 === void 0 ? "idle" : "failed";
    emit();
  },
  reset() {
    open = false;
    selectedJobId = void 0;
    activeTab = "files";
    refresh = "idle";
    download = "idle";
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
  const slurm = job.slurm?.[0];
  return [
    ["completed", job.phase === "settled" ? formatCompletionTime(job.settledAt ?? job.updatedAt) : "in progress"],
    ["partition", job.partition ?? "\u2014"],
    ["job ID", job.jobId],
    ["job number", slurm?.id ?? "\u2014"],
    ["status", slurm?.state ?? job.outcomeStatus ?? (job.phase === "settled" ? "\u2014" : "monitoring")],
    ["converged", job.converged === void 0 ? "\u2014" : job.converged ? "yes" : "no"]
  ];
}

// packages/mat-ui/src/client/StatusDock.tsx
var import_jsx_runtime = require("react/jsx-runtime");
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
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "mat-status-strip", role: "status", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.StateDot, { state: statusState(selected) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "mat-status-strip__label", children: selected.phase === "settled" ? "Computation finished" : "Computation running" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "select",
      {
        "aria-label": "Current conversation task",
        value: selected.jobId,
        onChange: (event) => {
          fileManagerState.selectJob(event.target.value);
        },
        children: visible.map((job) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: job.jobId, children: job.label ?? job.jobId }, job.jobId))
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "mat-status-strip__count", children: [
      visible.length,
      " tasks"
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { size: "sm", variant: "outline", "aria-label": `\u6253\u5F00\u4EFB\u52A1\u9762\u677F ${selected.jobId}`, onClick: onOpenTask, children: "\u4EFB\u52A1" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Button, { size: "sm", variant: "outline", "aria-label": "\u6253\u5F00\u6587\u4EF6\u9762\u677F", onClick: () => {
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
var listeners2 = /* @__PURE__ */ new Set();
function emit2() {
  for (const listener of listeners2) listener();
}
var viewerState = {
  snapshot: () => ({
    ...current === void 0 ? {} : { current },
    status,
    ...error === void 0 ? {} : { error }
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
    emit2();
  },
  reset() {
    current = void 0;
    status = "idle";
    error = void 0;
    listeners2.clear();
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
var import_jsx_runtime2 = require("react/jsx-runtime");
async function getJobs() {
  const response = await fetch("/mat-files/jobs", { cache: "no-store" });
  if (!response.ok) throw new Error(`jobs HTTP ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload.jobs) ? payload.jobs : [];
}
async function getTree(jobId, path = "") {
  const response = await fetch(`/mat-files/tree?jobId=${encodeURIComponent(jobId)}&path=${encodeURIComponent(path)}`, { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message ?? `tree HTTP ${response.status}`);
  return {
    entries: Array.isArray(payload.entries) ? payload.entries : [],
    primary: Array.isArray(payload.primary) ? payload.primary : [],
    preferences: payload.preferences,
    warning: payload.warning
  };
}
async function downloadSelection(jobId, paths) {
  const response = await fetch("/mat-files/download", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobId, paths })
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
var cacheKey = (jobId, path = "") => `${jobId}\0${path}`;
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
function FileManagerPanel({ sessionId, openTab, openWorkspace }) {
  const [snapshot, setSnapshot] = (0, import_react2.useState)(fileManagerState.snapshot());
  const [jobs2, setJobs] = (0, import_react2.useState)([]);
  const [entries, setEntries] = (0, import_react2.useState)([]);
  const [primary, setPrimary] = (0, import_react2.useState)([]);
  const [warning, setWarning] = (0, import_react2.useState)();
  const [error2, setError] = (0, import_react2.useState)();
  const visible = (0, import_react2.useMemo)(() => jobsForSession(jobs2, sessionId), [jobs2, sessionId]);
  (0, import_react2.useEffect)(() => fileManagerState.subscribe(() => {
    setSnapshot(fileManagerState.snapshot());
  }), []);
  (0, import_react2.useEffect)(() => {
    let live = true;
    void getJobs().then((value) => {
      if (live) setJobs(value);
    }).catch((cause) => {
      if (live) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => {
      live = false;
    };
  }, [sessionId]);
  (0, import_react2.useEffect)(() => {
    const current2 = fileManagerState.snapshot().selectedJobId;
    const id = current2 !== void 0 && visible.some((job2) => job2.jobId === current2) ? current2 : visible.at(-1)?.jobId;
    if (id !== void 0 && id !== current2) fileManagerState.select(id);
  }, [visible]);
  const job = visible.find((value) => value.jobId === snapshot.selectedJobId) ?? visible.at(-1);
  const openFile = (path) => {
    if (job === void 0) return;
    const kind = classifyFile(path);
    fileManagerState.selectPath(path);
    if (kind === "unsupported") {
      setError("\u8BE5\u7C7B\u578B\u6682\u4E0D\u652F\u6301\u9884\u89C8\uFF1A\u8BF7\u52FE\u9009\u540E\u4E0B\u8F7D");
      return;
    }
    viewerState.open(job.jobId, path, kind);
    openTab?.("mat-view");
  };
  const loadDirectory = async (path) => {
    if (job === void 0) return;
    const cached = treeCache.get(cacheKey(job.jobId, path));
    if (cached !== void 0) {
      setEntries((current2) => mergeTreeEntries(current2, path, cached.entries));
    }
    fileManagerState.beginExpand(path);
    try {
      const tree = await getTree(job.jobId, path);
      treeCache.set(cacheKey(job.jobId, path), tree);
      setEntries((current2) => mergeTreeEntries(current2, path, tree.entries));
      setWarning(tree.warning);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      fileManagerState.finishExpand(path);
    }
  };
  const refresh2 = async () => {
    if (job === void 0) return;
    const cached = treeCache.get(cacheKey(job.jobId));
    if (cached !== void 0) {
      setEntries(cached.entries);
      setPrimary(cached.primary);
      setWarning(cached.warning);
    }
    fileManagerState.beginRefresh();
    setError(void 0);
    setWarning(void 0);
    try {
      const tree = await getTree(job.jobId);
      treeCache.set(cacheKey(job.jobId), tree);
      setEntries(tree.entries);
      setPrimary(tree.primary);
      setWarning(tree.warning);
      fileManagerState.setPins(tree.preferences?.pins ?? []);
      fileManagerState.finishRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      fileManagerState.finishRefresh(cause);
    }
  };
  (0, import_react2.useEffect)(() => {
    if (job !== void 0) void refresh2();
  }, [job?.jobId]);
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
  const selectedPaths = snapshot.selectedPaths;
  const visibleEntries = visibleTreeEntries(entries, snapshot.expanded);
  const selectedEntries = (0, import_react2.useMemo)(
    () => entries.filter((entry) => selectedPaths.includes(entry.path)),
    [entries, selectedPaths]
  );
  const disabledReason = selectedEntries.some((entry) => entry.symbolicLink || !entry.readable) ? "\u7B26\u53F7\u94FE\u63A5\u6216\u4E0D\u53EF\u8BFB\u6761\u76EE\u4E0D\u80FD\u4E0B\u8F7D" : selectedPaths.length === 0 ? "\u8BF7\u5148\u9009\u62E9\u6587\u4EF6\u6216\u76EE\u5F55" : void 0;
  const persistPins = async (pins) => {
    if (job === void 0) return;
    const response = await fetch("/mat-files/preferences", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId: job.jobId, pins, exclusions: [] })
    });
    if (!response.ok) throw new Error(`preferences HTTP ${response.status}`);
  };
  const togglePin = (path) => {
    const pinned = snapshot.pins.includes(path);
    if (pinned) fileManagerState.unpin(path);
    else fileManagerState.pin(path);
    const pins = pinned ? snapshot.pins.filter((value) => value !== path) : [...snapshot.pins, path];
    void persistPins(pins).catch((cause) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  };
  const download2 = async () => {
    if (job === void 0 || disabledReason !== void 0) return;
    fileManagerState.beginDownload(selectedPaths);
    setError(void 0);
    try {
      await downloadSelection(job.jobId, selectedPaths);
      fileManagerState.finishDownload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      fileManagerState.finishDownload(cause);
    }
  };
  const onTreeKeyDown = (event) => {
    if (event.key !== " " && event.key !== "Enter") return;
    const path = event.target.dataset.path;
    if (path === void 0) return;
    event.preventDefault();
    fileManagerState.selectPath(path);
  };
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { className: "mat-files", "aria-label": "HPC \u5DE5\u4F5C\u533A\u6587\u4EF6", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("header", { className: "mat-files__toolbar", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { className: "mat-files__job", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: "\u4EFB\u52A1" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("select", { value: job?.jobId ?? "", onChange: (event) => {
          fileManagerState.select(event.target.value);
        }, children: [
          visible.map((value) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("option", { value: value.jobId, children: [
            value.jobId,
            " \xB7 ",
            value.clusterId
          ] }, value.jobId)),
          "      "
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.Tooltip, { label: "\u5237\u65B0\u672C\u5730\u4E0E\u8FDC\u7AEF\u76EE\u5F55", side: "bottom", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.Button, { size: "sm", variant: "outline", "aria-label": "\u5237\u65B0\u6587\u4EF6", disabled: snapshot.refresh === "pending" || job === void 0, icon: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.IconRefreshOutline16, {}), onClick: () => {
        void refresh2();
      } }) }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.Tooltip, { label: disabledReason ?? "\u4E0B\u8F7D\u9009\u4E2D\u9879", side: "bottom", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.Button, { size: "sm", variant: "primary", "aria-label": "\u4E0B\u8F7D\u9009\u4E2D\u9879", disabled: disabledReason !== void 0 || snapshot.download === "pending", icon: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.IconDownloadOutline16, {}), onClick: () => {
        void download2();
      }, children: snapshot.download === "pending" ? `\u4E0B\u8F7D\u4E2D\u2026${elapsed}s` : "\u4E0B\u8F7D" }) }) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "mat-files__location", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: "\u672C\u5730\u5DE5\u4F5C\u533A" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", disabled: job?.localWorkspace === void 0 || openWorkspace === void 0, onClick: () => {
        if (job?.localWorkspace !== void 0) void openWorkspace?.(job.localWorkspace);
      }, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("code", { children: job === void 0 ? "\u6682\u65E0\u4EFB\u52A1" : job.localWorkspace ?? "\u672C\u5730\u5DE5\u4F5C\u533A\u672A\u7EA6\u5B9A" }) })
    ] }),
    primary.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { className: "mat-files__primary", "aria-labelledby": "mat-primary-title", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { id: "mat-primary-title", children: "\u4E3B\u8981\u6587\u4EF6" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "mat-files__chips", children: primary.map((path) => {
        const opening2 = snapshot.opening.includes(path);
        return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("button", { type: "button", onClick: () => {
          openFile(path);
        }, "aria-pressed": selectedPaths.includes(path), "aria-busy": opening2, disabled: opening2, className: opening2 ? "mat-files__chip--busy" : void 0, children: [
          path.split("/").at(-1),
          opening2 ? "\u2026" : ""
        ] }, path);
      }) })
    ] }),
    warning !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { role: "status", className: "mat-files__warning", children: [
      "\u8FDC\u7AEF\u76EE\u5F55\u6682\u4E0D\u53EF\u7528\uFF0C\u4EC5\u663E\u793A\u672C\u5730\u5DE5\u4F5C\u533A\uFF1A",
      warning
    ] }),
    busy && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("p", { role: "status", "aria-live": "polite", className: "mat-files__loading", children: [
      snapshot.download === "pending" ? `\u4E0B\u8F7D\u4E2D\u2026 ${elapsed}s` : `\u6B63\u5728\u540C\u6B65\u8FDC\u7AEF\u76EE\u5F55\u2026 ${elapsed}s`,
      slowHint
    ] }),
    error2 !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { role: "alert", className: "mat-files__error", children: error2 }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "mat-files__tree", role: "tree", "aria-label": "\u672C\u5730\u4E0E\u8FDC\u7AEF\u7EDF\u4E00\u6587\u4EF6\u6811", "aria-multiselectable": "true", onKeyDown: onTreeKeyDown, children: entries.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "mat-files__empty", children: "\u5F53\u524D\u5DE5\u4F5C\u533A\u6CA1\u6709\u53EF\u663E\u793A\u7684\u6587\u4EF6\u3002" }) : visibleEntries.map((entry) => {
      const selected = selectedPaths.includes(entry.path);
      const pinned = snapshot.pins.includes(entry.path);
      const listing = entry.directory && snapshot.expanded.includes(entry.path) && snapshot.expanding.includes(entry.path);
      return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(import_react3.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { role: "treeitem", tabIndex: 0, "data-path": entry.path, "aria-selected": selected, "aria-expanded": entry.directory ? snapshot.expanded.includes(entry.path) : void 0, className: "mat-files__row", style: { paddingInlineStart: `${5 + entry.depth * 16}px` }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("input", { type: "checkbox", "aria-label": `\u9009\u62E9 ${entry.name}`, checked: selected, onChange: () => {
            fileManagerState.selectPath(entry.path);
          } }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "mat-files__kind", children: entry.directory ? snapshot.expanded.includes(entry.path) ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.IconFolderOpenOutline16, {}) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.IconFolderClose16, {}) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.StateDot, { state: statusState2(entry) }) }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", className: "mat-files__name", onClick: () => {
            entry.directory ? (fileManagerState.toggleExpanded(entry.path), void loadDirectory(entry.path)) : openFile(entry.path);
          }, children: entry.name }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: `mat-files__origin mat-files__origin--${entry.origin}`, children: sourceLabel(entry) }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.Tooltip, { label: pinned ? "\u4ECE\u4E3B\u8981\u6587\u4EF6\u79FB\u9664" : "\u56FA\u5B9A\u4E3A\u4E3B\u8981\u6587\u4EF6", side: "bottom", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", className: "mat-files__pin", "aria-label": `${pinned ? "\u53D6\u6D88\u56FA\u5B9A" : "\u56FA\u5B9A"} ${entry.name}`, "aria-pressed": pinned, onClick: () => {
            togglePin(entry.path);
          }, children: "\u2605" }) })
        ] }),
        listing && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { role: "status", className: "mat-files__row mat-files__row--loading", style: { paddingInlineStart: `${5 + (entry.depth + 1) * 16}px` }, children: "\u6B63\u5728\u52A0\u8F7D\u8FDC\u7AEF\u5B50\u76EE\u5F55\u2026" })
      ] }, entry.path);
    }) }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "mat-files__status", role: "status", "aria-live": "polite", children: selectedPaths.length === 0 ? "\u672A\u9009\u62E9\u6587\u4EF6" : `\u5DF2\u9009\u62E9 ${selectedPaths.length} \u9879${selectedEntries.some((entry) => entry.directory) || selectedPaths.length > 1 ? "\uFF0C\u5C06\u4E0B\u8F7D ZIP" : ""}` })
  ] });
}

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
var import_jsx_runtime3 = require("react/jsx-runtime");
var TEXT_PREVIEW_LIMIT = 512 * 1024;
var contentUrl = (target) => `/mat-files/content?jobId=${encodeURIComponent(target.jobId)}&path=${encodeURIComponent(target.path)}`;
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
function ViewerPanel(_props) {
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
      stageRef.current = void 0;
      componentRef.current = void 0;
      stage?.dispose();
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
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { className: "mat-view", "aria-label": "HPC \u6587\u4EF6\u9884\u89C8", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("header", { className: "mat-view__toolbar", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "mat-view__title", children: target === void 0 ? "\u672A\u9009\u62E9\u6587\u4EF6" : target.path.split("/").at(-1) }),
      target !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "mat-view__kind", children: KIND_LABELS[target.kind] }),
      target?.kind === "structure" && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "mat-view__seg", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.Button, { size: "sm", variant: style2 === "ball+stick" ? "primary" : "outline", "aria-label": "\u7403\u68CD\u98CE\u683C", onClick: () => {
            onStyle("ball+stick");
          }, children: "\u7403\u68CD" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.Button, { size: "sm", variant: style2 === "line" ? "primary" : "outline", "aria-label": "\u7EBF\u6846\u98CE\u683C", onClick: () => {
            onStyle("line");
          }, children: "\u7EBF\u6846" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.Button, { size: "sm", variant: style2 === "spacefill" ? "primary" : "outline", "aria-label": "\u586B\u5145\u98CE\u683C", onClick: () => {
            onStyle("spacefill");
          }, children: "\u586B\u5145" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.Button, { size: "sm", variant: spin ? "primary" : "outline", "aria-label": "\u81EA\u8F6C", "aria-pressed": spin, onClick: onSpin, children: spin ? "\u505C\u8F6C" : "\u81EA\u8F6C" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.Button, { size: "sm", variant: "outline", "aria-label": "\u91CD\u7F6E\u89C6\u89D2", onClick: () => {
          stageRef.current?.autoView();
        }, children: "\u91CD\u7F6E" })
      ] }),
      target?.kind === "text" && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.Button, { size: "sm", variant: "outline", "aria-label": "\u590D\u5236\u6587\u672C", disabled: text === void 0, onClick: copy, children: "\u590D\u5236" })
    ] }),
    target === void 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "mat-view__empty", children: "\u70B9\u51FB\u6587\u4EF6\u9762\u677F\u4E2D\u7684\u6587\u4EF6\u4EE5\u9884\u89C8\u3002" }) : snapshot.status === "error" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { className: "mat-view__error", role: "alert", children: [
      "\u9884\u89C8\u5931\u8D25\uFF1A",
      snapshot.error
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
      busy && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { role: "status", "aria-live": "polite", className: "mat-view__loading", children: [
        "\u6B63\u5728\u53D6\u56DE\u6587\u4EF6\u2026 ",
        elapsed,
        "s",
        slowHint
      ] }),
      copyFailed && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { role: "alert", className: "mat-view__error", children: "\u590D\u5236\u5931\u8D25" }),
      target.kind === "structure" && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { ref: containerRef, className: "mat-view__canvas" }),
      target.kind === "image" && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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
      target.kind === "pdf" && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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
      target.kind === "text" && /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("pre", { className: "mat-view__text", children: [
        text,
        truncated ? "\n\u2026\uFF08\u6587\u4EF6\u8D85\u8FC7 512 KB\uFF0C\u5DF2\u622A\u65AD\uFF0C\u5B8C\u6574\u5185\u5BB9\u8BF7\u4E0B\u8F7D\uFF09" : ""
      ] })
    ] })
  ] });
}

// packages/mat-ui/src/client/TaskDetailsPanel.tsx
var import_react5 = require("react");
var import_dsh_client_ui_primitives4 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime4 = require("react/jsx-runtime");
function stateOf(job) {
  if (job.phase !== "settled") return "ongoing";
  return job.outcomeStatus === "completed" ? "done" : "error";
}
function TaskDetailsPanel({ sessionId, openTab, openDetailsTab }) {
  const [selectedJobId2, setSelectedJobId] = (0, import_react5.useState)();
  const selectFiles = () => {
    if (selectedJobId2 !== void 0) fileManagerState.selectJob(selectedJobId2);
    openDetailsTab?.("mat-files");
    openTab?.("mat-files");
  };
  const [jobs2, setJobs] = (0, import_react5.useState)([]);
  const [error2, setError] = (0, import_react5.useState)();
  const visible = (0, import_react5.useMemo)(() => jobsForSession(jobs2, sessionId), [jobs2, sessionId]);
  (0, import_react5.useEffect)(() => {
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
  (0, import_react5.useEffect)(() => {
    if (visible.length > 0 && (selectedJobId2 === void 0 || !visible.some((job2) => job2.jobId === selectedJobId2))) {
      setSelectedJobId(visible.at(-1).jobId);
    }
  }, [visible, selectedJobId2]);
  const job = visible.find((value) => value.jobId === selectedJobId2) ?? visible.at(-1);
  if (error2 !== void 0) return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("section", { className: "mat-task-details", role: "status", children: error2 });
  if (job === void 0) return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("section", { className: "mat-task-details", role: "status", children: "\u6682\u65E0\u8BA1\u7B97\u4EFB\u52A1" });
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("section", { className: "mat-task-details", "aria-label": "HPC task details", children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("header", { className: "mat-task-details__header", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives4.StateDot, { state: stateOf(job) }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { children: "\u4EFB\u52A1" }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("select", { value: job.jobId, onChange: (event) => {
          setSelectedJobId(event.target.value);
          fileManagerState.selectJob(event.target.value);
        }, children: visible.map((value) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("option", { value: value.jobId, children: value.label ?? value.jobId }, value.jobId)) })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("dl", { className: "mat-task-details__metadata", children: monitorMetadata(job).map(([label, value]) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("dt", { children: label }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("dd", { children: value })
    ] }, label)) }),
    job.detail !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "mat-task-details__failure", title: job.detail, children: job.detail }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("footer", { className: "mat-task-details__footer", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("p", { className: "mat-task-details__files", children: [
        "\u7ED3\u679C\u6587\u4EF6 ",
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("b", { children: job.files?.length ?? 0 }),
        " \u4E2A"
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "mat-task-details__actions", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_dsh_client_ui_primitives4.Button, { size: "sm", variant: "primary", onClick: selectFiles, children: "\u6253\u5F00\u6587\u4EF6" }) })
    ] })
  ] });
}

// packages/mat-ui/src/client/MatToolView.tsx
var import_jsx_runtime5 = require("react/jsx-runtime");
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
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("article", { className: "mat-toolview", onClick: inspect, role: inspect ? "button" : void 0, children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("header", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "mat-status-dock__eyebrow", children: "MAT" }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("strong", { children: toolName.replace("mat_", "").replaceAll("_", " ") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("table", { children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("tbody", { children: table.slice(0, 12).map((cells, i) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("tr", { children: cells.map((cell, j) => j === 0 ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("th", { children: cell }, j) : /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("td", { children: cell }, j)) }, i)) }) }),
    table.length > 12 ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("small", { children: [
      "+ ",
      table.length - 12,
      " rows"
    ] }) : null
  ] });
}

// packages/mat-ui/src/client/DetailsRailToggle.tsx
var import_react6 = require("react");
var import_dsh_client_ui_primitives5 = require("@deepseek-ai/dsh-client-ui-primitives");
var import_jsx_runtime6 = require("react/jsx-runtime");
function DetailsRailToggle(props) {
  const { layout, useSessions } = props;
  const live = useSessions((s) => {
    const current2 = s.current;
    return current2 !== void 0 && s.byId[current2]?.blank === false;
  });
  const [detailsWidth, setDetailsWidth] = (0, import_react6.useState)(void 0);
  (0, import_react6.useEffect)(() => {
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
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
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
      children: open2 ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives5.IconChevronRightOutline14, {}) : /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_dsh_client_ui_primitives5.IconChevronLeftOutline14, {})
    }
  );
}

// packages/mat-ui/src/client/style.ts
var style = `
.mat-status-dock, section[data-testid=todo-panel]{box-sizing:border-box;width:min(calc(100% - 2 * var(--dsh-composer-side-clearance)),430px);margin-left:max(var(--dsh-composer-side-clearance),calc((100% - var(--dsh-composer-card-max-width))/2))}.mat-status-strip{box-sizing:border-box;width:min(calc(100% - 2 * var(--dsh-composer-side-clearance)),430px);margin-left:max(var(--dsh-composer-side-clearance),calc((100% - var(--dsh-composer-card-max-width))/2))}.mat-status-dock{margin-top:0;margin-bottom:8px;padding:9px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-base);font-variant-numeric:tabular-nums}.mat-status-dock--empty{color:var(--dsw-alias-label-secondary);font-size:11px;text-align:center;padding:7px 9px}.mat-status-dock__header,.mat-status-dock__summary,.mat-status-card__topline{display:flex;align-items:center;gap:7px}.mat-status-dock__header{justify-content:space-between}.mat-status-dock__summary{min-width:0}.mat-status-dock__toggle{display:grid;flex:none;place-items:center;width:24px;height:24px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}.mat-status-dock__toggle:hover,.mat-status-dock__toggle:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}.mat-status-dock__eyebrow{font:600 9px/1.2 ui-monospace,SFMono-Regular,monospace;letter-spacing:.12em;color:var(--dsw-alias-label-secondary)}.mat-status-dock__count{font-size:10px;color:var(--dsw-alias-label-secondary)}.mat-status-dock__jobs{display:grid;gap:6px;max-height:220px;overflow:auto}.mat-status-card{padding:8px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);font-size:11px}.mat-status-card__topline{min-width:0}.mat-status-card strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}.mat-status-chip{flex:none;padding:2px 6px;border-radius:999px;font-size:9px;text-transform:uppercase;font-weight:700;letter-spacing:.05em}.mat-status-chip--active{color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent)}.mat-status-chip--complete{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent)}.mat-status-chip--attention{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent)}.mat-status-card__metadata{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px 12px;margin:7px 0 0}.mat-status-card__metadata dt{font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:var(--dsw-alias-label-secondary)}.mat-status-card__metadata dd{overflow:hidden;margin:1px 0 0;text-overflow:ellipsis;white-space:nowrap;font:10px/1.35 ui-monospace,SFMono-Regular,monospace}.mat-status-strip{display:flex;align-items:center;gap:7px;width:min(calc(100% - 2 * var(--dsh-composer-side-clearance)),430px);margin:0 0 8px max(var(--dsh-composer-side-clearance),calc((100% - var(--dsh-composer-card-max-width))/2));padding:6px 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font:11px/16px var(--dsw-font-family);text-align:left}.mat-status-strip__label{color:var(--dsw-alias-label-primary)}.mat-status-strip select{min-width:0;flex:1;padding:3px 5px;border:1px solid var(--dsw-alias-border-l2);border-radius:5px;background:transparent;color:var(--dsw-alias-label-primary);font:11px/14px var(--dsw-font-family)}.mat-status-strip__count{color:var(--dsw-alias-label-tertiary);white-space:nowrap}.mat-task-details{display:flex;min-height:0;height:100%;flex-direction:column;gap:10px;padding:12px 14px;color:var(--dsw-alias-label-primary);font:12px/1.5 var(--dsw-font-family)}.mat-task-details[role=status]{justify-content:center;color:var(--dsw-alias-label-tertiary);font-size:11px}.mat-task-details__header{display:flex;align-items:center;gap:8px}.mat-task-details__header label{display:flex;min-width:0;flex:1;align-items:center;gap:7px;color:var(--dsw-alias-label-secondary)}.mat-task-details__header label>span{font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}.mat-task-details__header select{min-width:0;flex:1;padding:5px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);font:11px/14px var(--dsw-font-family)}.mat-task-details__metadata{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}.mat-task-details__metadata>div{display:grid;gap:2px;padding:7px 12px;border-top:1px solid var(--dsw-alias-border-l1)}.mat-task-details__metadata>div:first-child,.mat-task-details__metadata>div:nth-child(2){border-top:0}.mat-task-details__metadata dt{font-size:9px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}.mat-task-details__metadata dd{overflow:hidden;margin:0;text-overflow:ellipsis;white-space:nowrap;font:11px/1.4 ui-monospace,SFMono-Regular,monospace;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}.mat-task-details__failure{display:-webkit-box;margin:0;padding:7px 10px;border-left:2px solid var(--dsw-alias-state-error-primary);border-radius:0 6px 6px 0;background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent);color:var(--dsw-alias-state-error-primary);font-size:11px;line-height:1.5;-webkit-box-orient:vertical;-webkit-line-clamp:4;overflow:hidden}.mat-task-details__footer{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:auto;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1)}.mat-task-details__files{margin:0;color:var(--dsw-alias-label-secondary);font-size:11px}.mat-task-details__files b{font:600 12px/1 ui-monospace,SFMono-Regular,monospace;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary)}.mat-task-details__actions{display:flex;gap:8px}.mat-toolview{padding:9px 11px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);cursor:pointer}.mat-toolview header{display:flex;align-items:center;gap:9px;margin-bottom:6px}.mat-toolview table{width:100%;border-collapse:collapse;font:11px/1.5 ui-monospace,SFMono-Regular,monospace}.mat-toolview th,.mat-toolview td{padding:3px 6px;border-top:1px solid var(--dsw-alias-border-l2);text-align:left;vertical-align:top}.mat-toolview th{color:var(--dsw-alias-label-secondary);font-weight:500}
.mat-files{display:flex;min-height:0;height:100%;flex-direction:column;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font:12px/1.5 var(--dsw-font-family)}.mat-files__toolbar{display:flex;align-items:center;gap:6px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);font:12px/16px var(--dsw-font-family)}.mat-files__job{display:flex;min-width:0;flex:1;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary)}.mat-files__job>span{flex:none;font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}.mat-files__job select{min-width:0;flex:1;padding:5px 8px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:inherit;font:11px/14px var(--dsw-font-family)}.mat-files__location{display:flex;align-items:center;gap:8px;padding:7px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:11px}.mat-files__location>span{flex:none;font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}.mat-files__location button{min-width:0;flex:1;padding:2px 8px;border:0;border-radius:5px;background:transparent;color:inherit;cursor:pointer;text-align:left}.mat-files__location button:hover:not(:disabled),.mat-files__location button:focus-visible:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.mat-files__location button:disabled{cursor:default}.mat-files__location code{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:10px/1.5 ui-monospace,SFMono-Regular,monospace;color:var(--dsw-alias-label-tertiary)}.mat-files__primary{padding:8px 12px 7px}.mat-files__primary>div:first-child{margin-bottom:5px;font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}.mat-files__chips{display:flex;gap:5px;overflow:auto}.mat-files__chips button{padding:3px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font:10px/1.6 var(--dsw-font-family);white-space:nowrap;cursor:pointer}.mat-files__chips button:hover:not(:disabled){border-color:var(--dsw-alias-border-l3);color:var(--dsw-alias-label-primary)}.mat-files__chips button[aria-pressed=true]{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent);color:var(--dsw-alias-label-primary)}.mat-files__tree{min-height:0;flex:1;overflow:auto;padding:4px 8px}.mat-files__row{display:flex;align-items:center;gap:6px;min-height:30px;padding:3px 6px;border-radius:6px;font-size:11px}.mat-files__row:hover,.mat-files__row:focus-within{background:var(--dsw-alias-interactive-bg-hover)}.mat-files__row[aria-selected=true]{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent)}.mat-files__row input{accent-color:var(--dsw-alias-brand-primary)}.mat-files__kind{display:grid;flex:none;place-items:center;width:16px}.mat-files__name{min-width:0;flex:1;overflow:hidden;padding:0;border:0;background:transparent;color:inherit;text-align:left;text-overflow:ellipsis;white-space:nowrap;cursor:pointer}.mat-files__origin{flex:none;padding:1px 7px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;font-size:9px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}.mat-files__origin--remote{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 35%,transparent);color:var(--dsw-alias-brand-primary)}.mat-files__origin--both{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 35%,transparent);color:var(--dsw-alias-state-success-primary)}.mat-files__pin{display:grid;place-items:center;padding:3px;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:10px}.mat-files__pin:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.mat-files__pin[aria-pressed=true]{color:var(--dsw-alias-brand-primary)}.mat-files__empty,.mat-files__error,.mat-files__warning{margin:0;padding:0 12px;color:var(--dsw-alias-label-secondary);font-size:11px}.mat-files__empty{padding:8px 4px}.mat-files__error{color:var(--dsw-alias-state-error-primary)}.mat-files__warning{color:var(--dsw-alias-brand-primary)}.mat-files__status{margin:0;padding:7px 12px;border-top:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary);font-size:10px}.mat-files__loading{padding:0 12px 8px;color:var(--dsw-alias-label-secondary);font-size:11px;font-variant-numeric:tabular-nums;animation:mat-pulse 1.4s ease-in-out infinite}.mat-files__row--loading{min-height:22px;align-items:center;color:var(--dsw-alias-label-secondary);font-size:10px;animation:mat-pulse 1.4s ease-in-out infinite}.mat-files__chip--busy{cursor:progress;animation:mat-pulse 1.4s ease-in-out infinite}@keyframes mat-pulse{50%{opacity:.45}}
.mat-view{display:flex;min-height:0;height:100%;flex-direction:column;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font:12px/1.5 var(--dsw-font-family)}.mat-view__toolbar{display:flex;align-items:center;gap:6px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);font:12px/16px var(--dsw-font-family)}.mat-view__title{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font:500 12px/16px var(--dsw-font-family)}.mat-view__kind{flex:none;padding:1px 7px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;font-size:9px;font-weight:600;letter-spacing:.06em;color:var(--dsw-alias-label-tertiary)}.mat-view__seg{display:flex;flex:none;gap:4px;padding-left:8px;margin-left:2px;border-left:1px solid var(--dsw-alias-border-l2)}.mat-view__canvas{min-height:0;flex:1}.mat-view__media{flex:1;min-height:0;width:100%;object-fit:contain}.mat-view__frame{flex:1;min-height:0;width:100%;border:0}.mat-view__text{flex:1;min-height:0;overflow:auto;margin:10px 12px 12px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);font:11px/1.6 ui-monospace,SFMono-Regular,monospace;white-space:pre-wrap;word-break:break-word}.mat-view__empty,.mat-view__error,.mat-view__loading{margin:0;padding:12px;color:var(--dsw-alias-label-secondary);font-size:11px}.mat-view__error{color:var(--dsw-alias-state-error-primary)}.mat-view__loading{font-variant-numeric:tabular-nums;animation:mat-pulse 1.4s ease-in-out infinite}
.mat-rail-toggle{position:absolute;top:50%;transform:translateY(-50%);display:grid;place-items:center;width:22px;height:52px;padding:0;border:1px solid var(--dsw-alias-border-l2);border-right:0;border-radius:8px 0 0 8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);cursor:pointer;box-shadow:0 1px 6px rgba(0,0,0,.12);transition:right var(--ds-transition-duration-slow) var(--ds-ease-in-out)}[data-dragging] .mat-rail-toggle{transition:none}@media (prefers-reduced-motion: reduce){.mat-rail-toggle{transition:none}}.mat-rail-toggle:hover,.mat-rail-toggle:focus-visible{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l3);color:var(--dsw-alias-label-primary)}
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
var import_jsx_runtime7 = require("react/jsx-runtime");
var inject = ["slots", "theme", "layout"];
function apply(ctx) {
  ctx.slots.inject("conversation.details.tab", () => ctx.slots.register({
    name: "conversation.details.tab",
    id: "mat-files",
    order: 10,
    label: "\u6587\u4EF6"
  }, (props) => /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(FileManagerPanel, { ...props })));
  ctx.effect(installStyle, "mat-ui: native details stylesheet");
  ctx.slots.inject("conversation.details.tab", () => ctx.slots.register({
    name: "conversation.details.tab",
    id: "mat-view",
    order: 20,
    label: "\u67E5\u770B"
  }, (props) => /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(ViewerPanel, { ...props })));
  ctx.slots.inject("conversation.details.tab", () => ctx.slots.register({
    name: "conversation.details.tab",
    id: "mat-task",
    order: 0,
    label: "\u4EFB\u52A1"
  }, (props) => /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(TaskDetailsPanel, { ...props })));
  ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
    name: "conversation.input.dock",
    id: "mat-status",
    order: 15
  }, (props) => /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(StatusDock, { ...props })));
  ctx.slots.inject("shell.overlay", () => ctx.slots.register({
    name: "shell.overlay",
    id: "mat-rail-toggle",
    order: 10
  }, (props) => /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(DetailsRailToggle, { ...props, layout: ctx.layout })));
  ctx.slots.inject("tool.call.toolview", function* () {
    for (const key of ["mat_partitions", "mat_sbatch", "mat_job_status", "mat_job_watch", "mat_gaussian", "mat_upload", "mat_download"]) {
      yield ctx.slots.register({ name: "tool.call.toolview", key }, MatToolView);
    }
  });
}
return module.exports; } });
