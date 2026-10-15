#!/usr/bin/env bash
# dsh web 服务运维脚本（mat-dsh）：start | stop | restart | status
#
# 启动开发仓 CLI，并让开发 profile 内的 Harmony launcher 在加载前应用 Patch：
#   source env.local && DSH_HOME=... DSH_HARMONY_DSH_ENTRY=... node .../dsh-harmony/lib/bin.js ...
# 约定：
#   - pid 文件 /tmp/mat-dsh-web.pid 记录进程组 id（setsid 启动，stop 杀整组）
#   - 旧实例无 pid 文件时（脚本启用前手启的），按端口 3080 反查并连同 pnpm 父进程一起终止
#   - env.local 含凭据：只 source，绝不 cat/echo；日志只重定向 stdout/stderr
#
# 组合拓扑（2026-10-08 可移植化改造）：环境无关插件行收编在
# packages/mat-bundle/cordis.patch.yml，dev 与目标机同构装载——本脚本把
# mat-bundle（及其包族软链）注入 $DSH_HOME_DIR/profiles/web：
#   - node_modules 软链：mat-tools / mat-ui / mat-skills / mat-bundle
#   - package.json 幂等追加 dsh.profile.bundles += "mat-bundle"
# profiles/mat.yml 只剩环境相关行（LLM 路由 + dev 技能隔离），经 --patch 叠加。
set -euo pipefail

# 位置无关部署：路径从脚本自身位置推导（scripts/ 的上级即本仓根）。
# 兄弟布局约定：本仓与 deepseek-harness 宿主仓同父目录；不同布局用
# DEEPSEEK_HARNESS_REPO 覆盖。
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST_REPO="${DEEPSEEK_HARNESS_REPO:-$REPO_ROOT/../deepseek-harness}"
OVERLAY="$REPO_ROOT/profiles/mat.yml"
ENV_LOCAL="$REPO_ROOT/env.local"
DSH_HOME_DIR="${DSH_HOME_DIR:-$HOME/.local/share/mat-dsh}"
HARMONY_BIN="$DSH_HOME_DIR/profiles/web/node_modules/dsh-harmony/lib/bin.js"
DEV_DSH_ENTRY="$DSH_HOME_DIR/profiles/web/node_modules/@deepseek-ai/dsh/lib/bin.js"
PROFILE_PKG="$DSH_HOME_DIR/profiles/web/package.json"
MAT_UI_PACKAGE="$REPO_ROOT/packages/mat-ui"
MAT_UI_LINK="$DSH_HOME_DIR/profiles/web/node_modules/mat-ui"
MAT_TOOLS_PACKAGE="$REPO_ROOT/packages/mat-tools"
MAT_TOOLS_LINK="$DSH_HOME_DIR/profiles/web/node_modules/mat-tools"
MAT_SKILLS_PACKAGE="$REPO_ROOT/packages/mat-skills"
MAT_SKILLS_LINK="$DSH_HOME_DIR/profiles/web/node_modules/mat-skills"
MAT_BUNDLE_PACKAGE="$REPO_ROOT/packages/mat-bundle"
MAT_BUNDLE_LINK="$DSH_HOME_DIR/profiles/web/node_modules/mat-bundle"
MAT_UI_BUILD="$REPO_ROOT/scripts/build-mat-ui.mjs"
PORT=3080
PID_FILE=/tmp/mat-dsh-web.pid
LOG=/tmp/mat-dsh-web.log
OLD_LOG=/tmp/mat-dsh-web.log.old

# 幂等注入：package.json 的 dsh.profile.bundles 追加 "mat-bundle"（已在则不动）。
inject_bundle_into_profile() {
  node -e '
    const fs = require("node:fs")
    const path = process.argv[1]
    const pkg = JSON.parse(fs.readFileSync(path, "utf8"))
    pkg.dsh ??= {}
    pkg.dsh.profile ??= {}
    pkg.dsh.profile.bundles ??= []
    if (!pkg.dsh.profile.bundles.includes("mat-bundle")) {
      pkg.dsh.profile.bundles.push("mat-bundle")
      fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + "\n")
    }
  ' "$PROFILE_PKG"
}

port_pid() {  # 端口监听进程 pid（无则空）
  ss -ltnp 2>/dev/null | grep -oP ":${PORT}.*pid=\\K\\d+" | head -1 || true
}

is_up() {  # HTTP 探活
  curl -s -o /dev/null --max-time 3 -w '%{http_code}' "http://127.0.0.1:${PORT}/" 2>/dev/null | grep -q '^2'
}

wait_up() {  # $1=最长等待秒数
  local deadline=$(( $(date +%s) + $1 ))
  until is_up; do
    [ "$(date +%s)" -ge "$deadline" ] && return 1
    sleep 1
  done
}

kill_tree() {  # $1=pid：先杀监听 pid 的进程组，再兜底杀 pnpm 父进程
  local pid=$1 parent
  kill -- "-${pid}" 2>/dev/null || kill "${pid}" 2>/dev/null || true
  parent=$(ps -o ppid= -p "${pid}" 2>/dev/null | tr -d ' ' || true)
  [ -n "${parent}" ] && [ "${parent}" != "1" ] && ps -p "${parent}" -o args= 2>/dev/null | grep -q 'pnpm dsh' && kill "${parent}" 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    ss -ltn 2>/dev/null | grep -q ":${PORT} " || return 0
    sleep 1
  done
  echo "警告：端口 ${PORT} 仍被占用" >&2
  return 1
}

do_start() {
  if is_up; then echo "已在运行（http://127.0.0.1:${PORT} HTTP 200，pid=$(port_pid)），跳过启动"; exit 0; fi
  [ -f "$LOG" ] && mv -f "$LOG" "$OLD_LOG"
  ln -sfn "$MAT_UI_PACKAGE" "$MAT_UI_LINK"
  ln -sfn "$MAT_TOOLS_PACKAGE" "$MAT_TOOLS_LINK"
  ln -sfn "$MAT_SKILLS_PACKAGE" "$MAT_SKILLS_LINK"
  ln -sfn "$MAT_BUNDLE_PACKAGE" "$MAT_BUNDLE_LINK"
  inject_bundle_into_profile
  node "$MAT_UI_BUILD"
  (
    cd "$HOST_REPO"
    set -a; . "$ENV_LOCAL"; set +a
    exec setsid env DSH_HOME="$DSH_HOME_DIR" DSH_HARMONY_DSH_ENTRY="$DEV_DSH_ENTRY" \
      MAT_TRANSPORT=fetch \
      node "$HARMONY_BIN" --profile web --patch "$OVERLAY" --no-open
  ) >>"$LOG" 2>&1 &
  echo $! > "$PID_FILE"
  if wait_up 40; then
    echo "启动成功：http://127.0.0.1:${PORT}（pgid=$(cat "$PID_FILE")，日志 ${LOG}）"
  else
    echo "启动失败：${PORT} 未就绪，最近日志：" >&2
    tail -n 20 "$LOG" >&2 || true
    exit 1
  fi
}

do_stop() {
  local pid
  pid=$(port_pid)
  if [ -z "$pid" ] && [ -f "$PID_FILE" ]; then pid=$(cat "$PID_FILE"); fi
  if [ -z "$pid" ] && ! ss -ltn 2>/dev/null | grep -q ":${PORT} "; then
    echo "未在运行"; rm -f "$PID_FILE"; exit 0
  fi
  kill_tree "$pid" && echo "已停止（pid=${pid}）"
  rm -f "$PID_FILE"
}

case "${1:-}" in
  start)   do_start ;;
  stop)    do_stop ;;
  restart) do_stop; do_start ;;
  status)
    pid=$(port_pid)
    if [ -n "$pid" ]; then
      echo "运行中：pid=${pid}，HTTP $(curl -s -o /dev/null --max-time 3 -w '%{http_code}' "http://127.0.0.1:${PORT}/" 2>/dev/null)"
    else
      echo "未在运行"
    fi
    ;;
  *) echo "用法：$0 start|stop|restart|status" >&2; exit 2 ;;
esac
