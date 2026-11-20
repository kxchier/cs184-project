// SI units. Isometric quadratic bending + StVK membrane; docs/flexible-model.md.
import { solve } from './model.js';
export const defaultMaterial = { mass_per_area_kg_m2: 0.08, bending_stiffness_N_m: 0.00002,
  stretching_modulus_N_m: 100, poisson_ratio: 0.3, illustrative_uncalibrated: true };

export function uniformSheetMaterial(thickness, density, youngModulus) {
  if (![thickness, density, youngModulus].every(value => Number.isFinite(value) && value > 0)) {
    throw Error('Enter positive thickness, density, and Young’s modulus for a uniform sheet.');
  }
  const nu = defaultMaterial.poisson_ratio;
  return {
    ...defaultMaterial,
    mass_per_area_kg_m2: density * thickness,
    stretching_modulus_N_m: youngModulus * thickness,
    bending_stiffness_N_m: youngModulus * thickness ** 3 / (12 * (1 - nu ** 2)),
  };
}
export const defaultSolver = { max_iterations: 6000, residual_tolerance_N_m2: 0.005,
  lbfgs_history: 12, max_line_search: 40, armijo: 0.0001 };
const dot = (a,b) => a.reduce((s,v,i) => s+v*b[i],0);
const sub = (a,b) => a.map((v,i) => v-b[i]);
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm = a => Math.sqrt(dot(a,a));
const point = (x,i) => x.slice(3*i,3*i+3);
const mix = (a,b,c,u,v) => a.map((x,k) => x*(1-u-v)+b[k]*u+c[k]*v);
const cot = (a,b) => dot(a,b)/norm(cross(a,b));

export function buildMesh(config, angle, resolution = 4) {
  if (!Number.isInteger(resolution) || resolution < 2 || resolution > 24) throw Error('Resolution must be an integer from 2 to 24');
  const p = solve(config, angle).landmarks_m;
  const vertices=[], triangles=[], pins=new Set(), ridge=new Map(), maps=[];
  for (let side=0; side<2; side++) {
    const map=new Map(); maps.push(map);
    const tip=p[side===0?'left_wing_tip':'right_wing_tip'];
    for (let j=0;j<=resolution;j++) for (let i=0;i<=resolution-j;i++) {
      let id;
      if (i===0 && ridge.has(j)) id=ridge.get(j);
      else { id=vertices.length; vertices.push(mix(p.spine_origin,tip,p.ridge_tip,i/resolution,j/resolution)); }
      if(i===0) ridge.set(j,id);
      if(j===0) pins.add(id);
      map.set(`${i},${j}`,id);
    }
    for(let j=0;j<resolution;j++) for(let i=0;i<resolution-j;i++) {
      const add=(ids)=>triangles.push({ids:side===0?ids:[...ids].reverse(),panel:side});
      add([map.get(`${i},${j}`),map.get(`${i+1},${j}`),map.get(`${i},${j+1}`)]);
      if(i+j<resolution-1) add([map.get(`${i+1},${j}`),map.get(`${i+1},${j+1}`),map.get(`${i},${j+1}`)]);
    }
  }
  const reference=vertices.flat(), areas=Array(vertices.length).fill(0), edges=new Map();
  const membranes=triangles.map(({ids,panel},ti)=>{
    const [a,b,c]=ids.map(i=>vertices[i]), e1=sub(b,a),e2=sub(c,a);
    const l=norm(e1),u=dot(e1,e2)/l,v=norm(cross(e1,e2))/l, area=l*v/2;
    ids.forEach(id=>areas[id]+=area/3);
    for(let k=0;k<3;k++) {
      const i=ids[k],j=ids[(k+1)%3], opp=ids[(k+2)%3], key=[Math.min(i,j),Math.max(i,j)].join(',');
      if(!edges.has(key)) edges.set(key,[]);
      edges.get(key).push({i,j,opp,panel,ti,area});
    }
    return { ids, area, inv:[1/l,-u/(l*v),0,1/v] };
  });
  const bends=[];
  for(const adjacent of edges.values()) {
    if(adjacent.length!==2 || adjacent[0].panel!==adjacent[1].panel) continue;
    const [t,s]=adjacent, i=t.i,j=t.j,k=t.opp,l=s.opp;
    const [a,b,c,d]=[i,j,k,l].map(id=>vertices[id]);
    const ci=cot(sub(b,a),sub(c,a)), cj=cot(sub(a,b),sub(c,b));
    const di=cot(sub(b,a),sub(d,a)), dj=cot(sub(a,b),sub(d,b));
    bends.push({ ids:[i,j,k,l], K:[cj+dj,ci+di,-ci-cj,-di-dj], factor:3/(t.area+s.area) });
  }
  // Material landmarks are barycentric samples, not nearest vertices (stable under refinement).
  const markers=[
    {name:'spine_origin',panel:0,u:0,v:0}, {name:'left_wing_tip',panel:0,u:1,v:0},
    {name:'right_wing_tip',panel:1,u:1,v:0}, {name:'ridge_tip',panel:0,u:0,v:1},
    {name:'left_interior',panel:0,u:1/3,v:1/3}, {name:'right_interior',panel:1,u:1/3,v:1/3},
    {name:'left_free_midpoint',panel:0,u:0.5,v:0.5}, {name:'right_free_midpoint',panel:1,u:0.5,v:0.5},
  ].map(marker=>{
    const {panel,u,v}=marker;
    let i=Math.min(Math.floor(u*resolution),resolution-1), j=Math.min(Math.floor(v*resolution),resolution-1);
    if(i+j>=resolution) { if(i>0)i--;else j--; }
    const du=u*resolution-i,dv=v*resolution-j, map=maps[panel];
    let ids,weights;
    if(du+dv<=1+1e-12) {ids=[map.get(`${i},${j}`),map.get(`${i+1},${j}`),map.get(`${i},${j+1}`)];weights=[1-du-dv,du,dv];}
    else {ids=[map.get(`${i+1},${j}`),map.get(`${i+1},${j+1}`),map.get(`${i},${j+1}`)];weights=[1-dv,du+dv-1,1-du];}
    return {...marker,ids,weights};
  });
  return {resolution, reference, triangles, membranes,bends,areas,pins:[...pins],ridge:[...ridge.values()],maps,markers};
}

export function evaluate(mesh,x,material,gravity=[0,0,-9.81]) {
  const gradient=Array(x.length).fill(0); let energy=0;
  const Y=material.stretching_modulus_N_m,nu=material.poisson_ratio;
  const mu=Y/(2*(1+nu)),lambda=Y*nu/(1-nu*nu);
  for(const {ids,area,inv:[a,b,c,d]} of mesh.membranes) {
    const [p,q,r]=ids.map(i=>point(x,i)), e1=sub(q,p),e2=sub(r,p);
    const f1=e1.map((v,k)=>v*a+e2[k]*c),f2=e1.map((v,k)=>v*b+e2[k]*d);
    const E11=(dot(f1,f1)-1)/2,E22=(dot(f2,f2)-1)/2,E12=dot(f1,f2)/2,tr=E11+E22;
    energy+=area*(mu*(E11*E11+E22*E22+2*E12*E12)+lambda*tr*tr/2);
    const s11=2*mu*E11+lambda*tr,s22=2*mu*E22+lambda*tr,s12=2*mu*E12;
    for(let k=0;k<3;k++) {
      const p1=f1[k]*s11+f2[k]*s12,p2=f1[k]*s12+f2[k]*s22;
      const gq=area*(p1*a+p2*b),gr=area*(p1*c+p2*d);
      gradient[ids[1]*3+k]+=gq;gradient[ids[2]*3+k]+=gr;gradient[ids[0]*3+k]-=gq+gr;
    }
  }
  for(const {ids,K,factor} of mesh.bends) {
    const coefficient=material.bending_stiffness_N_m*factor;
    for(let k=0;k<3;k++) {
      const value=ids.reduce((s,id,i)=>s+K[i]*x[id*3+k],0);
      energy+=coefficient*value*value/2;
      ids.forEach((id,i)=>gradient[id*3+k]+=coefficient*K[i]*value);
    }
  }
  mesh.areas.forEach((area,i)=>{
    const mass=area*material.mass_per_area_kg_m2;
    for(let k=0;k<3;k++) {energy-=mass*gravity[k]*x[i*3+k];gradient[i*3+k]-=mass*gravity[k];}
  });
  return {energy,gradient};
}

function validateSettings(material,settings,gravity) {
  for(const key of ['mass_per_area_kg_m2','bending_stiffness_N_m','stretching_modulus_N_m'])
    if(!Number.isFinite(material[key]) || material[key]<0 || (key==='stretching_modulus_N_m' && material[key]===0)) throw Error(`Invalid ${key}`);
  if(!Number.isFinite(material.poisson_ratio)||material.poisson_ratio<0||material.poisson_ratio>=0.5) throw Error('Poisson ratio must be in [0,0.5)');
  for(const key of ['max_iterations','lbfgs_history','max_line_search'])
    if(!Number.isInteger(settings[key])||settings[key]<1) throw Error(`Invalid ${key}`);
  if(!Number.isFinite(settings.residual_tolerance_N_m2)||settings.residual_tolerance_N_m2<=0||!Number.isFinite(settings.armijo)||settings.armijo<=0||settings.armijo>=1) throw Error('Invalid solver tolerance or Armijo setting');
  if(gravity.length!==3||!gravity.every(Number.isFinite)) throw Error('Invalid gravity vector');
}

export function* relax(mesh, material=defaultMaterial, settings=defaultSolver, gravity=[0,0,-9.81]) {
  validateSettings(material,settings,gravity);
  const pinned=new Set(mesh.pins), history=[]; let x=[...mesh.reference], current=evaluate(mesh,x,material,gravity);
  const project=g=>g.map((v,k)=>pinned.has(Math.floor(k/3))?0:v);
  const residual=g=>Math.max(...mesh.areas.map((area,i)=>pinned.has(i)?0:Math.hypot(...g.slice(i*3,i*3+3))/area));
  let grad=project(current.gradient),iteration=0, reason='iteration_limit';
  for(;iteration<settings.max_iterations;iteration++) {
    const res=residual(grad);
    if(res<=settings.residual_tolerance_N_m2) {reason='force_residual';break;}
    let q=[...grad],alphas=[];
    for(let i=history.length-1;i>=0;i--) {const h=history[i],a=h.rho*dot(h.s,q);alphas[i]=a;q=q.map((v,k)=>v-a*h.y[k]);}
    const last=history.at(-1), scale=last?dot(last.s,last.y)/dot(last.y,last.y):1/material.stretching_modulus_N_m;
    let direction=q.map(v=>v*scale);
    for(let i=0;i<history.length;i++) {const h=history[i],b=h.rho*dot(h.y,direction);direction=direction.map((v,k)=>v+h.s[k]*(alphas[i]-b));}
    direction=direction.map(v=>-v);
    let slope=dot(grad,direction);
    if(slope>=0) {history.length=0;direction=grad.map(v=>-v/material.stretching_modulus_N_m);slope=dot(grad,direction);}
    let step=1,next,trial,accepted=false;
    for(let ls=0;ls<settings.max_line_search;ls++) {
      trial=x.map((v,k)=>v+step*direction[k]); next=evaluate(mesh,trial,material,gravity);
      if(Number.isFinite(next.energy) && next.energy<=current.energy+settings.armijo*step*slope) {accepted=true;break;}
      step*=0.5;
    }
    if(!accepted) {reason='line_search_failed';break;}
    const nextGrad=project(next.gradient),s=sub(trial,x),y=sub(nextGrad,grad),sy=dot(s,y);
    if(sy>1e-20) {history.push({s,y,rho:1/sy});if(history.length>settings.lbfgs_history) history.shift();}
    x=trial;grad=nextGrad;current=next;
    if(iteration%25===0) yield {iteration:iteration+1,residual_N_m2:residual(grad)};
  }
  const res=residual(grad);
  return { positions:x, iterations:iteration, residual_N_m2:res, converged:res<=settings.residual_tolerance_N_m2,
    reason:res<=settings.residual_tolerance_N_m2?'force_residual':reason, energy_J:current.energy };
}
export function equilibrium(mesh,material=defaultMaterial,settings=defaultSolver,gravity=[0,0,-9.81]) {
  const iterator=relax(mesh,material,settings,gravity);let step;do{step=iterator.next();}while(!step.done);return step.value;
}
export function sampleMarkers(mesh,x) {
  return Object.fromEntries(mesh.markers.map(({name,ids,weights})=>[name,[0,1,2].map(k=>ids.reduce((s,id,i)=>s+weights[i]*x[id*3+k],0))]));
}
export function diagnostics(mesh,x) {
  let maxStretch=0,sumStretch=0,count=0,areaSum=0,sumDisplacement=0,maxDisplacement=0;
  const edges=new Set();
  for(const {ids} of mesh.triangles) for(let k=0;k<3;k++) {
    const i=ids[k],j=ids[(k+1)%3],key=[Math.min(i,j),Math.max(i,j)].join(',');if(edges.has(key))continue;edges.add(key);
    const strain=norm(sub(point(x,i),point(x,j)))/norm(sub(point(mesh.reference,i),point(mesh.reference,j)))-1;
    maxStretch=Math.max(maxStretch,Math.abs(strain));sumStretch+=strain*strain;count++;
  }
  mesh.areas.forEach((a,i)=>{const d=norm(sub(point(x,i),point(mesh.reference,i)));sumDisplacement+=a*d*d;areaSum+=a;maxDisplacement=Math.max(maxDisplacement,d);});
  return { rms_displacement_m:Math.sqrt(sumDisplacement/areaSum), max_displacement_m:maxDisplacement,
    max_abs_edge_strain:maxStretch,rms_edge_strain:Math.sqrt(sumStretch/count) };
}
export function makeReport(config,angle,mesh,material,settings,result,computationMs,gravity=[0,0,-9.81]) {
  const reference=sampleMarkers(mesh,mesh.reference),deformed=sampleMarkers(mesh,result.positions);
  return {schema_version:1,model:'quadratic_bending_stvk_ideal_hinges',units:'SI',configuration:config,book_angle_deg:angle,
    material:{...material},gravity_m_s2:gravity,mesh_resolution:mesh.resolution,solver_settings:{...settings},
    convergence:{converged:result.converged,reason:result.reason,iterations:result.iterations,residual_N_m2:result.residual_N_m2},
    computation_time_ms:computationMs,diagnostics:diagnostics(mesh,result.positions),
    landmarks:Object.keys(reference).map(name=>({name,reference_m:reference[name],deformed_m:deformed[name],displacement_m:norm(sub(deformed[name],reference[name]))})),
    mesh:{reference_positions_m:mesh.reference,deformed_positions_m:result.positions,triangles:mesh.triangles,pinned_vertex_ids:mesh.pins,ridge_vertex_ids:mesh.ridge},
    limitations:['Illustrative uncalibrated parameters; numerical experiment only','No contact, self-collision, or intersection detection','Local equilibrium from rigid raised-branch initialization; no global minimum guarantee']};
}
export function reportCSV(reports) {
  const columns=['book_angle_deg','landmark','reference_x_m','reference_y_m','reference_z_m','deformed_x_m','deformed_y_m','deformed_z_m','displacement_m',
    'attachment_length_m','ridge_length_m','crease_angle_deg','mass_per_area_kg_m2','bending_stiffness_N_m','stretching_modulus_N_m','poisson_ratio','mesh_resolution','converged','iterations','residual_N_m2','computation_time_ms','frame','model','gravity_x_m_s2','gravity_y_m_s2','gravity_z_m_s2','solver_settings_json','convergence_reason','illustrative_uncalibrated'];
  const escape=v=>`"${String(v??'').replaceAll('"','""')}"`;
  const rows=reports.flatMap(r=>r.landmarks.map(p=>[r.book_angle_deg,p.name,...p.reference_m,...p.deformed_m,p.displacement_m,
    r.configuration.geometry.attachment_length_m,r.configuration.geometry.ridge_length_m,r.configuration.geometry.crease_angle_deg,
    r.material.mass_per_area_kg_m2,r.material.bending_stiffness_N_m,r.material.stretching_modulus_N_m,r.material.poisson_ratio,r.mesh_resolution,
    r.convergence.converged,r.convergence.iterations,r.convergence.residual_N_m2,r.computation_time_ms,r.configuration.frame,r.model,...r.gravity_m_s2,JSON.stringify(r.solver_settings),r.convergence.reason,r.material.illustrative_uncalibrated]));
  return [columns,...rows].map(row=>row.map(escape).join(',')).join('\n')+'\n';
}
