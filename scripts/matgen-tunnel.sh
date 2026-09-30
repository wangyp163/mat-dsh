#!/usr/bin/env bash
# matgen MCP 隧道运维（mat-dsh）：start | stop | restart | status
#
# HPC 容器 pod（matgen-mcp-pod:50046）上的 matgen-mcp 常驻服务监听 pod 内
# 0.0.0.0:8080，但 pod 的 k8s Service/Pod IP 从本机不可达（2026-09-24 实测
# 10.68.173.26 / 172.20.91.77 均 5s 超时，唯一通路是 ssh 入口）。本脚本维护一条
# 本地 127.0.0.1:18080 → pod 127.0.0.1:8080 的常驻隧道，供 profiles/mat.yml
# 的 matgen-mcp-reference（dsh-mcp-client streamable-http）接入；mcp-client 自带
# 指数退避重连，隧道短暂断线只表现为工具暂时不可用，恢复后自动跟上。
#
# 凭证：env.local 的 MATGEN_POD_SSHPASS（gitignored，与 MAT_* 同模式）。
# 约定同 dsh-web.sh：pid 文件记 setsid 进程组 id（stop 杀整组）；探活走
# /metrics；断线外层 while 重连（5s 退避 + ServerAliveInterval 30s 探死链）。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_LOCAL="$REPO_ROOT/env.local"
LOCAL_PORT="${MATGEN_TUNNEL_PORT:-18080}"
PID_FILE=/tmp/mat-matgen-tunnel.pid
LOG=/tmp/mat-matgen-tunnel.log
POD_HOST=matgen-mcp-pod
POD_PORT=50046

is_up() {  # 经隧道探 pod 的 /metrics（HTTP 200 即通）
  curl -s -o /dev/null --max-time 3 -w '%{http_code}' "http://127.0.0.1:${LOCAL_PORT}/metrics" 2>/dev/null | grep -q '^2'
}

wait_up() {  # $1=最长等待秒数
  local deadline=$(( $(date +%s) + $1 ))
  until is_up; do
    [ "$(date +%s)" -ge "$deadline" ] && return 1
    sleep 1
  done
}

do_start() {
  if is_up; then echo "隧道已在运行（http://127.0.0.1:${LOCAL_PORT} → ${POD_HOST}:8080），跳过启动"; exit 0; fi
  set -a; . "$ENV_LOCAL"; set +a
  if [ -z "${MATGEN_POD_SSHPASS:-}" ]; then
    echo "env.local 缺 MATGEN_POD_SSHPASS（HPC 容器 pod 的 ssh 密码）" >&2; exit 1
  fi
  # setsid 独立进程组：stop 时 kill -- -pgid 可连同 sshpass/ssh 一起收掉；
  # ExitOnForwardFailure 保证端口被占时立刻退出进重连循环而不是挂着空进程。
  setsid bash -c '
    while true; do
      sshpass -p "$1" ssh -N \
        -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
        -o StrictHostKeyChecking=accept-new \
        -L "127.0.0.1:'"${LOCAL_PORT}"':127.0.0.1:8080" -p '"${POD_PORT}"' root@'"${POD_HOST}"'
      echo "$(date -Is) tunnel exited rc=$?, reconnect in 5s" >&2
      sleep 5
    done
  ' _ "$MATGEN_POD_SSHPASS" >>"$LOG" 2>&1 &
  echo $! > "$PID_FILE"
  if wait_up 20; then
    echo "隧道已启动：http://127.0.0.1:${LOCAL_PORT} → ${POD_HOST}:8080（pgid=$(cat "$PID_FILE")，日志 ${LOG}）"
  else
    echo "启动失败：${LOCAL_PORT} 未就绪，最近日志：" >&2
    tail -n 10 "$LOG" >&2 || true
    exit 1
  fi
}

do_stop() {
  local pid
  pid=$(cat "$PID_FILE" 2>/dev/null || true)
  if [ -z "$pid" ]; then echo "未在运行（无 pid 文件）"; exit 0; fi
  kill -- "-${pid}" 2>/dev/null || kill "${pid}" 2>/dev/null || true
  rm -f "$PID_FILE"
  echo "已停止（pgid=${pid}）"
}

case "${1:-}" in
  start)   do_start ;;
  stop)    do_stop ;;
  restart) do_stop; do_start ;;
  status)
    if is_up; then
      echo "运行中：http://127.0.0.1:${LOCAL_PORT} → ${POD_HOST}:8080（pgid=$(cat "$PID_FILE" 2>/dev/null || echo '?')）"
    else
      echo "未在运行"
    fi
    ;;
  *) echo "用法：$0 start|stop|restart|status" >&2; exit 2 ;;
esac
