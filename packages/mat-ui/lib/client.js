window.__ModuleLoader__.load({ id: "~/mat-harness/mat-dsh/packages/mat-ui", factory: (require) => {
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

// packages/mat-ui/src/client/style.ts
var style = `
.mat-status-dock{margin:0 10px 8px;padding:12px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:linear-gradient(135deg,var(--dsw-alias-bg-base),color-mix(in srgb,var(--dsw-alias-brand-primary) 4%,var(--dsw-alias-bg-base)));box-shadow:0 8px 24px color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent);font-variant-numeric:tabular-nums}.mat-status-dock--empty{color:var(--dsw-alias-label-secondary);font-size:12px;text-align:center;padding:8px}.mat-status-dock__header,.mat-status-card__topline{display:flex;align-items:center;gap:8px}.mat-status-dock__header{justify-content:space-between;margin-bottom:10px}.mat-status-dock__eyebrow{font:600 10px/1.2 ui-monospace,SFMono-Regular,monospace;letter-spacing:.14em;color:var(--dsw-alias-label-secondary)}.mat-status-dock__count,.mat-status-card__meta,.mat-status-card__elapsed{font-size:11px;color:var(--dsw-alias-label-secondary)}.mat-status-dock__jobs{display:grid;gap:8px;max-height:260px;overflow:auto}.mat-status-card{padding:10px 11px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:color-mix(in srgb,var(--dsw-alias-bg-base) 94%,var(--dsw-alias-brand-primary));font-size:12px}.mat-status-card strong{display:block;margin:7px 0 2px;font-family:Georgia,'Times New Roman',serif;font-size:14px;letter-spacing:.01em}.mat-status-card__topline code{font-size:10px;color:var(--dsw-alias-label-secondary)}.mat-status-card__elapsed{margin-left:auto}.mat-status-chip{padding:2px 7px;border-radius:999px;font-size:10px;text-transform:uppercase;font-weight:700;letter-spacing:.06em}.mat-status-chip--active{color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent)}.mat-status-chip--complete{color:var(--dsw-alias-state-success);background:color-mix(in srgb,var(--dsw-alias-state-success) 12%,transparent)}.mat-status-chip--attention{color:var(--dsw-alias-state-error);background:color-mix(in srgb,var(--dsw-alias-state-error) 12%,transparent)}.mat-status-table{width:100%;margin-top:8px;border-collapse:collapse;font:11px/1.45 ui-monospace,SFMono-Regular,monospace}.mat-status-table th,.mat-status-table td{padding:3px 5px;border-top:1px solid var(--dsw-alias-border-l2);text-align:left}.mat-status-table td:nth-child(n+3){text-align:right}.mat-status-card__detail{margin:7px 0 0;color:var(--dsw-alias-label-secondary)}.mat-status-card__properties{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px}.mat-status-card__properties span{padding:3px 6px;border-radius:5px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 7%,transparent);font-size:10px}
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
var inject = ["slots"];
function apply(ctx) {
  ctx.effect(installStyle, "mat-ui: academic stylesheet");
  ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
    name: "conversation.input.dock",
    id: "mat-status",
    order: 15
  }, StatusDock));
}
return module.exports; } });
