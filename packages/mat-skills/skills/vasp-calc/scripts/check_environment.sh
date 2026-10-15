#!/usr/bin/env bash
# vasp-calc 环境门禁 v2（家目录部署真探代；字段集与 gaussian-env-gate.v2 同构，
# schema vasp-env-gate.v2）。
#
# v1（sif 时代）只做存在性探测；v2 的 workflow 侧可在登录节点**真探**——
# python import 拿 matstream 版本 + 任务注册表（对齐 gaussian 门禁的探测面）。
# vasp 侧探测边界不变：登录沙箱非交互 shell 无 module 命令，env.sh 的 module 行
# 有守卫，半 source 后 PATH 可验；vasp_std 的 MPI 运行时由作业内首跑 fail-fast
# 兜底（作业 122895612 已实证）。零集群副作用：只读探测。
set -uo pipefail

skill_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# SKILL_ENV_PROFILE 仅供测试注入 override。
# shellcheck disable=SC1090
. "${SKILL_ENV_PROFILE:-$skill_dir/scripts/env_profile.sh}"

WORKFLOW_ROOT="${1:-$WORKFLOW_ROOT_DEFAULT}"
VASP_HOME="${2:-$VASP_HOME_DEFAULT}"
WORKFLOW_ENV="$WORKFLOW_ROOT/env.sh"
WORKFLOW_PYTHON="$WORKFLOW_ROOT/bin/python"
VASP_STD="$VASP_HOME/app/bin/vasp_std"
REQUIRED_TASKS=(relax scf band relaxdftu scfdftu banddftu unfold phonon magmom born pdos spincharge)

errors=()
protocol=unknown
deployed_version=""
tasks_json='[]'
missing_json='[]'

json_array() { printf '%s\n' "$@" | python3 -c 'import json,sys; print(json.dumps([x.strip() for x in sys.stdin if x.strip()], separators=(",", ":")))'; }
required_json=$(json_array "${REQUIRED_TASKS[@]}")

[ -f "$WORKFLOW_ENV" ] || errors+=(workflow_env_missing)
[ -x "$WORKFLOW_PYTHON" ] || errors+=(workflow_python_missing)

if [ -x "$WORKFLOW_PYTHON" ]; then
  # 真探：import matstream 拿版本 + 任务注册表（task/__init__ 的 __all__ 小写化，
  # 与 CLI task_map 同源）。import 失败点名 workflow_import_failed。
  probe=$("$WORKFLOW_PYTHON" -c '
import json
import matstream
from matstream import task
print(json.dumps({"version": matstream.__version__, "tasks": sorted(t.lower() for t in task.__all__)}, separators=(",", ":")))
' 2>/dev/null) || { probe='{}'; errors+=(workflow_import_failed); }
  deployed_version=$(printf '%s' "$probe" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("version",""))' 2>/dev/null) || deployed_version=""
  tasks_json=$(printf '%s' "$probe" | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin).get("tasks",[]), separators=(",", ":")))' 2>/dev/null) || tasks_json='[]'
  protocol=new
fi

missing_json=$(python3 - "$tasks_json" "${REQUIRED_TASKS[@]}" <<'PY'
import json, sys
available = set(json.loads(sys.argv[1]))
required = sys.argv[2:]
print(json.dumps([x for x in required if x not in available], separators=(",", ":")))
PY
)
[ "$missing_json" = '[]' ] || errors+=(required_tasks_missing)

# vasp 侧：env.sh 在场 + vasp_std 可执行 + VERSION 首词比锚。
vasp_version=""
[ -f "$VASP_HOME/scripts/env.sh" ] || errors+=(vasp_env_missing)
if [ -x "$VASP_STD" ]; then
  [ -f "$VASP_HOME/VERSION" ] && vasp_version=$(head -n1 "$VASP_HOME/VERSION" | awk '{print $1}')
  if [ "$vasp_version" != "$VASP_VERSION_ANCHOR" ]; then
    errors+=(vasp_version_mismatch)
  fi
else
  errors+=(vasp_std_missing)
fi

# workflow 版本比锚（VERSION 文件与 import 结果都算数——以 import 为权威，
# 文件漂移单独点名）。
expected_version="${WORKFLOW_VERSION:-}"
newer_version=""
if [ -n "$expected_version" ] && [ "$deployed_version" != "$expected_version" ]; then
  errors+=(version_mismatch)
fi
file_version=""
[ -f "$WORKFLOW_ROOT/VERSION" ] && file_version=$(head -n1 "$WORKFLOW_ROOT/VERSION" | tr -d '[:space:]')

command -v sbatch >/dev/null 2>&1 || errors+=(sbatch_missing)

ok=false
[ "${#errors[@]}" -eq 0 ] && ok=true
errors_json=$(json_array ${errors[@]+"${errors[@]}"})
task_count=$(printf '%s' "$tasks_json" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')

printf '{"schema":"vasp-env-gate.v2","ok":%s,"workflow":"%s","workflow_version_file":"%s","python":"%s","vasp_home":"%s","vasp_version":"%s","protocol":"%s","deployed_version":"%s","expected_version":"%s","newer_version":"%s","required_tasks":%s,"tasks":%s,"missing_tasks":%s,"task_count":%s,"errors":%s}\n' \
  "$ok" "$WORKFLOW_ROOT" "$file_version" "$WORKFLOW_PYTHON" "$VASP_HOME" "$vasp_version" "$protocol" "$deployed_version" "$expected_version" "$newer_version" "$required_json" "$tasks_json" "$missing_json" "$task_count" "$errors_json"

[ "$ok" = true ]
