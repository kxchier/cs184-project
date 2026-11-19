# Fixed-angle experiments

These runs use example material values, not measurements from real paper. Run `npm run experiment`.
Each run starts from the raised rigid shape. Settings and meshes: `milestone.json`; landmarks: `milestone.csv`.

| Angle | D (N·m) | n | RMS def. (mm) | Max def. (mm) | Max edge strain (%) | Residual (N/m²) | Converged | Iterations | Time (ms) |
|---|---|---|---|---|---|---|---|---|---|
| 60° | 0.000002 | 4 | 1.084 | 2.302 | 0.073 | 0.00477 | yes | 301 | 42.5 |
| 60° | 0.000002 | 8 | 1.073 | 2.379 | 0.099 | 0.00483 | yes | 1179 | 213.1 |
| 60° | 0.00002 | 4 | 0.088 | 0.194 | 0.023 | 0.00490 | yes | 68 | 3.5 |
| 60° | 0.00002 | 8 | 0.081 | 0.187 | 0.025 | 0.00469 | yes | 242 | 39.8 |
| 90° | 0.000002 | 4 | 1.884 | 3.858 | 0.155 | 0.00483 | yes | 322 | 11.3 |
| 90° | 0.000002 | 8 | 1.924 | 4.099 | 0.272 | 0.00457 | yes | 925 | 115.6 |
| 90° | 0.00002 | 4 | 0.152 | 0.336 | 0.029 | 0.00396 | yes | 113 | 4.1 |
| 90° | 0.00002 | 8 | 0.141 | 0.324 | 0.034 | 0.00409 | yes | 248 | 31.4 |
| 120° | 0.000002 | 4 | 3.121 | 6.093 | 0.336 | 0.00466 | yes | 272 | 9.2 |
| 120° | 0.000002 | 8 | 3.576 | 7.059 | 0.588 | 0.00448 | yes | 1373 | 164.4 |
| 120° | 0.00002 | 4 | 0.237 | 0.520 | 0.044 | 0.00280 | yes | 115 | 3.7 |
| 120° | 0.00002 | 8 | 0.222 | 0.504 | 0.058 | 0.00489 | yes | 257 | 31.9 |
| 150° | 0.000002 | 4 | 7.489 | 13.872 | 1.035 | 0.00420 | yes | 379 | 12.7 |
| 150° | 0.000002 | 8 | 12.585 | 29.092 | 0.184 | 0.00497 | yes | 949 | 113.7 |
| 150° | 0.00002 | 4 | 0.386 | 0.815 | 0.085 | 0.00490 | yes | 140 | 4.8 |
| 150° | 0.00002 | 8 | 0.369 | 0.795 | 0.123 | 0.00418 | yes | 302 | 37.4 |

## Refinement (n=4 → 8)

| Angle | D (N·m) | RMS deformation change | Largest marker change (mm) |
|---|---|---|---|
| 60° | 0.000002 | -1.0% | 0.078 |
| 60° | 0.00002 | -7.3% | 0.008 |
| 90° | 0.000002 | 2.1% | 0.244 |
| 90° | 0.00002 | -6.9% | 0.012 |
| 120° | 0.000002 | 14.6% | 0.984 |
| 120° | 0.00002 | -6.3% | 0.017 |
| 150° | 0.000002 | 68.0% | 15.344 |
| 150° | 0.00002 | -4.5% | 0.028 |

With D = 2e−5 N·m, refining the mesh moves the markers by less than 0.03 mm, while RMS deformation changes by about 5–7%. The softer panels change more: about 15% at 120° and 68% at 150°, including a 15 mm marker shift. We cannot treat the soft 150° result as mesh-converged. It may need a finer mesh or may settle on a different branch; we have not checked which. The separate 90° test also shows less deformation as stiffness increases.

Two resolutions are not enough to prove mesh convergence. Check marker shifts as well as RMS deformation, since its sampling changes with the mesh. Passing the force tolerance does not show that a result matches real paper or avoids intersections. Large strains can also break the bending approximation. Times cover the solver only, excluding mesh generation and rendering, and vary between runs.
