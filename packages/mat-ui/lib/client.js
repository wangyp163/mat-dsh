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
var import_jsx_runtime = require("react/jsx-runtime");
function statusState(job) {
  if (job.phase !== "settled") return "ongoing";
  return job.outcomeStatus === "completed" ? "done" : "error";
}
function StatusDock({
  openDetailsTab,
  onOpenTask = () => {
    openDetailsTab?.("mat-task");
  }
}) {
  const [jobs2, setJobs] = (0, import_react.useState)([]);
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
  const latest = jobs2[jobs2.length - 1];
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "button",
    {
      type: "button",
      className: "mat-status-strip",
      "aria-label": latest === void 0 ? "Open HPC task details" : `Open task ${latest.jobId}`,
      onClick: onOpenTask,
      role: "status",
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.StateDot, { state: latest === void 0 ? "done" : statusState(latest) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "mat-status-strip__label", children: latest === void 0 ? "HPC ready" : latest.phase === "settled" ? "Computation finished" : "Computation running" }),
        latest !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("code", { children: latest.jobId }),
        jobs2.length > 1 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "mat-status-strip__count", children: [
          jobs2.length,
          " tasks"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "mat-status-strip__action", children: "Details" })
      ]
    }
  );
}

// packages/mat-ui/src/client/FileManagerPanel.tsx
var import_react2 = require("react");
var import_dsh_client_ui_primitives2 = require("@deepseek-ai/dsh-client-ui-primitives");

// packages/mat-ui/src/client/file-manager-state.ts
var open = false;
var selectedJobId;
var activeTab = "files";
var refresh = "idle";
var download = "idle";
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
  snapshot: () => ({ open, selectedJobId, activeTab, refresh, download, ...currentJob() }),
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
  finishRefresh(error) {
    refresh = error === void 0 ? "idle" : "failed";
    emit();
  },
  beginDownload(paths) {
    currentJob().selectedPaths = [...paths];
    refresh = "idle";
    download = "pending";
    emit();
  },
  finishDownload(error) {
    download = error === void 0 ? "idle" : "failed";
    emit();
  },
  reset() {
    open = false;
    selectedJobId = void 0;
    activeTab = "files";
    refresh = "idle";
    download = "idle";
    jobs.clear();
    listeners.clear();
  }
};

// packages/mat-ui/src/client/file-tree-model.ts
function parent(path) {
  const index = path.lastIndexOf("/");
  return index < 0 ? void 0 : path.slice(0, index);
}
function visibleTreeEntries(entries, expanded) {
  const open2 = new Set(expanded);
  return [...entries].sort((a, b) => a.path.localeCompare(b.path)).filter((entry) => {
    let current = parent(entry.path);
    while (current !== void 0) {
      if (!open2.has(current)) return false;
      current = parent(current);
    }
    return true;
  }).map((entry) => ({ ...entry, depth: entry.path.split("/").length - 1 }));
}
function mergeTreeEntries(current, root, children) {
  const prefix = `${root}/`;
  return [...current.filter((entry) => entry.path !== root && !entry.path.startsWith(prefix)), ...current.filter((entry) => entry.path === root), ...children].sort((a, b) => a.path.localeCompare(b.path));
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
    preferences: payload.preferences
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
function FileManagerPanel() {
  const [snapshot, setSnapshot] = (0, import_react2.useState)(fileManagerState.snapshot());
  const [jobs2, setJobs] = (0, import_react2.useState)([]);
  const [entries, setEntries] = (0, import_react2.useState)([]);
  const [primary, setPrimary] = (0, import_react2.useState)([]);
  const [error, setError] = (0, import_react2.useState)();
  (0, import_react2.useEffect)(() => fileManagerState.subscribe(() => {
    setSnapshot(fileManagerState.snapshot());
  }), []);
  (0, import_react2.useEffect)(() => {
    let live = true;
    void getJobs().then((value) => {
      if (!live) return;
      setJobs(value);
      const id = snapshot.selectedJobId ?? value[0]?.jobId;
      if (id !== void 0 && id !== snapshot.selectedJobId) fileManagerState.select(id);
    }).catch((cause) => {
      if (live) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => {
      live = false;
    };
  }, []);
  const job = jobs2.find((value) => value.jobId === snapshot.selectedJobId) ?? jobs2[0];
  const loadDirectory = async (path) => {
    if (job === void 0) return;
    try {
      const tree = await getTree(job.jobId, path);
      setEntries((current) => mergeTreeEntries(current, path, tree.entries));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const refresh2 = async () => {
    if (job === void 0) return;
    fileManagerState.beginRefresh();
    setError(void 0);
    try {
      const tree = await getTree(job.jobId);
      setEntries(tree.entries);
      setPrimary(tree.primary);
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
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("select", { value: job?.jobId ?? "", onChange: (event) => {
          fileManagerState.select(event.target.value);
        }, children: jobs2.map((value) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("option", { value: value.jobId, children: [
          value.jobId,
          " \xB7 ",
          value.clusterId
        ] }, value.jobId)) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.Tooltip, { label: "\u5237\u65B0\u672C\u5730\u4E0E\u8FDC\u7AEF\u76EE\u5F55", side: "bottom", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.Button, { size: "sm", variant: "toolbar", "aria-label": "\u5237\u65B0\u6587\u4EF6", disabled: snapshot.refresh === "pending" || job === void 0, icon: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.IconRefreshOutline16, {}), onClick: () => {
        void refresh2();
      } }) }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.Tooltip, { label: disabledReason ?? "\u4E0B\u8F7D\u9009\u4E2D\u9879", side: "bottom", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.Button, { size: "sm", variant: "primary", "aria-label": "\u4E0B\u8F7D\u9009\u4E2D\u9879", disabled: disabledReason !== void 0 || snapshot.download === "pending", icon: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.IconDownloadOutline16, {}), onClick: () => {
        void download2();
      }, children: "\u4E0B\u8F7D" }) }) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "mat-files__location", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: "\u672C\u5730\u5DE5\u4F5C\u533A" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("code", { children: job?.jobId ?? "\u6682\u65E0\u4EFB\u52A1" })
    ] }),
    primary.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { className: "mat-files__primary", "aria-labelledby": "mat-primary-title", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { id: "mat-primary-title", children: "\u4E3B\u8981\u6587\u4EF6" }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "mat-files__chips", children: primary.map((path) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", onClick: () => {
        if (!selectedPaths.includes(path)) fileManagerState.selectPath(path);
      }, "aria-pressed": selectedPaths.includes(path), children: path.split("/").at(-1) }, path)) })
    ] }),
    error !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { role: "alert", className: "mat-files__error", children: error }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "mat-files__tree", role: "tree", "aria-label": "\u672C\u5730\u4E0E\u8FDC\u7AEF\u7EDF\u4E00\u6587\u4EF6\u6811", "aria-multiselectable": "true", onKeyDown: onTreeKeyDown, children: entries.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "mat-files__empty", children: "\u5F53\u524D\u5DE5\u4F5C\u533A\u6CA1\u6709\u53EF\u663E\u793A\u7684\u6587\u4EF6\u3002" }) : visibleEntries.map((entry) => {
      const selected = selectedPaths.includes(entry.path);
      const pinned = snapshot.pins.includes(entry.path);
      return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { role: "treeitem", tabIndex: 0, "data-path": entry.path, "aria-selected": selected, "aria-expanded": entry.directory ? snapshot.expanded.includes(entry.path) : void 0, className: "mat-files__row", style: { paddingInlineStart: `${5 + entry.depth * 16}px` }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("input", { type: "checkbox", "aria-label": `\u9009\u62E9 ${entry.name}`, checked: selected, onChange: () => {
          fileManagerState.selectPath(entry.path);
        } }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "mat-files__kind", children: entry.directory ? snapshot.expanded.includes(entry.path) ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.IconFolderOpenOutline16, {}) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.IconFolderClose16, {}) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.StateDot, { state: statusState2(entry) }) }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", className: "mat-files__name", onClick: () => {
          entry.directory ? (fileManagerState.toggleExpanded(entry.path), void loadDirectory(entry.path)) : fileManagerState.selectPath(entry.path);
        }, children: entry.name }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: `mat-files__origin mat-files__origin--${entry.origin}`, children: sourceLabel(entry) }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives2.Tooltip, { label: pinned ? "\u4ECE\u4E3B\u8981\u6587\u4EF6\u79FB\u9664" : "\u56FA\u5B9A\u4E3A\u4E3B\u8981\u6587\u4EF6", side: "bottom", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", className: "mat-files__pin", "aria-label": `${pinned ? "\u53D6\u6D88\u56FA\u5B9A" : "\u56FA\u5B9A"} ${entry.name}`, "aria-pressed": pinned, onClick: () => {
          togglePin(entry.path);
        }, children: "\u2605" }) })
      ] }, entry.path);
    }) }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "mat-files__status", role: "status", "aria-live": "polite", children: selectedPaths.length === 0 ? "\u672A\u9009\u62E9\u6587\u4EF6" : `\u5DF2\u9009\u62E9 ${selectedPaths.length} \u9879${selectedEntries.some((entry) => entry.directory) || selectedPaths.length > 1 ? "\uFF0C\u5C06\u4E0B\u8F7D ZIP" : ""}` })
  ] });
}

// packages/mat-ui/src/client/TaskDetailsPanel.tsx
var import_react3 = require("react");
var import_dsh_client_ui_primitives3 = require("@deepseek-ai/dsh-client-ui-primitives");

// packages/mat-ui/src/client/status-model.ts
function formatCompletionTime(timestamp) {
  return new Intl.DateTimeFormat(void 0, {
    dateStyle: "short",
    timeStyle: "short"
  }).format(timestamp);
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

// packages/mat-ui/src/client/TaskDetailsPanel.tsx
var import_jsx_runtime3 = require("react/jsx-runtime");
function stateOf(job) {
  if (job.phase !== "settled") return "ongoing";
  return job.outcomeStatus === "completed" ? "done" : "error";
}
function TaskDetailsPanel({ openTab, openDetailsTab }) {
  const selectFiles = () => {
    openDetailsTab?.("mat-files");
    openTab?.("mat-files");
  };
  const [jobs2, setJobs] = (0, import_react3.useState)([]);
  const [error, setError] = (0, import_react3.useState)();
  (0, import_react3.useEffect)(() => {
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
  const job = jobs2[jobs2.length - 1];
  if (error !== void 0) return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("section", { className: "mat-task-details", role: "status", children: error });
  if (job === void 0) return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("section", { className: "mat-task-details", role: "status", children: "\u6682\u65E0\u8BA1\u7B97\u4EFB\u52A1" });
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { className: "mat-task-details", "aria-label": "HPC task details", children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("header", { className: "mat-task-details__header", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_dsh_client_ui_primitives3.StateDot, { state: stateOf(job) }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: job.label ?? job.jobId })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dl", { className: "mat-task-details__metadata", children: monitorMetadata(job).map(([label, value]) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dt", { children: label }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dd", { children: value })
    ] }, label)) }),
    job.detail !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "mat-task-details__failure", children: job.detail }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("p", { className: "mat-task-details__files", children: [
      "\u7ED3\u679C\u6587\u4EF6\uFF1A",
      job.files?.length ?? 0,
      " \u4E2A"
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", onClick: selectFiles, children: "\u6253\u5F00\u6587\u4EF6" })
  ] });
}

// packages/mat-ui/src/client/MatToolView.tsx
var import_jsx_runtime4 = require("react/jsx-runtime");
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
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("article", { className: "mat-toolview", onClick: inspect, role: inspect ? "button" : void 0, children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("header", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { className: "mat-status-dock__eyebrow", children: "MAT" }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("strong", { children: toolName.replace("mat_", "").replaceAll("_", " ") })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("table", { children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("tbody", { children: table.slice(0, 12).map((cells, i) => /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("tr", { children: cells.map((cell, j) => j === 0 ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("th", { children: cell }, j) : /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("td", { children: cell }, j)) }, i)) }) }),
    table.length > 12 ? /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("small", { children: [
      "+ ",
      table.length - 12,
      " rows"
    ] }) : null
  ] });
}

// packages/mat-ui/src/client/style.ts
var style = `
.mat-status-dock, section[data-testid=todo-panel]{box-sizing:border-box;width:min(calc(100% - 2 * var(--dsh-composer-side-clearance)),430px);margin-left:max(var(--dsh-composer-side-clearance),calc((100% - var(--dsh-composer-card-max-width))/2))}.mat-status-strip{box-sizing:border-box;width:min(calc(100% - 2 * var(--dsh-composer-side-clearance)),430px);margin-left:max(var(--dsh-composer-side-clearance),calc((100% - var(--dsh-composer-card-max-width))/2))}.mat-status-dock{margin-top:0;margin-bottom:8px;padding:9px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-base);font-variant-numeric:tabular-nums}.mat-status-dock--empty{color:var(--dsw-alias-label-secondary);font-size:11px;text-align:center;padding:7px 9px}.mat-status-dock__header,.mat-status-dock__summary,.mat-status-card__topline{display:flex;align-items:center;gap:7px}.mat-status-dock__header{justify-content:space-between}.mat-status-dock__summary{min-width:0}.mat-status-dock__toggle{display:grid;flex:none;place-items:center;width:24px;height:24px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}.mat-status-dock__toggle:hover,.mat-status-dock__toggle:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}.mat-status-dock__eyebrow{font:600 9px/1.2 ui-monospace,SFMono-Regular,monospace;letter-spacing:.12em;color:var(--dsw-alias-label-secondary)}.mat-status-dock__count{font-size:10px;color:var(--dsw-alias-label-secondary)}.mat-status-dock__jobs{display:grid;gap:6px;max-height:220px;overflow:auto}.mat-status-card{padding:8px 9px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-base);font-size:11px}.mat-status-card__topline{min-width:0}.mat-status-card strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}.mat-status-chip{flex:none;padding:2px 6px;border-radius:999px;font-size:9px;text-transform:uppercase;font-weight:700;letter-spacing:.05em}.mat-status-chip--active{color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent)}.mat-status-chip--complete{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent)}.mat-status-chip--attention{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent)}.mat-status-card__metadata{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px 12px;margin:7px 0 0}.mat-status-card__metadata dt{font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:var(--dsw-alias-label-secondary)}.mat-status-card__metadata dd{overflow:hidden;margin:1px 0 0;text-overflow:ellipsis;white-space:nowrap;font:10px/1.35 ui-monospace,SFMono-Regular,monospace}.mat-status-strip{display:flex;align-items:center;gap:7px;width:min(calc(100% - 2 * var(--dsh-composer-side-clearance)),430px);margin:0 auto 8px;padding:6px 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font-size:11px;text-align:left;cursor:pointer}.mat-status-strip:hover,.mat-status-strip:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}.mat-status-strip__label{color:var(--dsw-alias-label-primary)}.mat-status-strip code{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:10px ui-monospace,SFMono-Regular,monospace}.mat-status-strip__count{color:var(--dsw-alias-label-tertiary)}.mat-status-strip__action{margin-left:auto;color:var(--dsw-alias-brand-primary);font-size:10px}.mat-task-details{display:grid;gap:12px;padding:16px;color:var(--dsw-alias-label-primary);font-size:12px}.mat-task-details__header{display:flex;align-items:center;gap:8px}.mat-task-details__metadata{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 14px}.mat-task-details__metadata dt{color:var(--dsw-alias-label-secondary);font-size:10px}.mat-task-details__metadata dd{margin:2px 0 0;font:11px ui-monospace,SFMono-Regular,monospace}.mat-task-details__failure{margin:0;color:var(--dsw-alias-state-error-primary)}.mat-task-details__files{margin:0;color:var(--dsw-alias-label-secondary)}.mat-task-details button{justify-self:start;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer}.mat-toolview{padding:9px 11px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);cursor:pointer}.mat-toolview header{display:flex;align-items:center;gap:9px;margin-bottom:6px}.mat-toolview table{width:100%;border-collapse:collapse;font:11px/1.5 ui-monospace,SFMono-Regular,monospace}.mat-toolview th,.mat-toolview td{padding:3px 6px;border-top:1px solid var(--dsw-alias-border-l2);text-align:left;vertical-align:top}.mat-toolview th{color:var(--dsw-alias-label-secondary);font-weight:500}
.mat-files{display:flex;min-height:0;height:100%;flex-direction:column;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base)}.mat-files__toolbar{display:flex;align-items:center;gap:6px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1)}.mat-files__job{display:flex;min-width:0;flex:1;align-items:center;gap:6px;color:var(--dsw-alias-label-secondary);font-size:11px}.mat-files__job select{min-width:0;flex:1;padding:5px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:inherit}.mat-files__location{display:flex;justify-content:space-between;gap:8px;padding:8px 12px;color:var(--dsw-alias-label-secondary);font-size:11px}.mat-files__location code{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:10px ui-monospace,SFMono-Regular,monospace}.mat-files__primary{padding:0 12px 9px}.mat-files__primary>div:first-child{margin-bottom:5px;color:var(--dsw-alias-label-tertiary);font-size:10px;font-weight:600}.mat-files__chips{display:flex;gap:5px;overflow:auto}.mat-files__chips button{padding:4px 7px;border:1px solid var(--dsw-alias-border-l2);border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:10px;white-space:nowrap;cursor:pointer}.mat-files__tree{min-height:0;flex:1;overflow:auto;padding:3px 6px}.mat-files__row{display:flex;align-items:center;gap:6px;min-height:30px;padding:3px 5px;border-radius:5px;font-size:11px}.mat-files__row:hover,.mat-files__row:focus-within{background:var(--dsw-alias-interactive-bg-hover)}.mat-files__row[aria-selected=true]{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 10%,transparent)}.mat-files__kind{display:grid;flex:none;place-items:center;width:16px}.mat-files__name{min-width:0;flex:1;overflow:hidden;padding:0;border:0;background:transparent;color:inherit;text-align:left;text-overflow:ellipsis;white-space:nowrap;cursor:pointer}.mat-files__origin{flex:none;color:var(--dsw-alias-label-tertiary);font-size:9px}.mat-files__origin--remote{color:var(--dsw-alias-brand-primary)}.mat-files__origin--both{color:var(--dsw-alias-state-success-primary)}.mat-files__pin{padding:2px;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}.mat-files__pin[aria-pressed=true]{color:var(--dsw-alias-brand-primary)}.mat-files__empty,.mat-files__error,.mat-files__status{padding:0 12px;color:var(--dsw-alias-label-secondary);font-size:11px}.mat-files__error{color:var(--dsw-alias-state-error-primary)}.mat-files__status{margin:5px 0 9px}
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
var import_jsx_runtime5 = require("react/jsx-runtime");
var inject = ["slots", "theme", "layout"];
function apply(ctx) {
  ctx.slots.inject("conversation.details.tab", () => ctx.slots.register({
    name: "conversation.details.tab",
    id: "mat-files",
    order: 10,
    label: "\u6587\u4EF6"
  }, () => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(FileManagerPanel, {})));
  ctx.effect(installStyle, "mat-ui: native details stylesheet");
  ctx.slots.inject("conversation.details.tab", () => ctx.slots.register({
    name: "conversation.details.tab",
    id: "mat-task",
    order: 0,
    label: "\u4EFB\u52A1"
  }, (props) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(TaskDetailsPanel, { ...props })));
  ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
    name: "conversation.input.dock",
    id: "mat-status",
    order: 15
  }, (props) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(StatusDock, { ...props })));
  ctx.slots.inject("tool.call.toolview", function* () {
    for (const key of ["mat_partitions", "mat_sbatch", "mat_job_status", "mat_job_watch", "mat_gaussian", "mat_upload", "mat_download"]) {
      yield ctx.slots.register({ name: "tool.call.toolview", key }, MatToolView);
    }
  });
}
return module.exports; } });
