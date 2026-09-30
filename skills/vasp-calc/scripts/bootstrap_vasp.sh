#!/usr/bin/env bash
# bootstrap_vasp.sh —— vasp-hy（VASP 软件）家目录部署/重建（幂等）。
# 对齐 gaussian 的 bootstrap_g16.sh 形态：从公共软件区拷贝 + 路径重写。
#
# 只管 VASP 件；workflow 件（$HOME/workspace/matstream，conda-pack 基座 + wheel）
# 属部署 SOP（基座拷贝 + wheel 上传安装），不在本脚本——见 SKILL.md「部署」节。
#
# 用法（集群登录侧）：bash bootstrap_vasp.sh [VASP_HOME]
# 幂等：已就位（vasp_std + 改写后 env.sh + VERSION）则直接通过。

set -uo pipefail

VASP_HOME="${1:-$HOME/workspace/vasp-hy}"
PUBLIC_SRC="/public/software/apps/sag-tool/vasp/5.4.4-ioptcell_intelmpi2017_hdf5_libxc"
VERSION_ANCHOR="5.4.4-ioptcell-intelmpi2017-hdf5-libxc"

already_ok() {
  [ -x "$VASP_HOME/app/bin/vasp_std" ] \
    && [ -f "$VASP_HOME/VERSION" ] \
    && grep -q "SCRIPTDIR=$VASP_HOME" "$VASP_HOME/scripts/env.sh" 2>/dev/null
}

if already_ok; then
  echo "[bootstrap-vasp] $VASP_HOME already provisioned — nothing to do"
  exit 0
fi

if [ ! -d "$PUBLIC_SRC" ]; then
  echo "[bootstrap-vasp] FATAL: public source missing: $PUBLIC_SRC" >&2
  exit 1
fi

echo "[bootstrap-vasp] copying $PUBLIC_SRC -> $VASP_HOME (109M, cluster-local)..."
rm -rf "$VASP_HOME"
cp -a "$PUBLIC_SRC" "$VASP_HOME" || { echo "[bootstrap-vasp] copy failed" >&2; exit 1; }

echo "[bootstrap-vasp] rewriting env.sh (SCRIPTDIR + module guard + mpi unload loop)..."
cat > "$VASP_HOME/scripts/env.sh" << VASP_EOF
#!/bin/bash
# VASP 5.4.4-iOptCell（hdf5+libxc, intelmpi2017）——家目录拷贝自公共区 $PUBLIC_SRC。
# SCRIPTDIR 重写为家目录；module 行加守卫（登录沙箱非交互 shell 无 module，
# 半 source 仍可验 vasp_std 在 PATH；作业内 module 有效）。
# 作业环境经 /etc/profile 预载 mpi/hpcx（与 intelmpi 冲突）——加载前卸载一切已载 mpi/*。
SCRIPTDIR=$VASP_HOME
if command -v module >/dev/null 2>&1; then
    for m in \$(module list --terse 2>&1 | grep -E '^mpi/'); do
        module unload "\$m" >/dev/null 2>&1 || true
    done
    module load compiler/intel/2017.5.239
    module load mpi/intelmpi/2017.4.239
fi
export PATH=\$SCRIPTDIR/app/bin:\$PATH
export LD_LIBRARY_PATH=\$SCRIPTDIR/app/lib:\$LD_LIBRARY_PATH
export PROGLIST=\$SCRIPTDIR/app/bin
VASP_EOF
chmod +x "$VASP_HOME/scripts/env.sh"

echo "$VERSION_ANCHOR (home copy $(date +%F))" > "$VASP_HOME/VERSION"

# 自检：vasp_std 可执行 + 半 source 后 PATH 在场（登录侧 module 缺失不影响 PATH 行）
if [ ! -x "$VASP_HOME/app/bin/vasp_std" ]; then
  echo "[bootstrap-vasp] FATAL: vasp_std missing after copy" >&2
  exit 1
fi
(
  # shellcheck disable=SC1090
  . "$VASP_HOME/scripts/env.sh" >/dev/null 2>&1
  command -v vasp_std >/dev/null 2>&1 || { echo "[bootstrap-vasp] FATAL: vasp_std not on PATH after sourcing env.sh" >&2; exit 1; }
)
echo "[bootstrap-vasp] OK: $VASP_HOME provisioned ($VERSION_ANCHOR)"
