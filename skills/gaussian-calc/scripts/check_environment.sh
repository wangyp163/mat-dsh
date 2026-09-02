#!/usr/bin/env bash
set -uo pipefail

skill_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# 环境常量来自本 skill 的 env_profile.sh；SKILL_ENV_PROFILE 仅供测试注入 override。
# shellcheck disable=SC1090
. "${SKILL_ENV_PROFILE:-$skill_dir/scripts/env_profile.sh}"

WORKFLOW_ROOT="${1:-$WORKFLOW_ROOT_DEFAULT}"
G16_HOME="${2:-$HOME/workspace/g16-hy}"
WORKFLOW_ENV="$WORKFLOW_ROOT/env.sh"
G16_ENV="$G16_HOME/scripts/env.sh"
PYTHON_BIN="$WORKFLOW_ROOT/$PYTHON_BIN_SUBDIR/python"
CLI="$WORKFLOW_ROOT/$PYTHON_BIN_SUBDIR/gaussian-workflow"
REQUIRED_TASKS=(aea dipole fluorescence freq irc opt polar resp sp tddft ts)

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
import gaussian_workflow
import gaussian_workflow.phase_json as phase_json
from calcflow.task.registry import list_tasks
print(json.dumps({
    "protocol": "new" if "top-level object" in inspect.getsource(phase_json.load_payload) else "old",
    "module": gaussian_workflow.__file__,
    "tasks": list_tasks("gaussian"),
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

if [ ! -f "$G16_ENV" ]; then
  errors+=(g16_env_missing)
elif ! ( export G16_HOME LD_LIBRARY_PATH="${LD_LIBRARY_PATH:-}"; . "$G16_ENV" >/dev/null 2>&1 && command -v g16 >/dev/null 2>&1 ); then
  errors+=(g16_unavailable)
fi

# 版本锚：部署侧的 VERSION 文件（安装脚本落盘）与 skill 侧记录的期望比对，
# 让"文档/期望 vs 实际部署"的漂移在门禁处可见（wheel 元数据版本不可信，恒为 0.1.0）。
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

# 新鲜度提醒（warning，不进 errors、不影响 ok）：兄弟 v* 部署目录里存在比期望
# 更高且部署完整（VERSION + env.sh）的版本时上报，防止"新版本部署在旁边而
# skill 仍安静使用旧版"的盲区。没有更高候选时为空串。
newer_version=""
if [ -n "$expected_version" ]; then
  newer_vers=()
  for cand in "$(dirname "$WORKFLOW_ROOT")"/v*/; do
    [ -f "${cand}VERSION" ] && [ -f "${cand}env.sh" ] || continue
    cv=$(head -n1 "${cand}VERSION" | tr -d '[:space:]')
    [ -n "$cv" ] || continue
    [ "$cv" != "$expected_version" ] || continue
    [ "$(printf '%s\n' "$expected_version" "$cv" | sort -V | tail -n1)" = "$cv" ] || continue
    newer_vers+=("$cv")
  done
  if [ "${#newer_vers[@]}" -gt 0 ]; then
    newer_version=$(printf '%s\n' "${newer_vers[@]}" | sort -V | tail -n1)
  fi
fi

ok=false
[ "${#errors[@]}" -eq 0 ] && ok=true
errors_json=$(json_array ${errors[@]+"${errors[@]}"})
task_count=$(printf '%s' "$tasks_json" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')

printf '{"schema":"gaussian-env-gate.v2","ok":%s,"workflow":"%s","python":"%s","cli":"%s","module":"%s","protocol":"%s","deployed_version":"%s","expected_version":"%s","newer_version":"%s","required_tasks":%s,"tasks":%s,"missing_tasks":%s,"task_count":%s,"g16":"%s","errors":%s}\n' \
  "$ok" "$WORKFLOW_ROOT" "$PYTHON_BIN" "$CLI" "$module_file" "$protocol" "$deployed_version" "$expected_version" "$newer_version" "$required_json" "$tasks_json" "$missing_json" "$task_count" "$G16_ENV" "$errors_json"

[ "$ok" = true ]
