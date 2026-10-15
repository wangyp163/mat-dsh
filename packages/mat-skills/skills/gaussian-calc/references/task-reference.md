# Gaussian calcflow task reference

> CLI 命令：`gaussian-workflow`（可执行文件位置、协议版本与可用 task 由 `SKILL.md` 的环境门禁一次性给出）。本文档是 task 语义与产物参考；安装、环境与 HPC 编排见 `SKILL.md`。

## Current task registry and composition

```text
aea dipole fluorescence freq irc opt polar qst2 qst3 resp sp tddft ts
```

`freq` is the molecular vibrational-frequency task; periodic `phonon` is not supported. The CLI also accepts compositions of registered tasks: `opt+freq` and `opt+sp`. `opt+freq` is a **single-job composition** — one Gaussian route `opt freq`, a flat `{workdir}/opt+freq/` directory (no `01-`/`02-` step subdirectories), one `slurm.sh`, one submission, and unprefixed post properties (`energy`, `converged`, `frequencies_cm-1`, `imaginary_frequency_count`). It must be executed as such; 不得退化为 `-t opt` 加隐藏的 `calculator_kwargs.freq` route hack。Other compositions (e.g. `opt+sp`) remain multi-wave step directories. 若运行时 registry 与本文档不一致，应停止并报告部署版本漂移，而不是静默 fallback。 A composition cannot contain empty, repeated, or unknown components. The public result JSON always retains the original full CLI task string.

Production lifecycle:

```text
pre → run → external job manager executes Slurm job → post
```

- `pre` writes Gaussian input and task-local phase state.
- `run` validates Slurm allocation and renders or updates `slurm.sh`; JSON cluster mode never invokes `g16` locally.
- The external job manager submits and monitors `slurm.sh`.
- `post` validates completed output, then parses and reports structured properties.

The Slurm command is direct `g16 < input > log`; `g16_run.sh` is not required. Gaussian input parallelism comes from `%nprocshared`.

## Public CLI and state

The first-class routing interface is:

```bash
gaussian-workflow -t <task> -p <pre|run|post> -i <structure.xyz> -w <absolute-workdir> [--json <phase.json>]
```

`-t`/`-p`/`-i` remain required with `--json`. `--json` adds only phase-specific parameters. Do not use removed options `--idempotency-id`, `-n/--ncores`, `-m/--memory`, or `-j/--slurm-jobid`.

Cross-phase state is stored at:

```text
<workdir>/<task>/.calcflow-phase.json
```

For a single task, `job.gjf` produces `job.log` beside this state and `slurm.sh`. `opt+freq` is flat like a single task: `<workdir>/opt+freq/` holds one `job.gjf`, `job.log`, and `slurm.sh`. Other compositions use step directories, for example `<workdir>/opt+sp/01-opt/` and `<workdir>/opt+sp/02-sp/`.

## Phase JSON contract

Each phase JSON is a top-level object, never a list or generic routing wrapper.

### pre.json

The calculation object uses `gaussian_workflow.pre.v1` with `ase` dialect:

```json
{
  "schema_version": "gaussian_workflow.pre.v1",
  "resources": {
    "ncores": 32,
    "memory": "64GB"
  },
  "generator": {"dialect": "ase"},
  "ase": {
    "calculator_kwargs": {
      "method": "B3LYP",
      "basis": "6-31G(d)",
      "charge": 0,
      "mult": 1
    }
  },
  "output": {"input_file": "job.gjf"}
}
```

`pre.json` does not contain `task`, `structure`, `id`, or `parameters`; CLI supplies task and structure. `resources` is Gaussian-specific and requires exactly positive `ncores` and positive `memory` with an `MB`, `GB`, or `TB` unit:

```text
resources.ncores → %nprocshared
resources.memory → %mem
```

`charge`/`mult` must match the system electron count (hard-validated at pre since workflow 1.4.2): odd-electron systems (radicals, e.g. F+H2 = 11e) require an even multiplicity (`"mult": 2`), even-electron systems an odd one (closed-shell baseline `"mult": 1`). A mismatch returns `error_detail.code = "VALIDATION_FAILED"` with the suggested mult — fix and re-run pre instead of letting g16 fail with an opaque l101/l301 electron-count error. Do not set `nprocshared` or `mem` inside `ase.calculator_kwargs`. Without JSON, task methods supply defaults. For single-step tasks, JSON `ase.calculator_kwargs` is authoritative for route, method, basis, charge, multiplicity, and checkpoint settings. AEA uses the block as shared configuration but derives mandatory per-step charge/multiplicity and route.

### run.json

```json
{
  "slurm": {
    "partition": "normal",
    "nodes": 1,
    "ntasks_per_node": 32,
    "time": "24:00:00",
    "mem": "64GB"
  }
}
```

Only `slurm` is allowed. Supported Slurm fields are `partition`, `nodes`, `ntasks_per_node`, `time`, `account`, `qos`, `mem`, `output`, and `error`. `run` requires `GAUSSIAN_ENV_SCRIPT` to be a newline-free absolute path.

`run` only renders or updates `slurm.sh` (command is always `g16 < input > log`); it never executes `g16` or submits the job. The number of scripts produced by one `run` decides how many times the agent submits via the job manager:

- single-step task: one `<workdir>/<task>/slurm.sh`;
- composition (`opt+sp`): one per ready step subdir (`01-opt/`, `02-sp/`), 每个就绪子目录各一份;
- `aea`: one per currently-ready subdir (see the two-wave recipe below), 每个就绪子目录各一份.

An existing `slurm.sh` is only re-rendered in its `#SBATCH` directives, never its command line.

Software input resources and scheduler allocation are separate layers. When both values are present, the workflow validates:

```text
resources.ncores <= slurm.ntasks_per_node
resources.memory <= slurm.mem
```

### post.json

```json
{}
```

`post` reads the prior phase state and output. Every phase emits a JSON object containing at least `software`, `task`, `phase`, `status`, `files`, `slurm`, `properties`, and `error`. Errors preserve the CLI task and clear `files`/`images`.

## Single-step tasks

| task | default behavior | post result |
|---|---|---|
| `sp` | single point | final SCF energy |
| `opt` | `opt` | final energy, `g16_initial.xyz`, `g16_optimized.xyz` |
| `freq` | `freq` | `frequencies_cm-1`, `imaginary_frequency_count`, thermochemistry keys (`temperature_k` … `sum_electronic_free_energy_hartree`, workflow 1.6.3+) |
| `dipole` | single-point semantics | final energy/convergence |
| `polar` | `polar` route | final energy/convergence |
| `tddft` | `td(nstates=20)` | final energy/convergence |
| `fluorescence` | B3LYP/aug-cc-pVDZ, `td(nstates=10)` | S1 energy/wavelength/oscillator strength and Multiwfn spectrum files |
| `resp` | B3LYP/def2TZVP, solvent/dispersion, MK for light elements | final energy and RESP charges |
| `ts` | `opt(TS,CalcFC,NoEigenTest) freq` | `frequencies_cm-1`, `imaginary_frequency_count`, thermochemistry keys (1.6.3+), `g16_optimized.xyz`; requires a reasonable TS guess |
| `qst2` | `opt(QST2,CalcFC) freq` | same as `ts`; 2-frame input (reactant + product, identical atom ordering) |
| `qst3` | `opt(QST3,CalcFC) freq` | same as `ts`; 3-frame input (reactant + product + TS guess) |
| `irc` | `irc(CalcFC,MaxPoints=30,StepSize=10)` (MaxPoints 30 since workflow 1.4.2, was 5; tune via full-value route override, e.g. `["CalcFC","MaxPoints=50","StepSize=5"]` when l123 Bulirsch-Stoer integration diverges on small linear systems) | final energy/convergence, `irc_point_count`; plots `irc_profile` (total-energy curve along the IRC, signed reaction coordinate, TS highlighted) and `reaction_path` (R→TS→P ladder in kcal/mol from the IRC branch ends and point 0); requires valid TS geometry |

## freq and opt+freq

`freq` parses every Gaussian `Frequencies --` block and reports the flattened values in cm⁻¹. Negative values contribute to `imaginary_frequency_count`. For a minimum search, use the sequential composition `opt+freq` and apply scientific acceptance such as:

```json
{
  "imaginary_frequency_count": {"equals": 0}
}
```

A failed acceptance rule keeps execution `completed` but marks the workflow `needs_review`; it is not an execution failure.

## Transition-state search (ts / qst2 / qst3)

The three transition-state tasks take **all geometries from one multi-frame xyz file** (`-i` is still a single file; frame order = Gaussian molecule-section order; atom count and element ordering must match frame-by-frame):

| task | frames | route | frame semantics |
|---|---|---|---|
| `ts` | exactly 1 | `opt(TS,CalcFC,NoEigenTest) freq` | TS initial guess |
| `qst2` | exactly 2 | `opt(QST2,CalcFC) freq` | reactant, product (both pre-optimized) |
| `qst3` | exactly 3 | `opt(QST3,CalcFC) freq` | reactant, product, TS guess |

Element symbols in the xyz symbol column must be plain (`H`/`C`/`O`...); indexed labels (`H1`/`O2`) are rejected at pre with `VALIDATION_FAILED` (workflow 1.4.2+; earlier deployments raise a bare `KeyError('H1')`). A wrong frame count or mismatched element ordering fails `pre` with a structured error (no silent truncation). A multi-frame file fed to a single-structure task (e.g. `opt`) uses frame 1. All molecule sections share one `charge`/`mult`. Post reports `frequencies_cm-1` and `imaginary_frequency_count` and exports `g16_optimized.xyz`; first-order saddle confirmation is expressed as acceptance:

```json
{
  "imaginary_frequency_count": {"equals": 1}
}
```

TS→IRC linkage uses the composition `ts+irc` — the IRC step consumes the **optimized** TS geometry, not the initial guess (`qst2+irc` / `qst3+irc` chain the same way). The IRC step reports `irc_point_count` and produces the `irc_profile` and `reaction_path` plots.

## fluorescence

Gaussian output must contain an `Excited State 1` record. Post reports:

```text
fluorescence_energy_ev
wavelength_nm
oscillator_strength
```

The post stage invokes Multiwfn with its fluorescence menu and expects `spectrum_curve.txt` and `spectrum_line.txt` (when that Multiwfn build emits them). Missing Multiwfn or a non-zero exit is an error, not a successful empty spectrum.

## resp

Default route uses `B3LYP/def2TZVP`, `em=gd3bj`, `scrf(solvent=water)`, and `pop=MK` for systems whose maximum atomic number is below 19. The input must produce a checkpoint (default `g16.chk`). Post runs:

```text
formchk g16.chk g16.fchk
Multiwfn g16.fchk ... RESP menu ...
parse .chg
write *_resp.chg
```

The number of parsed charges must equal the number of atoms. Missing checkpoint, failed `formchk`, failed Multiwfn, or malformed charge output raises an error.

## aea

AEA is a four-step, resumable workflow:

```text
01-neutral-opt  charge=0  mult=1  B3LYP/def2SVP  opt em=gd3bj
02-neutral-scf  charge=0  mult=1  M062X/def2TZVP  scf=tight
03-anion-opt    charge=-1 mult=2  B3LYP/def2SVP  opt em=gd3bj
04-anion-scf    charge=-1 mult=2  M062X/def2TZVP  scf=tight
```

Directory layout:

```text
aea/
├── 01-neutral-opt/
├── 02-neutral-scf/
├── 03-anion-opt/
├── 04-anion-scf/
└── aea_result.txt
```

A normal production run uses two submission waves:

1. `pre` then `run` writes 01 and 03 inputs/scripts; submit and complete both jobs.
2. Run `pre` then `run` again. It reads optimized geometries and writes 02 and 04 inputs/scripts; submit and complete both jobs.
3. Run `post`.

`AEA = E_neutral - E_anion`; eV is `AEA_Eh * 27.2114`. AEA reuses the same pre JSON shape, including top-level Gaussian `resources`; it overrides charge/multiplicity (`0/1` neutral, `-1/2` anion) and opt/SCF phase routes for derived inputs. If JSON omits method/basis, the per-phase recipe defaults above remain in force.
