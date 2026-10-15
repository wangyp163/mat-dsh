# P1 沙箱化：验证 + 覆盖 + 量化（2026-10-15）

> 性质：harness engineering 补课路线 P1 完整实施态。前置：P0.5 评测基线
> （`../baseline-20261015/`）。结论先行——**宿主沙箱本就默认启用，P1 的真实
> 工作是把"以为缺"变成"已验证、已覆盖、已量化"**。

## 0. 前提修正（最重要的发现）

P0 时的判定"沙箱：有但未启用"**错误**。核对 base bundle
（`deepseek-harness/packages/bundle/base/cordis.patch.yml` 165-180 行）：
`dsh-sandbox-local` + `dsh-sandbox-policy`（mode=workspace-write）+
`dsh-bash-sandbox` 是**所有发行 profile 的默认装载**——本仓会话从第一天起
就在 bwrap 约束下运行，只是 golden 任务集无本地 bash 调用，从未触发。

方法论升级：三态判定法补第四态——**已启用未验证**。判"未启用"前必须查
base 默认值，不能只看"我没关过"。

## 1. 越权探针（零 token，7/7 通过）

`sandbox-probe.md` / `sandbox-probe.json`；探针脚本
`scripts/eval-sandbox-probe.ts`，包裹命令与 `dsh-bash-sandbox` 同源
（import 宿主 `sandbox-local/src/profiles.ts`，不复制实现）。

- 后端：**bwrap / full enforcement**（Linux 链首选，功能探针仲裁通过）
- 越权面全拒：写 $HOME（**生产凭据 env.local 所在**）/ 写 /usr/local /
  改 /etc/hosts（DNS 劫持面）/ 删家目录预存文件 / chmod 提权绕过
- 合法面不受影响：workspace 写（bind rw）、/tmp 写（tmpfs）
- 断言含**文件系统终态校验**（被删文件必须幸存、被拒写文件必须不存在）
- 拒绝方言：`Read-only file system`（bash-sandbox 执行器按此分类
  `result.sandbox.denied`）

## 2. 开销量化

- 微基准：**+3.1 ms / bash 调用**（plain 1.84ms → bwrap 4.94ms，×2.7 启动比）
- 任务级 A/B（6 golden 任务 × on/off 两泳道）：
  - 通过率 **6/6 = 6/6**；local-bash 两泳道同 13s / bash×1
  - 任务墙钟无可见差异（沙箱开销 3ms × 每任务 1-2 次 bash，被秒级任务时长淹没）
  - token：off 110,060 in / on 87,198 in——差异被**模型路径方差**淹没
    （fail-diagnosis 在 on 泳道自发走了 40 步深度诊断；on 泳道反而更省），
    方向都与"沙箱加 schema 字段增 token"的预期相反
- 单轮 A/B 的分辨率下限即模型方差；要分辨 <20% 的 token 差异需 N≥3 轮
  取均值（记为评测协议待办）

## 3. 过程中的工程教训（全部已修复并沉淀）

1. **探针自身的爆炸半径**：v2 探针 plain 泳道对真宿主执行了
   `echo >> /etc/hosts`、`chmod 777 $HOME`——评测工具本身成为风险源。
   v3 原则：**confined 泳道可对真目标发起（预期被拒零副作用）；plain 泳道
   对破坏性命令必须用安全替代目标（同命令类）**。宿主损伤已当场复原
   （hosts 清行、/root 还原 700、marker 清除）。
2. **`rm -f` 探针的 POSIX 陷阱**：沙箱内 touch 先被拒 → 目标不存在 →
   `rm -f` 对不存在文件静默 exit 0 → 误判"越权成功"。修正：宿主侧预建
   真实存量文件 + 终态幸存断言。
3. **清理时序**：workspace 目录在 bench 前被删 → bwrap `--bind` 挂载失败
   → 全部样本被静默过滤成中位 0ms。修正：bench 空样本即抛错，绝不静默。
4. **Unicode 减号**（eval-report v1.3）：模型写"−76.4090"（U+2212），
   `/-76\.40/` 漏判两泳道同任务假失败。修正：断言前归一化 Unicode/全角
   减号。与 v1.2"表格排版宽容"同族——**final 断言断语义要素，不断字形**。

## 4. 边界与后续

- 沙箱是**文件效果**约束：网络与进程可见性不在模式词汇内（README 明示，
  不假装覆盖后端不强制的面）。HPC curl 传输走 execFile 直连、不经
  shell seam——传输层 egress 收敛（只放行 HPC 端点）是可选深化项，需
  在 mat-tools 注入 sandboxed CommandRunner，记为 P1+。
- 面试叙事：gVisor/microVM 是更强隔离档（内核攻击面），本机 bwrap 已
  覆盖文件面；"沙箱开销 vs 事故清零"的量化数据即本文（+3.1ms/调用 ≈
  零成本买断家目录凭据泄露/DNS 劫持/误删三类事故面）。

## 5. 工件清单

| 工件 | 位置 |
|---|---|
| 探针脚本（可重复跑） | `scripts/eval-sandbox-probe.ts` |
| 探针证据 | `sandbox-probe.md` / `sandbox-probe.json` |
| A/B lane-off（danger-full-access） | `lane-off/report.md`（6/6） |
| A/B lane-on（workspace-write 默认） | `lane-on/report.md`（6/6，含对 off 的对比） |
| golden 任务集 v1.3（+local-bash） | `scripts/eval-golden-tasks.ts` |
| 跑批器 | `scripts/eval-run.ts`（新增 `--env KEY=VAL` 泳道开关透传） |
