window.__ModuleLoader__.load({ id: "~/mat-harness/mat-dsh/packages/mat-ui", factory: (require) => { var module = { exports: {} }; var exports = module.exports;
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
function statusTone(job) {
  if (job.phase === "settled") return job.outcomeStatus === "completed" ? "complete" : "attention";
  return "active";
}
function elapsed(job) {
  const seconds = Math.max(0, Math.floor((Date.now() - job.startedAt) / 1e3));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
function StatusDock() {
  const [jobs, setJobs] = (0, import_react.useState)([]);
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
  if (jobs.length === 0) return /* @__PURE__ */ React.createElement("div", { className: "mat-status-dock mat-status-dock--empty" }, "No active HPC jobs");
  return /* @__PURE__ */ React.createElement("section", { className: "mat-status-dock", "aria-label": "HPC job status" }, /* @__PURE__ */ React.createElement("header", { className: "mat-status-dock__header" }, /* @__PURE__ */ React.createElement("span", { className: "mat-status-dock__eyebrow" }, "COMPUTATIONAL MONITOR"), /* @__PURE__ */ React.createElement("span", { className: "mat-status-dock__count" }, jobs.length, " tracked")), /* @__PURE__ */ React.createElement("div", { className: "mat-status-dock__jobs" }, jobs.map((job) => /* @__PURE__ */ React.createElement("article", { className: "mat-status-card", key: job.jobId }, /* @__PURE__ */ React.createElement("div", { className: "mat-status-card__topline" }, /* @__PURE__ */ React.createElement("span", { className: `mat-status-chip mat-status-chip--${statusTone(job)}` }, job.phase), /* @__PURE__ */ React.createElement("code", null, job.jobId), /* @__PURE__ */ React.createElement("span", { className: "mat-status-card__elapsed" }, elapsed(job))), /* @__PURE__ */ React.createElement("strong", null, job.label), /* @__PURE__ */ React.createElement("div", { className: "mat-status-card__meta" }, "cluster ", job.clusterId, job.task ? ` \xB7 ${job.task}` : ""), job.slurm?.length ? /* @__PURE__ */ React.createElement("table", { className: "mat-status-table" }, /* @__PURE__ */ React.createElement("tbody", null, job.slurm.map((s) => /* @__PURE__ */ React.createElement("tr", { key: s.id }, /* @__PURE__ */ React.createElement("th", null, s.id), /* @__PURE__ */ React.createElement("td", null, s.state), /* @__PURE__ */ React.createElement("td", null, s.elapsedSeconds ?? "\u2014", "s"), /* @__PURE__ */ React.createElement("td", null, s.exitCode ?? "\u2014"))))) : null, job.detail ? /* @__PURE__ */ React.createElement("p", { className: "mat-status-card__detail" }, job.detail) : null, job.properties ? /* @__PURE__ */ React.createElement("div", { className: "mat-status-card__properties" }, Object.entries(job.properties).slice(0, 3).map(([key, value]) => /* @__PURE__ */ React.createElement("span", { key }, /* @__PURE__ */ React.createElement("b", null, key), " ", String(value)))) : null))));
}

// packages/mat-ui/src/client/ResultTail.tsx
var import_react2 = require("react");
function ResultTail() {
  const [job, setJob] = (0, import_react2.useState)();
  (0, import_react2.useEffect)(() => {
    let live = true;
    fetch("/mat-status/jobs", { cache: "no-store" }).then((r) => r.ok ? r.json() : { jobs: [] }).then((p) => {
      if (live) setJob(p.jobs?.filter((j) => j.phase === "settled").at(-1));
    }).catch(() => {
    });
    return () => {
      live = false;
    };
  }, []);
  if (!job) return null;
  return /* @__PURE__ */ React.createElement("aside", { className: "mat-result-tail" }, /* @__PURE__ */ React.createElement("span", { className: "mat-status-dock__eyebrow" }, "LATEST COMPUTATION"), /* @__PURE__ */ React.createElement("strong", null, job.label), job.detail ? /* @__PURE__ */ React.createElement("p", null, job.detail) : null, job.properties ? /* @__PURE__ */ React.createElement("div", { className: "mat-status-card__properties" }, Object.entries(job.properties).slice(0, 4).map(([k, v]) => /* @__PURE__ */ React.createElement("span", { key: k }, /* @__PURE__ */ React.createElement("b", null, k), " ", String(v)))) : null, job.files?.length ? /* @__PURE__ */ React.createElement("small", null, "files \xB7 ", job.files.join(", ")) : null);
}

// packages/mat-ui/src/client/MatToolView.tsx
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
  return /* @__PURE__ */ React.createElement("article", { className: "mat-toolview", onClick: inspect, role: inspect ? "button" : void 0 }, /* @__PURE__ */ React.createElement("header", null, /* @__PURE__ */ React.createElement("span", { className: "mat-status-dock__eyebrow" }, "MAT"), /* @__PURE__ */ React.createElement("strong", null, toolName.replace("mat_", "").replaceAll("_", " "))), /* @__PURE__ */ React.createElement("table", null, /* @__PURE__ */ React.createElement("tbody", null, table.slice(0, 12).map((cells, i) => /* @__PURE__ */ React.createElement("tr", { key: i }, cells.map((cell, j) => j === 0 ? /* @__PURE__ */ React.createElement("th", { key: j }, cell) : /* @__PURE__ */ React.createElement("td", { key: j }, cell)))))), table.length > 12 ? /* @__PURE__ */ React.createElement("small", null, "+ ", table.length - 12, " rows") : null);
}

// packages/mat-ui/src/client/OutputVisibilityAction.tsx
var import_react3 = require("react");
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// packages/mat-ui/src/client/output-visibility.ts
var OUTPUT_VISIBILITY_KEY = "mat.output-visibility.v1";
var DEFAULT_OUTPUT_VISIBILITY = Object.freeze({ thinking: "summary", tools: "summary" });
function isMode(value) {
  return value === "hidden" || value === "summary" || value === "expanded";
}
function parseOutputVisibility(raw) {
  if (raw === null) return { ...DEFAULT_OUTPUT_VISIBILITY };
  try {
    const value = JSON.parse(raw);
    if (!isMode(value.thinking) || !isMode(value.tools)) return { ...DEFAULT_OUTPUT_VISIBILITY };
    return { thinking: value.thinking, tools: value.tools };
  } catch {
    return { ...DEFAULT_OUTPUT_VISIBILITY };
  }
}
function loadOutputVisibility(storage = localStorage) {
  try {
    return parseOutputVisibility(storage.getItem(OUTPUT_VISIBILITY_KEY));
  } catch {
    return { ...DEFAULT_OUTPUT_VISIBILITY };
  }
}
function saveOutputVisibility(first, second) {
  const state = "thinking" in first ? first : second;
  const storage = "setItem" in first ? first : second;
  try {
    ;
    (storage ?? localStorage).setItem(OUTPUT_VISIBILITY_KEY, JSON.stringify(state));
  } catch {
  }
}
var THINKING_ROWS = '[data-variant="think"] [data-disclosure-row][aria-expanded]';
var TOOL_ROWS = "[data-chat-call-id] [data-disclosure-row][aria-expanded]";
function setExpanded(root, selector, expanded) {
  for (const row of root.querySelectorAll(selector)) {
    if (row.getAttribute("aria-expanded") === "true" !== expanded) row.click();
  }
}
function applyOutputVisibility(root, state) {
  root.setAttribute("data-mat-thinking", state.thinking);
  root.setAttribute("data-mat-tools", state.tools);
  setExpanded(root, THINKING_ROWS, state.thinking === "expanded");
  setExpanded(root, TOOL_ROWS, state.tools === "expanded");
}
function observeOutputVisibility(root, getState) {
  const observer = new MutationObserver(() => {
    applyOutputVisibility(root, getState());
  });
  observer.observe(root, { childList: true, subtree: true });
  return () => {
    observer.disconnect();
  };
}

// packages/mat-ui/src/client/OutputVisibilityAction.tsx
var MODES = [
  { value: "hidden", label: "\u9690\u85CF" },
  { value: "summary", label: "\u6458\u8981" },
  { value: "expanded", label: "\u5C55\u5F00" }
];
function conversationRoot(node) {
  return node?.closest("[data-phase]") ?? null;
}
function OutputVisibilityAction(_props) {
  const rootRef = (0, import_react3.useRef)(null);
  const triggerRef = (0, import_react3.useRef)(null);
  const stateRef = (0, import_react3.useRef)(DEFAULT_OUTPUT_VISIBILITY);
  const [state, setState] = (0, import_react3.useState)(() => loadOutputVisibility());
  const [open, setOpen] = (0, import_react3.useState)(false);
  stateRef.current = state;
  (0, import_dsh_client_ui_primitives.useDismissOnOutsidePointer)(rootRef, open, setOpen);
  (0, import_react3.useEffect)(() => {
    const root = conversationRoot(rootRef.current);
    if (root === null) return;
    applyOutputVisibility(root, stateRef.current);
    return observeOutputVisibility(root, () => stateRef.current);
  }, []);
  const update = (next) => {
    stateRef.current = next;
    setState(next);
    saveOutputVisibility(next);
    const root = conversationRoot(rootRef.current);
    if (root !== null) applyOutputVisibility(root, next);
  };
  const setMode = (scope, mode) => {
    update({ ...stateRef.current, [scope]: mode });
  };
  const onKeyDown = (event) => {
    if (event.key !== "Escape" || !open) return;
    event.preventDefault();
    setOpen(false);
    triggerRef.current?.focus();
  };
  return /* @__PURE__ */ React.createElement("div", { ref: rootRef, className: "mat-output-manager", onKeyDown }, /* @__PURE__ */ React.createElement(
    "button",
    {
      ref: triggerRef,
      type: "button",
      className: "mat-output-manager__trigger",
      "aria-label": "\u7BA1\u7406\u63A8\u7406\u4E0E\u5DE5\u5177\u8C03\u7528\u663E\u793A",
      "aria-expanded": open,
      onClick: () => {
        setOpen((value) => !value);
      }
    },
    /* @__PURE__ */ React.createElement(import_dsh_client_ui_primitives.IconSettingsOutline16, { size: 14 }),
    /* @__PURE__ */ React.createElement("span", null, "\u8F93\u51FA")
  ), open ? /* @__PURE__ */ React.createElement("div", { className: "mat-output-manager__menu", role: "dialog", "aria-label": "\u8F93\u51FA\u663E\u793A\u8BBE\u7F6E" }, /* @__PURE__ */ React.createElement("header", null, /* @__PURE__ */ React.createElement("span", { className: "mat-status-dock__eyebrow" }, "OUTPUT DISPLAY"), /* @__PURE__ */ React.createElement("strong", null, "\u4FE1\u606F\u5BC6\u5EA6")), [["thinking", "\u63A8\u7406"], ["tools", "\u5DE5\u5177\u8C03\u7528"]].map(([scope, label]) => /* @__PURE__ */ React.createElement("section", { key: scope }, /* @__PURE__ */ React.createElement("span", { className: "mat-output-manager__label" }, label), /* @__PURE__ */ React.createElement("div", { className: "mat-output-manager__segments", role: "group", "aria-label": `${label}\u663E\u793A\u65B9\u5F0F` }, MODES.map((mode) => /* @__PURE__ */ React.createElement(
    "button",
    {
      key: mode.value,
      type: "button",
      "aria-pressed": state[scope] === mode.value,
      onClick: () => {
        setMode(scope, mode.value);
      }
    },
    mode.label
  ))))), /* @__PURE__ */ React.createElement("footer", null, /* @__PURE__ */ React.createElement("button", { type: "button", onClick: () => {
    update({ ...DEFAULT_OUTPUT_VISIBILITY });
  } }, "\u6574\u6D01\u6A21\u5F0F"), /* @__PURE__ */ React.createElement("button", { type: "button", onClick: () => {
    update({ thinking: "expanded", tools: "expanded" });
  } }, "\u5168\u90E8\u5C55\u5F00"))) : null);
}

// packages/mat-ui/src/client/style.ts
var style = `
.mat-status-dock{margin:0 10px 8px;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:linear-gradient(135deg,var(--dsw-alias-bg-base),color-mix(in srgb,var(--dsw-alias-brand-primary) 4%,var(--dsw-alias-bg-base)));box-shadow:0 8px 24px color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent);font-variant-numeric:tabular-nums}.mat-status-dock--empty{color:var(--dsw-alias-label-secondary);font-size:12px;text-align:center;padding:8px}.mat-status-dock__header,.mat-status-card__topline{display:flex;align-items:center;gap:8px}.mat-status-dock__header{justify-content:space-between;margin-bottom:10px}.mat-status-dock__eyebrow{font:600 10px/1.2 ui-monospace,SFMono-Regular,monospace;letter-spacing:.14em;color:var(--dsw-alias-label-secondary)}.mat-status-dock__count,.mat-status-card__meta,.mat-status-card__elapsed{font-size:11px;color:var(--dsw-alias-label-secondary)}.mat-status-dock__jobs{display:grid;gap:8px;max-height:260px;overflow:auto}.mat-status-card{padding:10px 11px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:color-mix(in srgb,var(--dsw-alias-bg-base) 94%,var(--dsw-alias-brand-primary));font-size:12px}.mat-status-card strong{display:block;margin:7px 0 2px;font-family:Georgia,'Times New Roman',serif;font-size:14px;letter-spacing:.01em}.mat-status-card__topline code{font-size:10px;color:var(--dsw-alias-label-secondary)}.mat-status-card__elapsed{margin-left:auto}.mat-status-chip{padding:2px 7px;border-radius:999px;font-size:10px;text-transform:uppercase;font-weight:700;letter-spacing:.06em}.mat-status-chip--active{color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent)}.mat-status-chip--complete{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent)}.mat-status-chip--attention{color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent)}.mat-status-table{width:100%;margin-top:8px;border-collapse:collapse;font:11px/1.45 ui-monospace,SFMono-Regular,monospace}.mat-status-table th,.mat-status-table td{padding:3px 5px;border-top:1px solid var(--dsw-alias-border-l2);text-align:left}.mat-status-table td:nth-child(n+3){text-align:right}.mat-status-card__detail{margin:7px 0 0;color:var(--dsw-alias-label-secondary)}.mat-status-card__properties{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px}.mat-status-card__properties span{padding:3px 6px;border-radius:5px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 7%,transparent);font-size:10px}
[data-mat-thinking="hidden"] [data-variant="think"]{display:none!important}[data-mat-tools="hidden"] [data-chat-call-id]{display:none!important}.mat-output-manager{position:relative}.mat-output-manager__trigger{display:flex;align-items:center;gap:5px;height:26px;padding:0 8px;border:1px solid transparent;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:500 11px/1 system-ui,sans-serif;cursor:pointer}.mat-output-manager__trigger:hover,.mat-output-manager__trigger[aria-expanded="true"]{border-color:var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}.mat-output-manager__menu{position:absolute;z-index:40;top:32px;left:0;width:264px;padding:13px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-overlay);box-shadow:0 14px 36px color-mix(in srgb,var(--dsw-alias-label-primary) 16%,transparent);font-size:12px}.mat-output-manager__menu header{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:12px}.mat-output-manager__menu header strong{font-family:Georgia,'Times New Roman',serif;font-size:14px}.mat-output-manager__menu section{display:grid;grid-template-columns:58px 1fr;align-items:center;gap:8px;margin:8px 0}.mat-output-manager__label{color:var(--dsw-alias-label-secondary);font-size:11px}.mat-output-manager__segments{display:grid;grid-template-columns:repeat(3,1fr);padding:2px;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-base)}.mat-output-manager__segments button,.mat-output-manager__menu footer button{border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);font:500 11px/1.2 system-ui,sans-serif;cursor:pointer}.mat-output-manager__segments button{padding:6px 4px}.mat-output-manager__segments button[aria-pressed="true"]{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 13%,var(--dsw-alias-bg-base));color:var(--dsw-alias-brand-primary);font-weight:650}.mat-output-manager__menu footer{display:flex;justify-content:flex-end;gap:7px;margin-top:12px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l2)}.mat-output-manager__menu footer button{padding:6px 8px;border:1px solid var(--dsw-alias-border-l2)}.mat-output-manager__menu button:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l1)}.mat-result-tail{margin:7px 36px 10px;padding:10px 12px;border-left:3px solid var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 5%,transparent);font-size:12px}.mat-result-tail strong{display:block;margin:4px 0;font-family:Georgia,'Times New Roman',serif}.mat-result-tail p{margin:2px 0;color:var(--dsw-alias-label-secondary)}.mat-result-tail small{display:block;margin-top:6px;color:var(--dsw-alias-label-secondary)}.mat-toolview{padding:9px 11px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);cursor:pointer}.mat-toolview header{display:flex;align-items:center;gap:9px;margin-bottom:6px}.mat-toolview header strong{text-transform:capitalize;font-family:Georgia,'Times New Roman',serif}.mat-toolview table{width:100%;border-collapse:collapse;font:11px/1.5 ui-monospace,SFMono-Regular,monospace}.mat-toolview th,.mat-toolview td{padding:3px 6px;border-top:1px solid var(--dsw-alias-border-l2);text-align:left;vertical-align:top}.mat-toolview th{color:var(--dsw-alias-label-secondary);font-weight:500}.mat-toolview small{color:var(--dsw-alias-label-secondary)}
`;
function installStyle() {
  const node = document.createElement("style");
  node.dataset.matUi = "academic";
  node.textContent = style;
  document.head.append(node);
  return () => {
    node.remove();
  };
}

// packages/mat-ui/src/client/index.tsx
var inject = ["slots", "theme"];
function apply(ctx) {
  ctx.effect(installStyle, "mat-ui: academic stylesheet");
  ctx.effect(() => ctx.theme.overrideTokens("mat-ui: academic refinement", {
    "--dsw-alias-label-primary": { light: "#17263a", dark: "#e6edf7" },
    "--dsw-alias-brand-primary": { light: "#35658f", dark: "#8eb9df" },
    "--dsw-alias-bg-base": { light: "#f7f9fc", dark: "#111823" }
  }), "mat-ui: academic theme tokens");
  ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
    name: "conversation.session.header.actions",
    id: "mat-output-visibility",
    order: 30
  }, OutputVisibilityAction));
  ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
    name: "conversation.input.dock",
    id: "mat-status",
    order: 15
  }, StatusDock));
  ctx.slots.inject("conversation.chat.turnTail", () => ctx.slots.register({
    name: "conversation.chat.turnTail"
  }, ResultTail));
  ctx.slots.inject("tool.call.toolview", function* () {
    for (const key of ["mat_partitions", "mat_sbatch", "mat_job_status", "mat_job_watch", "mat_gaussian", "mat_upload", "mat_download"]) {
      yield ctx.slots.register({ name: "tool.call.toolview", key }, MatToolView);
    }
  });
}
return module.exports; } });
