// Fixed wing domain in coefficients of the attachment and ridge vectors.
import { solve } from './model.js';

const outline = [[0, 0], [1, 0], [1.45, 0.18], [1.28, 0.46],
  [0.70, 0.47], [0.73, 0.76], [0.42, 1.03], [0, 1]];
const faces = [[2, 3, 4], [1, 2, 4], [5, 6, 7], [4, 5, 7], [1, 4, 7], [0, 1, 7]];
const sub = (a, b) => a.map((x, i) => x - b[i]);
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const cross = ([x,y,z], [a,b,c]) => [y*c-z*b, z*a-x*c, x*b-y*a];
const norm = a => Math.hypot(...a);
const cross2 = ([a,b], [c,d]) => a*d-b*c;
const edgeKey = (a,b) => a < b ? `${a},${b}` : `${b},${a}`;

function edgeIncidences(triangles) {
  const edges = new Map();
  for (const [face, ids] of triangles.entries()) {
    for (let i=0;i<3;i++) {
      const from=ids[i], to=ids[(i+1)%3], key=edgeKey(from,to);
      if (!edges.has(key)) edges.set(key,[]);
      edges.get(key).push({from,to,opposite:ids[(i+2)%3],face});
    }
  }
  return edges;
}

export function validateWing(points, triangles) {
  if (!points.length || !triangles.length || points.some(p=>!Array.isArray(p) || p.length!==2 || !p.every(Number.isFinite)) ||
      new Set(points.map(p=>p.join(','))).size!==points.length) throw Error('Invalid or duplicate wing vertices');
  if (triangles.some(ids=>!Array.isArray(ids) || ids.length!==3 || new Set(ids).size!==3 ||
      ids.some(i=>!Number.isInteger(i)||i<0||i>=points.length))) throw Error('Invalid triangle indices');
  if (new Set(triangles.map(ids=>[...ids].sort((a,b)=>a-b).join(','))).size!==triangles.length) {
    throw Error('Duplicate faces');
  }
  if (new Set(triangles.flat()).size!==points.length) throw Error('Isolated wing vertex');
  let min_angle_deg=Infinity, max_aspect_ratio=0, area=0;
  for (const ids of triangles) {
    const [a,b,c]=ids.map(i=>points[i]), twice=cross2(sub(b,a),sub(c,a));
    if (!Number.isFinite(twice) || twice<=0) throw Error('Degenerate or reversed triangle');
    const lengths=[norm(sub(b,a)),norm(sub(c,b)),norm(sub(a,c))];
    max_aspect_ratio=Math.max(max_aspect_ratio,Math.max(...lengths)**2/twice);
    for (let i=0;i<3;i++) {
      const u=sub(points[ids[(i+1)%3]],points[ids[i]]), v=sub(points[ids[(i+2)%3]],points[ids[i]]);
      min_angle_deg=Math.min(min_angle_deg,Math.atan2(Math.abs(cross2(u,v)),dot(u,v))*180/Math.PI);
    }
    area+=twice/2;
  }
  if (!Number.isFinite(area+min_angle_deg+max_aspect_ratio) || min_angle_deg<10 || max_aspect_ratio>8) throw Error('Poorly conditioned wing triangle');
  const edges=edgeIncidences(triangles), adjacent=triangles.map(()=>[]);
  const boundary=new Map();
  for (const incidents of edges.values()) {
    const [a,b]=incidents;
    if (incidents.length>2 || (b && a.from!==b.to)) throw Error('Invalid wing edge incidence');
    if (b) {
      adjacent[a.face].push(b.face); adjacent[b.face].push(a.face);
    } else {
      if (boundary.has(a.from)) throw Error('Multiple outgoing boundary edges');
      boundary.set(a.from,a.to);
    }
  }
  const seen=new Set([0]);
  for (const f of seen) for (const n of adjacent[f]) seen.add(n);
  if (seen.size!==triangles.length || points.length-edges.size+triangles.length!==1 ||
      !boundary.size || new Set(boundary.values()).size!==boundary.size) throw Error('Wing must be a connected disk');
  const start=boundary.keys().next().value, chain=[start];
  for (let next=boundary.get(start); next!==start; next=boundary.get(next)) {
    if (next===undefined || chain.length>=boundary.size) throw Error('Invalid wing boundary');
    chain.push(next);
  }
  if(chain.length!==boundary.size) throw Error('Multiple wing boundaries');
  const segments=chain.map((id,i)=>[points[id],points[chain[(i+1)%chain.length]]]);
  for(const [i,[a,b]] of segments.entries()) for(let j=i+2;j<segments.length;j++) {
    if(i===0 && j===segments.length-1) continue;
    const [c,d]=segments[j];
    const side=(p,q,r)=>cross2(sub(q,p),sub(r,p));
    const boxesOverlap=[0,1].every(k=>Math.max(a[k],b[k])>=Math.min(c[k],d[k]) &&
      Math.max(c[k],d[k])>=Math.min(a[k],b[k]));
    if(boxesOverlap && side(a,b,c)*side(a,b,d)<=0 && side(c,d,a)*side(c,d,b)<=0) {
      throw Error('Self-intersecting wing boundary');
    }
  }
  const polygonArea=segments.reduce((s,[a,b])=>s+cross2(a,b)/2,0);
  if(Math.abs(area-polygonArea)>128*Number.EPSILON*area) throw Error('Wing area mismatch');
  return {area_m2:area,min_angle_deg,max_aspect_ratio,boundary:chain};
}

function topology(level) {
  const points=outline.map(p=>[...p]);
  if(level===0) return {points,triangles:faces};
  const ids=new Map();
  const midpoint=(a,b)=>{
    const key=edgeKey(a,b);
    if (!ids.has(key)) {
      ids.set(key,points.length);
      points.push(points[a].map((x,i)=>(x+points[b][i])/2));
    }
    return ids.get(key);
  };
  const triangles=faces.flatMap(([a,b,c])=>{
    const ab=midpoint(a,b), bc=midpoint(b,c), ca=midpoint(c,a);
    return [[a,ab,ca],[ab,b,bc],[ca,bc,c],[ab,bc,ca]];
  });
  return {points,triangles};
}

function assemble(vertices,triangles) {
  const areas=vertices.map(()=>0);
  // Same inverse reference edge matrix and area lumping as flexible.buildMesh.
  const membranes=triangles.map(({ids})=>{
    const [a,b,c]=ids.map(i=>vertices[i]), e1=sub(b,a), e2=sub(c,a);
    const l=norm(e1), u=dot(e1,e2)/l, v=norm(cross(e1,e2))/l, area=l*v/2;
    for(const id of ids) areas[id]+=area/3;
    return {ids,area,inv:[1/l,-u/(l*v),0,1/v]};
  });
  const bends=[];
  const cot=(a,b)=>dot(a,b)/norm(cross(a,b));
  for(const incidents of edgeIncidences(triangles.map(t=>t.ids)).values()) {
    if(incidents.length===1) continue;
    const [t,s]=incidents;
    if(incidents.length!==2 || t.from!==s.to) throw Error('Invalid welded edge incidence');
    if(triangles[t.face].panel!==triangles[s.face].panel) continue;
    const ids=[t.from,t.to,t.opposite,s.opposite], [a,b,c,d]=ids.map(i=>vertices[i]);
    const ci=cot(sub(b,a),sub(c,a)), cj=cot(sub(a,b),sub(c,b));
    const di=cot(sub(b,a),sub(d,a)), dj=cot(sub(a,b),sub(d,b));
    bends.push({ids,K:[cj+dj,ci+di,-ci-cj,-di-dj],
      factor:3/(membranes[t.face].area+membranes[s.face].area)});
  }
  if (areas.some(area=>!Number.isFinite(area) || area<=0) ||
      membranes.some(m=>!m.inv.every(Number.isFinite)) ||
      bends.some(b=>!Number.isFinite(b.factor) || !b.K.every(Number.isFinite))) {
    throw Error('Invalid butterfly element assembly');
  }
  return {membranes,areas,bends};
}

export function buildButterflyMesh(config, angle, level=0) {
  if(level!==0 && level!==1) throw Error('Butterfly mesh level must be 0 or 1');
  const {landmarks_m:p}=solve(config,angle);
  const {points,triangles:local}=topology(level);
  const {attachment_length_m:a,ridge_length_m:h,crease_angle_deg}=config.geometry;
  const beta=crease_angle_deg*Math.PI/180;
  const planar=points.map(([u,v])=>[u*a+v*h*Math.cos(beta),v*h*Math.sin(beta)]);
  const quality=validateWing(planar,local);
  const attachment=points.map((_,i)=>i).filter(i=>points[i][1]===0).sort((i,j)=>points[i][0]-points[j][0]);
  const seam=points.map((_,i)=>i).filter(i=>points[i][0]===0).sort((i,j)=>points[i][1]-points[j][1]);
  const vertices=[], triangles=[], ridgeIds=new Map(), attachments=[], boundaries=[], markers=[];
  for(const [panel,side] of ['left','right'].entries()) {
    const tip=p[side+'_wing_tip'];
    // Barycentric extension of the rigid placement is isometric in the wing plane.
    const map=points.map(([u,v],i)=>{
      if(u===0 && ridgeIds.has(i)) return ridgeIds.get(i);
      const id=vertices.length;
      vertices.push(tip.map((x,k)=>x*u+p.ridge_tip[k]*v));
      if(u===0) ridgeIds.set(i,id);
      return id;
    });
    for(const face of local) {
      const ids=face.map(i=>map[i]);
      triangles.push({ids:panel===0?ids:ids.reverse(),panel});
    }
    attachments.push(attachment.map(i=>map[i]));
    const boundary=quality.boundary.map(i=>map[i]);
    boundaries.push(panel===0?boundary:boundary.reverse());
    for(const [name,i] of [['forewing',2],['hindwing',6]]) {
      markers.push({name:side+'_'+name,ids:[map[i]],weights:[1]});
    }
  }
  const ridge=seam.map(i=>ridgeIds.get(i));
  const edges=edgeIncidences(triangles.map(t=>t.ids));
  for(let i=1;i<ridge.length;i++) {
    const incident=edges.get(edgeKey(ridge[i-1],ridge[i]));
    if(incident?.length!==2 || triangles[incident[0].face].panel===triangles[incident[1].face].panel) {
      throw Error('Split butterfly ridge');
    }
  }
  return {level, reference:vertices.flat(), triangles, ...assemble(vertices,triangles),
    pins:[...new Set(attachments.flat())], ridge, attachments, boundaries, markers,
    quality:{area_m2:2*quality.area_m2,min_angle_deg:quality.min_angle_deg,max_aspect_ratio:quality.max_aspect_ratio}};
}
