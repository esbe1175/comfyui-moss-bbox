import {parseState,compilePrompt,clamp,parseAspectRatio,setAspectRatio,formatAspectRatio,resolveDimensions,resizeBox,addRegion,colorFor} from './state.js';
import {ensureGroups,createGroup,removeGroup,groupRegionIds,selectionBounds,moveRegions,resizeRegions,duplicateRegions,pasteRegions} from './groups.js';
import {importPrompt} from './prompt_import.js';
import {snapPoint,snapBox,snapMove,snapResize} from './grid.js';
import {icon,esc} from './icons.js';
import {listEntries,moveListRegions,moveListFolder,groupListRegions} from './list.js';
import {installShortcutHelp} from './shortcut_help.js';

const button=(action,glyph,text='',tip=text,extra='',shortcut='')=>`<button type="button" class="btn btn-sm ${extra} ${text?'':'btn-square'}" data-action="${action}" title="${esc(tip)}" aria-label="${esc(tip)}">${icon(glyph)}${text?`<span>${text}</span>`:''}${shortcut?`<kbd class="tool-key">${shortcut}</kbd>`:''}</button>`;
const categoryName=label=>label[0].toUpperCase()+label.slice(1);
const categoryIcon=label=>icon(label==='character'?'person':label,14);
const boxClipboardType='application/x-moss-bbox+json';
const handles=['nw','n','ne','e','se','s','sw','w'];
const presets=[['1:1','Square'],['2:3','Portrait photo'],['3:2','Photo'],['3:4','Portrait standard'],['4:3','Standard'],['4:5','Portrait'],['5:4','Landscape'],['9:16','Portrait widescreen'],['16:9','Widescreen'],['2:1','Panorama'],['1:2','Tall'],['21:9','Ultrawide']];

export class BBoxEditor {
 constructor(adapter){
  this.adapter=adapter;this.workspace=Boolean(adapter.workspace);this.state=parseState(adapter.read());ensureGroups(this.state);
  this.selected=this.state.regions[0]?.id;this.selection=new Set(this.selected?[this.selected]:[]);
  this.zoom=1;this.panX=0;this.panY=0;this.undo=[];this.redo=[];this.visible=true;this.closed=false;this.drawArmed=false;this.snap=Boolean(adapter.getSnap?.()??true);
 }
 async open(){
  this.host=document.createElement('div');this.root=this.host.attachShadow({mode:'open'});
  const css=document.createElement('link');css.rel='stylesheet';css.href=new URL('./editor.css',import.meta.url).href;
  const ready=new Promise((resolve,reject)=>{css.onload=resolve;css.onerror=()=>reject(new Error('Could not load box editor styles. Refresh ComfyUI.'));});
  this.root.append(css);this.dialog=document.createElement('dialog');this.dialog.id=`moss-boxes-${crypto.randomUUID()}`;
  this.dialog.className=this.workspace?'modal workspace':'modal';this.dialog.dataset.theme='moss';this.dialog.setAttribute('aria-label','MOSS-Image BBOX editor');
  this.dialog.innerHTML=`<div class="modal-box editor-shell">
   <header class="editor-header"><h1>MOSS-Image BBOX editor</h1>
    <div class="aspect-ratio"><label for="${this.dialog.id}-ratio">Aspect ratio</label><div class="ratio-control">
     <input id="${this.dialog.id}-ratio" class="input input-sm" data-field="aspect_ratio" aria-label="Aspect ratio" title="Any positive W:H ratio, such as 37:19."/>
     <details class="dropdown ratio-menu"><summary class="btn btn-sm btn-square" title="All aspect ratios" aria-label="All aspect ratios">${icon('down')}</summary><div class="dropdown-content ratio-presets">${presets.map(([ratio,label])=>`<button class="btn btn-sm" data-ratio="${ratio}" title="${label}"><span>${ratio}</span><small>${label}</small></button>`).join('')}</div></details>
    </div></div>
    <div class="header-actions">${button('shortcuts','keyboard','','Keyboard shortcuts · hover to show, click to pin')}${button('undo','undo','','Undo · Ctrl+Z')}${button('redo','redo','','Redo · Ctrl+Shift+Z')}${button('save-prompt','download','Save prompt','Download the current prompt')}${button('import-prompt','paste','Import prompt','Read and validate a prompt or editable layout from the clipboard.')}<div class="copy-control">${button('copy','copy','Copy','Copy prompt or editable layout')}<ul class="menu menu-sm copy-menu" aria-label="Copy format" hidden><li><button data-action="copy-prompt" title="Native MOSS pixels for the current generation canvas">Prompt</button></li><li><button data-action="copy-layout" title="Normalized boxes, folders and muted boxes; import at any resolution">Editable layout</button></li></ul></div>
     <form method="dialog"><button class="btn btn-sm" title="Edits are saved to this node as you work">${this.workspace?'Back to workflow':'Done'}</button></form></div>
   </header>
   <div class="editor-body"><main class="canvas-column">
    <div class="canvas-tools"><div class="mode-tools">${button('select','cursor','Select','Select, move and resize boxes · V · Ctrl-drag to select a region','','V')}${button('draw','box','Draw box','Draw boxes · R','','R')}</div><div class="selection-tools"><span class="selection-count"></span>${button('duplicate','copy','','Duplicate selected boxes · Ctrl+D')}${button('delete','trash','','Delete selected boxes')}${button('new-folder','folder','Group','Put selected boxes in a folder · Ctrl+G')}</div>
     <div class="view-tools">${button('snap','grid','Snap 16','Show the 16-pixel generation grid and snap box edges')}${button('visibility','eye','','Show or hide boxes')}${button('zoom-out','minus','','Zoom out')}${button('fit','fit','','Fit image · 0')}${button('zoom-in','plus','','Zoom in')}</div></div>
    <div class="viewport" tabindex="0" aria-label="Image and bounding boxes" title="V: Select · R: Draw box · Ctrl-drag: select a region · Shift-click: multiple boxes · Alt-click: next overlapping box · Right-click: choose box · Wheel: zoom · Middle-drag or Space-drag: pan"><div class="board-wrap"><div class="artboard"><img class="reference" alt="Reference image" draggable="false" hidden/><div class="grid-overlay" hidden></div><div class="boxes"></div></div></div></div>
    <div class="image-bar">${button('import','image','Import image','Import or replace the reference image; existing boxes are kept')}${button('paste-image','paste','Paste image','Use an image from the clipboard as the reference; existing boxes are kept')}<span class="image-name"></span>${button('remove-image','close','','Remove reference image; keep boxes')}</div>
   </main><aside class="sidebar"><section class="scene-field"><label for="scene">Scene</label><textarea id="scene" class="textarea textarea-sm" data-field="scene" placeholder="Describe the whole image…" title="Overall scene, medium, lighting, palette and camera."></textarea></section>
    <div class="region-heading"><h2>Boxes <span class="count"></span></h2><div>${button('new-folder','folder','','New folder from selected boxes')}${button('add','plus','','Create a box · R to draw a custom box')}</div></div><div class="regions" aria-label="Box descriptions"></div>
   </aside></div>
   ${this.workspace?`<footer class="generation-bar"><div class="generation-controls"><div class="generation-readout"><div class="generation-meta"><span class="generation-dot-key" hidden></span><span class="generation-status" role="status" aria-live="polite" aria-busy="false">Ready</span></div><div class="generation-steps" role="progressbar" aria-label="Generation steps" aria-valuemin="0" hidden></div></div><button type="button" class="btn btn-primary" data-action="generate" title="Generate with the current workflow · Ctrl+Enter">${icon('image')}<span>Generate</span><kbd>Ctrl+Enter</kbd></button></div></footer>`:''}
   <section class="prompt-panel" aria-label="Import MOSS prompt" hidden><header><h2>Import prompt</h2>${button('close-import','close','','Close prompt import')}</header><textarea class="textarea" data-field="prompt_import" aria-label="MOSS prompt JSON" placeholder="Paste MOSS prompt JSON…" spellcheck="false"></textarea><div class="import-source" hidden><h3 title="MOSS pixel prompts omit their canvas dimensions. Choose the source canvas; your current canvas stays unchanged.">Source canvas</h3><div class="source-controls"><label>Aspect ratio<input class="input input-sm" data-field="import_source_ratio" aria-label="Source aspect ratio" placeholder="3:2"/></label><label>Megapixels<input class="input input-sm" type="number" min="0.01" step="0.25" data-field="import_source_megapixels" aria-label="Source megapixels"/></label><details class="source-exact"><summary title="Use the exact pixel dimensions of the source prompt">Exact size</summary><div><label>Width<input class="input input-sm" type="number" min="16" step="16" data-field="import_source_width" aria-label="Source width"/></label><label>Height<input class="input input-sm" type="number" min="16" step="16" data-field="import_source_height" aria-label="Source height"/></label></div></details></div><div class="source-actions"><button type="button" class="btn btn-sm" data-action="import-current-canvas" title="The prompt was created at this node's current aspect ratio and megapixels">Use current canvas</button><button type="button" class="btn btn-sm" data-action="import-source-canvas">Import</button></div></div><p class="import-error" role="alert" hidden></p><div class="prompt-actions">${button('paste-prompt','paste','Read clipboard')}${button('apply-prompt','check','Import')}</div></section>
   <ul class="menu menu-sm overlap-menu" aria-label="Boxes under pointer" hidden></ul><div class="list-drop-hint" role="status" hidden></div>
   <div class="feedback" role="status" aria-live="polite" hidden></div><input type="file" accept="image/*" class="file-picker" hidden/>
  </div>`;
  this.root.append(this.dialog);document.body.append(this.host);
  const copyToggle=this.root.querySelector('[data-action="copy"]');copyToggle.setAttribute('aria-haspopup','menu');copyToggle.setAttribute('aria-expanded','false');
  this.board=this.root.querySelector('.artboard');this.viewport=this.root.querySelector('.viewport');this.image=this.root.querySelector('.reference');
  this.root.addEventListener('click',event=>this.click(event).catch(error=>this.notify(error.message)));
  this.root.addEventListener('dblclick',event=>{const title=event.target.closest('[data-select-folder]');if(title){event.preventDefault();this.startGroupRename(title.dataset.selectFolder);}});
  this.root.addEventListener('input',event=>this.input(event));this.root.addEventListener('change',event=>this.change(event));
  this.root.addEventListener('focusin',event=>{const row=event.target.closest('.region');if(row&&event.target.matches('textarea,select')&&(this.selected!==row.dataset.id||this.selection.size>1)){this.selected=row.dataset.id;this.selection=new Set([this.selected]);this.refreshRegionSelection();this.renderBoxes();this.updateActions();}if(event.target.matches('textarea,input,select'))this.focusSnapshot=JSON.stringify(this.state);});
  this.root.addEventListener('focusout',event=>{if(event.target.dataset.groupName)this.finishGroupRename(false,true,false);});
  const regions=this.root.querySelector('.regions');
  regions.addEventListener('dragstart',event=>this.startListDrag(event));regions.addEventListener('dragover',event=>this.overListDrag(event));
  regions.addEventListener('dragleave',event=>{if(!regions.contains(event.relatedTarget))this.clearListDrop();});
  regions.addEventListener('drop',event=>this.dropList(event));regions.addEventListener('dragend',()=>this.endListDrag());
  this.board.addEventListener('pointerdown',event=>this.pointerDown(event));this.board.addEventListener('pointermove',event=>this.pointerMove(event));this.board.addEventListener('pointerup',event=>this.pointerUp(event));this.board.addEventListener('pointercancel',()=>this.cancelDrag());this.board.addEventListener('lostpointercapture',()=>this.cancelDrag());this.board.addEventListener('pointerleave',()=>{if(!this.drag)this.board.style.cursor='';});
  this.board.addEventListener('contextmenu',event=>this.contextMenu(event));
  const overlapMenu=this.root.querySelector('.overlap-menu');
  this.root.addEventListener('mouseover',event=>{const item=event.target.closest('[data-choose-box]');if(item)this.hoverOverlap(item.dataset.chooseBox);});
  this.root.addEventListener('focusin',event=>{const item=event.target.closest('[data-choose-box]');if(item)this.hoverOverlap(item.dataset.chooseBox);});
  overlapMenu.addEventListener('mouseleave',()=>this.hoverOverlap(null));
  overlapMenu.addEventListener('focusout',event=>{if(!overlapMenu.contains(event.relatedTarget))this.hoverOverlap(null);});
  this.dialog.addEventListener('cancel',event=>{if(this.renameSession){event.preventDefault();this.finishGroupRename(true);}else if(this.listDrag){event.preventDefault();this.endListDrag();}else if(this.drag){event.preventDefault();this.cancelDrag();this.setTool('select');}else if(this.pan){event.preventDefault();this.endPan();this.setTool('select');}else if(!this.root.querySelector('.prompt-panel').hidden){event.preventDefault();this.closeImport();}else if(this.drawArmed){event.preventDefault();this.setTool('select');}});
  this.dialog.addEventListener('close',()=>this.close());
  this.viewport.addEventListener('pointerdown',event=>this.startPan(event),true);
  this.viewport.addEventListener('pointermove',event=>{if(!this.pan)return;event.preventDefault();event.stopPropagation();this.panX=this.pan.left+event.clientX-this.pan.x;this.panY=this.pan.top+event.clientY-this.pan.y;this.applyPan();},true);
  this.viewport.addEventListener('pointerup',event=>this.endPan(event));this.viewport.addEventListener('pointercancel',event=>this.endPan(event));this.viewport.addEventListener('lostpointercapture',event=>this.endPan(event));
  this.viewport.addEventListener('auxclick',event=>{if(event.button===1)event.preventDefault();});
  this.viewport.addEventListener('dragover',event=>{if(!Array.from(event.dataTransfer?.types||[]).includes('Files'))return;event.preventDefault();this.viewport.classList.add('drag-over');});this.viewport.addEventListener('dragleave',()=>this.viewport.classList.remove('drag-over'));
  this.viewport.addEventListener('drop',event=>{event.preventDefault();this.viewport.classList.remove('drag-over');const file=event.dataTransfer?.files?.[0];if(file)this.importImage(file);});
  try{await ready;}catch(error){this.host.remove();throw error;}if(this.closed)return;
  this.eventWindow=this.dialog.ownerDocument.defaultView;
  this.captureKey=event=>{if(this.dialog.open){event.stopImmediatePropagation();this.key(event,event.composedPath()[0]);}};
  this.captureKeyUp=event=>{if(!this.dialog.open)return;event.stopImmediatePropagation();if(event.code==='Space')this.space=false;if(event.key==='Control'||event.key==='Meta')this.marqueeArmed=Boolean(event.ctrlKey||event.metaKey);this.updateCursor();};
  this.captureClipboard=event=>{if(this.dialog.open){event.stopImmediatePropagation();this.clipboard(event,event.composedPath()[0]);}};
  this.captureWheel=event=>{if(!this.dialog.open||!event.composedPath().includes(this.viewport))return;event.preventDefault();event.stopImmediatePropagation();if(!event.deltaY||this.pan||this.drag)return;this.setZoom(this.zoom*(event.deltaY>0?.85:1.15),[event.clientX,event.clientY]);this.showZoomCursor(event.deltaY<0);};
  this.captureBlur=()=>{this.space=false;this.marqueeArmed=false;this.endPan();this.cancelDrag();this.endListDrag();this.clearZoomCursor();this.updateCursor();};
  this.eventWindow.addEventListener('wheel',this.captureWheel,{capture:true,passive:false});this.eventWindow.addEventListener('blur',this.captureBlur);
  this.eventWindow.addEventListener('keydown',this.captureKey,true);this.eventWindow.addEventListener('keyup',this.captureKeyUp,true);
  for(const type of ['copy','cut','paste'])this.eventWindow.addEventListener(type,this.captureClipboard,true);
  this.dialog.showModal();this.shortcutHelp=installShortcutHelp(this.root);
  this.observer=new ResizeObserver(()=>{this.fit();this.updateStepMeter();});
  this.observer.observe(this.viewport);this.render();this.loadReference();
  this.viewport.focus();
 }
 close(){if(this.closed)return;this.finishGroupRename(false,false);this.closed=true;if(this.eventWindow){this.eventWindow.removeEventListener('keydown',this.captureKey,true);this.eventWindow.removeEventListener('keyup',this.captureKeyUp,true);this.eventWindow.removeEventListener('wheel',this.captureWheel,true);this.eventWindow.removeEventListener('blur',this.captureBlur);for(const type of ['copy','cut','paste'])this.eventWindow.removeEventListener(type,this.captureClipboard,true);}this.shortcutHelp?.destroy();this.observer?.disconnect();clearTimeout(this.feedbackTimer);clearTimeout(this.zoomCursorTimer);if(this.dialog?.open)this.dialog.close();this.host?.remove();this.adapter.closed?.();}
 checkpoint(snapshot=JSON.stringify(this.state)){if(this.undo.at(-1)!==snapshot)this.undo.push(snapshot);this.redo.length=0;}
 save(){this.adapter.write(JSON.stringify(this.state));this.updateActions();}
 setGenerationStatus(message,{busy=false,step,steps}={}){
  if(this.closed)return;
  const status=this.root?.querySelector('.generation-status');
  if(!status)return;
  status.textContent=message;
  status.setAttribute('aria-busy',String(busy));
  this.generationStatusRevision=(this.generationStatusRevision||0)+1;
  this.generationProgress=Number.isInteger(steps)&&steps>0&&Number.isFinite(step)
   ? {value:Math.min(steps,Math.max(0,step)),steps}:null;
  this.updateStepMeter();
 }
 updateStepMeter(){
  if(!this.workspace||this.closed)return;
  const bar=this.root.querySelector('.generation-steps');
  const key=this.root.querySelector('.generation-dot-key');
  if(!this.generationProgress){
   bar.hidden=true;
   key.hidden=true;
   return;
  }
  const {value,steps}=this.generationProgress;
  bar.hidden=false;
  const available=Math.max(1,Math.floor((bar.clientWidth||272)/7.5));
  const stepsPerDot=Math.ceil(steps/available);
  const dots=Math.ceil(steps/stepsPerDot);
  key.hidden=stepsPerDot===1;
  key.textContent=`${stepsPerDot} steps per dot`;
  bar.setAttribute('aria-valuemax',String(steps));
  bar.setAttribute('aria-valuenow',String(value));
  bar.setAttribute('aria-valuetext',`Step ${value} of ${steps}`);
  bar.style.setProperty('--step-count',String(dots));
  bar.classList.toggle('dense',dots>18);
  const fill=value===steps?100:Math.max(0,(value/stepsPerDot-.5)*100/dots);
  bar.style.setProperty('--step-fill',`${fill}%`);
  if(bar.children.length!==dots){
   bar.replaceChildren(...Array.from({length:dots},()=>document.createElement('span')));
  }
  Array.from(bar.children).forEach((dot,index)=>{
   dot.classList.toggle('done',value>=Math.min((index+1)*stepsPerDot,steps));
   dot.classList.toggle('current',index===Math.ceil(value/stepsPerDot)-1);
  });
 }
 async generate(){
  if(!this.workspace||this.generationSubmitting||this.closed)return;
  const control=this.root.querySelector('[data-action="generate"]');this.generationSubmitting=true;control.disabled=true;control.setAttribute('aria-busy','true');
  try{
   const ratioControl=this.root.querySelector('[data-field="aspect_ratio"]'),ratio=ratioControl.value;
   try{parseAspectRatio(ratio);}catch(error){ratioControl.setCustomValidity(error.message);ratioControl.reportValidity();throw error;}
   ratioControl.setCustomValidity('');this.finishGroupRename(false,true,false);this.cancelDrag();this.endPan();
   if(ratio!==formatAspectRatio(this.state)){this.checkpoint();setAspectRatio(this.state,ratio);this.render();}
   this.save();this.setGenerationStatus('Queueing…',{busy:true});const revision=this.generationStatusRevision;
   if(await this.adapter.generate()===false)throw new Error('Could not queue the workflow. Check the workflow and try again.');
   if(revision===this.generationStatusRevision)this.setGenerationStatus('Queued. Waiting for result…',{busy:true});
  }catch(error){if(!this.closed){const message=error.message||'Could not queue the workflow.';this.setGenerationStatus(message);this.notify(message);}}
  finally{this.generationSubmitting=false;control.disabled=false;control.setAttribute('aria-busy','false');}
 }
 selectedIds(){return this.state.regions.filter(r=>this.selection.has(r.id)).map(r=>r.id);}
 updateActions(){
  this.root.querySelector('[data-action="undo"]').disabled=!this.undo.length;this.root.querySelector('[data-action="redo"]').disabled=!this.redo.length;
  const count=this.selectedIds().length;this.root.querySelector('.selection-count').textContent=count?`${count} selected`:'';
  this.root.querySelectorAll('[data-action="duplicate"],[data-action="delete"]').forEach(el=>el.disabled=!count);
  for(const mode of ['select','draw']){const active=this.drawArmed===(mode==='draw'),control=this.root.querySelector(`[data-action="${mode}"]`);control.setAttribute('aria-pressed',String(active));control.classList.toggle('btn-active',active);}
  const snapButton=this.root.querySelector('[data-action="snap"]');snapButton.setAttribute('aria-pressed',String(this.snap));snapButton.classList.toggle('btn-active',this.snap);
  this.root.querySelector('[data-action="visibility"]').setAttribute('aria-pressed',String(this.visible));this.root.querySelector('[data-action="remove-image"]').hidden=!this.state.image;
  this.root.querySelectorAll('[data-ratio]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.ratio===formatAspectRatio(this.state))));
 }
 render(){
  ensureGroups(this.state);this.selection=new Set(this.selectedIds());if(!this.selection.has(this.selected))this.selected=this.selection.values().next().value;
  this.root.querySelector('[data-field="scene"]').value=this.state.scene;this.root.querySelector('[data-field="aspect_ratio"]').value=formatAspectRatio(this.state);
  this.root.querySelector('.image-name').textContent=this.state.image?.name||'';this.root.querySelector('.count').textContent=this.state.regions.length||'';
  this.renderRegions();this.renderBoxes();this.updateActions();this.fit();
 }
 regionHTML(r){
  const index=this.state.regions.indexOf(r),selected=this.selection.has(r.id),primary=r.id===this.selected,caption=r.label==='text'?r.text||r.caption:r.caption;
  return `<section class="region ${selected?'selected':''} ${primary?'primary':''} ${r.muted?'muted':''}" data-id="${esc(r.id)}" style="--region:${colorFor(index)}">
   <div class="region-top"><button class="region-title" draggable="true" data-drag-region="${esc(r.id)}" data-select="${esc(r.id)}" aria-label="Select ${r.label} box: ${esc(caption||'No description')}" aria-pressed="${selected}" title="Drag to reorder · Drop onto another box to group"><span class="region-category" data-category="${r.label}" title="${categoryName(r.label)}" aria-label="${categoryName(r.label)}">${categoryIcon(r.label)}</span><span class="region-summary">${esc(caption||'No description')}</span></button><button type="button" class="btn btn-sm btn-square" data-duplicate-box="${esc(r.id)}" aria-label="Duplicate ${r.label} box" title="Duplicate this box">${icon('copy',14)}</button><button type="button" class="btn btn-sm btn-square" data-delete-box="${esc(r.id)}" aria-label="Delete ${r.label} box" title="Delete this box">${icon('trash',14)}</button><button class="btn btn-sm btn-square mute-box" data-mute-box="${esc(r.id)}" aria-label="Turn ${r.muted?'on':'off'} ${r.label} box" aria-pressed="${Boolean(r.muted)}" title="${r.muted?'Box is off · click to turn on':'Box is on · click to turn off'}">${icon('power',14)}</button></div>
   ${primary?`<div class="region-edit"><div class="region-options"><details class="dropdown type-selector"><summary class="select select-sm" aria-label="Box type" aria-haspopup="menu">${categoryIcon(r.label)}<span>${categoryName(r.label)}</span>${icon('down',12)}</summary><ul class="menu menu-sm type-menu" role="menu" aria-label="Box type">${['object','character','text'].map(type=>`<li><button type="button" role="menuitemradio" aria-checked="${type===r.label}" data-box-type="${type}">${categoryIcon(type)}<span>${categoryName(type)}</span>${type===r.label?icon('check',12):''}</button></li>`).join('')}</ul></details></div>
    ${r.label==='text'?`<label>Text<textarea class="textarea textarea-sm wording" data-field="text" placeholder="Exact words to render…" title="Enter or Esc: finish editing · Shift+Enter: new line">${esc(r.text)}</textarea></label>`:''}
    <label>Description<textarea class="textarea textarea-sm caption" data-field="caption" placeholder="Describe this box…" title="Appearance, pose, materials and colors. Enter from the canvas to edit · Enter or Esc to finish · Shift+Enter for a new line">${esc(r.caption)}</textarea></label>
   </div>`:''}</section>`;
 }
 renderRegions(){
  const folderHTML=group=>{
   const ids=groupRegionIds(this.state,group.id),all=ids.length>0&&ids.every(id=>this.selection.has(id));
   return `<section class="box-folder ${all?'selected':''}" data-folder="${esc(group.id)}"><div class="folder-header"><button class="btn btn-sm btn-square" data-collapse-folder="${esc(group.id)}" aria-expanded="${!group.collapsed}" title="${group.collapsed?'Expand':'Collapse'} folder">${icon(group.collapsed?'right':'down',14)}</button>${this.renameSession?.id===group.id?`<input class="input input-ghost input-sm folder-name" data-group-name="${esc(group.id)}" value="${esc(group.name)}" aria-label="Folder name"/>`:this.folderTitleHTML(group)}<button class="btn btn-sm btn-square" data-remove-folder="${esc(group.id)}" title="Remove folder; keep its boxes" aria-label="Remove folder ${esc(group.name)}">${icon('close',13)}</button></div><div class="folder-boxes" ${group.collapsed?'hidden':''}>${this.state.regions.filter(r=>r.groupId===group.id).map(r=>this.regionHTML(r)).join('')}</div></section>`;
  };
  const groups=new Map(this.state.groups.map(group=>[group.id,group])),regions=new Map(this.state.regions.map(region=>[region.id,region]));
  this.root.querySelector('.regions').innerHTML=listEntries(this.state).map(entry=>entry.kind==='folder'?folderHTML(groups.get(entry.id)):this.regionHTML(regions.get(entry.id))).join('')+'<div class="list-root-drop">Drop here outside folders</div>';
 }
 folderTitleHTML(group){const ids=groupRegionIds(this.state,group.id),all=ids.length>0&&ids.every(id=>this.selection.has(id));return `<button class="folder-title" draggable="true" data-drag-folder="${esc(group.id)}" data-select-folder="${esc(group.id)}" aria-label="Select folder ${esc(group.name)}" aria-pressed="${all}" title="Drag to reorder · Click to select · Double-click to rename">${icon('folder',15)}<span class="folder-name">${esc(group.name)}</span><span class="folder-count">${ids.length}</span></button>`;}
 startListDrag(event){
  const source=event.target.closest('[data-drag-region],[data-drag-folder]');if(!source||!event.dataTransfer){event.preventDefault();return;}
  this.endListDrag();this.closeOverlap();
  this.listDrag=source.dataset.dragRegion?{kind:'region',ids:this.selection.has(source.dataset.dragRegion)?this.selectedIds():[source.dataset.dragRegion]}:{kind:'folder',id:source.dataset.dragFolder};
  event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('application/x-moss-bbox-list',this.listDrag.kind);
  this.root.querySelector('.regions').classList.add('list-dragging');
  for(const row of this.root.querySelectorAll('.region'))row.classList.toggle('drag-source',this.listDrag.kind==='region'&&this.listDrag.ids.includes(row.dataset.id));
  if(this.listDrag.kind==='folder')[...this.root.querySelectorAll('.box-folder')].find(folder=>folder.dataset.folder===this.listDrag.id)?.classList.add('drag-source');
 }
 listDropTarget(event){
  if(!this.listDrag)return null;
  const target=event.target,row=target.closest('.region'),folder=target.closest('.box-folder'),entries=listEntries(this.state);
  const fraction=element=>{const rect=element.getBoundingClientRect();return rect.height?(event.clientY-rect.top)/rect.height:.5;};
  const moving=new Set(this.listDrag.kind==='region'?this.listDrag.ids:[this.listDrag.id]),anchor=(ids,index)=>ids.slice(index).find(id=>!moving.has(id))??null;
  const rootTarget=(element,id,after)=>({groupId:null,beforeId:anchor(entries.map(entry=>entry.id),entries.findIndex(entry=>entry.id===id)+(after?1:0)),element,position:after?'after':'before'});
  if(this.listDrag.kind==='folder'){
   const element=folder||row;if(!element)return{groupId:null,beforeId:null,element:this.root.querySelector('.list-root-drop'),position:'inside'};
   const id=folder?folder.dataset.folder:row.dataset.id;if(id===this.listDrag.id)return null;
   return rootTarget(element,id,fraction(folder?.querySelector('.folder-header')||element)>=.5);
  }
  if(row){
   const f=fraction(row),id=row.dataset.id;
   if(f>.25&&f<.75){if(this.listDrag.ids.includes(id))return null;return{targetId:id,element:row,position:'group'};}
   if(folder){const ids=groupRegionIds(this.state,folder.dataset.folder),after=f>=.75;return{groupId:folder.dataset.folder,beforeId:anchor(ids,ids.indexOf(id)+(after?1:0)),element:row,position:after?'after':'before'};}
   return rootTarget(row,id,f>=.75);
  }
  if(folder){
   const header=folder.querySelector('.folder-header'),f=fraction(header);
   if(target.closest('.folder-header')&&(f<.25||f>.75))return rootTarget(folder,folder.dataset.folder,f>.75);
   return{groupId:folder.dataset.folder,beforeId:null,element:header,position:'inside'};
  }
  return{groupId:null,beforeId:null,element:this.root.querySelector('.list-root-drop'),position:'inside'};
 }
 clearListDrop(){
  this.listDrop=null;for(const element of this.root.querySelectorAll('[data-drop-position]'))delete element.dataset.dropPosition;
  this.root.querySelector('.list-drop-hint').hidden=true;
 }
 overListDrag(event){
  if(!this.listDrag)return;event.preventDefault();event.dataTransfer.dropEffect='move';this.clearListDrop();
  const list=this.root.querySelector('.regions'),bounds=list.getBoundingClientRect();if(event.clientY<bounds.top+32)list.scrollTop-=12;else if(event.clientY>bounds.bottom-32)list.scrollTop+=12;
  const drop=this.listDropTarget(event);if(!drop){event.dataTransfer.dropEffect='none';return;}
  this.listDrop=drop;drop.element.dataset.dropPosition=drop.position;
  const hint=this.root.querySelector('.list-drop-hint'),group=this.state.groups.find(group=>group.id===drop.groupId);
  hint.textContent=drop.position==='group'?'Create a folder with this box':drop.position==='inside'?(group?`Move into ${group.name}`:'Move outside folders'):`Insert ${drop.position==='before'?'before':'after'} here`;
  const shell=this.root.querySelector('.editor-shell').getBoundingClientRect();hint.hidden=false;
  hint.style.left=`${clamp(event.clientX-shell.left+14,8,Math.max(8,shell.width-hint.offsetWidth-8))}px`;hint.style.top=`${clamp(event.clientY-shell.top+18,8,Math.max(8,shell.height-hint.offsetHeight-8))}px`;
 }
 dropList(event){
  if(!this.listDrag)return;event.preventDefault();const moving=this.listDrag,drop=this.listDrop||this.listDropTarget(event),before=JSON.stringify(this.state);this.endListDrag();if(!drop)return;
  const changed=moving.kind==='folder'?moveListFolder(this.state,moving.id,drop.beforeId):drop.targetId?groupListRegions(this.state,moving.ids,drop.targetId,`Folder ${this.state.groups.length+1}`):moveListRegions(this.state,moving.ids,drop.groupId,drop.beforeId);
  if(!changed)return;
  if(moving.kind==='region'){this.selection=new Set(moving.ids);if(!this.selection.has(this.selected))this.selected=moving.ids.at(-1);const group=this.state.groups.find(group=>group.id===drop.groupId);if(group)group.collapsed=false;}
  this.checkpoint(before);this.save();this.render();this.viewport.focus();
 }
 endListDrag(){
  this.listDrag=null;this.clearListDrop();this.root.querySelector('.regions').classList.remove('list-dragging');for(const source of this.root.querySelectorAll('.drag-source'))source.classList.remove('drag-source');
 }
 refreshRegionSelection(){
  for(const row of this.root.querySelectorAll('.region')){const selected=this.selection.has(row.dataset.id);row.classList.toggle('selected',selected);row.querySelector('[data-select]')?.setAttribute('aria-pressed',String(selected));}
  for(const section of this.root.querySelectorAll('.box-folder')){const members=groupRegionIds(this.state,section.dataset.folder),all=members.length>0&&members.every(id=>this.selection.has(id));section.classList.toggle('selected',all);section.querySelector('[data-select-folder]')?.setAttribute('aria-pressed',String(all));}
 }
 renderBoxes(){
  const boxes=this.root.querySelector('.boxes');boxes.hidden=!this.visible;
  let html=this.state.regions.map((r,index)=>{const[x0,y0,x1,y1]=r.bbox,selected=this.selection.has(r.id),primary=r.id===this.selected;
   return `<div class="bbox ${selected?'selected':''} ${r.muted?'muted':''}" data-box="${esc(r.id)}" style="left:${x0*100}%;top:${y0*100}%;width:${(x1-x0)*100}%;height:${(y1-y0)*100}%;--region:${colorFor(index)}"><button class="box-category" data-canvas-select="${esc(r.id)}" data-category="${r.label}" title="${categoryName(r.label)}" aria-label="Select ${r.label} box: ${esc(r.caption||r.text||'No description')}">${categoryIcon(r.label)}</button>${primary&&this.selection.size===1?handles.map(h=>`<span class="handle ${h}" data-handle="${h}"></span>`).join(''):''}</div>`;
  }).join('');
  if(this.selection.size>1){const b=selectionBounds(this.state,this.selection);if(b)html+=`<div class="selection-frame" data-drag-selection="true" title="Drag selected boxes together" style="left:${b[0]*100}%;top:${b[1]*100}%;width:${(b[2]-b[0])*100}%;height:${(b[3]-b[1])*100}%"><span class="selection-grip" data-drag-selection="true">${this.selection.size}</span>${handles.map(h=>`<span class="handle ${h}" data-group-handle="${h}" title="Resize selected boxes"></span>`).join('')}</div>`;}
  if(this.drag?.kind==='marquee'){const[x,y]=this.drag.start,[u,v]=this.drag.end;html+=`<div class="selection-marquee" aria-hidden="true" style="left:${Math.min(x,u)*100}%;top:${Math.min(y,v)*100}%;width:${Math.abs(u-x)*100}%;height:${Math.abs(v-y)*100}%"></div>`;}
  boxes.innerHTML=html;
 }
 focusDescription(){const region=this.state.regions.find(region=>region.id===this.selected),folder=this.state.groups.find(group=>group.id===region?.groupId);if(folder?.collapsed){folder.collapsed=false;this.renderRegions();}let input=this.root.querySelector(`[data-id="${this.selected}"] .caption`);if(!input&&this.selected){this.renderRegions();input=this.root.querySelector(`[data-id="${this.selected}"] .caption`);}if(input){input.focus();input.setSelectionRange(input.value.length,input.value.length);}}
 select(id,focus=true,additive=false){
  if(additive){if(this.selection.has(id))this.selection.delete(id);else if(id)this.selection.add(id);}else this.selection=new Set(id?[id]:[]);
  this.selected=this.selection.has(id)?id:this.selection.values().next().value;
  const region=this.state.regions.find(r=>r.id===this.selected),folder=this.state.groups.find(g=>g.id===region?.groupId);if(folder)folder.collapsed=false;
  this.renderRegions();this.renderBoxes();this.updateActions();
  [...this.root.querySelectorAll('.region')].find(el=>el.dataset.id===this.selected)?.scrollIntoView({block:'nearest'});
  if(focus)this.focusSelection();
 }
 selectMany(ids,focus=true,stableHeaders=false){
  this.selection=new Set(ids);this.selected=ids.at(-1);const primary=this.state.regions.find(r=>r.id===this.selected),folder=this.state.groups.find(g=>g.id===primary?.groupId);if(folder&&!stableHeaders)folder.collapsed=false;
  if(stableHeaders)this.refreshRegionSelection();else this.renderRegions();
  this.renderBoxes();this.updateActions();if(focus)this.focusSelection();
 }
 focusSelection(){this.viewport.focus();}
 startGroupRename(id){
  if(this.renameSession?.id===id)return;if(this.renameSession)this.finishGroupRename();const group=this.state.groups.find(g=>g.id===id);if(!group)return;
  this.renameSession={id,name:group.name};this.renderRegions();const input=[...this.root.querySelectorAll('[data-group-name]')].find(el=>el.dataset.groupName===id);input?.focus();input?.select();
 }
 finishGroupRename(cancel=false,render=true,focus=true){
  const session=this.renameSession;if(!session)return;this.renameSession=null;const group=this.state.groups.find(g=>g.id===session.id);
  if(group&&(cancel||!group.name.trim())&&group.name!==session.name){group.name=session.name;this.save();}
  if(render){const input=[...this.root.querySelectorAll('[data-group-name]')].find(el=>el.dataset.groupName===session.id);if(input&&group){const shell=this.dialog.ownerDocument.createElement('div');shell.innerHTML=this.folderTitleHTML(group);input.replaceWith(shell.firstElementChild);}if(focus)this.viewport.focus();}
 }
 addBox(){
  this.checkpoint();const offset=(this.state.regions.length%5)*.025,region=addRegion(this.state,[.25+offset,.25+offset,.65+offset,.65+offset]);
  if(this.snap)region.bbox=snapBox(region.bbox,this.gridDimensions());
  const current=this.state.regions.find(r=>r.id===this.selected);if(current?.groupId)region.groupId=current.groupId;
  this.selection=new Set([region.id]);this.selected=region.id;this.save();this.render();this.select(region.id);
 }
 gridDimensions(){return resolveDimensions(this.state,this.adapter.megapixels?.()??1);}
 updateGrid(){const grid=this.root.querySelector('.grid-overlay');grid.hidden=!this.snap;if(!this.snap)return;try{const d=this.gridDimensions();grid.style.setProperty('--cell-x',`${1600/d.width}%`);grid.style.setProperty('--cell-y',`${1600/d.height}%`);}catch(error){this.snap=false;grid.hidden=true;this.updateActions();this.notify(error.message);}}
 fit(){
  this.updateGrid();const scale=Math.max(.001,Math.min((this.viewport.clientWidth-64)/this.state.width,(this.viewport.clientHeight-64)/this.state.height));
  this.boardWidth=this.state.width*scale*this.zoom;this.boardHeight=this.state.height*scale*this.zoom;
  this.board.style.width=`${this.boardWidth}px`;this.board.style.height=`${this.boardHeight}px`;this.applyPan();
 }
 applyPan(){
  const bound=(viewport,image)=>Math.max(0,(viewport+image)/2-Math.min(48,viewport/2,image));
  const x=bound(this.viewport.clientWidth,this.boardWidth||0),y=bound(this.viewport.clientHeight,this.boardHeight||0);
  this.panX=clamp(this.panX,-x,x);this.panY=clamp(this.panY,-y,y);
  this.root.querySelector('.board-wrap').style.transform=`translate(${this.panX}px, ${this.panY}px)`;
 }
 resetView(){this.zoom=1;this.panX=0;this.panY=0;this.fit();}
 setZoom(value,anchor){
  const viewport=this.viewport.getBoundingClientRect(),before=this.board.getBoundingClientRect(),target=anchor||[viewport.left+this.viewport.clientWidth/2,viewport.top+this.viewport.clientHeight/2];
  const x=before.width?(target[0]-before.left)/before.width:.5,y=before.height?(target[1]-before.top)/before.height:.5;
  this.zoom=clamp(value,.5,6);this.fit();const after=this.board.getBoundingClientRect();
  this.panX+=target[0]-after.left-x*after.width;this.panY+=target[1]-after.top-y*after.height;this.applyPan();
 }
 startPan(event){
  if(this.drag||this.pan||(event.button!==1&&!(event.button===0&&this.space)))return;
  event.preventDefault();event.stopPropagation();this.closeOverlap();this.clearZoomCursor();
  this.pan={x:event.clientX,y:event.clientY,left:this.panX,top:this.panY,pointerId:event.pointerId};
  this.viewport.setPointerCapture(event.pointerId);this.viewport.focus();this.updateCursor();
 }
 endPan(event){
  if(!this.pan||event&&event.pointerId!==this.pan.pointerId)return;
  const id=this.pan.pointerId;this.pan=null;if(this.viewport.hasPointerCapture(id))this.viewport.releasePointerCapture(id);this.updateCursor();
 }
 setTool(mode){this.drawArmed=mode==='draw';this.updateActions();this.updateCursor();}
 updateCursor(event){
  if(event)this.marqueeArmed=Boolean(event.ctrlKey||event.metaKey);
  const marquee=Boolean(this.marqueeArmed||this.drag?.kind==='marquee'),drawing=Boolean(this.drawArmed&&!marquee);
  this.viewport.classList.toggle('can-pan',Boolean(this.space));this.viewport.classList.toggle('panning',Boolean(this.pan));
  this.viewport.classList.toggle('draw-tool',drawing);this.viewport.classList.toggle('select-tool',!drawing);this.viewport.classList.toggle('marquee-tool',marquee);
  this.viewport.classList.toggle('moving-boxes',this.drag?.kind==='move');
  this.board.classList.toggle('draw-cursor',drawing);this.board.classList.toggle('marquee-cursor',marquee);
  if(this.drag){const resize={nw:'nwse',se:'nwse',ne:'nesw',sw:'nesw',n:'ns',s:'ns',e:'ew',w:'ew'};this.board.style.cursor=['draw','marquee'].includes(this.drag.kind)?'crosshair':this.drag.kind.startsWith('resize')?`${resize[this.drag.handle]}-resize`:'move';}
  else this.board.style.cursor=marquee?'crosshair':'';
 }
 clearZoomCursor(){clearTimeout(this.zoomCursorTimer);this.viewport.classList.remove('zooming-in','zooming-out');}
 showZoomCursor(zoomIn){this.clearZoomCursor();this.viewport.classList.add(zoomIn?'zooming-in':'zooming-out');this.zoomCursorTimer=setTimeout(()=>this.clearZoomCursor(),180);}
 loadReference(){
  const token=this.referenceToken=(this.referenceToken||0)+1;this.image.hidden=!this.state.image;
  if(this.state.image){this.image.onload=()=>{if(token===this.referenceToken)this.image.hidden=false;};this.image.onerror=()=>{if(token===this.referenceToken){this.image.hidden=true;this.notify('Reference unavailable. Import it again.');}};this.image.src=this.adapter.imageURL(this.state.image);}else this.image.removeAttribute('src');
 }
 setReference(reference){if(this.closed)return;this.state.image=structuredClone(reference);this.root.querySelector('.image-name').textContent=reference.name;this.updateActions();this.loadReference();}
 async pasteImage(){
  const controls=this.root.querySelectorAll('[data-action="import"],[data-action="paste-image"]');controls.forEach(control=>control.disabled=true);
  try{
   if(!navigator.clipboard?.read){this.notify('Image clipboard access is unavailable in this browser.');return;}
   const items=await navigator.clipboard.read();if(this.closed)return;
   for(const item of items){
    const type=item.types.find(type=>type.startsWith('image/'));if(!type)continue;
    const blob=await item.getType(type);if(this.closed)return;
    const extension=type.split('/')[1].split('+')[0].replace('jpeg','jpg').replace(/[^a-z0-9]/gi,'')||'png';
    const file=new this.dialog.ownerDocument.defaultView.File([blob],`clipboard-${crypto.randomUUID()}.${extension}`,{type});
    await this.importImage(file);return;
   }
   this.notify('No image in the clipboard. Copy an image first.');
  }catch(error){this.notify(error.name==='NotAllowedError'?'Clipboard image access was denied. Allow clipboard access and try again.':error.message||'Could not read an image from the clipboard.');}
  finally{controls.forEach(control=>control.disabled=false);}
 }
 async importImage(file){
  if(file.type&&!file.type.startsWith('image/')){this.notify('Choose an image file.');return;}const controls=this.root.querySelectorAll('[data-action="import"],[data-action="paste-image"]');controls.forEach(control=>control.disabled=true);
  try{const bitmap=await createImageBitmap(file,{imageOrientation:'from-image'}),width=bitmap.width,height=bitmap.height;bitmap.close();const reference=await this.adapter.upload(file);if(!this.host.isConnected)return;
   this.checkpoint();this.state.image=reference;this.state.width=width;this.state.height=height;this.zoom=1;this.panX=0;this.panY=0;this.save();this.render();this.loadReference();
  }catch(error){this.notify(error.message);}finally{controls.forEach(control=>control.disabled=false);}
 }
 closeImport(){this.root.querySelector('.prompt-panel').hidden=true;this.root.querySelector('.import-error').hidden=true;this.resetImportSource();}
 resetImportSource(){this.root.querySelector('.import-source').hidden=true;this.root.querySelector('[data-action="apply-prompt"]').hidden=false;}

 savePrompt(){
  const prompt=compilePrompt(this.state,this.adapter.megapixels?.()??1);let json=false;try{JSON.parse(prompt);json=true;}catch{/* Plain scene prompts download as text. */}
  const download=this.dialog.ownerDocument.createElement('a'),url=this.eventWindow.URL.createObjectURL(new this.eventWindow.Blob([prompt],{type:json?'application/json;charset=utf-8':'text/plain;charset=utf-8'}));
  download.href=url;download.download=`moss-image-prompt.${json?'json':'txt'}`;download.hidden=true;this.root.append(download);
  try{download.click();}finally{download.remove();this.eventWindow.setTimeout(()=>this.eventWindow.URL.revokeObjectURL(url),0);}
 }
 async readPromptClipboard(){
  const panel=this.root.querySelector('.prompt-panel'),field=this.root.querySelector('[data-field="prompt_import"]');
  try{const text=await navigator.clipboard.readText();field.value=text;if(!this.applyPrompt(text)&&this.root.querySelector('.import-source').hidden)field.focus();}catch{panel.hidden=false;const status=this.root.querySelector('.import-error');status.textContent='Clipboard access is unavailable. Paste the prompt here.';status.hidden=false;field.focus();}
 }
 applyPrompt(text,sourceCanvas=null){
   try{const result=importPrompt(text,this.state,this.adapter.megapixels?.()??1,sourceCanvas);this.checkpoint();this.state=result.state;ensureGroups(this.state);this.selection=new Set(this.state.regions[0]?[this.state.regions[0].id]:[]);this.selected=this.state.regions[0]?.id;this.save();this.render();this.closeImport();this.viewport.focus();this.notify(result.repairs.length?`Prompt imported. ${result.repairs.join(' ')}`:'Prompt imported');return true;}
  catch(error){
   this.root.querySelector('.prompt-panel').hidden=false;
   const status=this.root.querySelector('.import-error');
   if(error.code==='MOSS_SOURCE_CANVAS_REQUIRED'){
    const source=this.root.querySelector('.import-source'),mp=this.adapter.megapixels?.()??1,canvas=resolveDimensions(this.state,mp);
    source.hidden=false;this.root.querySelector('[data-action="apply-prompt"]').hidden=true;
    this.root.querySelector('[data-field="import_source_ratio"]').value=formatAspectRatio(this.state);
    this.root.querySelector('[data-field="import_source_megapixels"]').value=mp;
    this.root.querySelector('[data-field="import_source_width"]').value=canvas.width;
    this.root.querySelector('[data-field="import_source_height"]').value=canvas.height;
    this.root.querySelector('.source-exact').open=false;
    this.root.querySelector('[data-action="import-current-canvas"]').textContent='Use current · '+canvas.width+' × '+canvas.height;
    status.hidden=true;const field=this.root.querySelector('[data-field="import_source_ratio"]');field.focus();field.select();return false;
   }
   status.textContent=error.message;status.hidden=false;return false;
  }
 }

 syncImportSource(){
  try{
   const ratio=parseAspectRatio(this.root.querySelector('[data-field="import_source_ratio"]').value);
   const canvas=resolveDimensions(ratio,Number(this.root.querySelector('[data-field="import_source_megapixels"]').value));
   this.root.querySelector('[data-field="import_source_width"]').value=canvas.width;
   this.root.querySelector('[data-field="import_source_height"]').value=canvas.height;
  }catch{/* Show validation only when importing. */}
 }

 importFromSource(){
  try{
   let canvas;
   if(this.root.querySelector('.source-exact').open){
    canvas={width:Number(this.root.querySelector('[data-field="import_source_width"]').value),height:Number(this.root.querySelector('[data-field="import_source_height"]').value)};
   }else{
    const ratio=parseAspectRatio(this.root.querySelector('[data-field="import_source_ratio"]').value);
    canvas=resolveDimensions(ratio,Number(this.root.querySelector('[data-field="import_source_megapixels"]').value));
   }
   return this.applyPrompt(this.root.querySelector('[data-field="prompt_import"]').value,canvas);
  }catch(error){const status=this.root.querySelector('.import-error');status.textContent=error.message;status.hidden=false;return false;}
 }
 async click(event){
  const target=event.target;
  for(const menu of this.root.querySelectorAll('.type-selector[open]'))if(!menu.contains(target))menu.open=false;
  if(!target.closest('.copy-control')){this.root.querySelector('.copy-menu').hidden=true;this.root.querySelector('[data-action="copy"]').setAttribute('aria-expanded','false');}
  if(!target.closest('.overlap-menu'))this.closeOverlap();
  const type=target.closest('[data-box-type]');if(type){const region=this.state.regions.find(region=>region.id===type.closest('.region').dataset.id);if(region.label!==type.dataset.boxType){this.checkpoint();region.label=type.dataset.boxType;this.save();}this.select(region.id);return;}
  const row=target.closest('[data-select],[data-canvas-select]');if(row){if(row.dataset.canvasSelect&&(event.ctrlKey||event.metaKey))return;this.select(row.dataset.select||row.dataset.canvasSelect,true,event.shiftKey||event.ctrlKey||event.metaKey);if(row.dataset.select&&this.selection.size===1)this.focusDescription();return;}
  const deleted=target.closest('[data-delete-box]');if(deleted){this.deleteBoxes([deleted.dataset.deleteBox]);return;}
  const duplicate=target.closest('[data-duplicate-box]');if(duplicate){this.duplicate([duplicate.dataset.duplicateBox]);return;}
  const mute=target.closest('[data-mute-box]');if(mute){this.checkpoint();const region=this.state.regions.find(r=>r.id===mute.dataset.muteBox);region.muted=!region.muted;this.save();this.renderRegions();this.renderBoxes();if(this.selected)this.focusSelection();return;}
  const chosen=target.closest('[data-choose-box]');if(chosen){this.closeOverlap();this.select(chosen.dataset.chooseBox);return;}
  const ratio=target.closest('[data-ratio]');if(ratio){this.checkpoint();setAspectRatio(this.state,ratio.dataset.ratio);this.save();this.render();this.root.querySelector('.ratio-menu').open=false;return;}
  const collapse=target.closest('[data-collapse-folder]');if(collapse){this.checkpoint();const group=this.state.groups.find(g=>g.id===collapse.dataset.collapseFolder);group.collapsed=!group.collapsed;this.save();this.renderRegions();return;}
  const folder=target.closest('[data-select-folder]');if(folder){const ids=groupRegionIds(this.state,folder.dataset.selectFolder);const all=ids.length>0&&ids.every(id=>this.selection.has(id));this.selectMany(event.shiftKey?(all?[...this.selection].filter(id=>!ids.includes(id)):[...new Set([...this.selection,...ids])]):ids,false,true);this.viewport.focus();return;}
  const remove=target.closest('[data-remove-folder]');if(remove){this.checkpoint();removeGroup(this.state,remove.dataset.removeFolder);this.save();this.renderRegions();return;}
  const action=target.closest('[data-action]')?.dataset.action;if(!action)return;
  if(action==='generate'){await this.generate();return;}
  if(action==='select'||action==='draw'){this.setTool(action);this.viewport.focus();return;}
  if(action==='snap'){if(!this.snap){try{this.gridDimensions();}catch(error){this.notify(error.message);return;}}this.snap=!this.snap;this.adapter.setSnap?.(this.snap);this.updateActions();this.updateGrid();return;}
  if(action==='add'){this.addBox();return;}
  if(action==='import'){this.root.querySelector('.file-picker').click();return;}
  if(action==='paste-image'){await this.pasteImage();return;}
  if(action==='remove-image'){this.checkpoint();this.state.image=null;this.save();this.render();this.loadReference();if(this.selected)this.focusSelection();return;}
  if(action==='import-prompt'||action==='paste-prompt'){await this.readPromptClipboard();return;}
  if(action==='import-current-canvas'){this.applyPrompt(this.root.querySelector('[data-field="prompt_import"]').value,'current');return;}
  if(action==='import-source-canvas'){this.importFromSource();return;}
  if(action==='apply-prompt'){this.applyPrompt(this.root.querySelector('[data-field="prompt_import"]').value);return;}
  if(action==='close-import'){this.closeImport();return;}
  if(action==='fit'){this.resetView();return;}if(action==='zoom-in'){this.setZoom(this.zoom*1.25);return;}if(action==='zoom-out'){this.setZoom(this.zoom/1.25);return;}
  if(action==='visibility'){this.visible=!this.visible;this.renderBoxes();this.updateActions();return;}
  if(action==='save-prompt'){this.savePrompt();return;}
  if(action==='copy'){const menu=this.root.querySelector('.copy-menu');menu.hidden=!menu.hidden;target.closest('[data-action]').setAttribute('aria-expanded',String(!menu.hidden));return;}
  if(action==='copy-prompt'||action==='copy-layout'){this.root.querySelector('.copy-menu').hidden=true;this.root.querySelector('[data-action="copy"]').setAttribute('aria-expanded','false');try{await navigator.clipboard.writeText(action==='copy-layout'?JSON.stringify(this.state,null,2):compilePrompt(this.state,this.adapter.megapixels?.()??1));this.notify(action==='copy-layout'?'Editable layout copied':'Prompt copied');}catch(error){this.notify(error.message||'Clipboard unavailable.');}return;}
  if(action==='undo'||action==='redo'){const from=action==='undo'?this.undo:this.redo,to=action==='undo'?this.redo:this.undo;if(!from.length)return;to.push(JSON.stringify(this.state));this.state=parseState(from.pop());ensureGroups(this.state);this.selection=new Set(this.selectedIds());if(!this.selection.size&&this.state.regions.length)this.selection.add(this.state.regions.at(-1).id);this.selected=this.selection.values().next().value;this.save();this.render();this.loadReference();this.focusSelection();return;}
  if(action==='new-folder'){this.checkpoint();const group=createGroup(this.state,this.selectedIds(),`Folder ${this.state.groups.length+1}`);this.save();this.startGroupRename(group.id);return;}
  if(action==='delete'&&this.selection.size){this.deleteBoxes(this.selection);return;}
  if(action==='duplicate'&&this.selection.size)this.duplicate(this.selection);
 }
 input(event){
  const field=event.target.dataset.field;
  if(['import_source_ratio','import_source_megapixels'].includes(field)){this.syncImportSource();return;}
  if(field==='aspect_ratio'){event.target.setCustomValidity('');return;}
  if(event.target.dataset.groupName){if(this.focusSnapshot){this.checkpoint(this.focusSnapshot);this.focusSnapshot=null;}this.state.groups.find(g=>g.id===event.target.dataset.groupName).name=event.target.value;this.save();return;}
  if(!['scene','caption','text'].includes(field))return;if(this.focusSnapshot){this.checkpoint(this.focusSnapshot);this.focusSnapshot=null;}
  if(field==='scene')this.state.scene=event.target.value;else{const region=this.state.regions.find(r=>r.id===this.selected);if(!region)return;region[field]=event.target.value;event.target.closest('.region').querySelector('.region-summary').textContent=(region.label==='text'?region.text||region.caption:region.caption)||'No description';}this.save();
 }
 change(event){
  const target=event.target;
  if(target.matches('.file-picker')){const file=target.files[0];if(file)this.importImage(file);target.value='';return;}


  const field=target.dataset.field;
  if(['import_source_ratio','import_source_megapixels'].includes(field)){this.syncImportSource();return;}
  if(field==='aspect_ratio'){try{parseAspectRatio(target.value);}catch(error){target.setCustomValidity(error.message);target.reportValidity();return;}this.checkpoint();setAspectRatio(this.state,target.value);target.setCustomValidity('');this.save();this.render();}
 }
 point(event){const r=this.board.getBoundingClientRect();return[clamp((event.clientX-r.left)/r.width,0,1),clamp((event.clientY-r.top)/r.height,0,1)];}
 hitBoxes(p){return this.state.regions.filter(r=>p[0]>=r.bbox[0]&&p[0]<=r.bbox[2]&&p[1]>=r.bbox[1]&&p[1]<=r.bbox[3]).reverse();}
 boxAt(p){const hits=this.hitBoxes(p),area=r=>(r.bbox[2]-r.bbox[0])*(r.bbox[3]-r.bbox[1]);return hits.sort((a,b)=>{const difference=area(a)-area(b);if(Math.abs(difference)>1e-9)return difference;if(a.id===this.selected)return-1;if(b.id===this.selected)return 1;return 0;})[0];}
 hoverOverlap(id){
  if(this.root.querySelector('.overlap-menu').hidden)id=null;this.hoveredBox=id;
  for(const box of this.root.querySelectorAll('[data-box]'))box.classList.toggle('menu-hover',box.dataset.box===id);
  for(const row of this.root.querySelectorAll('.region'))row.classList.toggle('menu-hover',row.dataset.id===id);
  for(const item of this.root.querySelectorAll('[data-choose-box]'))item.classList.toggle('box-hover',item.dataset.chooseBox===id);
 }
 closeOverlap(){this.root.querySelector('.overlap-menu').hidden=true;this.hoverOverlap(null);}
 contextMenu(event){event.preventDefault();this.hoverOverlap(null);const hits=this.hitBoxes(this.point(event)),menu=this.root.querySelector('.overlap-menu');if(!hits.length){this.closeOverlap();return;}const shell=this.root.querySelector('.editor-shell').getBoundingClientRect();menu.style.left=`${clamp(event.clientX-shell.left,8,Math.max(8,shell.width-260))}px`;menu.style.top=`${clamp(event.clientY-shell.top,8,Math.max(8,shell.height-hits.length*36-16))}px`;menu.innerHTML=hits.map(r=>`<li><button data-choose-box="${esc(r.id)}"><span class="region-category" data-category="${r.label}" title="${categoryName(r.label)}" aria-label="${categoryName(r.label)}" style="--region:${colorFor(this.state.regions.indexOf(r))}">${categoryIcon(r.label)}</span><span>${esc(r.caption||r.text||'No description')}</span></button></li>`).join('');menu.hidden=false;}
 pointerDown(event){
  if(event.button!==0||this.space||this.pan)return;event.preventDefault();this.clearZoomCursor();this.closeOverlap();this.visible=true;
  const raw=this.point(event),selectionBefore=[...this.selection],primaryBefore=this.selected;
  if(event.ctrlKey||event.metaKey){
   this.drag={kind:'marquee',start:raw,end:raw,selectionBefore,primaryBefore,additive:Boolean(event.shiftKey),pointerId:event.pointerId};
   if(!event.shiftKey){this.selection=new Set();this.selected=undefined;}
   this.board.setPointerCapture(event.pointerId);this.viewport.focus();this.updateCursor(event);this.refreshRegionSelection();this.renderBoxes();this.updateActions();return;
  }
  const draw=this.drawArmed,point=draw&&this.snap?snapPoint(raw,this.gridDimensions()):raw,groupHandle=draw?null:event.target.dataset.groupHandle,handle=draw?null:groupHandle||event.target.dataset.handle,union=this.selection.size>1?selectionBounds(this.state,this.selection):null,inSelection=union&&raw[0]>=union[0]&&raw[0]<=union[2]&&raw[1]>=union[1]&&raw[1]<=union[3],before=JSON.stringify(this.state);let region;
  if(draw){region=addRegion(this.state,[point[0],point[1],point[0],point[1]]);const previous=this.state.regions.find(r=>r.id===this.selected);if(previous?.groupId)region.groupId=previous.groupId;this.selection=new Set([region.id]);this.selected=region.id;}
  else if(handle)region=this.state.regions.find(r=>r.id===this.selected);
  else if(!event.altKey&&!event.shiftKey&&(event.target.closest('[data-drag-selection]')||inSelection)){region=this.state.regions.find(r=>r.id===this.selected);}
  else if(event.target.dataset.canvasSelect){region=this.state.regions.find(r=>r.id===event.target.dataset.canvasSelect);if(region&&!this.selection.has(region.id))this.select(region.id,false);}
  else{
   if(event.altKey){const hits=this.hitBoxes(point),index=hits.findIndex(r=>r.id===this.selected);region=hits[(index+1)%hits.length];}else region=this.boxAt(point);
   if(!region){this.select(null,false);return;}
   if(event.shiftKey){this.select(region.id,true,true);return;}
   if(event.altKey||!this.selection.has(region.id))this.select(region.id,false);else this.selected=region.id;
  }
  if(!region)return;
  this.drag={id:region.id,kind:draw?'draw':groupHandle?'resize-group':handle?'resize':'move',handle,start:point,bbox:groupHandle?[...union]:[...region.bbox],before,selectionBefore,primaryBefore,pointerId:event.pointerId,rawStart:raw,boxes:this.state.regions.filter(r=>this.selection.has(r.id)).map(r=>({id:r.id,bbox:[...r.bbox]}))};
  this.board.setPointerCapture(event.pointerId);this.viewport.focus();this.updateCursor(event);this.renderBoxes();this.renderRegions();this.updateActions();
 }
 pointerMove(event){
  this.updateCursor(event);if(!this.drag)return;
  const p=this.point(event),d=this.drag,r=this.state.regions.find(r=>r.id===d.id);
  if(d.kind==='marquee'){
   d.end=p;const left=Math.min(d.start[0],p[0]),top=Math.min(d.start[1],p[1]),right=Math.max(d.start[0],p[0]),bottom=Math.max(d.start[1],p[1]);
   const hits=this.state.regions.filter(({bbox:b})=>b[0]<=right&&b[2]>=left&&b[1]<=bottom&&b[3]>=top).map(box=>box.id);
   this.selection=new Set([...(d.additive?d.selectionBefore:[]),...hits]);this.selected=hits.at(-1)||(this.selection.has(d.primaryBefore)?d.primaryBefore:this.selection.values().next().value);
   this.refreshRegionSelection();this.renderBoxes();this.updateActions();return;
  }
  if(d.kind!=='draw'&&!d.moved){const rect=this.board.getBoundingClientRect();if(Math.hypot((p[0]-d.start[0])*rect.width,(p[1]-d.start[1])*rect.height)<3)return;d.moved=true;}
  if(d.kind==='draw'){const end=this.snap?snapPoint(p,this.gridDimensions()):p;r.bbox=[Math.min(d.start[0],end[0]),Math.min(d.start[1],end[1]),Math.max(d.start[0],end[0]),Math.max(d.start[1],end[1])];}
  if(d.kind==='resize')r.bbox=this.snap?snapResize(d.bbox,d.handle,p,this.gridDimensions()):resizeBox(d.bbox,d.handle,p[0],p[1]);
  if(d.kind==='resize-group'){for(const saved of d.boxes)this.state.regions.find(box=>box.id===saved.id).bbox=[...saved.bbox];const dimensions=this.snap?this.gridDimensions():null,next=this.snap?snapResize(d.bbox,d.handle,p,dimensions):resizeBox(d.bbox,d.handle,p[0],p[1]);resizeRegions(this.state,d.boxes.map(box=>box.id),d.bbox,next,dimensions?{snapBox:box=>snapBox(box,dimensions)}:{});}
  if(d.kind==='move'){for(const saved of d.boxes)this.state.regions.find(box=>box.id===saved.id).bbox=[...saved.bbox];const ids=d.boxes.map(box=>box.id),delta=this.snap?snapMove(this.state,ids,p[0]-d.start[0],p[1]-d.start[1],this.gridDimensions(),16,{relative:d.boxes.length>1}):[p[0]-d.start[0],p[1]-d.start[1]];moveRegions(this.state,ids,...delta);}
  this.renderBoxes();
 }
 pointerUp(event){
  if(!this.drag)return;this.pointerMove(event);const d=this.drag,r=this.state.regions.find(r=>r.id===d.id);this.drag=null;this.updateCursor(event);if(this.board.hasPointerCapture(event.pointerId))this.board.releasePointerCapture(event.pointerId);
  if(d.kind==='marquee'){this.renderRegions();this.renderBoxes();this.updateActions();this.viewport.focus();return;}
  const rect=this.board.getBoundingClientRect(),raw=this.point(event),tiny=this.snap?((r.bbox[2]<=r.bbox[0]||r.bbox[3]<=r.bbox[1])||Math.abs(raw[0]-d.rawStart[0])*rect.width<3||Math.abs(raw[1]-d.rawStart[1])*rect.height<3):((r.bbox[2]-r.bbox[0])*rect.width<5||(r.bbox[3]-r.bbox[1])*rect.height<5);
  if(d.kind==='draw'&&tiny){this.state=parseState(d.before);ensureGroups(this.state);const hit=this.boxAt(d.start);this.selection=new Set(hit?[hit.id]:[]);this.selected=hit?.id;this.render();this.viewport.focus();return;}
  if(d.kind==='draw')this.setTool('select');
  if(JSON.stringify(this.state)!==d.before){this.checkpoint(d.before);this.save();}this.render();this.focusSelection();
 }
 cancelDrag(){if(!this.drag)return;const d=this.drag;this.drag=null;if(this.board.hasPointerCapture(d.pointerId))this.board.releasePointerCapture(d.pointerId);if(d.kind!=='marquee'){this.state=parseState(d.before);ensureGroups(this.state);}this.updateCursor();this.selection=new Set(d.selectionBefore.filter(id=>this.state.regions.some(r=>r.id===id)));this.selected=this.selection.has(d.primaryBefore)?d.primaryBefore:this.selection.values().next().value;this.render();if(d.kind==='marquee')this.viewport.focus();else this.focusSelection();}
 deleteBoxes(ids){
  const removed=new Set(ids),index=this.state.regions.findIndex(r=>removed.has(r.id));if(index<0)return;
  this.checkpoint();this.state.regions=this.state.regions.filter(r=>!removed.has(r.id));this.selection=new Set(this.selectedIds());
  if(!this.selection.has(this.selected))this.selected=this.selection.values().next().value;
  if(!this.selected){this.selected=this.state.regions[Math.min(index,this.state.regions.length-1)]?.id;if(this.selected)this.selection.add(this.selected);}
  this.save();this.render();if(this.selected)this.focusSelection();else this.viewport.focus();
 }
 duplicate(ids){
  this.checkpoint();const copies=duplicateRegions(this.state,ids);this.selection=new Set(copies.map(r=>r.id));this.selected=copies.at(-1)?.id;this.save();this.render();this.focusSelection();
 }
 clipboard(event,target){
  const typing=target.matches('input,textarea,select')||target.isContentEditable,description=target.matches('textarea[data-field="caption"],textarea[data-field="text"]');
  if(event.type==='cut'){if(!typing)event.preventDefault();return;}
  if(typing&&!description)return;
  if(event.type==='copy'){
   if(description&&target.selectionStart!==target.selectionEnd)return;
   event.preventDefault();const regions=this.state.regions.filter(r=>this.selection.has(r.id));if(!regions.length||!event.clipboardData)return;
   const text=JSON.stringify({type:'moss-bbox-selection',version:1,regions});event.clipboardData.setData('text/plain',text);event.clipboardData.setData(boxClipboardType,text);this.notify(`Copied ${regions.length===1?'box':`${regions.length} boxes`}`);return;
  }
  let payload;try{payload=JSON.parse(event.clipboardData?.getData(boxClipboardType)||event.clipboardData?.getData('text/plain')||'');}catch{if(!typing)event.preventDefault();return;}
  if(payload?.type!=='moss-bbox-selection'){if(!typing)event.preventDefault();return;}
  event.preventDefault();
  if(payload.version!==1||!Array.isArray(payload.regions)||!payload.regions.length||!payload.regions.every(r=>r&&['object','character','text'].includes(r.label)&&typeof r.caption==='string'&&(r.text===undefined||typeof r.text==='string')&&Array.isArray(r.bbox)&&r.bbox.length===4&&r.bbox.every(n=>Number.isFinite(n)&&n>=0&&n<=1)&&r.bbox[2]>r.bbox[0]&&r.bbox[3]>r.bbox[1])){this.notify('Clipboard boxes are invalid.');return;}
  this.checkpoint();const copies=pasteRegions(this.state,payload.regions);
  for(const region of copies){if(!this.state.groups.some(g=>g.id===region.groupId))delete region.groupId;else this.state.groups.find(g=>g.id===region.groupId).collapsed=false;}
  this.selection=new Set(copies.map(r=>r.id));this.selected=copies.at(-1).id;this.save();this.render();this.focusSelection();
 }
 key(event,target=event.target){
  if(event.isComposing)return;
  if(this.workspace&&(event.ctrlKey||event.metaKey)&&!event.altKey&&event.key==='Enter'){event.preventDefault();if(!event.repeat)this.generate();return;}
  const typeMenu=target.closest('.type-selector');
  if(typeMenu){
   const options=[...typeMenu.querySelectorAll('[data-box-type]')],index=options.indexOf(target.closest('[data-box-type]'));
   if(event.key==='Escape'){event.preventDefault();typeMenu.open=false;this.viewport.focus();}
   else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();typeMenu.open=true;const next=event.key==='Home'?0:event.key==='End'?options.length-1:index<0?(event.key==='ArrowUp'?options.length-1:0):(index+(event.key==='ArrowUp'?-1:1)+options.length)%options.length;options[next].focus();}
   else if(!event.ctrlKey&&!event.metaKey&&!event.altKey&&['v','r'].includes(event.key.toLowerCase())){event.preventDefault();typeMenu.open=false;this.setTool(event.key.toLowerCase()==='r'?'draw':'select');this.viewport.focus();}
   return;
  }
  if(event.key==='Escape'&&this.listDrag){event.preventDefault();this.endListDrag();return;}
  const editing=target.matches('textarea[data-field="caption"],textarea[data-field="text"],textarea[data-field="scene"]');
  if(editing&&(event.key==='Escape'||event.key==='Enter'&&!event.shiftKey&&!event.ctrlKey&&!event.metaKey&&!event.altKey)){event.preventDefault();if(!event.repeat)this.viewport.focus();return;}
  event.stopPropagation();if(event.key==='Escape'&&this.shortcutHelp?.dismiss()){event.preventDefault();return;}if(event.key==='Escape'&&!this.root.querySelector('.copy-menu').hidden){event.preventDefault();this.root.querySelector('.copy-menu').hidden=true;this.root.querySelector('[data-action="copy"]').setAttribute('aria-expanded','false');return;}if(event.key==='Enter'&&target.closest('.import-source')){event.preventDefault();this.importFromSource();return;}if(target.dataset.groupName&&['Enter','Escape'].includes(event.key)){event.preventDefault();this.finishGroupRename(event.key==='Escape');return;}const typing=target.matches('input,textarea,select');if(typing)return;
  const command=event.ctrlKey||event.metaKey,key=event.key.toLowerCase();
  if(event.key==='Control'||event.key==='Meta'){this.marqueeArmed=true;this.updateCursor();return;}
  if(!command&&!event.altKey&&['v','r'].includes(key)){event.preventDefault();this.setTool(key==='r'?'draw':'select');return;}
  if(event.key==='Escape'&&(this.drag||this.pan)){event.preventDefault();this.cancelDrag();this.endPan();this.setTool('select');return;}
  if(event.key==='Escape'&&this.drawArmed){event.preventDefault();this.setTool('select');return;}
  if(event.code==='Space'){event.preventDefault();this.space=true;this.updateCursor();return;}
  if(!command&&key==='0'){event.preventDefault();this.resetView();return;}
  if(event.key==='Enter'&&!event.shiftKey&&!command&&!event.altKey&&target===this.viewport){event.preventDefault();if(!event.repeat&&!this.drag&&!this.pan&&!this.listDrag&&this.selection.size===1)this.focusDescription();return;}
  let action;if(command&&key==='z')action=event.shiftKey?'redo':'undo';else if(command&&key==='y')action='redo';else if(command&&key==='d')action='duplicate';else if(command&&key==='g')action='new-folder';else if(!command&&['Delete','Backspace'].includes(event.key))action='delete';else if(!command&&key==='0')action='fit';
  if(command&&key==='a'){event.preventDefault();this.selectMany(this.state.regions.map(r=>r.id));return;}
  if(action){event.preventDefault();this.root.querySelector(`[data-action="${action}"]`)?.click();return;}
  if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)&&this.selection.size){event.preventDefault();const pixels=(event.shiftKey?10:1)*(this.snap?16:1),dimensions=this.snap?this.gridDimensions():resolveDimensions(this.state),raw=[({ArrowLeft:-pixels,ArrowRight:pixels}[event.key]||0)/dimensions.width,({ArrowUp:-pixels,ArrowDown:pixels}[event.key]||0)/dimensions.height],delta=this.snap&&this.selection.size>1?snapMove(this.state,this.selection,...raw,dimensions,16,{relative:true}):raw;if(!delta.some(Boolean))return;this.checkpoint();moveRegions(this.state,this.selection,...delta);this.save();this.renderBoxes();}
 }
 notify(message){const status=this.root.querySelector('.feedback');status.textContent=message;status.hidden=false;clearTimeout(this.feedbackTimer);this.feedbackTimer=setTimeout(()=>status.hidden=true,4500);}
}
