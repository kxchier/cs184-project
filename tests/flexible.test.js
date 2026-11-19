import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {buildMesh,evaluate,equilibrium,defaultMaterial,defaultSolver,diagnostics,sampleMarkers,makeReport,reportCSV} from '../viewer/flexible.js';
const config=JSON.parse(readFileSync(new URL('../configs/baseline.json',import.meta.url)));

test('mesh topology welds ridge, leaves free DOFs, and excludes crease bending',()=>{
  for(const n of [4,8]) {
    const m=buildMesh(config,90,n);
    assert.equal(m.triangles.length,2*n*n);
    assert.equal(m.reference.length/3,(n+1)*(n+1));
    assert.equal(m.pins.length,2*n+1);
    assert.equal(m.ridge.length,n+1);
    assert.ok(m.ridge.slice(1).every(id=>!m.pins.includes(id)));
    const edges=new Map();
    for(const t of m.triangles) for(let i=0;i<3;i++) {const key=[t.ids[i],t.ids[(i+1)%3]].sort((a,b)=>a-b).join(',');if(!edges.has(key))edges.set(key,[]);edges.get(key).push(t.panel);}
    for(let j=0;j<n;j++) {
      assert.equal(m.maps[0].get(`0,${j}`),m.maps[1].get(`0,${j}`));
      const key=[m.ridge[j],m.ridge[j+1]].sort((a,b)=>a-b).join(',');
      assert.deepEqual(edges.get(key).sort(),[0,1]);
      assert.ok(!m.bends.some(b=>[b.ids[0],b.ids[1]].sort((a,b)=>a-b).join(',')===key));
    }
    const markers=sampleMarkers(m,m.reference);
    assert.equal(Object.keys(markers).length,8);
    assert.ok(Object.values(markers).flat().every(Number.isFinite));
    const ridge=markers.ridge_tip,tip=markers.left_wing_tip;
    for(let k=0;k<3;k++) {
      assert.ok(Math.abs(markers.left_interior[k]-(ridge[k]+tip[k])/3)<1e-14);
      assert.ok(Math.abs(markers.left_free_midpoint[k]-(ridge[k]+tip[k])/2)<1e-14);
    }
  }
});

test('analytic energy gradient agrees with finite differences away from reference',()=>{
  const m=buildMesh(config,90,3),x=m.reference.map((v,k)=>v+0.00005*Math.sin(k*1.7));
  const {gradient}=evaluate(m,x,defaultMaterial);
  for(let k=0;k<x.length;k++) {
    const eps=1e-7,a=[...x],b=[...x];a[k]+=eps;b[k]-=eps;
    const numeric=(evaluate(m,a,defaultMaterial).energy-evaluate(m,b,defaultMaterial).energy)/(2*eps);
    assert.ok(Math.abs(numeric-gradient[k])<1e-8,`gradient ${k}: ${numeric} vs ${gradient[k]}`);
  }
});

test('zero gravity preserves rigid geometry, including at 0° and 180°',()=>{
  for(const angle of [0,60,90,120,150,180]) {
    const m=buildMesh(config,angle,4),r=equilibrium(m,defaultMaterial,defaultSolver,[0,0,0]);
    assert.ok(r.converged);assert.equal(r.iterations,0);assert.deepEqual(r.positions,m.reference);
    assert.ok(Math.abs(r.energy_J)<1e-20);
  }
});

test('internal elastic energy is invariant under rigid rotation and translation',()=>{
  const m=buildMesh(config,90,4),x=m.reference.map((v,k)=>v+0.0001*Math.sin(k));
  const moved=[];
  for(let i=0;i<x.length;i+=3) moved.push(-x[i+1]+0.02,x[i]-0.03,x[i+2]+0.01);
  const a=evaluate(m,x,defaultMaterial,[0,0,0]).energy;
  const b=evaluate(m,moved,defaultMaterial,[0,0,0]).energy;
  assert.ok(Math.abs(a-b)<1e-14);
});

test('gravity deforms free interiors, edges and ridge while attachments stay exact',()=>{
  const m=buildMesh(config,90,4),r=equilibrium(m);
  assert.ok(r.converged);
  for(const id of m.pins) assert.deepEqual(r.positions.slice(id*3,id*3+3),m.reference.slice(id*3,id*3+3));
  const a=sampleMarkers(m,m.reference),b=sampleMarkers(m,r.positions);
  for(const name of ['left_interior','right_interior','left_free_midpoint','right_free_midpoint','ridge_tip'])
    assert.ok(Math.hypot(...a[name].map((v,k)=>v-b[name][k]))>1e-6,`${name} must be free`);
  assert.ok(diagnostics(m,r.positions).max_abs_edge_strain<0.001);
  assert.ok(evaluate(m,r.positions,defaultMaterial).energy<evaluate(m,m.reference,defaultMaterial).energy);
});

test('stiffness increase approaches the rigid reference in the 90° check',()=>{
  const m=buildMesh(config,90,4);let previous=Infinity;
  for(const D of [2e-6,2e-5,2e-4,2e-3]) {
    const r=equilibrium(m,{...defaultMaterial,bending_stiffness_N_m:D});
    assert.ok(r.converged);const d=diagnostics(m,r.positions).rms_displacement_m;
    assert.ok(d<previous);previous=d;
  }
  assert.ok(previous<1e-5);
});

test('refinement is close in the stiffer 90° case, but sensitive in soft 150° case',()=>{
  for(const [angle,D,substantial] of [[90,2e-5,false],[150,2e-6,true]]) {
    const values=[4,8].map(n=>{const m=buildMesh(config,angle,n),r=equilibrium(m,{...defaultMaterial,bending_stiffness_N_m:D});assert.ok(r.converged);return diagnostics(m,r.positions).rms_displacement_m;});
    const relative=Math.abs(values[1]/values[0]-1);
    if(substantial)assert.ok(relative>0.25);else assert.ok(relative<0.10);
  }
});

test('iteration-limit results are flagged and exports retain provenance',()=>{
  const m=buildMesh(config,90,4),settings={...defaultSolver,max_iterations:1},r=equilibrium(m,defaultMaterial,settings);
  assert.equal(r.converged,false);assert.equal(r.reason,'iteration_limit');
  const report=makeReport(config,90,m,defaultMaterial,settings,r,1.2);
  assert.equal(report.landmarks.length,8);assert.equal(report.convergence.converged,false);
  assert.deepEqual(report.solver_settings,settings);assert.equal(report.mesh_resolution,4);
  assert.ok(report.landmarks.some(p=>p.displacement_m>0));
  const csv=reportCSV([report]);assert.equal(csv.trim().split('\n').length,9);
  for(const key of ['reference_x_m','deformed_x_m','bending_stiffness_N_m','solver_settings_json','convergence_reason','gravity_z_m_s2'])assert.ok(csv.includes(key));
  assert.ok(!JSON.stringify(report).includes('null'));
  for(const bad of [-1,NaN])assert.throws(()=>equilibrium(m,{...defaultMaterial,mass_per_area_kg_m2:bad}));
});
