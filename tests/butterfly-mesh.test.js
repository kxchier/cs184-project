import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildButterflyMesh, validateWing } from '../viewer/butterfly-mesh.js';
import { solve } from '../viewer/model.js';
import { buildMesh, defaultMaterial, defaultSolver, equilibrium, evaluate, sampleMarkers } from '../viewer/flexible.js';
import { bookPages, classifyGeometry } from '../experiments/geometry-validity.mjs';

const config=JSON.parse(readFileSync(new URL('../configs/baseline.json',import.meta.url)));
const tolerance={distance_m:1e-8,attachment_m:1e-11,relative_area:1e-6};
const zero=[0,0,0], gravity=[0,0,-9.81];
const point=(x,i)=>x.slice(3*i,3*i+3);
const sub=(a,b)=>a.map((x,i)=>x-b[i]);
const norm=v=>Math.hypot(...v);
const equal=(a,b,t=1e-12)=>assert.ok(Math.abs(a-b)<=t,`${a} differs from ${b}`);
function incidence(mesh) {
  const edges=new Map();
  for(const {ids,panel} of mesh.triangles) for(let i=0;i<3;i++){
    const a=ids[i], b=ids[(i+1)%3], key=[Math.min(a,b),Math.max(a,b)].join();
    if(!edges.has(key)) edges.set(key,[]);
    edges.get(key).push({a,b,panel});
  }
  return edges;
}
const diagnose=(mesh,positions,angle)=>classifyGeometry(mesh,positions,bookPages(config,angle),tolerance);

test('wing validator rejects invalid indices, faces, winding, nonfinite and poorly conditioned geometry',()=>{
  const p=[[0,0],[1,0],[0,1],[1,1]];
  assert.throws(()=>validateWing(p,[[0,1,4]]),/indices/);
  assert.throws(()=>validateWing(p,[[0,1,2],[2,0,1]]),/Duplicate faces/);
  assert.throws(()=>validateWing(p,[[0,1,2]]),/Isolated/);
  assert.throws(()=>validateWing(p.slice(0,3),[[0,2,1]]),/reversed/);
  assert.throws(()=>validateWing([[0,0],[1,0],[2,0]],[[0,1,2]]),/Degenerate/);
  assert.throws(()=>validateWing([[0,0],[1,0],[1,1e-10]],[[0,1,2]]),/conditioned/);
  assert.throws(()=>validateWing([[0,0],[1,0],[NaN,1]],[[0,1,2]]),/Invalid/);
  assert.throws(()=>validateWing([...p.slice(0,3),[2,0],[3,0],[2,1]],[[0,1,2],[3,4,5]]),/connected/);
  assert.throws(()=>buildButterflyMesh(config,NaN),/angle/);
  assert.throws(()=>buildButterflyMesh(config,60,2),/level/);
});

test('welded topology, explicit boundaries and exactly the physical pin chains survive refinement',()=>{
  for(const level of [0,1]){
    const mesh=buildButterflyMesh(config,60,level), edges=incidence(mesh);
    assert.equal(new Set(mesh.triangles.flatMap(t=>t.ids)).size,mesh.areas.length);
    assert.equal(mesh.areas.length-edges.size+mesh.triangles.length,1);
    assert.equal(mesh.ridge.length,level+2);
    for(const list of edges.values()){
      assert.ok(list.length<=2);
      if(list.length===2) assert.equal(list[0].a,list[1].b);
    }
    const crossWing=[...edges.values()].filter(x=>x.length===2 && x[0].panel!==x[1].panel);
    assert.equal(crossWing.length,mesh.ridge.length-1);
    for(const [i,id] of mesh.ridge.slice(1).entries()){
      const key=[id,mesh.ridge[i]].sort((a,b)=>a-b).join();
      assert.ok(crossWing.includes(edges.get(key)));
      assert.ok(!mesh.bends.some(b=>b.ids.slice(0,2).sort((a,b)=>a-b).join()===key));
    }
    const p=solve(config,60).landmarks_m;
    for(const [side,chain] of mesh.attachments.entries()){
      assert.equal(chain.length,2+level);
      const tip=p[side?'right_wing_tip':'left_wing_tip'];
      chain.forEach((id,i)=>point(mesh.reference,id).forEach((x,k)=>equal(x,tip[k]*i/(chain.length-1),0)));
    }
    assert.deepEqual(new Set(mesh.pins),new Set(mesh.attachments.flat()));
    for(const [panel,boundary] of mesh.boundaries.entries()){
      const incident=[...edges.values()].flat().filter(x=>x.panel===panel);
      const counts=new Map();
      for(const {a,b} of incident){const k=[a,b].sort((x,y)=>x-y).join(); counts.set(k,(counts.get(k)??0)+1);}
      assert.equal(boundary.length,[...counts.values()].filter(n=>n===1).length);
      for(const [i,a] of boundary.entries()){
        const b=boundary[(i+1)%boundary.length];
        assert.ok(incident.some(e=>e.a===a && e.b===b));
        assert.equal(counts.get([a,b].sort((x,y)=>x-y).join()),1);
      }
    }
  }
});

test('material domain, rest lengths, lumped areas and lobe identities are angle and refinement consistent',()=>{
  const coarse=buildButterflyMesh(config,60,0), fine=buildButterflyMesh(config,60,1);
  assert.equal(fine.triangles.length,4*coarse.triangles.length);
  assert.deepEqual(sampleMarkers(coarse,coarse.reference),sampleMarkers(fine,fine.reference));
  for(const level of [0,1]){
    const a=buildButterflyMesh(config,60,level);
    equal(a.quality.area_m2,coarse.quality.area_m2);
    for(const angle of [0,90,180]){
      const b=buildButterflyMesh(config,angle,level);
      assert.deepEqual(a.triangles,b.triangles);
      for(const [i,t] of a.triangles.entries()){
        equal(a.membranes[i].area,b.membranes[i].area);
        for(let j=0;j<3;j++){
          const ids=[t.ids[j],t.ids[(j+1)%3]];
          equal(norm(sub(...ids.map(id=>point(a.reference,id)))),norm(sub(...ids.map(id=>point(b.reference,id)))));
        }
      }
    }
    equal(a.membranes.reduce((sum,e)=>sum+e.area,0),a.quality.area_m2);
    equal(a.areas.reduce((sum,x)=>sum+x,0),a.quality.area_m2);
    assert.ok(a.areas.every(x=>x>0));
  }
});

test('support triangle assembly agrees with the original membrane element at the matching scale',()=>{
  const a=buildButterflyMesh(config,60,0), original=buildMesh(config,60,2);
  const support=a.membranes.find(e=>e.ids.join()==='0,1,7'), small=original.membranes[0];
  equal(support.area,4*small.area);
  support.inv.forEach((v,i)=>equal(v,small.inv[i]/2));
  for(const bend of a.bends){
    equal(bend.K.reduce((x,y)=>x+y,0),0);
    for(let axis=0;axis<3;axis++) equal(bend.ids.reduce((s,id,i)=>s+bend.K[i]*a.reference[3*id+axis],0),0);
  }
});

test('irregular-mesh gradients and material scaling agree for isolated energy terms',()=>{
  for(const level of [0,1]){
    const mesh=buildButterflyMesh(config,90,level);
    const perturbed=mesh.reference.map((v,i)=>v+0.0004*Math.sin(i*.83));
    // Strip other element lists to exercise each production energy independently.
    const terms=[
      [{...mesh,bends:[]},zero,'stretching_modulus_N_m'],
      [{...mesh,membranes:[]},zero,'bending_stiffness_N_m'],
      [{...mesh,membranes:[],bends:[]},gravity,'mass_per_area_kg_m2'],
    ];
    for(const [elements,g,parameter] of terms){
      const base=evaluate(elements,perturbed,defaultMaterial,g);
      assert.ok(Number.isFinite(base.energy) && base.gradient.every(Number.isFinite));
      assert.ok(Math.abs(base.energy)>1e-12);
      const doubled=evaluate(elements,perturbed,{...defaultMaterial,[parameter]:2*defaultMaterial[parameter]},g);
      equal(doubled.energy,2*base.energy);
      for(const [i,gradient] of base.gradient.entries()){
        equal(doubled.gradient[i],2*gradient);
        const h=1e-7, plus=[...perturbed], minus=[...perturbed];
        plus[i]+=h; minus[i]-=h;
        const fd=(evaluate(elements,plus,defaultMaterial,g).energy-evaluate(elements,minus,defaultMaterial,g).energy)/(2*h);
        equal(fd,gradient,2e-8);
      }
      if(parameter==='mass_per_area_kg_m2'){
        const weight=base.gradient.filter((_,i)=>i%3===2).reduce((s,x)=>s+x,0);
        equal(weight,mesh.quality.area_m2*defaultMaterial.mass_per_area_kg_m2*9.81);
      }
    }
  }
});

test('both angle and mesh levels deform at the free lobes with gravity and preserve exact pins',()=>{
  for(const angle of [60,90]) for(const level of [0,1]){
    const m=buildButterflyMesh(config,angle,level);
    const rest=equilibrium(m,defaultMaterial,defaultSolver,zero);
    assert.ok(rest.converged && Math.abs(rest.energy_J)<1e-24);
    assert.deepEqual(rest.positions,m.reference);
    const loaded=equilibrium(m,defaultMaterial,defaultSolver,gravity);
    assert.ok(loaded.converged && Number.isFinite(loaded.energy_J));
    assert.ok(loaded.residual_N_m2<=defaultSolver.residual_tolerance_N_m2);
    for(const id of m.pins) assert.deepEqual(point(loaded.positions,id),point(m.reference,id));
    const before=sampleMarkers(m,rest.positions), after=sampleMarkers(m,loaded.positions);
    assert.ok(Object.keys(before).every(name=>norm(sub(before[name],after[name]))>1e-6));
    for(const state of [rest,loaded]){
      const result=diagnose(m,state.positions,angle);
      assert.equal(result.status,'valid');
      assert.ok(result.sweeps.every(s=>!s.contacts.length&&!s.boundary_candidates.length));
    }
  }
  const m=buildButterflyMesh(config,90);
  const failed=equilibrium(m,defaultMaterial,{...defaultSolver,max_iterations:1},gravity);
  assert.equal(failed.converged,false);
  assert.equal(failed.reason,'iteration_limit');
});

test('the new topology exposes artificial page crossings and opposing-panel and same-panel intersections',()=>{
  const m=buildButterflyMesh(config,90);
  const fore=m.markers.find(x=>x.name==='left_forewing').ids[0];
  const crossed=[...m.reference]; crossed[3*fore+2]=-0.08;
  assert.ok(diagnose(m,crossed,90).sweeps[1].contacts.some(x=>x.category==='panel_page'));
  const overlap=[...m.reference];
  for(const id of m.boundaries[0]) if(!m.pins.includes(id)) overlap[3*id]*=-1;
  assert.ok(diagnose(m,overlap,90).sweeps[1].contacts.some(x=>x.category==='between_panels'));
  const folded=[...m.reference];
  const right=m.markers.find(x=>x.name==='left_hindwing').ids[0];
  folded.splice(3*fore,3,...point(folded,right));
  assert.ok(diagnose(m,folded,90).sweeps[1].contacts.some(x=>x.category==='within_panel'));
  crossed[0]=NaN;
  assert.equal(diagnose(m,crossed,90).status,'unresolved');
});
