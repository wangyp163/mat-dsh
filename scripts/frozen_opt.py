#!/usr/bin/env python3
"""Frozen-skeleton GFN2-xTB optimizer (projected-gradient BFGS).

Context: xtb 6.7.1 on this cluster ignores $fix / $constrain control-file
blocks (verified empirically on site: skeleton atoms move in all variants),
so freezing atoms 1-3 (C C O skeleton) is enforced HERE by an outer BFGS
loop in the hydrogen subspace only:

  - energy + gradient from `xtb --grad` singlepoints (Eh, Eh/bohr)
  - skeleton atoms are never updated -> bit-exact freeze, no constraint
    potential involved
  - convergence: gnorm over free atoms < 1e-5 Eh/bohr (xtb "tight" class)

Runs under Slurm; ~0.3 s per singlepoint, hard budget MAXITER steps.
"""
import os
import re
import subprocess

import numpy as np

XYZ_IN = "c2-etoh.xyz"
SCRATCH = "sp"
NATOMS = 9
FIXED = (0, 1, 2)            # 0-based indices of atoms 1-3 (C, C, O)
MAXITER = 300
GNORM_TOL = 1.0e-5           # Eh/bohr over free atoms
TRUST = 0.3                  # max |step| per atom, bohr
BOHR = 0.52917721092         # 1 bohr in Angstrom


def read_xyz(path):
    lines = open(path).read().splitlines()
    n = int(lines[0].split()[0])
    syms, xyz = [], []
    for ln in lines[2:2 + n]:
        p = ln.split()
        syms.append(p[0])
        xyz.append([float(p[1]), float(p[2]), float(p[3])])
    return syms, np.array(xyz)


def write_xyz(path, syms, xyz, comment=""):
    with open(path, "w") as f:
        f.write("%d\n%s\n" % (len(syms), comment))
        for s, (x, y, z) in zip(syms, xyz):
            f.write("%-2s %20.12f %20.12f %20.12f\n" % (s, x, y, z))


def run_xtb(xyz_path):
    """Singlepoint + gradient; returns (E [Eh], grad [n,3] [Eh/bohr])."""
    os.makedirs(SCRATCH, exist_ok=True)
    subprocess.run(["cp", xyz_path, os.path.join(SCRATCH, "geom.xyz")], check=True)
    with open(os.path.join(SCRATCH, "sp.out"), "w") as fo:
        r = subprocess.run(
            ["xtb", "geom.xyz", "--gfn", "2", "--chrg", "0", "--grad"],
            cwd=SCRATCH, stdout=fo, stderr=subprocess.STDOUT)
    if r.returncode != 0:
        raise RuntimeError("xtb failed, see %s/sp.out" % SCRATCH)
    out = open(os.path.join(SCRATCH, "sp.out")).read()
    m = re.findall(r"TOTAL ENERGY\s+(-?\d+\.\d+)\s+Eh", out)
    if not m:
        raise RuntimeError("no TOTAL ENERGY in sp.out")
    e = float(m[-1])
    rows = []
    for ln in open(os.path.join(SCRATCH, "gradient")):
        p = ln.split()
        if len(p) == 7:
            try:
                rows.append([float(v) for v in p[:6]])
            except ValueError:
                rows = []          # column-header line -> restart block
    if len(rows) < NATOMS:
        raise RuntimeError("gradient parse failed")
    g = np.array(rows[-NATOMS:])[:, :3]
    return e, g


def gnorm(g):
    return float(np.sqrt((g ** 2).sum()))


syms, x0 = read_xyz(XYZ_IN)
assert len(syms) == NATOMS, "expected %d atoms" % NATOMS
assert all(syms[i] in ("C", "O") for i in FIXED), "atoms 1-3 must be C,C,O"
free = [i for i in range(NATOMS) if i not in FIXED]

xf = (x0[free] / BOHR).ravel()        # free-atom coords, flat, bohr
e, g = run_xtb(XYZ_IN)
gf = np.array([g[i] for i in free]).ravel()
print("iter    0  E=%.9f  gnorm(free)=%.3e  maxF=%.3e"
      % (e, gnorm(gf.reshape(-1, 3)), np.abs(gf).max()), flush=True)

H = np.eye(gf.size) * 0.5
best_e, best_x, best_gn = e, xf.copy(), gnorm(gf.reshape(-1, 3))
converged = False
line_fails = 0

for it in range(1, MAXITER + 1):
    d = -H @ gf
    dmax = np.abs(d.reshape(-1, 3)).max()
    if dmax > TRUST:
        d *= TRUST / dmax
    step_ok = False
    alpha, e0, g0 = 1.0, e, gf
    for _ls in range(24):
        trial_x = xf + alpha * d
        xA = x0.copy()
        xA[free] = trial_x.reshape(-1, 3) * BOHR
        write_xyz("trial.xyz", syms, xA)
        try:
            e, g = run_xtb("trial.xyz")
            gf = np.array([g[i] for i in free]).ravel()
        except RuntimeError:
            alpha *= 0.5
            continue
        if e < e0 - 1e-4 * alpha * float(g0 @ d):   # Armijo
            step_ok = True
            break
        alpha *= 0.5
    if not step_ok:
        line_fails += 1
        H = np.eye(gf.size) * 0.5
        e, gf = e0, g0
        print("iter %4d  line search failed, Hessian reset (%d/3)"
              % (it, line_fails), flush=True)
        if line_fails >= 3:
            break
        continue
    line_fails = 0
    s = alpha * d
    y = gf - g0
    sy_ = float(s @ y)
    if sy_ > 1e-10:
        rho = 1.0 / sy_
        I = np.eye(gf.size)
        H = (I - rho * np.outer(s, y)) @ H @ (I - rho * np.outer(y, s)) \
            + rho * np.outer(s, s)
    cur = gnorm(gf.reshape(-1, 3))
    if e < best_e:
        best_e, best_x, best_gn = e, (xf + alpha * d).copy(), cur
    print("iter %4d  E=%.9f  gnorm(free)=%.3e  maxF=%.3e"
          % (it, e, cur, np.abs(gf).max()), flush=True)
    xf = xf + alpha * d
    if cur < GNORM_TOL:
        converged = True
        break

xA = x0.copy()
xA[free] = best_x.reshape(-1, 3) * BOHR
write_xyz("xtbopt.xyz", syms, xA,
          "energy: %.12f gnorm_free: %.9f GFN2-xTB, skeleton atoms 1-3 frozen"
          % (best_e, best_gn))
moved = np.abs(xA[:3] - x0[:3]).max()
print("CONVERGED=%s  E_final=%.9f Eh  gnorm_free=%.3e  "
      "max_skeleton_displacement=%.1e A"
      % (converged, best_e, best_gn, moved), flush=True)
