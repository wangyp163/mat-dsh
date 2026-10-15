---
id: vasp-zbrent-fatal
signature: "ZBRENT: fatal|bracketing interval|VERY BAD PROBLEMS|THE RANK-ORDERING OF ENERGIES"
task: [relax, relaxdftu, phonon]
versions: ["0.1.3"]
source: seed（VASP 通用排障知识，未经本仓集群实证——首次命中后回写实证来源与真实签名）
prescription: [{"match":"IBRION=2 共轭梯度上线搜索崩","route":"换 IBRION=1（RMM-DIIS 稳）或 IBRION=3（阻尼 MD，配合 POTIM 减小 0.5→0.1~0.2）"},{"match":"起始结构离平衡太远（大应变/原子过近）","route":"先 veryfast 预弛豫再上目标 preset；或 POTIM 减小"},{"match":"伴随电子步不收敛","route":"先修电子步（转 kb:vasp-electronic-unconverged）——离子崩多数是电子步污染的力"},{"match":"临界收敛（力已接近 EDIFFG）","route":"放宽 EDIFFG（降 preset）或取力最低帧 CONTCAR 续算"}]
---

## 症状

- relax 族任务中止， stdout/stderr 见 ZBRENT/bracketing 或 VERY BAD PROBLEMS 类行；
- 收割时 `converged: false` 且 OSZICAR 离子步能量非单调。

## 根因

线搜索（ZBRENT）在两次试探间找不到能量极小——力被电子步噪声污染、起始结构太差、
或共轭梯度（IBRION=2）对该体系不稳。

## 处方（决策表）

| 场景 | 判定 | 处方 |
|---|---|---|
| IBRION=2 崩 | 默认路径 | IBRION=1 或 IBRION=3（POTIM 减小） |
| 起始结构差 | 大应变/近距原子 | veryfast 预弛豫再上目标档 |
| 电子步污染 | 伴随 SCF 震荡 | 先修电子步（`kb:vasp-electronic-unconverged`） |
| 临界收敛 | 力接近阈值 | 放宽 EDIFFG 或取力最低帧续算 |

## 禁止事项

- 不要在未换 IBRION/未修电子步的情况下原样重试同参数（必然复现）。
