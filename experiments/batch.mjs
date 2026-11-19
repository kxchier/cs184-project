import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {buildMesh,equilibrium,defaultMaterial,defaultSolver,makeReport,reportCSV} from '../viewer/flexible.js';
const config=JSON.parse(readFileSync(new URL('../configs/baseline.json',import.meta.url)));
const reports=[];
for(const angle of [60,90,120,150]) for(const D of [0.000002,0.00002]) for(const n of [4,8]) {
  const mesh=buildMesh(config,angle,n),material={...defaultMaterial,bending_stiffness_N_m:D};
  const start=performance.now(),result=equilibrium(mesh,material,defaultSolver);
  const report=makeReport(config,angle,mesh,material,defaultSolver,result,performance.now()-start);
  report.runtime={node:process.version,platform:process.platform,arch:process.arch};
  reports.push(report);
}
mkdirSync(new URL('../results/',import.meta.url),{recursive:true});
const save=(name,data)=>writeFileSync(new URL(`../results/${name}`,import.meta.url),data);
save('milestone.json',JSON.stringify(reports,null,2)+'\n');save('milestone.csv',reportCSV(reports));
let md='# Fixed-angle experiments\n\nThese runs use example material values, not measurements from real paper. Run `npm run experiment`.\nEach run starts from the raised rigid shape. Settings and meshes: `milestone.json`; landmarks: `milestone.csv`.\n\n';
md+='| Angle | D (N·m) | n | RMS def. (mm) | Max def. (mm) | Max edge strain (%) | Residual (N/m²) | Converged | Iterations | Time (ms) |\n|---|---|---|---|---|---|---|---|---|---|\n';
for(const r of reports) {const d=r.diagnostics,c=r.convergence;md+=`| ${r.book_angle_deg}° | ${r.material.bending_stiffness_N_m} | ${r.mesh_resolution} | ${(d.rms_displacement_m*1000).toFixed(3)} | ${(d.max_displacement_m*1000).toFixed(3)} | ${(d.max_abs_edge_strain*100).toFixed(3)} | ${c.residual_N_m2.toFixed(5)} | ${c.converged?'yes':'NO: '+c.reason} | ${c.iterations} | ${r.computation_time_ms.toFixed(1)} |\n`;}
md+='\n## Refinement (n=4 → 8)\n\n| Angle | D (N·m) | RMS deformation change | Largest marker change (mm) |\n|---|---|---|---|\n';
for(let i=0;i<reports.length;i+=2) {
  const [a,b]=reports.slice(i,i+2),change=(b.diagnostics.rms_displacement_m/a.diagnostics.rms_displacement_m-1)*100;
  const markerChange=Math.max(...a.landmarks.map((p,j)=>Math.hypot(...p.deformed_m.map((v,k)=>v-b.landmarks[j].deformed_m[k]))));
  md+=`| ${a.book_angle_deg}° | ${a.material.bending_stiffness_N_m} | ${change.toFixed(1)}% | ${(markerChange*1000).toFixed(3)} |\n`;
}
md+='\nWith D = 2e−5 N·m, refining the mesh moves the markers by less than 0.03 mm, while RMS deformation changes by about 5–7%. The softer panels change more: about 15% at 120° and 68% at 150°, including a 15 mm marker shift. We cannot treat the soft 150° result as mesh-converged. It may need a finer mesh or may settle on a different branch; we have not checked which. The separate 90° test also shows less deformation as stiffness increases.\n';
md+='\nTwo resolutions are not enough to prove mesh convergence. Check marker shifts as well as RMS deformation, since its sampling changes with the mesh. Passing the force tolerance does not show that a result matches real paper or avoids intersections. Large strains can also break the bending approximation. Times cover the solver only, excluding mesh generation and rendering, and vary between runs.\n';
save('milestone.md',md);console.log(md);
