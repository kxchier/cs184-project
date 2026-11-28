import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { buildMesh, equilibrium, makeReport } from '../viewer/flexible.js';
import { matrix } from './angle-convergence.mjs';
import { bookPages, classifyGeometry } from './geometry-validity.mjs';

const sub = (a, b) => a.map((x, i) => x - b[i]);
const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
const norm = a => Math.hypot(...a);
const mix = (a, b, t) => a.map((x, i) => x + t * (b[i] - x));
const unit = a => a.map(x => x / norm(a));
const cross = ([x,y,z], [a,b,c]) => [y*c-z*b, z*a-x*c, x*b-y*a];
const point = (flat, i) => flat.slice(3*i, 3*i+3);
const finite = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
const faceIds = [[0,1,2], [0,2,3]];
const pairKey = ids => ids.join(':');

function featureDistance(p, feature) {
  if (!feature.length) return Infinity;
  const [a,b=a] = feature;
  const v = sub(b,a);
  const t = dot(v,v) ? Math.max(0, Math.min(1, dot(sub(p,a),v)/dot(v,v))) : 0;
  return norm(sub(p,mix(a,b,t)));
}

// Orthogonal page coordinates in metres. The face diagonal is u/width = v/height.
function pageFrame(quad) {
  if (quad?.length !== 4 || !quad.every(finite)) throw Error('Invalid page vertices');
  const [o, b, c, d] = quad;
  const u = sub(b,o), v = sub(d,o);
  const width = norm(u), height = norm(v);
  const error = 64 * Number.EPSILON * Math.max(...quad.flat().map(Math.abs), width, height);
  if (width <= error || height <= error || Math.abs(dot(unit(u),v)) > error ||
      norm(sub(sub(c,d),u)) > error) throw Error('Page must be a nondegenerate rectangle');
  const x = unit(u), y = unit(v), z = unit(cross(x,y));
  return { width, height, project(p) { const q = sub(p,o); return [dot(q,x),dot(q,y),dot(q,z)]; } };
}

function margins([u,v], { width:w, height:h }, face) {
  const diagonal = (h*u-w*v)/Math.hypot(w,h);
  return face === 0 ? [v,w-u,diagonal] : [u,h-v,-diagonal];
}

// Clip an interval parametrically using the page-local half-planes.
function clipSegment(a,b,frame,face,inset) {
  const start = margins(frame.project(a),frame,face);
  const end = margins(frame.project(b),frame,face);
  let lo=0, hi=1;
  for (let i=0;i<3;i++) {
    const x=start[i]-inset, y=end[i]-inset;
    if (x<0 && y<0) return [];
    if (x<0) lo=Math.max(lo,x/(x-y));
    if (y<0) hi=Math.min(hi,x/(x-y));
  }
  return hi>=lo ? [mix(a,b,lo),mix(a,b,hi)] : [];
}

function clipPolygon(vertices,frame,face,inset) {
  let polygon=vertices;
  for(let i=0;i<3;i++) {
    polygon=polygon.flatMap((a,j)=>{
      const b=polygon[(j+1)%polygon.length];
      const x=margins(frame.project(a),frame,face)[i]-inset;
      const y=margins(frame.project(b),frame,face)[i]-inset;
      return [...(x>=0?[a]:[]), ...(x*y<0?[mix(a,b,x/(x-y))]:[])];
    });
  }
  return polygon;
}

function inspectFace(triangle, frame, face, allowed, tolerance, roundoff) {
  const heights=triangle.map(p=>frame.project(p)[2]);
  const slice=[];
  for(const [i,a] of triangle.entries()) {
    const j=(i+1)%3, x=heights[i], y=heights[j];
    if (x===0) slice.push(a);
    else if (x*y<0) slice.push(mix(a,triangle[j],x/(x-y)));
  }
  const transverse=Math.min(...heights)<-roundoff && Math.max(...heights)>roundoff;
  const edge=heights.filter(x=>x===0).length===2;
  const coplanar=heights.every(x=>x===0);
  const extendsBeyond=points=>points.some(p=>featureDistance(p,allowed)>4*tolerance);
  if ((transverse||edge) && slice.length===2) {
    const clipped=clipSegment(...slice,frame,face,roundoff);
    if (clipped.length===2 && norm(sub(...clipped))>roundoff && extendsBeyond(clipped)) {
      return { status:'confirmed', kind:transverse?'transverse-crossing':'tangential-edge', witnesses_m:clipped };
    }
  }
  if (coplanar) {
    const clipped=clipPolygon(triangle,frame,face,roundoff);
    const area=clipped.slice(1,-1).reduce((sum,p,i)=>
      sum+norm(cross(sub(p,clipped[0]),sub(clipped[i+2],clipped[0])))/2,0);
    if(area>roundoff*Math.max(frame.width,frame.height) && extendsBeyond(clipped)) {
      return {status:'confirmed',kind:'coplanar-overlap',witnesses_m:clipped};
    }
  }
  // A wide slab preserves doubt without promoting proximity to intersection.
  const near=slice.concat(triangle.filter((_,i)=>Math.abs(heights[i])<=tolerance));
  const candidate=near.flatMap((a,i)=>near.slice(i).flatMap(b=>
    clipSegment(a,b,frame,face,-tolerance)));
  return extendsBeyond(candidate) ? {status:'candidate',kind:'boundary-candidate'} : {status:'clear'};
}

function usableTriangle(triangle,roundoff) {
  return triangle?.length===3 && triangle.every(finite) &&
    norm(cross(sub(triangle[1],triangle[0]),sub(triangle[2],triangle[0]))) >
    roundoff*Math.max(norm(sub(triangle[1],triangle[0])),norm(sub(triangle[2],triangle[0])));
}

export function inspectPageTriangle(triangle,quad,face,allowed,tolerance,roundoff) {
  if(!usableTriangle(triangle,roundoff)) return {status:'unresolved'};
  return inspectFace(triangle,pageFrame(quad),face,allowed,tolerance,roundoff);
}

function onTriangle(p,[a,b,c],epsilon) {
  const u=sub(b,a), v=sub(c,a), q=sub(p,a), n=cross(u,v);
  const area=norm(n);
  if(!area || Math.abs(dot(q,n))/area>epsilon) return false;
  // Signed distances to the three edges, measured in the triangle plane.
  return [[a,b],[b,c],[c,a]].every(([x,y])=>
    dot(cross(sub(y,x),sub(p,x)),n)/(norm(sub(y,x))*area)>=-epsilon);
}

export function summarizeContacts(hits) {
  const counts={transverse_crossings:0,tangential_edges:0,coplanar_overlaps:0};
  for(const hit of hits) {
    if(hit.kind==='transverse-crossing') counts.transverse_crossings++;
    else if(hit.kind==='tangential-edge') counts.tangential_edges++;
    else if(hit.kind==='coplanar-overlap') counts.coplanar_overlaps++;
  }
  return counts;
}

export function numericalGate(reference,solution,report) {
  if (!solution.converged || !solution.positions.every(Number.isFinite) ||
      !Number.isFinite(solution.residual_N_m2) ||
      solution.residual_N_m2>reference.solver_settings.residual_tolerance_N_m2) return 'solver_failure';
  if (reference.status!=='converged' || solution.energy_J!==reference.energy_J || ['landmarks','diagnostics','convergence']
    .some(key=>!isDeepStrictEqual(report[key],reference[key]))) return 'reference_mismatch';
  return null;
}

function verifyPages(mesh,positions,pages,diagnostic,tolerances) {
  const frames=pages.map(pageFrame), pins=new Set(mesh.pins);
  return diagnostic.sweeps.map(sweep=>{
    const tolerance=tolerances.distance_m*sweep.multiplier;
    const roundoff=diagnostic.page_roundoff_m;
    const confirmed=[], candidates=[], invalid_triangles=[];
    for(const [i,t] of mesh.triangles.entries()) {
      const triangle=t.ids.map(id=>point(positions,id));
      if(!usableTriangle(triangle,roundoff) || diagnostic.degenerate_triangles.includes(i)) {
        invalid_triangles.push(i);
        continue;
      }
      for(const [page,frame] of frames.entries()) {
        const allowed=t.ids.filter(id=>pins.has(id)).map(id=>point(mesh.reference,id)).filter(p=>{
          const [u,v,h]=frame.project(p), e=tolerances.attachment_m;
          return Math.abs(h)<=e && u>=-e && u<=frame.width+e && v>=-e && v<=frame.height+e;
        });
        for(let face=0;face<2;face++) {
          const hit=inspectFace(triangle,frame,face,allowed,tolerance,roundoff);
          if(hit.status==='confirmed') confirmed.push({ids:[i,page,face],...hit});
          if(hit.status==='candidate') candidates.push([i,page,face]);
        }
      }
    }
    const primaryCandidates=sweep.boundary_candidates.filter(h=>h.category==='panel_page').map(h=>h.ids);
    const primaryCandidateKeys=new Set(primaryCandidates.map(pairKey));
    const independentCandidateKeys=new Set(candidates.map(pairKey));
    const primary=sweep.contacts.filter(h=>h.category==='panel_page');
    const a=new Set(primary.map(h=>pairKey(h.ids)));
    const b=new Set(confirmed.map(h=>pairKey(h.ids)));
    const check=(ids,witnesses)=>{
      const [i,page,face]=ids;
      const panel=mesh.triangles[i].ids.map(id=>point(positions,id));
      const finiteFace=faceIds[face].map(j=>pages[page][j]);
      return witnesses.length>0 && witnesses.every(p=>finite(p) &&
        onTriangle(p,panel,8*roundoff) && onTriangle(p,finiteFace,8*roundoff));
    };
    return {
      multiplier:sweep.multiplier, confirmed, candidates, invalid_triangles,
      unresolved_candidate_pairs:{
        md3_only:primaryCandidates.filter(ids=>!independentCandidateKeys.has(pairKey(ids))),
        independent_only:candidates.filter(ids=>!primaryCandidateKeys.has(pairKey(ids))),
      },
      md3_only:primary.filter(h=>!b.has(pairKey(h.ids))).map(h=>h.ids),
      independent_only:confirmed.filter(h=>!a.has(pairKey(h.ids))).map(h=>h.ids),
      invalid_witnesses:[
        ...primary.filter(h=>!check(h.ids,h.points_m)).map(h=>({method:'md3',ids:h.ids})),
        ...confirmed.filter(h=>!check(h.ids,h.witnesses_m)).map(h=>({method:'independent',ids:h.ids})),
      ],
    };
  });
}

function runCase(reference,tolerances,md3) {
  const {configuration:c,book_angle_deg:angle,mesh_resolution:n,material,gravity_m_s2:g,solver_settings:settings}=reference;
  const record={id:reference.id,angle_deg:angle,resolution:n,material,convergence:null,
    md2a_match:false, status:'unresolved'};
  try {
    const mesh=buildMesh(c,angle,n), solution=equilibrium(mesh,material,settings,g);
    const report=makeReport(c,angle,mesh,material,settings,solution,0,g);
    record.convergence=report.convergence;
    const reason=numericalGate(reference,solution,report);
    if(reason) return {...record,reason};
    record.md2a_match=true;
    const pages=bookPages(c,angle);
    const geometry=classifyGeometry(mesh,solution.positions,pages,tolerances);
    if(geometry.status==='unresolved') return {...record,reason:geometry.reason,geometry};
    const verification=verifyPages(mesh,solution.positions,pages,geometry,tolerances);
    const agreement=verification.every(v=>!v.md3_only.length && !v.independent_only.length && !v.invalid_witnesses.length);
    const kindSignature=v=>JSON.stringify(v.confirmed.map(h=>[h.ids,h.kind]));
    const kindsStable=verification.every(v=>kindSignature(v)===kindSignature(verification[1]));
    const original=md3.get(reference.id);
    const md3_match=original ? Object.keys(geometry).every(k=>isDeepStrictEqual(geometry[k],original[k])) &&
      isDeepStrictEqual(solution.positions,original.positions_m) : null;
    const unresolved=!agreement || !kindsStable || md3_match===false || verification.some(v=>v.invalid_triangles.length);
    const boundary=verification.some(v=>v.candidates.length) && geometry.status==='valid';
    return {...record, geometry, verification, agreement, md3_match,
      confirmed_page_contacts:!unresolved && !boundary && ['valid','invalid'].includes(geometry.status)
        ? summarizeContacts(verification[1].confirmed) : null,
      status:unresolved?'unresolved':boundary?'ambiguous':geometry.status,
      reason:unresolved?'verification_disagreement':boundary?'independent_boundary_candidate':null};
  } catch(error) {
    return {...record,reason:'execution_failure',detail:error.message};
  }
}

function analyze(reference,cases) {
  const statuses=new Map(cases.map(c=>[c.id,c.status]));
  const classify=ids=>ids.map(id=>statuses.get(id));
  const refinement=reference.comparisons.map(comparison=>({...comparison,
    endpoint_statuses:classify([comparison.coarse_id,comparison.fine_id])}));
  const material=[];
  for(const a of reference.runs) for(const factor of ['mass_per_area_kg_m2','bending_stiffness_N_m']) {
    const other=factor==='mass_per_area_kg_m2'?'bending_stiffness_N_m':'mass_per_area_kg_m2';
    const b=reference.runs.find(b=>b.book_angle_deg===a.book_angle_deg && b.mesh_resolution===a.mesh_resolution &&
      b.material[other]===a.material[other] && b.material[factor]>a.material[factor]);
    if(!b) continue;
    const fixed=new Set(['spine_origin','left_wing_tip','right_wing_tip']);
    const byName=new Map(b.landmarks.map(p=>[p.name,p]));
    const ids=[a.id,b.id], endpoint_statuses=classify(ids);
    const usable=endpoint_statuses.every(status=>status==='valid'||status==='invalid');
    material.push({ids,factor,angle_deg:a.book_angle_deg,resolution:a.mesh_resolution,endpoint_statuses,
      rms_deformation_change_mm:usable?1000*(b.diagnostics.rms_displacement_m-a.diagnostics.rms_displacement_m):null,
      max_free_landmark_shift_mm:usable?1000*Math.max(...a.landmarks.filter(p=>!fixed.has(p.name)).map(p=>
        norm(sub(p.deformed_m,byName.get(p.name).deformed_m)))):null});
  }
  return {refinement,material};
}

const angles=[60,90,120,150];
const resolutions=[4,8,12,16];
const states=['valid','invalid','ambiguous','unresolved'];
const labels=['No violation detected','Violation detected','Ambiguous','Unresolved'];

function table(rows) {
  return rows.map(row=>'| '+row.join(' | ')+' |').join('\n');
}

const disputedCandidates=c=>c.verification?.some(v=>
  Object.values(v.unresolved_candidate_pairs).some(ids=>ids.length)) ?? false;

export function markdown({cases,refinement,material}) {
  const group=rows=>{
    const counts=[0,0,0];
    for(const {endpoint_statuses:s} of rows) {
      counts[s.some(x=>x==='ambiguous'||x==='unresolved')?2:s.includes('invalid')?1:0]++;
    }
    return counts;
  };
  const verified=c=>c.md2a_match && c.agreement && c.status==='invalid';
  const countCases=field=>cases.filter(c=>verified(c) && c.confirmed_page_contacts?.[field]>0).length;
  const outcome=c=>{
    if(!c || !c.md2a_match || !c.agreement || c.status==='unresolved') return 'unresolved';
    if(c.status==='ambiguous') return 'ambiguous';
    if(c.status==='valid') return 'no violation detected';
    const counts=c.confirmed_page_contacts;
    if(counts?.transverse_crossings) return 'transverse crossing';
    const contacts=[];
    if(counts?.tangential_edges) contacts.push('tangential edge contact');
    if(counts?.coplanar_overlaps) contacts.push('coplanar overlap');
    return contacts.join(' and ') || 'other detected violation';
  };
  const byId=new Map(cases.map(c=>[c.id,c]));
  const agree=cases.filter(c=>c.agreement).length;
  const candidateDiff=cases.filter(disputedCandidates);
  const casesTable=table([['Angle',...labels],['---:',...states.map(()=>'---:')],
    ...angles.map(a=>[a+'°',...states.map(s=>cases.filter(c=>c.angle_deg===a && c.status===s).length)])]);
  const comparisonsTable=table([
    ['Comparison','Both clear','Includes detected violation','Ambiguous or unresolved','Total'],
    ['---','---:','---:','---:','---:'],
    ['Refinement',...group(refinement),refinement.length],
    ...['mass_per_area_kg_m2','bending_stiffness_N_m'].map((factor,i)=>{
      const rows=material.filter(c=>c.factor===factor);
      return [i?'Stiffness':'Mass',...group(rows),rows.length];
    }),
  ]);
  const unresolved=cases.filter(c=>c.status==='unresolved'||c.status==='ambiguous');
  const caseNotes=unresolved.length?unresolved.map(c=>`- \`${c.id}\` — ${c.reason??'tolerance-sensitive or boundary-only result'}`).join('\n'):'No whole case was ambiguous or unresolved.';
  const candidateNotes=candidateDiff.length
    ? 'Candidate sets differ for '+candidateDiff.map(c=>'\`'+c.id+'\`').join(', ')+
      '. The independent search clips the convex hull of near-plane vertices and plane-slice points, while MD3 also checks edges in both directions. The JSON retains the disputed face IDs and tolerances. These candidates do not enter any confirmed-contact count.'
    : 'The two methods returned the same boundary-candidate pair sets.';
  const finest=material.filter(c=>c.resolution===16);
  const endpointText=ids=>ids.map(id=>outcome(byId.get(id))).join(' → ');
  const interpretable=ids=>ids.every(id=>!['ambiguous','unresolved'].includes(outcome(byId.get(id))));
  const value=(x,ids)=>interpretable(ids) && Number.isFinite(x)?x.toFixed(3):'—';
  const massTable=table([
    ['Angle','Stiff: RMS change (mm)','Stiff endpoints','Soft: RMS change (mm)','Soft endpoints'],
    ['---:','---:','---','---:','---'],
    ...angles.map(angle=>[angle+'°',...[2e-5,2e-6].flatMap(stiffness=>{
      const row=finest.find(r=>r.angle_deg===angle && r.factor==='mass_per_area_kg_m2' &&
        byId.get(r.ids[0])?.material.bending_stiffness_N_m===stiffness);
      return row?[value(row.rms_deformation_change_mm,row.ids),endpointText(row.ids)]:['—','unresolved'];
    })]),
  ]);
  const fineSoft=refinement.filter(r=>{
    const c=byId.get(r.fine_id);
    return c?.angle_deg>=120 && c.resolution===16 && c.material.bending_stiffness_N_m===2e-6;
  });
  const refinementTable=table([
    ['Angle','Mass (kg/m²)','Maximum 12→16 landmark shift (mm)','Endpoints'],
    ['---:','---:','---:','---'],
    ...fineSoft.map(r=>{
      const c=byId.get(r.fine_id), ids=[r.coarse_id,r.fine_id];
      return [c.angle_deg+'°',c.material.mass_per_area_kg_m2,value(r.max_mm,ids),endpointText(ids)];
    }),
  ]);
  const crossingWithAgreement=fineSoft.some(r=>Number.isFinite(r.max_mm) && r.max_mm<0.02 &&
    [r.coarse_id,r.fine_id].every(id=>outcome(byId.get(id))==='transverse crossing'));
  const finestTable=table([['Angle','Mass contrasts with clear endpoints','Stiffness contrasts with clear endpoints'],
    ['---:','---:','---:'],...angles.map(a=>[a+'°',...['mass_per_area_kg_m2','bending_stiffness_N_m'].map(f=>{
      const rows=finest.filter(c=>c.angle_deg===a&&c.factor===f);
      return rows.filter(c=>c.ids.every(id=>outcome(byId.get(id))==='no violation detected')).length+' / '+rows.length;
    })])]);
  return `# Finite-page admissibility across the MD2A grid

Which angle and material comparisons involve a low-residual V-fold that crosses a finite page? We re-solved the committed 64-case MD2A grid without changing the static, zero-thickness model, illustrative material inputs, or solver settings. Numerical agreement requires identical named landmarks, deformation diagnostics, energy, and convergence metadata. The eight MD3 configurations also require identical solved positions and diagnostic records.

MD3 and an independent page-local calculation both check the finite page faces. The independent method projects each panel triangle into orthogonal page coordinates, slices it at the page plane, and clips the interval against the bounded face. Coplanar polygons are clipped directly. The inward roundoff margin prevents proximity from certifying overlap. Both methods exclude contact confined to intended pinned features and report boundary candidates separately. Confirmed witnesses from both methods are checked against the panel and page triangles.

## Results

${casesTable}

${agree} of ${cases.length} cases agreed on the exact confirmed page-face identities at all three tolerances and passed witness checks. Verified contacts by case: **${countCases('transverse_crossings')} of ${cases.length} transverse crossings**, ${countCases('tangential_edges')} tangential edge contacts, and ${countCases('coplanar_overlaps')} coplanar overlaps. A case can contribute to more than one contact category. Confirmed unintended tangential edges and coplanar overlaps count as violations but do not enter the transverse-crossing count. Numerical convergence means the force-residual criterion was met. A clear label means the diagnostic found no violation of the tested geometry.

${caseNotes}

${candidateNotes}

![Admissibility by angle, material and mesh](admissibility-grid.svg)

## Refinement and material comparisons

${comparisonsTable}

Each comparison retains both endpoint labels. The JSON also retains the 48 original refinement metrics and the signed change in RMS deformation and maximum matched free-landmark shift for material contrasts with resolved endpoints. A comparison involving a detected violation still describes the unconstrained numerical solution. It has weaker evidence for an admissible geometry.

On the finest mesh, the numbers of material contrasts with two clear endpoints are:

${finestTable}

### Mass contrasts on the finest mesh

${massTable}

The signed change is heavier minus lighter. A dash marks a contrast withheld because an endpoint is missing or unresolved.

### Fine-mesh checks for soft material at large angles

${refinementTable}

${crossingWithAgreement?'At least one fine-mesh pair has a maximum sampled landmark shift below 0.02 mm with verified transverse crossings at both endpoints. Refinement agreement and a small force residual can therefore coexist with geometric invalidity. ':''}This analysis leaves the cause of the mesh-dependent equilibrium change open.

Pair counts depend on tessellation and do not measure penetration severity. The check covers finite nominal page surfaces, with neither thickness nor contact response. Panel self-contact checks come from MD3 and are outside the independent page verifier. Static equilibria with uncalibrated material inputs cannot establish physical accuracy, continuum convergence, or unfolding dynamics.

Run \`node experiments/admissibility-grid.mjs\` to regenerate the [full data](admissibility-grid.json), this report, and the figure.
`;
}

export function figure(cases) {
  const colors=['#d9ede5','#f4b4aa','#ffe3a2','#d9dbe0'];
  const symbols=['✓','×','?','–'];
  const materials=[[.08,2e-6],[.08,2e-5],[.16,2e-6],[.16,2e-5]];
  const svg=['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 790 434" role="img" aria-labelledby="title">',
    '<title id="title">Finite-page admissibility across the MD2A grid</title>',
    '<rect width="790" height="434" fill="white"/>',
    '<g font-family="system-ui,sans-serif" fill="#1e2d38">',
    '<text x="24" y="32" font-size="22" font-weight="600">Finite-page admissibility across the MD2A grid</text>',
    '<text x="24" y="56" font-size="13">Columns within each angle show subdivisions per panel edge</text>'];
  for(const [i,angle] of angles.entries()) {
    const x=204+140*i;
    svg.push(`<text x="${x+59}" y="86" text-anchor="middle" font-size="15">${angle}°</text>`);
    for(const [j,n] of resolutions.entries()) svg.push(`<text x="${x+15+j*30}" y="108" text-anchor="middle" font-size="12">${n}</text>`);
    for(const [k,[mass,stiffness]] of materials.entries()) {
      const y=120+50*k;
      if(i===0) svg.push(`<text x="24" y="${y+24}" font-size="13">${mass.toFixed(2)} kg/m² · ${stiffness===2e-6?'2e−6':'2e−5'} N·m</text>`);
      for(const [j,n] of resolutions.entries()) {
        const row=cases.find(c=>c.angle_deg===angle&&c.resolution===n&&
          c.material.mass_per_area_kg_m2===mass&&c.material.bending_stiffness_N_m===stiffness);
        const state=states.indexOf(row.status), cell=x+30*j;
        const mark=disputedCandidates(row)?'*':'';
        svg.push(`<rect x="${cell+2}" y="${y}" width="26" height="36" rx="3" fill="${colors[state]}"/>`,
          `<text x="${cell+15}" y="${y+24}" text-anchor="middle" font-size="16">${symbols[state]}${mark}</text>`);
      }
    }
  }
  for(const [i,label] of labels.entries()) {
    const x=24+190*i;
    svg.push(`<rect x="${x}" y="343" width="22" height="22" rx="3" fill="${colors[i]}"/>`,
      `<text x="${x+11}" y="359" text-anchor="middle" font-size="14">${symbols[i]}</text>`,
      `<text x="${x+28}" y="359" font-size="12">${label}</text>`);
  }
  svg.push('<text x="24" y="386" font-size="12">Each cell represents one static equilibrium.</text>',
    '<text x="24" y="408" font-size="12">* Disputed boundary candidates. The cell symbol still shows the whole-case classification.</text>','</g>','</svg>');
  return svg.join('\n')+'\n';
}

function main() {
  const read=name=>JSON.parse(readFileSync(new URL('../results/'+name+'.json',import.meta.url)));
  const reference=read('angle-convergence'), previous=read('geometry-validity');
  const baseline=JSON.parse(readFileSync(new URL('../configs/baseline.json',import.meta.url)));
  const specifications=reference.runs.map(r=>({id:r.id, angle:r.book_angle_deg,
    mass:r.material.mass_per_area_kg_m2, stiffness:r.material.bending_stiffness_N_m, resolution:r.mesh_resolution}));
  if (!isDeepStrictEqual(specifications,matrix()) || reference.runs.some(r=>
    !isDeepStrictEqual(r.configuration,baseline) ||
    !isDeepStrictEqual(r.gravity_m_s2, previous.gravity_m_s2) ||
    !isDeepStrictEqual(r.solver_settings, previous.solver_settings) ||
    r.material.stretching_modulus_N_m!==previous.stretching_modulus_N_m ||
    r.material.poisson_ratio!==previous.poisson_ratio) || reference.comparisons.length!==48) throw Error('Unexpected MD2A reference matrix');
  const md3=new Map(previous.cases.map(c=>[c.id,c]));
  const cases=reference.runs.map(r=>runCase(r,previous.tolerances,md3));
  const result={schema_version:2, reference_files:['angle-convergence.json','geometry-validity.json'],
    configuration:reference.runs[0].configuration, gravity_m_s2:reference.runs[0].gravity_m_s2,
    solver_settings:reference.runs[0].solver_settings, tolerances:previous.tolerances,
    cases,...analyze(reference,cases)};
  for(const [ext,value] of [['json',JSON.stringify(result,null,2)+'\n'],['md',markdown(result)],['svg',figure(cases)]]) {
    writeFileSync(new URL('../results/admissibility-grid.'+ext,import.meta.url),value);
  }
  console.log(Object.fromEntries(states.map(s=>[s,cases.filter(c=>c.status===s).length])));
  if(cases.some(c=>c.status==='unresolved')) process.exitCode=1;
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href===import.meta.url) main();
