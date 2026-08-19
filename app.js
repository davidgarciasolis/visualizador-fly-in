const state = { map: null, turns: [], turn: 0, playing: null };
const $ = (id) => document.getElementById(id);
const svgNs = 'http://www.w3.org/2000/svg';

function parseMetadata(text = '') {
  return Object.fromEntries([...text.matchAll(/(\w+)=([^\s\]]+)/g)].map(([, k, v]) => [k, v]));
}

function parseMap(source) {
  const map = { hubs: new Map(), edges: [], drones: 0, start: null, end: null };
  source.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) return;
    const drones = line.match(/^nb_drones:\s*(\d+)$/);
    if (drones) { map.drones = Number(drones[1]); return; }
    const hub = line.match(/^(start_hub|end_hub|hub):\s*(\S+)\s+(-?\d+)\s+(-?\d+)(?:\s+\[([^\]]*)\])?$/);
    if (hub) {
      const [, kind, name, x, y, metadata] = hub;
      const item = { name, x:Number(x), y:Number(y), kind, ...parseMetadata(metadata) };
      map.hubs.set(name, item); if (kind === 'start_hub') map.start = name; if (kind === 'end_hub') map.end = name; return;
    }
    const edge = line.match(/^connection:\s*(\S+?)-(\S+?)(?:\s+\[([^\]]*)\])?$/);
    if (edge) { const [, a, b, metadata] = edge; map.edges.push({ a, b, name:`${a}-${b}`, ...parseMetadata(metadata) }); return; }
    throw new Error(`Línea ${index + 1}: formato no reconocido.`);
  });
  if (!map.drones || !map.start || !map.end) throw new Error('El mapa debe incluir nb_drones, start_hub y end_hub.');
  return map;
}

function parseSolution(input) {
  return input.replace(/\r/g, '').split('\n').filter((line) => line.trim() && !line.trim().startsWith('#')).map((line, i) => {
    const moves = line.trim().split(/\s+/).map((token) => {
      const match = token.match(/^D(\d+)-(.+)$/);
      if (!match) throw new Error(`Solución, turno ${i + 1}: «${token}» no tiene formato D<ID>-destino.`);
      return { id:Number(match[1]), destination:match[2] };
    });
    return moves;
  });
}

function validateSolution(turns) {
  const knownEdges = new Set(state.map.edges.flatMap((edge) => [edge.name, `${edge.b}-${edge.a}`]));
  turns.forEach((moves, index) => moves.forEach((move) => {
    if (move.id < 1 || move.id > state.map.drones) throw new Error(`Turno ${index + 1}: D${move.id} no existe en este mapa.`);
    if (!state.map.hubs.has(move.destination) && !knownEdges.has(move.destination)) {
      throw new Error(`Turno ${index + 1}: «${move.destination}» no es un hub ni una conexión del mapa.`);
    }
  }));
}

function snapshots() {
  const positions = new Map(Array.from({ length: state.map.drones }, (_, i) => [i + 1, { hub:state.map.start }]));
  const result = [new Map([...positions].map(([id, p]) => [id, {...p}]))];
  state.turns.forEach((moves) => { moves.forEach(({id, destination}) => {
    if (!positions.has(id)) return;
    const edge = state.map.edges.find((item) => item.name === destination || `${item.b}-${item.a}` === destination);
    positions.set(id, edge && !state.map.hubs.has(destination) ? { edge } : { hub:destination });
  }); result.push(new Map([...positions].map(([id, p]) => [id, {...p}]))); });
  return result;
}

function el(name, attrs = {}) { const node = document.createElementNS(svgNs, name); Object.entries(attrs).forEach(([k,v]) => node.setAttribute(k,v)); return node; }
function renderGraph() {
  if (!state.map) return; const svg = $('graph'); svg.replaceChildren(); const hubs = [...state.map.hubs.values()];
  const minX=Math.min(...hubs.map(h=>h.x)), maxX=Math.max(...hubs.map(h=>h.x)), minY=Math.min(...hubs.map(h=>h.y)), maxY=Math.max(...hubs.map(h=>h.y));
  const scale = Math.min(1050 / Math.max(1,maxX-minX), 600 / Math.max(1,maxY-minY)); const pos = (hub) => ({ x:80+(hub.x-minX)*scale, y:80+(maxY-hub.y)*scale });
  svg.setAttribute('viewBox', `0 0 ${Math.max(650,(maxX-minX)*scale+160)} ${Math.max(460,(maxY-minY)*scale+160)}`);
  const current = snapshots()[state.turn]; const transit = new Set([...current.values()].filter(p=>p.edge).map(p=>p.edge));
  state.map.edges.forEach(edge => { const a=pos(state.map.hubs.get(edge.a)), b=pos(state.map.hubs.get(edge.b)); svg.append(el('line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,class:`edge ${transit.has(edge)?'transit':''}`})); });
  hubs.forEach(hub => { const p=pos(hub), drones=[...current].filter(([,place])=>place.hub===hub.name).map(([id])=>id), group=el('g',{class:`hub ${hub.kind==='start_hub'?'start':''} ${hub.kind==='end_hub'?'end':''} ${hub.zone==='blocked'?'blocked':''}`}); group.append(el('circle',{cx:p.x,cy:p.y,r:31,fill:hub.color||'#35516f',class:'core'})); const label=el('text',{x:p.x,y:p.y-45,class:'hub-label','text-anchor':'middle'}); label.textContent=hub.name; group.append(label); const meta=el('text',{x:p.x,y:p.y+50,class:'meta-label','text-anchor':'middle'}); meta.textContent=`${hub.zone||'normal'} · cap ${hub.max_drones||1}`; group.append(meta); drones.forEach((id,i)=>{ const angle=(i/drones.length)*Math.PI*2-Math.PI/2, dx=Math.cos(angle)*Math.min(19,8+i*3),dy=Math.sin(angle)*Math.min(19,8+i*3); group.append(el('circle',{cx:p.x+dx,cy:p.y+dy,r:10,fill:droneColor(id),class:'drone'})); const txt=el('text',{x:p.x+dx,cy:p.y+dy,class:'drone-label'}); txt.textContent=`D${id}`; group.append(txt); }); svg.append(group); });
  [...current].filter(([,p])=>p.edge).forEach(([id,{edge}])=>{ const a=pos(state.map.hubs.get(edge.a)),b=pos(state.map.hubs.get(edge.b)); const circle=el('circle',{cx:(a.x+b.x)/2,cy:(a.y+b.y)/2,r:11,fill:droneColor(id),class:'drone'}); svg.append(circle); const txt=el('text',{x:(a.x+b.x)/2,cy:(a.y+b.y)/2,class:'drone-label'});txt.textContent=`D${id}`;svg.append(txt); });
}
function droneColor(id) { return ['#59d3b2','#ffb866','#7bb5ff','#f78fb3','#be8cff','#f1e05a','#60d9f1','#ff7e67'][((id-1)%8)]; }
function render() {
  if (!state.map) return;
  const total = state.turns.length;
  $('turn-label').textContent = `Turno ${state.turn}`;
  $('turn-total').textContent = `de ${total}`;
  $('turn-slider').max = total;
  $('turn-slider').value = state.turn;
  $('map-summary').textContent = `${state.map.drones} drones · ${state.map.hubs.size} hubs`;
  const entries = [0, ...state.turns.map((_, index) => index + 1)];
  $('turn-list').replaceChildren(...entries.map((number) => {
    const button = document.createElement('button');
    const moves = number ? state.turns[number - 1].map((move) => `D${move.id}→${move.destination}`).join(' ') : '';
    button.textContent = number ? `T${number} · ${moves || 'espera'}` : 'Inicio';
    button.className = number === state.turn ? 'active' : '';
    button.onclick = () => setTurn(number);
    const item = document.createElement('li');
    item.append(button);
    return item;
  }));
  renderGraph();
}
function setTurn(turn) { state.turn=Math.max(0,Math.min(turn,state.turns.length)); render(); }
function stop() { clearInterval(state.playing); state.playing=null; $('play-pause').textContent='▶ Reproducir'; }
function loadMap(text, name='mapa') { try { state.map=parseMap(text); state.turns=[]; state.turn=0; stop(); $('status').textContent=`${name} cargado correctamente.`; render(); } catch(e) { $('status').textContent=`Error: ${e.message}`; } }
$('map-file').onchange=async(e)=>{const file=e.target.files[0];if(file)loadMap(await file.text(),file.name);};
$('load-solution').onclick=()=>{ if(!state.map)return; try{const turns=parseSolution($('solution-input').value);validateSolution(turns);state.turns=turns;setTurn(0);$('status').textContent=`Solución cargada: ${state.turns.length} turnos.`;}catch(e){$('status').textContent=`Error: ${e.message}`;} };
$('first-turn').onclick=()=>setTurn(0); $('previous-turn').onclick=()=>setTurn(state.turn-1); $('next-turn').onclick=()=>setTurn(state.turn+1); $('last-turn').onclick=()=>setTurn(state.turns.length); $('turn-slider').oninput=e=>setTurn(Number(e.target.value));
$('play-pause').onclick=()=>{if(state.playing){stop();return;} if(state.turn===state.turns.length)setTurn(0);$('play-pause').textContent='❚❚ Pausar';state.playing=setInterval(()=>{if(state.turn===state.turns.length){stop();}else setTurn(state.turn+1);},800);};
