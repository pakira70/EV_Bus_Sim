/* run_cut_editor.js — notifications & safeguards
   ✔ Clear toast: two actions (Clear now / Save) + auto-dismiss
   ✔ Save safety: overwrite confirm or save copy; clear blanks name
   ✔ “Editing: …” badge next to schedule name
   ✔ DEADHEAD shows low/critical/stranded colors correctly
   ✔ Results header “Simulation Results” + nicer Close button
*/

(() => {
  // -------------------- constants / state --------------------
  const SLOT_MIN = 15;
  const SLOTS = 96;
  const LS_KEY_SAVES = 'evsim.runCuts';
  const LS_KEY_DRAFT = 'evsim.runCuts.draft';
  const GRID_ID = 'schedule-grid';
  const GRID_BODY_ID = 'schedule-grid-body';
  const POPOVER_SEL = '#activity-popover';
  const CHARGE_PICKER_SEL = '#charger-select';

  const scheduleData = {}; // { busId: Array(96) of {type, chargerName?, chargerId?} | null }
  let busCounter = 1;
  let availableChargers = [];
  let currentEditingName = ''; // tracks currently-loaded schedule name

  // -------------------- helpers --------------------
  const $  = (q, r=document) => r.querySelector(q);
  const $$ = (q, r=document) => Array.from(r.querySelectorAll(q));
  const px = v => Number(String(v||'').trim().replace('px','')) || 0;
  const log = (...a) => console.log('[editor]', ...a);

  const hhmm = slot => {
    const h = Math.floor(slot/4), m = (slot%4)*15;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
  };

  function getConfiguredChargersSafe(){
    try { return (window.getConfiguredChargers && window.getConfiguredChargers()) || []; }
    catch { return []; }
  }
  function chargerLookup(key){
    const pools = [ (window.EVSim && window.EVSim.chargers) || [], availableChargers || [] ];
    for (const a of pools){
      const hit = a.find(c => String(c.name)===String(key) || String(c.id)===String(key));
      if (hit) return hit;
    }
    return null;
  }
  function setCellTitle(td, slotIdx, chargerName){
    const base = `Slot ${slotIdx} · ${hhmm(slotIdx)}`;
    if (!chargerName){ td.title = base; return; }
    const meta = chargerLookup(chargerName);
    const label = meta ? `${meta.name}${meta.rate?` (${meta.rate} kW)`:''}` : chargerName;
    td.title = `${base} • ${label}`;
  }
  function ensureRowArray(busId){
    if (!Array.isArray(scheduleData[busId]) || scheduleData[busId].length!==SLOTS){
      scheduleData[busId] = Array(SLOTS).fill(null);
    }
  }
  function nextBusName(){
    let name;
    do { name = `BUS${busCounter++}`; } while (scheduleData[name]);
    return name;
  }

  // -------------------- CSS (grid, results, toasts, badge) --------------------
  (function injectCSS(){
    const s = document.createElement('style');
    s.textContent = `
      :root { --border:#23324d; --muted:#9fb0cc; --accent:#b6c7ff; }

      #${GRID_ID} td.time-slot { font-size:10px; line-height:1; text-align:center; vertical-align:middle; }
      #${GRID_ID} td.time-slot.range-selected { background: rgba(182,199,255,.28)!important; outline:none!important; }

      /* Neutral RUN blue */
      #${GRID_ID} td.time-slot.activity-run { background: rgba(59,130,246,.22)!important; color:var(--accent)!important; }
      /* Neutral DEADHEAD grey */
      #${GRID_ID} td.time-slot.activity-deadhead { background: rgba(148,163,184,.22)!important; color:#cbd5e1!important; }

      /* Bright warnings that override base */
      #${GRID_ID} td.time-slot.soc-low    { background: rgba(253,224,71,.78)!important;  color:#3b3b00!important; }
      #${GRID_ID} td.time-slot.soc-crit   { background: rgba(239,68,68,.80)!important;   color:#3a0e0e!important; }
      #${GRID_ID} td.time-slot.soc-strand { background:#000!important; color:#fff!important; font-weight:400; letter-spacing:0; }
      #${GRID_ID} td.time-slot.soc-strand::after{ content:'X'; display:block; font-weight:400; color:#fff; line-height:1; transform: translateY(1px); }

      /* Hover red × remove inside bus name */
      td.bus-name-cell { position:relative; padding-right:26px; }
      .bus-remove{
        position:absolute; right:6px; top:50%; transform:translateY(-50%);
        width:16px; height:16px; border-radius:8px; border:1px solid rgba(220,38,38,.45);
        background: transparent; color:#dc2626; font-weight:700; font-size:12px; line-height:1;
        display:none; align-items:center; justify-content:center; cursor:pointer;
      }
      td.bus-name-cell:hover .bus-remove, td.bus-name-cell:focus-within .bus-remove { display:inline-flex; }
      .bus-remove:hover{ background: rgba(220,38,38,.1); }

      /* Controls alignment tweak */
      .editor-controls{ display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
      .editor-controls button, .editor-controls .btn { margin:0!important; }

      /* Results container & nicer Close button */
      #simulation-results-container{ border:1px solid var(--border); border-radius:12px; padding:12px 14px; background:#0b1220; }
      .sim-results h3{ margin:0; font-size:16px }
      #close-results-btn{
        appearance:none; border:1px solid var(--border); background:#0b1322; color:#e5e7eb;
        padding:8px 12px; border-radius:10px; cursor:pointer; font-weight:600; letter-spacing:.2px;
      }
      #close-results-btn:hover{ filter:brightness(1.08) }

      /* Toasts (Notification Center) */
      .toast-region{ position: fixed; inset: 12px 12px auto auto; width: 360px; max-width: calc(100vw - 24px); z-index: 9999; display:flex; flex-direction:column; gap:10px; }
      @media (max-width: 640px){ .toast-region{ inset:auto 12px 12px 12px; width:auto; } }
      .evtoast{
        display:grid; grid-template-columns: 1fr auto; gap:10px; align-items:start;
        background: linear-gradient(180deg, #0e1729, #0b1220 70%); color:#e5e7eb;
        border:1px solid var(--border); border-left:4px solid #0284c7; border-radius:14px; padding:10px 12px;
        box-shadow: 0 10px 20px rgba(0,0,0,.35), 0 6px 6px rgba(0,0,0,.3);
        animation: evslide .14s ease-out;
      }
      .evtoast.success{ border-left-color:#16a34a }
      .evtoast.info{    border-left-color:#0284c7 }
      .evtoast.warn{    border-left-color:#d97706 }
      .evtoast.error{   border-left-color:#dc2626 }
      .evtoast h3{ margin:0 0 2px; font-size:14px }
      .evtoast p{ margin:0; color: var(--muted) }
      .evtoast .actions{ display:flex; gap:8px; align-items:center }
      .evtoast .btn-link{ appearance:none; border:none; background:transparent; color:#b6c7ff; font-weight:600; cursor:pointer; padding:4px 8px; border-radius:8px }
      .evtoast .btn-link:hover{ background: rgba(182,199,255,.1) }
      .evtoast .close{ appearance:none; border:none; background:transparent; color:#9fb0cc; font-size:18px; line-height:1; padding:4px; cursor:pointer; border-radius:6px }
      .evtoast .close:hover{ background: rgba(255,255,255,.06) }
      @keyframes evslide{ from{ transform: translateY(-6px); opacity:0 } to{ transform: translateY(0); opacity:1 } }

      /* Editing badge next to schedule name */
      .editing-badge{
        margin-left:8px; padding:2px 8px; border:1px solid var(--border); border-radius:10px; color:#9fb0cc; font-size:12px;
        background: #0a1324;
      }
    `;
    document.head.appendChild(s);
  })();

  // -------------------- Notification Center --------------------
  const notify = (() => {
    const region = (() => {
      let el = document.querySelector('.toast-region');
      if (!el) {
        el = document.createElement('div');
        el.className = 'toast-region';
        el.setAttribute('aria-live','polite');
        el.setAttribute('aria-relevant','additions');
        el.setAttribute('aria-label','Notifications');
        document.body.appendChild(el);
      }
      return el;
    })();
    const maxVisible = 3;
    const queue = [];
    const visible = new Set();

    function mountNext(){ if (visible.size>=maxVisible) return; const next=queue.shift(); if(!next) return; visible.add(next.id); region.appendChild(next.el); requestAnimationFrame(next.startTimer); }
    function dismiss(id){ const el=region.querySelector(`.evtoast[data-id="${id}"]`); if(!el) return; el.setAttribute('hidden','true'); setTimeout(()=>{ visible.delete(id); el.remove(); mountNext(); },80); }

    function push(level, title, body, {timeout, persist, actionLabel, onAction, secondaryLabel, onSecondary}={}){
      region.setAttribute('aria-live', (level==='warn'||level==='error') ? 'assertive' : 'polite');
      const el = document.createElement('div');
      const id = Math.random().toString(36).slice(2);
      el.className = `evtoast ${level}`; el.dataset.id=id; el.tabIndex=0; el.role='status'; el.setAttribute('aria-atomic','true');
      el.innerHTML = `
        <div class="content">
          <h3>${title}</h3>
          ${body ? `<p>${body}</p>` : ''}
        </div>
        <div class="actions">
          ${secondaryLabel ? `<button class="btn-link action-secondary">${secondaryLabel}</button>` : ''}
          ${actionLabel ? `<button class="btn-link action">${actionLabel}</button>` : ''}
          <button class="close" aria-label="Dismiss">×</button>
        </div>
      `;
      el.querySelector('.close').addEventListener('click', ()=>dismiss(id));
      if (onAction)   el.querySelector('.action')?.addEventListener('click', ()=>onAction(id));
      if (onSecondary)el.querySelector('.action-secondary')?.addEventListener('click', ()=>onSecondary(id));

      let timer;
      const startTimer = () => {
        if (persist) return;
        const t = timeout ?? (level==='success'?3000 : level==='info'?4000 : level==='warn'?6000 : 0);
        if (t>0) timer = setTimeout(()=>dismiss(id), t);
      };
      const stopTimer = ()=>{ if (timer) clearTimeout(timer); };
      el.addEventListener('mouseenter', stopTimer);
      el.addEventListener('mouseleave', startTimer);

      queue.push({ id, el, startTimer }); mountNext();
      return id;
    }

    return {
      dismiss,
      success: (t,b,o)=>push('success', t,b,o),
      info:    (t,b,o)=>push('info',    t,b,o),
      warn:    (t,b,o)=>push('warn',    t,b,o),
      error:   (t,b,o)=>push('error',   t,b,o),
      confirm: (t,b,{okLabel='Confirm', cancelLabel='Cancel', onConfirm, onCancel}={}) =>
        push('warn', t,b, { persist:true, actionLabel:okLabel, onAction:id=>{ onConfirm?.(id); }, secondaryLabel:cancelLabel, onSecondary:id=>{ onCancel?.(id); } })
    };
  })();

  // -------------------- header sizing --------------------
  function sizeTimeColumns(){
    const root = document.documentElement;
    const container = document.querySelector('.schedule-grid-container');
    if (!container) return;

    const cs = getComputedStyle(root);
    const wName = px(cs.getPropertyValue('--col-width-name'));
    const wType = px(cs.getPropertyValue('--col-width-type'));
    const wSOC  = px(cs.getPropertyValue('--col-width-soc'));
    const minCol = px(cs.getPropertyValue('--time-col-min')) || 14;
    const maxCol = px(cs.getPropertyValue('--time-col-max')) || 34;
    const cols = Number(cs.getPropertyValue('--time-cols').trim()) || SLOTS;

    const available = container.clientWidth - (wName + wType + wSOC);
    if (available <= 0) return;

    let colW = Math.floor(available / cols);
    colW = Math.max(minCol, Math.min(maxCol, colW));
    root.style.setProperty('--col-width-time', colW + 'px');
  }
  window.sizeTimeColumns = sizeTimeColumns;

  function createHeader(){
    const table = $(`#${GRID_ID}`);
    if (!table) return;
    const thead = table.querySelector('thead') || table.createTHead();
    thead.innerHTML = '';

    const hourRow = document.createElement('tr'); hourRow.classList.add('hour-row');
    const thBus = document.createElement('th'); thBus.textContent='Bus #'; thBus.rowSpan=2; hourRow.appendChild(thBus);
    const thType= document.createElement('th'); thType.textContent='Type'; thType.rowSpan=2; hourRow.appendChild(thType);
    const thSOC = document.createElement('th'); thSOC.textContent='Start SOC %'; thSOC.rowSpan=2; hourRow.appendChild(thSOC);
    for (let h=0; h<24; h++){ const th=document.createElement('th'); th.classList.add('hour'); th.colSpan=4; th.textContent=String(h).padStart(2,'0'); hourRow.appendChild(th); }
    const quartersRow = document.createElement('tr'); quartersRow.classList.add('quarter-row');
    for (let h=0; h<24; h++){ ['00','15','30','45'].forEach(min=>{ const th=document.createElement('th'); th.classList.add('time-slot'); th.textContent=min; quartersRow.appendChild(th); }); }
    thead.appendChild(hourRow); thead.appendChild(quartersRow);
    sizeTimeColumns(); requestAnimationFrame(sizeTimeColumns);
  }

  // -------------------- rows (rename + inline remove ×) --------------------
  function addBusRow(busId){
    const tbody = $(`#${GRID_BODY_ID}`); if (!tbody) return null;
    const id = (busId && String(busId).trim()) || nextBusName();
    if (scheduleData[id]) { log(`Bus "${id}" already exists.`); return null; }
    ensureRowArray(id);

    const tr = document.createElement('tr');
    tr.dataset.busId = id;

    // Bus name (editable) + hover ×
    const tdBus = document.createElement('td');
    tdBus.className = 'bus-name-cell';
    tdBus.contentEditable = 'true';
    tdBus.textContent = id;
    tdBus.title = 'Click to rename bus';
    tdBus.addEventListener('blur', () => {
      const oldId = tr.dataset.busId;
      const newId = tdBus.textContent.trim() || oldId;
      if (newId === oldId) return;
      if (scheduleData[newId]) { tdBus.textContent = oldId; notify.info('Name in use', `“${newId}” already exists.`); return; }
      scheduleData[newId] = scheduleData[oldId];
      delete scheduleData[oldId];
      tr.dataset.busId = newId;
      saveDraft();
    });
    const rm = document.createElement('button');
    rm.type='button'; rm.className='bus-remove'; rm.title='Remove bus'; rm.textContent='×';
    rm.addEventListener('click', (e)=>{
      e.stopPropagation();
      const bid = tr.dataset.busId;
      const id = notify.confirm(`Delete bus ${bid}?`, 'This cannot be undone.', {
        okLabel:'Delete', cancelLabel:'Cancel',
        onConfirm: (tid)=>{ notify.dismiss(tid); tr.remove(); delete scheduleData[bid]; saveDraft(); notify.success('Bus removed', bid); }
      });
    });
    tdBus.appendChild(rm);
    tr.appendChild(tdBus);

    // Type
    const tdType = document.createElement('td');
    const sel = document.createElement('select');
    sel.className='bus-type-select';
    ['EV','Diesel'].forEach(v=>{ const o=document.createElement('option'); o.value=v; o.textContent=v; sel.appendChild(o); });
    sel.addEventListener('change', ()=>{ setRowFuelState(tr); saveDraft(); recalcSOC(null,null,tr); });
    tdType.appendChild(sel); tr.appendChild(tdType);

    // Start SOC
    const tdSOC = document.createElement('td');
    const soc = document.createElement('input');
    soc.type='number'; soc.min='0'; soc.max='100'; soc.step='1'; soc.className='start-soc-input'; soc.value='90';
    soc.addEventListener('input', ()=>{ saveDraft(); recalcSOC(null,null,tr); });
    tdSOC.appendChild(soc); tr.appendChild(tdSOC);

    // 96 time cells
    for (let i=0;i<SLOTS;i++){
      const td = document.createElement('td');
      td.classList.add('time-slot'); td.dataset.timeSlot = i; setCellTitle(td, i, null);
      tr.appendChild(td);
    }

    tbody.appendChild(tr);
    setRowFuelState(tr);
    return tr;
  }

  function clearChargeEventsForRow(tr){
    const busId = tr.dataset.busId;
    ensureRowArray(busId);
    const arr = scheduleData[busId];
    for (let i=0;i<SLOTS;i++){
      const ev = arr[i];
      if (ev?.type==='CHARGE'){
        arr[i]=null;
        const td = tr.querySelector(`td.time-slot[data-time-slot="${i}"]`);
        if (td){
          td.className = 'time-slot';
          td.textContent=''; delete td.dataset.charger; setCellTitle(td, i, null);
        }
      }
    }
  }
  function setRowFuelState(tr){
    const sel = tr.querySelector('.bus-type-select');
    const soc = tr.querySelector('.start-soc-input');
    const isDiesel = (sel?.value==='Diesel');
    if (soc){ soc.disabled = isDiesel; soc.classList.toggle('disabled', isDiesel); }
    if (isDiesel) clearChargeEventsForRow(tr);
  }

  // -------------------- painting & popover --------------------
  const pop = { el:null, info:null, chargeBox:null, chargerSel:null, cancelBtn:null };
  let isMouseDown=false, paintRow=null, paintStart=-1, activeCell=null;

  function getPopoverRefs(){
    pop.el        = $(POPOVER_SEL);
    pop.info      = $('#popover-cell-info');
    pop.chargeBox = $('#charge-options');
    pop.chargerSel= $(CHARGE_PICKER_SEL);
    pop.cancelBtn = $('#popover-cancel');
  }

  function clearRange(row){ row?.querySelectorAll('td.time-slot.range-selected').forEach(td=>td.classList.remove('range-selected')); }
  function markRange(row, a, b){
    clearRange(row);
    const [s,e] = a<=b ? [a,b] : [b,a];
    const cells = row.querySelectorAll('td.time-slot');
    for (let i=s;i<=e;i++) cells[i]?.classList.add('range-selected');
    return [s,e];
  }

  function placePopoverBounded(cell){
    if (!pop.el) return;
    const prevDisp = pop.el.style.display, prevVis = pop.el.style.visibility;
    pop.el.style.visibility='hidden'; pop.el.style.display='block';
    const r = cell.getBoundingClientRect();
    const w = pop.el.offsetWidth || 280;
    const h = pop.el.offsetHeight || 120;
    let left = r.left + window.scrollX;
    let top  = r.bottom + window.scrollY + 4;
    const maxLeft = window.scrollX + window.innerWidth  - w - 8;
    const maxTop  = window.scrollY + window.innerHeight - h - 8;
    if (left > maxLeft) left = Math.max(window.scrollX + 8, maxLeft);
    if (top  > maxTop)  top  = Math.max(window.scrollY + 8, r.top + window.scrollY - h - 8);
    pop.el.style.left = `${left}px`;
    pop.el.style.top  = `${top}px`;
    pop.el.style.visibility = prevVis || 'visible';
    pop.el.style.display    = prevDisp || 'block';
  }

  function ensureChargeAllowedForCell(cell){
    const row = cell.closest('tr');
    const isDiesel = row?.querySelector('.bus-type-select')?.value === 'Diesel';
    const chargeBtn = pop.el?.querySelector('.activity-btn[data-activity="CHARGE"]');
    if (chargeBtn){ chargeBtn.disabled = isDiesel; chargeBtn.title = isDiesel ? 'Diesel buses cannot be charged' : ''; }
    if (isDiesel && pop.chargeBox) pop.chargeBox.style.display='none';
  }

  function chargerSlotConflict(chargerName, slot, selfBusId){
    for (const [busId, arr] of Object.entries(scheduleData)){
      if (busId===selfBusId) continue;
      const ev = arr?.[slot];
      if (ev && ev.type==='CHARGE' && String(ev.chargerName)===String(chargerName)) return busId;
    }
    return null;
  }

  function wirePainting(){
    const tbody = $(`#${GRID_BODY_ID}`); if (!tbody) return;

    tbody.addEventListener('mousedown', (e)=>{
      const cell = e.target.closest('td.time-slot'); if (!cell) return;
      isMouseDown = true; paintRow = cell.parentElement; paintStart = Number(cell.dataset.timeSlot);
      markRange(paintRow, paintStart, paintStart); e.preventDefault();
    });

    tbody.addEventListener('mouseover', (e)=>{
      if (!isMouseDown || !paintRow) return;
      const cell = e.target.closest('td.time-slot'); if (!cell || cell.parentElement!==paintRow) return;
      markRange(paintRow, paintStart, Number(cell.dataset.timeSlot));
    });

    window.addEventListener('mouseup', ()=>{
      if (!isMouseDown) return; isMouseDown=false; if (!paintRow) return;
      const sel = $$('.time-slot.range-selected', paintRow).map(td=>Number(td.dataset.timeSlot)).sort((a,b)=>a-b);
      const start = sel[0] ?? paintStart;
      const end   = sel.at(-1) ?? paintStart;
      const last  = paintRow.querySelector(`td.time-slot[data-time-slot="${end}"]`) || paintRow.querySelector(`td.time-slot[data-time-slot="${paintStart}"]`);
      activeCell  = last;

      if (pop.info) pop.info.textContent = `Bus: ${paintRow.dataset.busId}, Time: ${hhmm(start)}–${hhmm(end)}`;
      ensureChargeAllowedForCell(last);
      pop.el.style.display='block';
      placePopoverBounded(last);
      if (pop.chargeBox) pop.chargeBox.style.display='none';
    });

    tbody.addEventListener('click', (e)=>{
      const cell = e.target.closest('td.time-slot'); if (!cell) return;
      const row  = cell.parentElement;
      clearRange(row); cell.classList.add('range-selected'); activeCell = cell;
      if (pop.info) pop.info.textContent = `Bus: ${row.dataset.busId}, Time: ${hhmm(Number(cell.dataset.timeSlot))}`;
      ensureChargeAllowedForCell(cell);
      pop.el.style.display='block';
      placePopoverBounded(cell);
      if (pop.chargeBox) pop.chargeBox.style.display='none';
    });
  }

  function applyActivity(activity, details=null){
    if (!activeCell) return;
    const row = activeCell.closest('tr');
    const busId = row.dataset.busId;
    ensureRowArray(busId);

    const selected = $$('.time-slot.range-selected', row);
    const slots = (selected.length ? selected.map(td=>Number(td.dataset.timeSlot)) : [Number(activeCell.dataset.timeSlot)]);

    if (activity==='CHARGE'){
      const chosenOpt  = pop.chargerSel?.selectedOptions?.[0];
      const chargerName= details?.chargerName || chosenOpt?.value || pop.chargerSel?.value;
      if (!chargerName){ notify.warn('No charger selected','Pick a charger from the list'); return; }

      let blocked = 0, firstConflict=null, firstSlot=null;
      slots.forEach(i=>{
        const conflictBus = chargerSlotConflict(chargerName, i, busId);
        if (conflictBus){ blocked++; if(firstConflict===null){ firstConflict=conflictBus; firstSlot=i; } return; }
        const ev = { type:'CHARGE', chargerName, chargerId: chargerName };
        scheduleData[busId][i] = ev;
        const td = row.querySelector(`td.time-slot[data-time-slot="${i}"]`);
        if (td){
          td.className = 'time-slot activity-charge';
          td.textContent='C';
          td.dataset.charger = chargerName; setCellTitle(td, i, chargerName);
        }
      });
      if (blocked){
        notify.warn(
          `${chargerName} already assigned`,
          `In use by ${firstConflict} at ${hhmm(firstSlot)}`,
          { actionLabel:'Focus bus', onAction:()=>focusBusRow(firstConflict) }
        );
      }

      pop.el.style.display='none'; clearRange(row);
      if (pop.chargerSel){ pop.chargerSel.value=''; if (pop.chargeBox) pop.chargeBox.style.display='none'; }
      saveDraft(); recalcSOC();
      return;
    }

    // Non-charge activities
    slots.forEach(i=>{
      scheduleData[busId][i] = { type: activity };
      const td = row.querySelector(`td.time-slot[data-time-slot="${i}"]`);
      if (td){
        td.className = 'time-slot';
        if (activity==='RUN'){ td.classList.add('activity-run'); td.textContent='R'; }
        else if (activity==='BREAK'){ td.classList.add('activity-break'); td.textContent='B'; }
        else if (activity==='DEADHEAD'){ td.classList.add('activity-deadhead'); td.textContent='D'; }
        else { td.textContent=''; }
        delete td.dataset.charger; setCellTitle(td, i, null);
      }
    });
    pop.el.style.display='none'; clearRange(row);
    saveDraft(); recalcSOC(null,null,row);
  }

  function wirePopover(){
    const el = $(POPOVER_SEL); if (!el) return;
    getPopoverRefs();

    pop.cancelBtn?.addEventListener('click', ()=>{
      pop.el.style.display='none';
      const row = activeCell?.closest('tr'); if (row) clearRange(row);
      activeCell = null;
    });

    pop.el.addEventListener('click', (e)=>{
      const btn = e.target.closest('.activity-btn'); if (!btn) return;
      const activity = btn.dataset.activity;

      if (activity==='CHARGE'){
        const row = activeCell?.closest('tr');
        const isDiesel = row?.querySelector('.bus-type-select')?.value === 'Diesel';
        if (isDiesel) return;

        if (pop.chargeBox) pop.chargeBox.style.display='block';
        if (pop.chargerSel){
          if (!pop.chargerSel.firstElementChild || pop.chargerSel.firstElementChild.value!==''){
            const ph=document.createElement('option'); ph.value=''; ph.textContent='-- Select Charger --';
            pop.chargerSel.insertBefore(ph, pop.chargerSel.firstChild);
          }
          pop.chargerSel.value='';
          pop.chargerSel.onchange = ()=>{ const v=pop.chargerSel.value; if (v) applyActivity('CHARGE', { chargerName:v }); };
        }
      } else {
        if (pop.chargeBox) pop.chargeBox.style.display='none';
        applyActivity(activity);
      }
    });

    document.addEventListener('keydown', (e)=>{
      if (e.key==='Escape' && pop.el?.style.display==='block'){
        pop.el.style.display='none';
        const row = activeCell?.closest('tr'); if (row) clearRange(row);
        activeCell = null;
      }
    });
  }

  // -------------------- chargers --------------------
  async function loadChargers(){
    try {
      const res = await fetch('/api/chargers');
      if (!res.ok) throw new Error('fetch failed');
      const data = await res.json();
      availableChargers = (data||[]).map(ch=>({
        id: ch.id ?? ch.chargerId ?? ch.name ?? '',
        name: ch.name ?? String(ch.id ?? ''),
        rate: typeof ch.rate==='number' ? ch.rate
            : typeof ch.rate_kw==='number' ? ch.rate_kw
            : typeof ch.rateKw==='number' ? ch.rateKw : null
      }));
      window.EVSim = window.EVSim || {};
      const cfg = getConfiguredChargersSafe();
      window.EVSim.chargers = cfg.length ? cfg : availableChargers;

      const sel = $(CHARGE_PICKER_SEL);
      if (sel){
        sel.innerHTML='';
        const ph = document.createElement('option'); ph.value=''; ph.textContent='-- Select Charger --'; sel.appendChild(ph);
        (cfg.length ? cfg : availableChargers).forEach(ch=>{
          const o=document.createElement('option'); o.value=ch.name; o.textContent=`${ch.name}${ch.rate?` (${ch.rate} kW)`:''}`;
          sel.appendChild(o);
        });
        sel.value='';
      }
    } catch(e){
      console.warn('[editor] charger load failed:', e);
    }
  }

  // -------------------- save/load + safety --------------------
  function getSaves(){ try { return JSON.parse(localStorage.getItem(LS_KEY_SAVES)||'{}'); } catch { return {}; } }
  function putSaves(map){ localStorage.setItem(LS_KEY_SAVES, JSON.stringify(map)); }

  function saveDraft(){
    const draft = collectState(); draft.__ts = Date.now();
    localStorage.setItem(LS_KEY_DRAFT, JSON.stringify(draft));
    updateEditingBadge(draft.name || '');
  }
  function loadDraft(){ try { return JSON.parse(localStorage.getItem(LS_KEY_DRAFT) || 'null'); } catch { return null; } }

  function normalizedCopy(data){
    const out = {};
    for (const [busId, arr] of Object.entries(data)){
      out[busId] = Array(SLOTS).fill(null);
      for (let i=0;i<SLOTS;i++){
        const ev = arr?.[i] || null;
        if (!ev){ out[busId][i] = null; continue; }
        if (ev.type==='CHARGE'){
          const name = ev.chargerName || ev.charger || ev.chargerId || null;
          if (!name) { out[busId][i] = null; continue; }
          out[busId][i] = { type:'CHARGE', chargerName:name, chargerId:name };
        } else {
          out[busId][i] = { type: ev.type };
        }
      }
    }
    return out;
  }

  function collectState(){
    const buses = [];
    $(`#${GRID_ID} tbody`)?.querySelectorAll('tr[data-bus-id]')?.forEach(tr=>{
      const id = tr.dataset.busId;
      const type = tr.querySelector('.bus-type-select')?.value || 'EV';
      const socV = Number(tr.querySelector('.start-soc-input')?.value ?? 90);
      buses.push({ id, type, soc: Number.isFinite(socV)? socV : 90 });
    });
    return { name: $('#run-cut-name')?.value?.trim() || '', slotMinutes: SLOT_MIN, buses, data: normalizedCopy(scheduleData) };
  }

  function rebuildFromState(state){
    const tbody = $(`#${GRID_BODY_ID}`); if (!tbody) return;
    tbody.innerHTML='';
    Object.keys(scheduleData).forEach(k=>delete scheduleData[k]);

    (state?.buses || []).forEach(b=>{
      const tr = addBusRow(b.id); if (!tr) return;
      const sel = tr.querySelector('.bus-type-select'); if (sel) sel.value = b.type || 'EV';
      setRowFuelState(tr);
      const soc = tr.querySelector('.start-soc-input'); if (soc) soc.value = Number.isFinite(Number(b.soc)) ? Number(b.soc) : 90;

      ensureRowArray(b.id);
      const rowArr = scheduleData[b.id];
      const src = (state.data && state.data[b.id]) || [];
      for (let i=0;i<SLOTS;i++){
        const raw = src[i] || null;
        if (!raw){ rowArr[i]=null; continue; }
        if (raw.type==='CHARGE'){
          const name = raw.chargerName || raw.charger || raw.chargerId || null;
          if (!name){ rowArr[i]=null; continue; }
          rowArr[i] = { type:'CHARGE', chargerName:name, chargerId:name };
        } else {
          rowArr[i] = { type: raw.type };
        }

        const td = tr.querySelector(`td.time-slot[data-time-slot="${i}"]`);
        if (td){
          td.className='time-slot';
          const ev = rowArr[i];
          if (ev){
            if (ev.type==='RUN'){ td.classList.add('activity-run'); td.textContent='R'; }
            else if (ev.type==='BREAK'){ td.classList.add('activity-break'); td.textContent='B'; }
            else if (ev.type==='DEADHEAD'){ td.classList.add('activity-deadhead'); td.textContent='D'; }
            else if (ev.type==='CHARGE'){ td.classList.add('activity-charge'); td.textContent='C'; td.dataset.charger = ev.chargerName; }
          } else { td.textContent=''; delete td.dataset.charger; }
          setCellTitle(td, i, ev?.type==='CHARGE' ? ev.chargerName : null);
        }
      }
    });

    recalcSOC();
  }

  // --- badge next to name ---
  function updateEditingBadge(name){
    const input = $('#run-cut-name'); if (!input) return;
    let badge = input.nextElementSibling;
    if (!badge || !badge.classList || !badge.classList.contains('editing-badge')){
      badge = document.createElement('span'); badge.className='editing-badge';
      input.insertAdjacentElement('afterend', badge);
    }
    badge.textContent = `Editing: ${name ? name : 'Unsaved draft'}`;
  }

  // --- safe save flows ---
  function timestampSuffix(){
    const d = new Date();
    const pad = n => String(n).padStart(2,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function saveScheduleSafely(){
    const nameEl = $('#run-cut-name');
    if (!nameEl){ notify.info('Missing field','Cannot find schedule name box.'); return; }
    let name = nameEl.value.trim();
    if (!name){
      notify.info('Enter a Schedule Name','Name is required to save.'); nameEl.focus(); return;
    }
    const saves = getSaves();
    const doSave = (finalName)=>{
      const map = getSaves(); map[finalName] = collectState(); putSaves(map);
      currentEditingName = finalName; nameEl.value = finalName; updateEditingBadge(finalName);
      saveDraft();
      notify.success(`${finalName} schedule saved`);
    };

    if (saves[name]){
      const id = notify.confirm('Overwrite existing schedule?', `“${name}” already exists.`, {
        okLabel:'Overwrite', cancelLabel:'Save copy',
        onConfirm: (tid)=>{ notify.dismiss(tid); doSave(name); },
        onCancel:  (tid)=>{ notify.dismiss(tid);
          const copy = `${name} (copy ${timestampSuffix()})`;
          nameEl.value = copy; doSave(copy);
        }
      });
    } else {
      doSave(name);
    }
  }

  // -------------------- SOC recompute (RUN & DEADHEAD consume; CHARGE adds) --------------------
  function recalcSOC(_grid=null, _busParams=null, onlyRow=null){
    const bus = _busParams || (window.EVSim && window.EVSim.busParams) || { essCapacity:435, euRate:55, lowSOC:20, criticalSOC:10 };
    const dtHrs = SLOT_MIN/60;

    const rows = onlyRow ? [onlyRow] : $(`#${GRID_ID} tbody`)?.querySelectorAll('tr[data-bus-id]') || [];
    rows.forEach(tr=>{
      const type = tr.querySelector('.bus-type-select')?.value || 'EV';
      const busId = tr.dataset.busId;
      const arr = (scheduleData[busId] ||= Array(SLOTS).fill(null));

      let socPct = Number(tr.querySelector('.start-soc-input')?.value ?? 90);
      socPct = Number.isFinite(socPct) ? Math.max(0, Math.min(100, socPct)) : 90;

      for (let i=0;i<SLOTS;i++){
        const td = tr.querySelector(`td.time-slot[data-time-slot="${i}"]`);
        const ev = arr[i];

        if (type==='EV'){
          if (ev?.type==='RUN' || ev?.type==='DEADHEAD'){
            socPct = Math.max(0, socPct - (bus.euRate||0)*dtHrs/(bus.essCapacity||1)*100);
          } else if (ev?.type==='CHARGE'){
            const meta = chargerLookup(ev.chargerName || ev.chargerId);
            const rate = Number(meta?.rate)||0;
            socPct = Math.min(100, socPct + rate*dtHrs/(bus.essCapacity||1)*100);
          }
        }

        if (td){
          td.classList.remove('soc-low','soc-crit','soc-strand');
          // Reset base class per type first
          td.classList.remove('activity-run','activity-deadhead');
          if (ev?.type==='RUN'){ td.classList.add('activity-run'); }
          if (ev?.type==='DEADHEAD'){ td.classList.add('activity-deadhead'); }

          if (ev?.type==='RUN'){
            if (socPct < 5){ td.classList.remove('activity-run'); td.classList.add('soc-strand'); td.textContent=''; }
            else if (socPct < (bus.criticalSOC ?? 10)){ td.classList.remove('activity-run'); td.classList.add('soc-crit'); td.textContent='R'; }
            else if (socPct < (bus.lowSOC ?? 20)){ td.classList.remove('activity-run'); td.classList.add('soc-low');  td.textContent='R'; }
            else { td.textContent='R'; }
          } else if (ev?.type==='DEADHEAD'){
            if (socPct < 5){ td.classList.remove('activity-deadhead'); td.classList.add('soc-strand'); td.textContent=''; }
            else if (socPct < (bus.criticalSOC ?? 10)){ td.classList.remove('activity-deadhead'); td.classList.add('soc-crit'); td.textContent='D'; }
            else if (socPct < (bus.lowSOC ?? 20)){ td.classList.remove('activity-deadhead'); td.classList.add('soc-low');  td.textContent='D'; }
            else { td.textContent='D'; }
          } else if (ev?.type==='CHARGE'){ td.textContent='C'; }
          else if (ev?.type==='BREAK'){ td.textContent='B'; }
          else if (!ev && !td.classList.contains('range-selected')) { td.textContent=''; }
        }
      }
    });
  }

  // Preview results
  function computeSOCReport(){
    const busParams = (window.EVSim && window.EVSim.busParams) || { essCapacity:435, euRate:55, lowSOC:20, criticalSOC:10 };
    const dtHrs = SLOT_MIN/60;
    const report = [];

    $(`#${GRID_ID} tbody`)?.querySelectorAll('tr[data-bus-id]')?.forEach(tr=>{
      const id = tr.dataset.busId;
      const type = tr.querySelector('.bus-type-select')?.value || 'EV';
      const arr = scheduleData[id] || [];
      let soc = Number(tr.querySelector('.start-soc-input')?.value ?? 90);
      soc = Number.isFinite(soc) ? Math.max(0, Math.min(100, soc)) : 90;

      let lowAt=null, critAt=null, strandAt=null;

      for (let i=0;i<SLOTS;i++){
        const ev = arr[i];
        if (type==='EV'){
          if (ev?.type==='RUN' || ev?.type==='DEADHEAD'){
            soc = Math.max(0, soc - (busParams.euRate||0)*dtHrs/(busParams.essCapacity||1)*100);
          } else if (ev?.type==='CHARGE'){
            const meta = chargerLookup(ev.chargerName || ev.chargerId);
            const rate = Number(meta?.rate)||0;
            soc = Math.min(100, soc + rate*dtHrs/(busParams.essCapacity||1)*100);
          }
        }
        if (strandAt===null && soc<5) strandAt = i;
        if (critAt===null && soc<(busParams.criticalSOC ?? 10)) critAt = i;
        if (lowAt===null  && soc<(busParams.lowSOC ?? 20))      lowAt  = i;
      }

      report.push({ id, finalSOC: Number(soc.toFixed(1)), lowAt, critAt, strandAt });
    });

    return report;
  }

  function renderClientResults(){
    const box = $('#simulation-results-container'); if (!box) return;
    const data = computeSOCReport();

    const html = [
      `<div class="sim-results">`,
        `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px">`,
          `<h3>Simulation Results</h3>`,
          `<button id="close-results-btn" title="Close results">Close Results</button>`,
        `</div>`,
        `<p style="margin:0 0 8px">Buses: ${data.length}</p>`,
        ...data.map(d=>{
          const lines = [];
          if (d.lowAt!==null)   lines.push(`<li style="color:#6b4e00">Low SOC at ${hhmm(d.lowAt)}</li>`);
          if (d.critAt!==null)  lines.push(`<li style="color:#b91c1c">Critical SOC at ${hhmm(d.critAt)}</li>`);
          if (d.strandAt!==null)lines.push(`<li><span style="color:#fff;background:#000;padding:0 6px;border-radius:4px">Stranded</span> at ${hhmm(d.strandAt)}</li>`);
          const bullets = lines.length ? lines.join('') : '<li>No warnings</li>';
          return `<div style="margin:6px 0 10px">
                    <strong>${d.id}</strong> — Final SOC: ${d.finalSOC}%
                    <ul style="margin:4px 0 0 18px">${bullets}</ul>
                  </div>`;
        }),
      `</div>`
    ].join('');
    box.innerHTML = html;
    box.style.display = 'block';
    $('#close-results-btn')?.addEventListener('click', ()=>{ box.style.display='none'; });
  }

  // -------------------- convenience UI --------------------
  function focusBusRow(busId){
    const row = $(`#${GRID_ID} tbody tr[data-bus-id="${busId}"]`);
    if (!row){ notify.info('Row not found', busId); return; }
    row.scrollIntoView({behavior:'smooth', block:'center'});
    row.style.outline = '2px solid var(--accent)';
    row.style.background = 'rgba(182,199,255,.15)';
    setTimeout(()=>{ row.style.outline=''; row.style.background=''; }, 1800);
  }

  // -------------------- init / boot --------------------
  function applyConfiguredChargersToSelects(){
    const chargers = getConfiguredChargersSafe();
    const selects = document.querySelectorAll(CHARGE_PICKER_SEL+', select.charger-select');
    selects.forEach(sel=>{
      const want = [''].concat(chargers.map(c=>`${c.name} (${c.rate} kW)`)).join('|');
      const cur  = Array.from(sel.options).map(o=>o.value===''?'':o.textContent).join('|');
      if (want===cur) return;
      sel.innerHTML='';
      const ph = document.createElement('option'); ph.value=''; ph.textContent='-- Select Charger --'; sel.appendChild(ph);
      chargers.forEach(c=>{ const o=document.createElement('option'); o.value=c.name; o.textContent=`${c.name} (${c.rate} kW)`; sel.appendChild(o); });
      sel.value='';
    });
  }

  function initEditor(){
    const getBusParams = (window.getBusParams && window.getBusParams) || (()=>null);
    const chargers = getConfiguredChargersSafe();
    const bus = getBusParams() || { essCapacity:435, euRate:55, lowSOC:20, criticalSOC:10 };
    window.EVSim = window.EVSim || {}; window.EVSim.busParams = bus;
    if (!chargers.length && !availableChargers.length){
      const host = document.getElementById('editor-root') || document.body;
      const el = document.createElement('div');
      el.id='no-chargers-banner';
      el.textContent='No chargers configured. Go to Configuration → Charger Setup to add chargers.';
      el.style.cssText='margin:12px;padding:10px;border:1px solid var(--border);background:#fff7e6;color:#6b4e00;border-radius:8px;font-weight:600;';
      host.prepend(el);
    }
  }

  function clearSchedule(){
    $(`#${GRID_BODY_ID}`).innerHTML=''; Object.keys(scheduleData).forEach(k=>delete scheduleData[k]);
    // Safety: blank the schedule name so Save can’t overwrite by accident
    const nameEl = $('#run-cut-name'); if (nameEl) nameEl.value = '';
    currentEditingName = ''; updateEditingBadge('');
    saveDraft();
    notify.info('Schedule cleared','Working in Unsaved draft');
  }

  function init(){
    createHeader();
    wirePainting();
    wirePopover();
    loadChargers();
    initEditor();

    const addBtn   = $('#add-bus-btn');
    const saveBtn  = $('#save-run-cut-btn');
    const loadBtn  = $('#load-run-cut-btn');
    const clearBtn = $('#clear-run-cut-btn');
    const simBtn   = $('#run-simulation-btn');

    addBtn?.addEventListener('click', ()=>{ addBusRow(); saveDraft(); });

    saveBtn?.addEventListener('click', saveScheduleSafely);

    loadBtn?.addEventListener('click', ()=>{
      openLoadModal();
    });

    clearBtn?.addEventListener('click', ()=>{
      // “Clear Schedule?” with two actions: Clear now / Save
      notify.confirm('Clear schedule?', 'Unsaved changes will be lost.', {
        okLabel:'Clear now',
        cancelLabel:'Save…',
        onConfirm: (tid)=>{ notify.dismiss(tid); clearSchedule(); },
        onCancel:  (tid)=>{ notify.dismiss(tid);
          const nameEl = $('#run-cut-name');
          if (!nameEl || !nameEl.value.trim()){
            notify.info('Enter a Schedule Name','Name is required to save.'); nameEl?.focus();
          } else {
            saveScheduleSafely();
          }
        }
      });
    });

    simBtn?.addEventListener('click', ()=>{
      const state = collectState();
      const cfg = getConfiguredChargersSafe();
      const catalog = (cfg.length ? cfg : availableChargers || []).map(c=>({ name:c.name, id: c.id ?? c.name, rate: c.rate ?? null }));
      const detail = { ...state, chargersCatalog: catalog, chargerKey:'name', strandedThreshold: 5 };
      window.dispatchEvent(new CustomEvent('run-simulation', { detail }));
      renderClientResults();
    });

    const draft = loadDraft();
    if (draft && draft.data){
      rebuildFromState(draft);
      if ($('#run-cut-name')) $('#run-cut-name').value = draft.name || '';
      currentEditingName = draft.name || '';
    } else {
      addBusRow();
      currentEditingName = '';
    }
    updateEditingBadge(currentEditingName);

    recalcSOC();
    applyConfiguredChargersToSelects(); setTimeout(applyConfiguredChargersToSelects, 300);

    window.addEventListener('beforeunload', saveDraft);
    window.addEventListener('resize', sizeTimeColumns);
    sizeTimeColumns();
  }

  // ---------- load modal (unchanged from earlier) ----------
  function getSaves(){ try { return JSON.parse(localStorage.getItem(LS_KEY_SAVES)||'{}'); } catch { return {}; } }
  function putSaves(map){ localStorage.setItem(LS_KEY_SAVES, JSON.stringify(map)); }
  function openLoadModal(){
    const modal = $('#load-modal'), list = $('#modal-run-cut-list'); if (!modal || !list) return;
    const saves = getSaves(); list.innerHTML=''; const names = Object.keys(saves);

    if (!names.length){ list.innerHTML='<p>No saved schedules.</p>'; }
    else {
      const ul = document.createElement('ul');
      names.forEach(name=>{
        const li = document.createElement('li');
        const span = document.createElement('span'); span.textContent = name;
        const load = document.createElement('button'); load.textContent='Load';
        load.addEventListener('click', ()=>{
          rebuildFromState(saves[name]);
          const nm=$('#run-cut-name'); if (nm) nm.value=name;
          currentEditingName = name; updateEditingBadge(name);
          modal.style.display='none'; saveDraft();
          notify.info('Schedule loaded', name);
        });
        const del  = document.createElement('button'); del.className='delete-btn'; del.textContent='Delete';
        del.addEventListener('click', ()=>{ const map=getSaves(); delete map[name]; putSaves(map); openLoadModal(); });
        li.appendChild(span); li.appendChild(load); li.appendChild(del); ul.appendChild(li);
      });
      list.appendChild(ul);
    }
    modal.style.display='block';
  }

  window.addEventListener('DOMContentLoaded', init);

  // --- clear lingering selection on cancel/close ---
  (function(){
    function clearGridSelection(){
      const cells = document.querySelectorAll(
        `#${GRID_ID} .selected, #${GRID_ID} .is-selected, #${GRID_ID} .cell--selected, #${GRID_ID} .range-selected, #${GRID_ID} [aria-selected="true"]`
      );
      cells.forEach(el=>{
        el.classList.remove('selected','is-selected','cell--selected','range-selected');
        if (el.getAttribute('aria-selected')==='true') el.setAttribute('aria-selected','false');
        el.style.background=''; el.style.outline='';
      });
    }
    document.addEventListener('click', (e)=>{
      const t=e.target;
      const inModal = t.closest('.modal, [role="dialog"], #activity-modal');
      const looksCancel = /cancel/i.test(t.textContent||'') || t.matches('[data-action="cancel"], [data-dismiss="modal"], .btn-cancel, .close, [aria-label="Close"]');
      if (inModal && looksCancel) clearGridSelection();
    }, true);
    document.addEventListener('keydown', (e)=>{ if (e.key==='Escape') clearGridSelection(); });
    const modal = document.getElementById('activity-modal') || document.querySelector('.modal[role="dialog"]');
    if (modal){
      const mo = new MutationObserver(()=>{
        const isOpen = modal.hasAttribute('open') || getComputedStyle(modal).display!=='none';
        if (!isOpen) clearGridSelection();
      });
      mo.observe(modal, { attributes:true, attributeFilter:['open','style','class'] });
    }
  })();

  // -------------------- debug helpers --------------------
  window.EVSim = window.EVSim || {};

  window.EVSim.debugSOC = function(busId){
    const rows = window.EVSim.debugSOCkWh(busId);
    if (!rows) return;
    const compact = rows.map(r => ({ slot:r.slot, time:r.time, end_pct:r.end_pct, ev:r.ev }));
    console.table(compact);
    return compact;
    };

  window.EVSim.debugSOCkWh = function(busId){
    const busParams = window.EVSim.busParams || { essCapacity:435, euRate:55, lowSOC:20, criticalSOC:10 };
    const dtHrs = SLOT_MIN/60;
    const tr = $(`#${GRID_ID} tbody tr[data-bus-id="${busId}"]`);
    if (!tr){ console.warn('Bus not found'); return; }
    let socPctStart = Number(tr.querySelector('.start-soc-input')?.value ?? 90);
    socPctStart = Number.isFinite(socPctStart) ? Math.max(0, Math.min(100, socPctStart)) : 90;

    const ess = busParams.essCapacity || 1;
    let e_kWh = ess * socPctStart / 100;
    const arr = scheduleData[busId] || [];

    const rows = [];
    for (let i=0;i<SLOTS;i++){
      const ev = arr[i];
      const start_kWh = e_kWh;
      const start_pct = (e_kWh / ess) * 100;

      let delta = 0;
      let note = ev?.type || '-';
      if (ev?.type === 'RUN' || ev?.type==='DEADHEAD'){
        delta = - (busParams.euRate||0) * dtHrs;
      } else if (ev?.type === 'CHARGE'){
        const meta = chargerLookup(ev.chargerName || ev.chargerId);
        const rate = Number(meta?.rate)||0;
        delta = rate * dtHrs;
        if (!meta) note += ' (unknown charger)';
      }

      e_kWh = Math.min(ess, Math.max(0, e_kWh + delta));
      const end_pct = (e_kWh / ess) * 100;

      rows.push({
        slot: i, time: hhmm(i),
        start_pct: +start_pct.toFixed(2),
        start_kWh: +start_kWh.toFixed(3),
        delta_kWh: +delta.toFixed(3),
        end_kWh: +e_kWh.toFixed(3),
        end_pct: +end_pct.toFixed(2),
        ev: note
      });
    }
    console.table(rows);
    return rows;
  };
})();
