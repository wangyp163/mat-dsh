#!/usr/bin/env bash
set -uo pipefail

# abacus-calc 环境门禁（镜像 gaussian-env-gate.v2 语义，schema abacus-env-gate.v1）。
# 与 gaussian 的差异：无独立 runtime env（abacus 二进制与 workflow 同 env）、
# 必须检测 hpcx OPAL_PREFIX 毒丸（demo 集群 profile 会污染 conda OpenMPI）。

skill_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1090
. "${SKILL_ENV_PROFILE:-$skill_dir/scripts/env_profile.sh}"

WORKFLOW_ROOT="${1:-$WORKFLOW_ROOT_DEFAULT}"
WORKFLOW_ENV="$WORKFLOW_ROOT/env.sh"
PYTHON_BIN="$WORKFLOW_ROOT/$PYTHON_BIN_SUBDIR/python"
CLI="$WORKFLOW_ROOT/$PYTHON_BIN_SUBDIR/abacus-workflow"
REQUIRED_TASKS=(relax jdos shg shift bcd anc ahc wl mei chern surface_states hseband phthermo bc eos)

protocol=unknown
module_file=""
tasks_json='[]'
errors=()

json_array() { printf '%s\n' "$@" | python3 -c 'import json,sys; print(json.dumps([x.strip() for x in sys.stdin if x.strip()], separators=(",", ":")))'; }
required_json=$(json_array "${REQUIRED_TASKS[@]}")

[ -f "$WORKFLOW_ENV" ] || errors+=(workflow_env_missing)
[ -x "$PYTHON_BIN" ] || errors+=(workflow_python_missing)
[ -x "$CLI" ] || errors+=(workflow_cli_missing)

if [ -x "$PYTHON_BIN" ]; then
  probe=$(
    "$PYTHON_BIN" -c '
import inspect, json
import abacus_workflow
import abacus_workflow.tasks  # noqa: F401  触发注册表加载
import abacus_workflow.phase_json as phase_json
from calcflow.task.registry import list_tasks
print(json.dumps({
    "protocol": "new" if "顶层必须是对象" in inspect.getsource(phase_json.load_payload) else "old",
    "module": abacus_workflow.__file__,
    "tasks": list_tasks("abacus"),
}, separators=(",", ":")))
' 2>/dev/null
  ) || {
    probe='{}'
    errors+=(workflow_import_failed)
  }
  protocol=$(printf '%s' "$probe" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("protocol","unknown"))' 2>/dev/null) || protocol=unknown
  module_file=$(printf '%s' "$probe" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("module",""))' 2>/dev/null) || module_file=
  tasks_json=$(printf '%s' "$probe" | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin).get("tasks",[]), separators=(",", ":")))' 2>/dev/null) || tasks_json='[]'
fi

[ "$protocol" = new ] || errors+=(protocol_not_new)
missing_json=$(python3 - "$tasks_json" "${REQUIRED_TASKS[@]}" <<'PY'
import json, sys
available = set(json.loads(sys.argv[1]))
required = sys.argv[2:]
print(json.dumps([x for x in required if x not in available], separators=(",", ":")))
PY
)
[ "$missing_json" = '[]' ] || errors+=(required_tasks_missing)

# abacus 运行时：二进制与 mpirun 都在 workflow env 内；同时验 OPAL_PREFIX 毒丸
# （demo 集群 profile 注入 hpcx 前缀会让 conda OMPI 加载错配组件——env.sh 已
# 内置清毒，这里验证清毒后的 env 真的能跑 mpirun）。
abacus_check=""
if [ -f "$WORKFLOW_ENV" ]; then
  # activate 脚本不耐 set -u（ nounset 下 source 中断、PATH 不生效）——局部放开。
  abacus_check=$(
    bash -c "set +u; . '$WORKFLOW_ENV' >/dev/null 2>&1 && command -v abacus >/dev/null 2>&1 && mpirun --version 2>&1 | head -1" || true
  )
fi
case "$abacus_check" in
  *Open" "MPI*|*"Open MPI"*) : ;;
  "") errors+=(abacus_runtime_missing) ;;
  *) errors+=(abacus_runtime_missing) ;;
esac

# 版本锚：部署侧 VERSION 与 skill 侧期望比对（wheel 元数据版本不可信）。
deployed_version=""
[ -f "$WORKFLOW_ROOT/VERSION" ] && deployed_version=$(head -n1 "$WORKFLOW_ROOT/VERSION" | tr -d '[:space:]')
expected_version="${WORKFLOW_VERSION:-}"
if [ -n "$expected_version" ]; then
  if [ -z "$deployed_version" ]; then
    errors+=(version_unpinned)
  elif [ "$deployed_version" != "$expected_version" ]; then
    errors+=(version_mismatch)
  fi
fi

ok=false
[ "${#errors[@]}" -eq 0 ] && ok=true
errors_json=$(json_array ${errors[@]+"${errors[@]}"})
task_count=$(printf '%s' "$tasks_json" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')

printf '{"schema":"abacus-env-gate.v1","ok":%s,"workflow":"%s","python":"%s","cli":"%s","module":"%s","protocol":"%s","deployed_version":"%s","expected_version":"%s","newer_version":"","required_tasks":%s,"tasks":%s,"missing_tasks":%s,"task_count":%s,"runtime":"%s","errors":%s}\n' \
  "$ok" "$WORKFLOW_ROOT" "$PYTHON_BIN" "$CLI" "$module_file" "$protocol" "$deployed_version" "$expected_version" "$required_json" "$tasks_json" "$missing_json" "$task_count" "$WORKFLOW_ENV" "$errors_json"

[ "$ok" = true ]
