import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { figure, inspectPageTriangle, markdown, numericalGate, summarizeContacts } from '../experiments/admissibility-grid.mjs';

const page=[[0,0,0],[1,0,0],[1,1,0],[0,1,0]];
const roundoff=64*Number.EPSILON;
const classify=(triangle,face=0,allowed=[],tolerance=1e-8)=>
  inspectPageTriangle(triangle,page,face,allowed,tolerance,roundoff).status;

test('independent clipping distinguishes the finite face, outer edge, and diagonal',()=>{
  assert.equal(classify([[.7,.2,-1],[.7,.2,1],[.7,.4,0]]),'confirmed');
  assert.equal(classify([[1.1,.2,-1],[1.1,.2,1],[1.1,.4,0]]),'clear');
  const diagonal=[[.2,.2,-1],[.2,.2,1],[.4,.4,0]];
  assert.equal(classify(diagonal,0),'candidate');
  assert.equal(classify(diagonal,1),'candidate');
  const across=[[.3,.2,-1],[.3,.2,1],[.3,.5,0]];
  assert.equal(classify(across,0),'confirmed');
  assert.equal(classify(across,1),'confirmed');
});

test('exempt features allow attachment contact but not a crossing that extends beyond them',()=>{
  const pin=[.4,.2,0], second=[.8,.2,0];
  assert.equal(classify([pin,second,[.6,.3,1]],0,[pin,second]),'clear');
  assert.equal(classify([pin,[.7,.2,-1],[.7,.4,1]],0,[pin]),'confirmed');
  assert.equal(classify([[0,0,0],[-1,0,1],[0,-1,1]],0,[[0,0,0]]),'clear');
});

test('coplanar area overlap is confirmed while point, edge and near-plane contacts are candidates',()=>{
  assert.equal(classify([[.3,.1,0],[.6,.1,0],[.6,.3,0]]),'confirmed');
  assert.equal(classify([[.1,0,0],[.4,0,0],[.2,-.1,0]]),'candidate');
  assert.equal(classify([[.3,.1,0],[.6,.1,1],[.6,.3,1]]),'candidate');
  assert.equal(classify([[.3,.1,1e-15],[.6,.1,1e-15],[.6,.3,1e-15]]),'candidate');
});

test('near misses remain candidates even when all tolerance levels agree',()=>{
  for(const tolerance of [1e-9,1e-8,1e-7]) {
    const slice=x=>[[x,.2,-1],[x,.2,1],[x,.4,0]];
    assert.equal(classify(slice(1+5e-12),0,[],tolerance),'candidate');
    assert.equal(classify(slice(1-5e-12),0,[],tolerance),'confirmed');
  }
});

test('degenerate or nonfinite panels are unresolved and malformed pages are rejected',()=>{
  assert.equal(classify([[0,0,0],[1,0,0],[2,0,0]]),'unresolved');
  assert.equal(classify([[0,0,0],[1,0,0],[NaN,1,0]]),'unresolved');
  assert.throws(()=>inspectPageTriangle([[0,0,0],[1,0,0],[0,1,0]],
    [[0,0,0],[0,0,0],[1,1,0],[0,1,0]],0,[],1e-8,roundoff),/rectangle/);
});

test('numerical gate distinguishes a failed solve from a reference mismatch',()=>{
  const report={landmarks:[],diagnostics:{},convergence:{}};
  const reference={...report,status:'converged',energy_J:1,solver_settings:{residual_tolerance_N_m2:.005}};
  const solved={converged:true,positions:[0,0,0],residual_N_m2:.004,energy_J:1};
  assert.equal(numericalGate(reference,solved,report),null);
  assert.equal(numericalGate(reference,{...solved,converged:false},report),'solver_failure');
  assert.equal(numericalGate(reference,{...solved,positions:[NaN]},report),'solver_failure');
  assert.equal(numericalGate(reference,{...solved,energy_J:2},report),'reference_mismatch');
  assert.equal(numericalGate(reference,solved,{...report,landmarks:[1]}),'reference_mismatch');
});

test('saved grid preserves case IDs, refinement endpoints, and independent pair identity accounting',()=>{
  const read=name=>JSON.parse(readFileSync(new URL('../results/'+name+'.json',import.meta.url)));
  const d=read('admissibility-grid'), ref=read('angle-convergence');
  assert.deepEqual(d.cases.map(c=>c.id),ref.runs.map(c=>c.id));
  assert.equal(new Set(d.cases.map(c=>c.id)).size,64);
  assert.equal(d.material.length,64);
  assert.deepEqual(d.refinement.map(({endpoint_statuses,...r})=>r),ref.comparisons);
  const statuses=new Map(d.cases.map(c=>[c.id,c.status]));
  for(const row of [...d.refinement,...d.material]) {
    const ids=row.ids??[row.coarse_id,row.fine_id];
    assert.deepEqual(row.endpoint_statuses,ids.map(id=>statuses.get(id)));
  }
  for(const c of d.cases) for(const [i,v] of (c.verification??[]).entries()) {
    const mk=ids=>ids.join(':');
    const primary=c.geometry.sweeps[i].contacts.filter(h=>h.category==='panel_page').map(h=>mk(h.ids));
    const independent=v.confirmed.map(h=>mk(h.ids));
    assert.equal(new Set(independent).size,independent.length);
    assert.deepEqual(v.md3_only.map(mk),primary.filter(id=>!independent.includes(id)));
    assert.deepEqual(v.independent_only.map(mk),independent.filter(id=>!primary.includes(id)));
    const md3Candidates=c.geometry.sweeps[i].boundary_candidates
      .filter(h=>h.category==='panel_page').map(h=>mk(h.ids));
    const candidates=v.candidates.map(mk);
    assert.deepEqual(v.unresolved_candidate_pairs.md3_only.map(mk),
      md3Candidates.filter(id=>!candidates.includes(id)));
    assert.deepEqual(v.unresolved_candidate_pairs.independent_only.map(mk),
      candidates.filter(id=>!md3Candidates.includes(id)));
  }
});

test('paper counts separate transverse crossings, tangent edges, and coplanar overlap',()=>{
  const fixtures=[
    {triangle:[[.6,.1,0],[.8,.2,0],[.7,.2,1]], status:'invalid', kind:'tangential-edge'},
    {triangle:[[.7,.2,-1],[.7,.2,1],[.7,.4,0]], status:'invalid', kind:'transverse-crossing'},
    {triangle:[[.3,.1,0],[.6,.1,0],[.6,.3,0]], status:'invalid', kind:'coplanar-overlap'},
    {triangle:[[.3,.1,0],[.6,.1,1],[.6,.3,1]], status:'ambiguous', kind:'boundary-candidate'},
    {triangle:[[.3,.1,0],[.6,.1,0],[.6,.3,1]], allowed:[[.3,.1,0],[.6,.1,0]], status:'valid'},
    {triangle:[[1+5e-12,.2,-1],[1+5e-12,.2,1],[1+5e-12,.4,0]], status:'ambiguous', kind:'boundary-candidate'},
  ];
  const cases=fixtures.map(({triangle,allowed=[],status,kind},i)=>{
    const hit=inspectPageTriangle(triangle,page,0,allowed,1e-8,roundoff);
    assert.equal(hit.kind,kind);
    return {id:String(i),angle_deg:60,status,agreement:true,md2a_match:true,
      confirmed_page_contacts:summarizeContacts(hit.status==='confirmed'?[hit]:[])};
  });
  const render=cases=>markdown({cases,refinement:[],material:[]});
  assert.match(render(cases),/1 of 6 transverse crossings\*\*, 1 tangential edge contacts, and 1 coplanar overlaps/);
  assert.match(render([cases[0],cases[2]]),/0 of 2 transverse crossings/);
  assert.match(render(cases.slice(3)),/0 of 3 transverse crossings/);
});

test('an unresolved fine-mesh endpoint cannot appear as clear or crossing in the Markdown',()=>{
  const d=JSON.parse(readFileSync(new URL('../results/admissibility-grid.json',import.meta.url)));
  const c=d.cases.find(c=>c.angle_deg===150 && c.resolution===16 &&
    c.material.mass_per_area_kg_m2===.16 && c.material.bending_stiffness_N_m===2e-5);
  Object.assign(c,{status:'unresolved',reason:'reference_mismatch',md2a_match:false});
  const report=markdown(d);
  assert.match(report,/11 of 64 transverse crossings/);
  assert.match(report,/reference_mismatch/);
  assert.match(report,/\| 150° \| — \| no violation detected → unresolved \|/);
  assert.doesNotMatch(report,/\| 150° \| 0\.604 \|/);
});

test('the SVG marks candidate disagreements without changing their whole-case symbols',()=>{
  const d=JSON.parse(readFileSync(new URL('../results/admissibility-grid.json',import.meta.url)));
  const svg=figure(d.cases);
  const disputed=d.cases.filter(c=>c.verification?.some(v=>
    Object.values(v.unresolved_candidate_pairs).some(ids=>ids.length)));
  assert.ok(disputed.length>0);
  assert.equal((svg.match(/×\*<\/text>/g)??[]).length,disputed.length);
  assert.match(svg,/Disputed boundary candidates/);
});
