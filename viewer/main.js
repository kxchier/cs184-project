import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { solve, validate } from './model.js';
import { buildMesh, relax, sampleMarkers, defaultMaterial, defaultSolver, makeReport, reportCSV } from './flexible.js';

const viewport = document.querySelector('#viewport');
const status = document.querySelector('#status');

async function start() {
  const response = await fetch('./configs/baseline.json');
  if (!response.ok) throw new Error(`Configuration request failed: ${response.status}`);
  const config = await response.json();
  validate(config);
  const g = config.geometry;
  const size = Math.max(g.attachment_length_m, g.ridge_length_m);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#ffffff');
  const camera = new THREE.PerspectiveCamera(42, 1, size / 100, size * 100);
  camera.up.set(0, 0, 1);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.domElement.setAttribute('aria-label', '3D book pages and triangular V-fold panels');
  viewport.appendChild(renderer.domElement);
  const labels = new CSS2DRenderer();
  Object.assign(labels.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
  viewport.appendChild(labels.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = size * 0.5;
  controls.maxDistance = size * 15;
  function resetCamera() {
    camera.position.set(size * 1.8, -size * 2.8, size * 3.4);
    controls.target.set(0, size * 0.35, size * 0.25);
    controls.update();
  }
  resetCamera();
  document.querySelector('#reset').addEventListener('click', resetCamera);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x808890, 1.5));
  const light = new THREE.DirectionalLight(0xffffff, 1.2);
  light.position.set(size, -size, size * 3);
  scene.add(light);

  function surface(color, panel = false) {
    const geometry = new THREE.BufferGeometry();
    const material = new THREE.MeshStandardMaterial({
      color, side: THREE.DoubleSide, roughness: 0.85,
      // Depth bias separates coplanar panel/page drawing at 180° without moving landmarks.
      polygonOffset: true, polygonOffsetFactor: panel ? -2 : 1,
      polygonOffsetUnits: panel ? -2 : 1,
    });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    return mesh;
  }
  function setSurface(mesh, points, indices) {
    mesh.geometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
    mesh.geometry.setIndex(indices);
    mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingSphere();
  }
  function line(color, radius) {
    // Thin cylinders keep ideal hinge lines readable from different camera angles.
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1, 8),
      new THREE.MeshBasicMaterial({ color }));
    scene.add(mesh);
    return mesh;
  }
  function setLine(mesh, a, b) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b);
    const direction = end.clone().sub(start);
    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    mesh.scale.y = direction.length();
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  }
  const pages = [surface('#e4e8eb'), surface('#edf0f2')];
  const panels = [surface('#879ca6', true), surface('#b3bdc4', true)];
  const hinges = [line('#687984', size * 0.004), line('#687984', size * 0.004), line('#687984', size * 0.004)];
  const freeEdges = [line('#637985', size * 0.002), line('#7e8d97', size * 0.002)];
  const overlay = panels.map(() => {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({color:'#677c89',wireframe:true,transparent:true,opacity:0.35,depthTest:false}));
    scene.add(mesh); return mesh;
  });
  const curves = [0,1,2].map(() => {const curve=new THREE.Line(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:'#52616b'}));scene.add(curve);return curve;});
  function setCurve(curve, ids, x) {
    curve.geometry.setAttribute('position',new THREE.Float32BufferAttribute(ids.flatMap(id=>x.slice(id*3,id*3+3)),3));
    curve.geometry.computeBoundingSphere();
  }
  const spine = line('#9caab3', size * 0.003);
  setLine(spine, [0, -size * 0.35, 0], [0, size * 1.45, 0]);

  function label(text, className) {
    const element = document.createElement('div');
    element.className = className;
    element.textContent = text;
    return new CSS2DObject(element);
  }
  const landmarks = [
    ['spine_origin', 'O · spine origin'], ['left_wing_tip', 'L · left wing tip'],
    ['right_wing_tip', 'R · right wing tip'], ['ridge_tip', 'C · ridge tip'],
    ['left_interior', 'IL · left interior'], ['right_interior', 'IR · right interior'],
    ['left_free_midpoint', 'FL · left free midpoint'], ['right_free_midpoint', 'FR · right free midpoint'],
  ].map(([key, name]) => {
    const marker = new THREE.Mesh(new THREE.SphereGeometry(size * 0.009, 16, 12),
      new THREE.MeshBasicMaterial({ color: '#52616b' }));
    const tag = label(name.split(' · ')[0], 'landmark');
    tag.element.title = name;
    marker.add(tag);
    scene.add(marker);
    const row = document.createElement('tr');
    row.innerHTML = `<td>${name.split(' · ')[0]}</td><td></td><td></td><td></td>`;
    document.querySelector('#coordinates').appendChild(row);
    return { key, marker, row };
  });
  // A small fixed-frame triad uses the same world axes as the exported data.
  const triadOrigin = new THREE.Vector3(-size * 1.2, -size * 0.4, 0);
  for (const [direction, color, name] of [
    [[1, 0, 0], 0x81939e, '+x'], [[0, 1, 0], 0x81939e, '+y spine'], [[0, 0, 1], 0x81939e, '+z up'],
  ]) {
    const dir = new THREE.Vector3(...direction);
    scene.add(new THREE.ArrowHelper(dir, triadOrigin, size * 0.3, color, size * 0.04, size * 0.02));
    const tag = label(name, 'axis');
    tag.position.copy(triadOrigin).addScaledVector(dir, size * 0.36);
    scene.add(tag);
  }
  document.querySelector('#geometry').textContent =
    `a = ${g.attachment_length_m} m · h = ${g.ridge_length_m} m · β = ${g.crease_angle_deg}°`;
  const slider = document.querySelector('#angle');
  const exact = document.querySelector('#exact-angle');
  let generation=0, currentReport=null;
  const modelMode=document.querySelector('#model-mode');
  const solverStatus=document.querySelector('#solver-status');
  const exports=[document.querySelector('#export-json'),document.querySelector('#export-csv')];
  function renderMesh(mesh,positions) {
    const points=Array.from({length:positions.length/3},(_,i)=>positions.slice(i*3,i*3+3));
    panels.forEach((panel,i)=>setSurface(panel,points,mesh.triangles.filter(t=>t.panel===i).flatMap(t=>t.ids)));
    const p=sampleMarkers(mesh,positions);
    [p.left_wing_tip,p.right_wing_tip].forEach((tip,i)=>setLine(hinges[i],p.spine_origin,tip));
    hinges[2].visible=false;freeEdges.forEach(edge=>edge.visible=false);
    setCurve(curves[0],mesh.ridge,positions);
    mesh.maps.forEach((map,side)=>setCurve(curves[side+1],Array.from({length:mesh.resolution+1},(_,i)=>map.get(`${i},${mesh.resolution-i}`)),positions));
    for(const {key,marker,row} of landmarks) {
      marker.position.set(...p[key]);
      p[key].forEach((v,i)=>row.cells[i+1].textContent=v.toFixed(5));
    }
  }
  async function update(angle) {
    const token=++generation;
    currentReport=null;exports.forEach(button=>button.disabled=true);
    try {
      const resolution=Number(document.querySelector('#resolution').value);
      const mesh=buildMesh(config,angle,resolution);
      const material={...defaultMaterial,mass_per_area_kg_m2:Number(document.querySelector('#mass').value),
        bending_stiffness_N_m:Number(document.querySelector('#bending').value),stretching_modulus_N_m:Number(document.querySelector('#stretching').value)};
      const gravity=document.querySelector('#gravity').checked?[0,0,-9.81]:[0,0,0];
      for(const id of ['mass','bending','stretching']) {
        const input=document.querySelector('#'+id);
        if(input.value===''||!input.validity.valid) throw Error('Enter valid material settings.');
      }
      const half=angle*Math.PI/360;
      for(const [i,sign] of [[0,-1],[1,1]]) {
        const x=sign*size*1.3*Math.sin(half),z=size*1.3*Math.cos(half);
        setSurface(pages[i],[[0,-size*.35,0],[x,-size*.35,z],[x,size*1.45,z],[0,size*1.45,0]],[0,1,2,0,2,3]);
        setSurface(overlay[i],Array.from({length:mesh.reference.length/3},(_,j)=>mesh.reference.slice(j*3,j*3+3)),mesh.triangles.filter(t=>t.panel===i).flatMap(t=>t.ids));
        overlay[i].visible=document.querySelector('#reference-overlay').checked;
      }
      slider.value=angle;exact.value=angle;document.querySelector('#angle-value').textContent=`${angle}°`;
      renderMesh(mesh,mesh.reference);
      let result={positions:mesh.reference,iterations:0,residual_N_m2:0,converged:true,reason:'prescribed_geometry'};
      const flexible=modelMode.value==='flexible';let computationMs=0;
      if(flexible) {
        solverStatus.textContent='Solving at a fixed angle…';
        const iterator=relax(mesh,material,defaultSolver,gravity);
        let step;
        do {
          const start=performance.now();step=iterator.next();computationMs+=performance.now()-start;
          if(!step.done) {
            solverStatus.textContent=`Solving · ${step.value.iteration} iterations · residual ${step.value.residual_N_m2.toExponential(2)} N/m²`;
            await new Promise(resolve=>setTimeout(resolve,0));
            if(token!==generation)return;
          }
        }while(!step.done);
        result=step.value;renderMesh(mesh,result.positions);
      }
      if(token!==generation)return;
      currentReport=makeReport(config,angle,mesh,material,defaultSolver,result,computationMs,gravity);
      if(!flexible) {
        currentReport.model='rigid_ideal_hinges';currentReport.material={};currentReport.solver_settings=null;
        currentReport.convergence={converged:null,reason:'not_applicable_prescribed_geometry',iterations:0,residual_N_m2:null};
        solverStatus.textContent='Rigid geometric baseline · no material simulation';
      } else {
        solverStatus.textContent=`${result.converged?'Converged numerical equilibrium':'UNCONVERGED — '+result.reason} · ${result.iterations} iterations · residual ${result.residual_N_m2.toExponential(2)} N/m² · ${computationMs.toFixed(0)} ms. Max displacement ${(currentReport.diagnostics.max_displacement_m*1000).toFixed(2)} mm; max edge strain ${(currentReport.diagnostics.max_abs_edge_strain*100).toFixed(2)}%. Uncalibrated; no contact handling.`;
      }
      solverStatus.classList.toggle('unconverged',flexible&&!result.converged);
      exports.forEach(button=>button.disabled=false);
    }catch(error) {if(token===generation) {solverStatus.textContent=error.message;solverStatus.classList.add('unconverged');}}
  }
  for(const id of ['model-mode','mass','bending','stretching','resolution','gravity']) document.querySelector('#'+id).addEventListener('change',()=>update(Number(exact.value)));
  document.querySelector('#reference-overlay').addEventListener('change',event=>overlay.forEach(mesh=>mesh.visible=event.target.checked));
  function download(format) {
    if(!currentReport)return;
    const blob=new Blob([format==='json'?JSON.stringify(currentReport,null,2):reportCSV([currentReport])],{type:format==='json'?'application/json':'text/csv'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`vfold-${modelMode.value}-${exact.value}.${format}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  exports[0].addEventListener('click',()=>download('json'));exports[1].addEventListener('click',()=>download('csv'));
  slider.addEventListener('input', () => update(Number(slider.value)));
  exact.addEventListener('input', () => {
    if (exact.value !== '' && exact.validity.valid) update(Number(exact.value));
  });
  update(90);
  function resize() {
    const { width, height } = viewport.getBoundingClientRect();
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    labels.setSize(width, height);
  }
  new ResizeObserver(resize).observe(viewport);
  resize();
  renderer.domElement.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    status.textContent = 'Graphics context lost. Reload the page to restore the viewer.';
  });
  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
    labels.render(scene, camera);
  });
  status.textContent = '';
}

start().catch(error => {
  console.error(error);
  status.textContent = `Viewer could not start: ${error.message}. Run npm install, serve with npm start, and use a WebGL-enabled browser.`;
});
