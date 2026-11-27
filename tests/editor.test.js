import assert from 'node:assert/strict';
import test from 'node:test';
import {Window} from 'happy-dom';
import {BBoxEditor} from '../web/editor.js';
import {addRegion,compilePrompt,createState,resolveDimensions} from '../web/state.js';

const rounded=box=>box.map(value=>Math.round(value*1e9)/1e9);

async function setup(t,state=createState(),configureWindow,adapterOptions={}){
 const window=new Window({url:'http://localhost:8188/',settings:{enableCSSFileLoading:false,enableImageFileLoading:false,handleDisabledFileLoadingAsSuccess:true}});
 const previous=new Map(['document','navigator','ResizeObserver','createImageBitmap'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 let disconnected=0,saved=JSON.stringify(state),closed=0;
 const writes=[];
 Object.defineProperties(globalThis,{
  document:{value:window.document,configurable:true},navigator:{value:window.navigator,configurable:true},
  ResizeObserver:{value:class{observe(){}disconnect(){disconnected++;}},configurable:true},
  createImageBitmap:{value:async()=>{throw new Error('Unexpected image decode.');},writable:true,configurable:true},
 });
 window.HTMLElement.prototype.scrollIntoView=function(){};
 window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new window.Event('close'));};
 const adapter={getSnap:()=>false,read:()=>saved,write:value=>{saved=value;writes.push(JSON.parse(value));},closed:()=>closed++,imageURL:image=>`/view?filename=${encodeURIComponent(image.name)}`,upload:async file=>({name:file.name,subfolder:'moss-bbox',type:'input'}),...adapterOptions};
 const editors=[];
 async function open(){
  const editor=new BBoxEditor(adapter);editors.push(editor);const opening=editor.open();editor.root.querySelector('link').dispatchEvent(new window.Event('load'));await opening;
  for(const surface of [editor.board,editor.viewport]){const captured=new Set();surface.setPointerCapture=id=>captured.add(id);surface.hasPointerCapture=id=>captured.has(id);surface.releasePointerCapture=id=>captured.delete(id);}
  editor.board.getBoundingClientRect=()=>({left:20,top:30,right:1020,bottom:530,width:1000,height:500,x:20,y:30});
  Object.defineProperties(editor.viewport,{clientWidth:{value:1200},clientHeight:{value:800}});editor.fit();return editor;
 }
 configureWindow?.(window);
 const editor=await open();
 t.after(async()=>{for(const item of editors)if(item.host.isConnected)item.dialog.close();await window.happyDOM.close();for(const[key,descriptor]of previous)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];});
 const query=selector=>editor.root.querySelector(selector);
 const click=action=>{const control=query(`[data-action="${action}"]`);assert.ok(control,`Missing ${action} control`);control.click();};
 const input=(field,value)=>{const element=query(`[data-field="${field}"]`);assert.ok(element,`Missing ${field} field`);element.focus();element.value=value;element.dispatchEvent(new window.Event('input',{bubbles:true,composed:true}));return element;};
 const change=(field,value)=>{if(field==='label'){const control=query(`[data-box-type="${value}"]`);assert.ok(control,`Missing ${value} type`);control.click();return control;}const element=query(`[data-field="${field}"]`);assert.ok(element,`Missing ${field} field`);element.focus();element.value=value;element.dispatchEvent(new window.Event('change',{bubbles:true,composed:true}));return element;};
 const pointer=(type,x,y,target=editor.board,options={})=>target.dispatchEvent(new window.PointerEvent(type,{bubbles:true,composed:true,cancelable:true,pointerId:7,pointerType:'mouse',button:0,buttons:type==='pointerup'?0:1,clientX:20+x*1000,clientY:30+y*500,...options}));
 const draw=(start,end)=>{editor.setTool('draw');pointer('pointerdown',...start);pointer('pointermove',...end);pointer('pointerup',...end);editor.setTool('select');};
 const key=(key,options={},target=editor.viewport)=>{target.focus();const event=new window.KeyboardEvent('keydown',{key,bubbles:true,composed:true,cancelable:true,...options});target.dispatchEvent(event);return event;};
 const shiftClick=selector=>{const control=query(selector);assert.ok(control,`Missing control ${selector}`);control.dispatchEvent(new window.MouseEvent('click',{bubbles:true,composed:true,shiftKey:true}));};
 const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
 return{window,editor,adapter,writes,query,click,input,change,pointer,draw,key,shiftClick,flush,open,get saved(){return JSON.parse(saved);},get closed(){return closed;},get disconnected(){return disconnected;}};
}

function assertDescriptionFocus(h,expected){
 const caption=h.query('.primary .caption');assert.ok(caption);assert.equal(caption.value,expected);assert.equal(h.editor.root.activeElement,caption);assert.equal(caption.selectionStart,expected.length);assert.equal(caption.selectionEnd,expected.length);
}

function assertCanvasFocus(h,expected){
 const caption=h.query('.primary .caption');assert.ok(caption);assert.equal(caption.value,expected);assert.equal(h.editor.root.activeElement,h.editor.viewport);
}

function oneBox(){const state=createState();addRegion(state,[.2,.2,.5,.6]).caption='A chair.';return state;}

test('Draw creates, describes, and creates again with editable descriptions',async t=>{
 const h=await setup(t);assert.equal(h.editor.dialog.open,true);assert.equal(h.editor.root.activeElement,h.editor.viewport);
 assert.equal(h.query('[data-action="select"]').getAttribute('aria-pressed'),'true');assert.equal(h.query('[data-action="draw"]').getAttribute('aria-pressed'),'false');
 h.input('scene','A woman reading by a window.');h.draw([.1,.15],[.45,.85]);
 const first=h.editor.state.regions[0];assert.deepEqual(rounded(first.bbox),[.1,.15,.45,.85]);assert.equal(h.editor.selected,first.id);assertCanvasFocus(h,'');
 const caption=h.input('caption','A woman in a cream linen shirt, seated in profile.');assert.equal(h.query('.primary .region-summary').textContent,caption.value);
 h.draw([.5,.3],[.9,.8]);assert.equal(h.editor.state.regions.length,2);assertCanvasFocus(h,'');
 h.input('caption','An open red clothbound book on her lap.');assert.equal(h.saved.regions[0].caption,first.caption);assert.equal(JSON.parse(compilePrompt(h.saved)).items.length,2);
});

test('plain drag on empty canvas never creates a box, while plus creates a selected box with canvas focus',async t=>{
 const h=await setup(t);h.pointer('pointerdown',.1,.1);h.pointer('pointermove',.6,.7);h.pointer('pointerup',.6,.7);assert.equal(h.editor.state.regions.length,0);assert.equal(h.writes.length,0);
 h.click('add');assert.equal(h.saved.regions.length,1);assert.equal(h.editor.selected,h.saved.regions[0].id);assertCanvasFocus(h,'');
 const [left,top,right,bottom]=h.saved.regions[0].bbox;assert.ok(left>=0&&top>=0&&right>left&&bottom>top&&right<=1&&bottom<=1);
 h.input('caption','A red cup.');h.click('add');assert.equal(h.saved.regions.length,2);assert.equal(h.saved.regions[0].caption,'A red cup.');assertCanvasFocus(h,'');
});

test('changing to text returns canvas focus and preserves exact wording and appearance',async t=>{
 const h=await setup(t);h.draw([.1,.1],[.8,.4]);h.change('label','text');assertCanvasFocus(h,'');
 const wording='CAF\u00c9 "\u00c9T\u00c9"\n\u4f60\u597d';const field=h.input('text',wording);h.key('Delete',{},field);assert.equal(h.editor.state.regions.length,1);
 h.input('caption','White serif lettering on a blue enamel sign.');const item=JSON.parse(compilePrompt(h.saved)).items[0];assert.equal(item.text,wording);assert.equal(item.caption,'White serif lettering on a blue enamel sign.');assert.equal(h.query('.primary .region-summary').textContent,wording);
});

test('a created box immediately moves and resizes using plain drags',async t=>{
 const h=await setup(t);h.draw([.2,.2],[.5,.6]);h.input('caption','A chair.');
 h.pointer('pointerdown',.3,.3);h.pointer('pointermove',.4,.4);h.pointer('pointerup',.4,.4);assert.deepEqual(rounded(h.saved.regions[0].bbox),[.3,.3,.6,.7]);assertCanvasFocus(h,'A chair.');
 h.pointer('pointerdown',.6,.7,h.query('[data-handle="se"]'));h.pointer('pointermove',.8,.9);h.pointer('pointerup',.8,.9);assert.deepEqual(rounded(h.saved.regions[0].bbox),[.3,.3,.8,.9]);
 h.pointer('pointerdown',.3,.6,h.query('[data-handle="w"]'));h.pointer('pointermove',.9,.6);h.pointer('pointerup',.9,.6);assert.deepEqual(rounded(h.saved.regions[0].bbox),[.798,.3,.8,.9]);assert.equal(h.editor.board.hasPointerCapture(7),false);assertCanvasFocus(h,'A chair.');
});

test('Draw creates a nested box even when it begins over an existing box',async t=>{
 const h=await setup(t,oneBox());h.draw([.3,.3],[.45,.5]);assert.equal(h.saved.regions.length,2);assert.deepEqual(rounded(h.saved.regions[1].bbox),[.3,.3,.45,.5]);assert.deepEqual(h.saved.regions[0].bbox,[.2,.2,.5,.6]);assertCanvasFocus(h,'');
});

test('canvas selection keeps canvas focus and list selection starts editing the chosen nested box',async t=>{
 const state=createState();const outer=addRegion(state,[.05,.05,.95,.95]);outer.caption='A room.';const inner=addRegion(state,[.3,.25,.6,.75],'text');inner.caption='A blue sign.';inner.text='CAF\u00c9';
 const h=await setup(t,state);h.pointer('pointerdown',.4,.4,h.query(`[data-box="${outer.id}"]`));h.pointer('pointerup',.4,.4);assert.equal(h.editor.selected,inner.id);assertCanvasFocus(h,'A blue sign.');assert.equal(h.editor.state.regions.length,2);assert.equal(h.writes.length,0);
 h.query(`[data-select="${outer.id}"] .region-category`).click();assert.equal(h.editor.selected,outer.id);assertDescriptionFocus(h,'A room.');
 h.pointer('pointerdown',.99,.99);h.pointer('pointerup',.99,.99);assert.equal(h.editor.selection.size,0);assert.equal(h.query('.region-edit'),null);
});

test('Enter starts and finishes description editing while printable canvas keys preserve its content',async t=>{
 const h=await setup(t,oneBox());assertCanvasFocus(h,'A chair.');h.key('!');assertCanvasFocus(h,'A chair.');assert.equal(h.writes.length,0);
 assert.equal(h.key('Enter').defaultPrevented,true);assertDescriptionFocus(h,'A chair.');
 const caption=h.input('caption','A wooden chair.');assert.equal(h.saved.regions[0].caption,'A wooden chair.');assert.equal(h.key('Enter',{},caption).defaultPrevented,true);assertCanvasFocus(h,'A wooden chair.');
 h.key('?');assertCanvasFocus(h,'A wooden chair.');assert.equal(h.saved.regions[0].caption,'A wooden chair.');h.key(' ',{code:'Space'});assert.equal(h.editor.space,true);h.editor.viewport.dispatchEvent(new h.window.KeyboardEvent('keyup',{key:' ',code:'Space',bubbles:true,composed:true}));assert.equal(h.editor.space,false);
});

test('Alt-click cycles all overlapping boxes and right-click can pick any hidden box',async t=>{
 const state=createState();const outer=addRegion(state,[.05,.05,.95,.95]);outer.caption='A room.';const middle=addRegion(state,[.2,.2,.8,.8]);middle.caption='A table.';const inner=addRegion(state,[.3,.3,.6,.6]);inner.caption='A cup.';
 const h=await setup(t,state);const seen=new Set();for(let i=0;i<3;i++){h.pointer('pointerdown',.4,.4,h.editor.board,{altKey:true});h.pointer('pointerup',.4,.4);seen.add(h.editor.selected);assertCanvasFocus(h,h.editor.state.regions.find(r=>r.id===h.editor.selected).caption);}assert.deepEqual(seen,new Set([outer.id,middle.id,inner.id]));
 const event=new h.window.MouseEvent('contextmenu',{bubbles:true,composed:true,cancelable:true,clientX:420,clientY:230});h.editor.board.dispatchEvent(event);assert.equal(event.defaultPrevented,true);assert.equal(h.query('.overlap-menu').hidden,false);assert.equal(h.editor.root.querySelectorAll('[data-choose-box]').length,3);
 h.query(`[data-choose-box="${outer.id}"]`).click();assert.equal(h.editor.selected,outer.id);assert.equal(h.query('.overlap-menu').hidden,true);assertCanvasFocus(h,'A room.');assert.equal(h.writes.length,0);
});

test('Shift-click on canvas and rows supports moving several boxes together',async t=>{
 const state=createState();const first=addRegion(state,[.1,.1,.3,.3]);first.caption='A cup.';const second=addRegion(state,[.5,.2,.7,.4]);second.caption='A plate.';const third=addRegion(state,[.75,.6,.9,.9]);third.caption='A vase.';
 const h=await setup(t,state);h.pointer('pointerdown',.6,.3,h.editor.board,{shiftKey:true});assert.deepEqual(new Set(h.editor.selectedIds()),new Set([first.id,second.id]));h.shiftClick(`[data-select="${third.id}"]`);assert.equal(h.editor.selection.size,3);h.shiftClick(`[data-select="${third.id}"]`);assert.equal(h.editor.selection.size,2);
 h.pointer('pointerdown',.2,.2);h.pointer('pointermove',.3,.4);h.pointer('pointerup',.3,.4);assert.deepEqual(rounded(h.saved.regions[0].bbox),[.2,.3,.4,.5]);assert.deepEqual(rounded(h.saved.regions[1].bbox),[.6,.4,.8,.6]);assert.deepEqual(h.saved.regions[2].bbox,third.bbox);
});

test('folders select and move their boxes together, collapse, and remove without deleting boxes',async t=>{
 const state=createState();const first=addRegion(state,[.1,.1,.3,.3]);first.caption='A cup.';const second=addRegion(state,[.5,.2,.7,.4]);second.caption='A plate.';
 const h=await setup(t,state);h.shiftClick(`[data-select="${second.id}"]`);h.click('new-folder');assert.equal(h.saved.groups.length,1);const folder=h.saved.groups[0];assert.ok(h.saved.regions.every(r=>r.groupId===folder.id));assert.equal(h.editor.root.activeElement,h.query('[data-group-name]'));
 const name=h.query('[data-group-name]');name.value='Still life';name.dispatchEvent(new h.window.Event('input',{bubbles:true,composed:true}));assert.equal(h.saved.groups[0].name,'Still life');h.key('Enter',{},name);assert.equal(h.query('[data-group-name]'),null);
 h.query(`[data-collapse-folder="${folder.id}"]`).click();assert.equal(h.saved.groups[0].collapsed,true);assert.equal(h.query('.folder-boxes').hidden,true);h.query(`[data-collapse-folder="${folder.id}"]`).click();assert.equal(h.query('.folder-boxes').hidden,false);
 h.editor.select(first.id);h.query(`[data-select-folder="${folder.id}"]`).click();assert.equal(h.editor.selection.size,2);h.pointer('pointerdown',.3,.2,h.query('[data-drag-selection]'));h.pointer('pointermove',.4,.3);h.pointer('pointerup',.4,.3);assert.deepEqual(rounded(h.saved.regions[0].bbox),[.2,.2,.4,.4]);assert.deepEqual(rounded(h.saved.regions[1].bbox),[.6,.3,.8,.5]);
 h.query(`[data-remove-folder="${folder.id}"]`).click();assert.equal(h.saved.groups.length,0);assert.equal(h.saved.regions.length,2);assert.ok(h.saved.regions.every(r=>!r.groupId));
});

test('duplicate, delete, undo and redo restore editable region state',async t=>{
 const state=createState();const original=addRegion(state,[.1,.2,.4,.6]);original.caption='A red mug.';const h=await setup(t,state);
 h.key('d',{ctrlKey:true});assert.equal(h.editor.state.regions.length,2);const copy=h.editor.state.regions[1];assert.notEqual(copy.id,original.id);assert.equal(copy.caption,original.caption);assert.deepEqual(rounded(copy.bbox),[.125,.225,.425,.625]);assert.equal(h.editor.selected,copy.id);
 h.key('Delete');assert.equal(h.editor.state.regions.length,1);h.key('z',{ctrlKey:true});assert.equal(h.editor.state.regions.length,2);assert.equal(h.editor.state.regions[1].id,copy.id);h.key('z',{ctrlKey:true,shiftKey:true});assert.equal(h.editor.state.regions.length,1);h.click('undo');h.click('undo');assert.deepEqual(h.editor.state.regions,[original]);assert.equal(h.query('[data-action="undo"]').disabled,true);assert.equal(h.query('[data-action="redo"]').disabled,false);
});

test('a duplicate can immediately be dragged without moving its original',async t=>{
 const state=createState();const original=addRegion(state,[.1,.2,.4,.6]);original.caption='A red mug.';const h=await setup(t,state);h.click('duplicate');const copyId=h.editor.selected;
 h.pointer('pointerdown',.275,.425);h.pointer('pointermove',.475,.525);h.pointer('pointerup',.475,.525);assert.equal(h.editor.state.regions.length,2);assert.equal(h.editor.selected,copyId);assert.deepEqual(rounded(h.editor.state.regions[0].bbox),original.bbox);assert.deepEqual(rounded(h.editor.state.regions[1].bbox),[.325,.325,.625,.725]);assertCanvasFocus(h,'A red mug.');
});

test('cancelled and accidental tiny Draw drags leave no invalid or unsaved box',async t=>{
 const state=oneBox();const h=await setup(t,state);h.click('draw');h.pointer('pointerdown',.6,.6);h.pointer('pointermove',.8,.8);assert.equal(h.editor.state.regions.length,2);
 const cancel=new h.window.Event('cancel',{cancelable:true});h.editor.dialog.dispatchEvent(cancel);assert.equal(cancel.defaultPrevented,true);assert.deepEqual(h.editor.state,{...state,groups:[]});assert.equal(h.editor.drag,null);assert.equal(h.writes.length,0);
 h.draw([.6,.6],[.601,.601]);assert.deepEqual(h.editor.state,{...state,groups:[]});assert.equal(h.writes.length,0);
});

test('image import preserves its aspect ratio and normalized boxes',async t=>{
 const state=oneBox();const h=await setup(t,state);let bitmapClosed=false,uploaded;
 globalThis.createImageBitmap=async(file,options)=>{assert.equal(file.name,'interior.png');assert.equal(options.imageOrientation,'from-image');return{width:1001,height:753,close(){bitmapClosed=true;}};};h.adapter.upload=async file=>{uploaded=file;return{name:'interior.png',subfolder:'moss-bbox',type:'input'};};
 const file=new h.window.File(['image bytes'],'interior.png',{type:'image/png'});await h.editor.importImage(file);assert.equal(uploaded,file);assert.equal(bitmapClosed,true);assert.equal(h.saved.width,1001);assert.equal(h.saved.height,753);assert.equal(h.query('[data-field="aspect_ratio"]').value,'1001:753');assert.deepEqual(h.saved.regions,state.regions);assert.equal(h.saved.image.name,'interior.png');assert.equal(h.query('.image-name').textContent,'interior.png');assert.equal(h.query('.reference').getAttribute('src'),'/view?filename=interior.png');assert.equal(h.query('[data-action="import"]').disabled,false);
 h.change('aspect_ratio','37:19');assert.equal(h.saved.width,37);assert.equal(h.saved.height,19);h.click('remove-image');assert.equal(h.saved.image,null);assert.deepEqual(h.saved.regions,state.regions);h.click('undo');assert.equal(h.saved.image.name,'interior.png');
});

test('edits survive closing and reopening with the canvas ready for shortcuts',async t=>{
 const h=await setup(t);h.input('scene','An oil painting of a garden.');h.draw([.1,.15],[.7,.9]);h.input('caption','A marble fountain among red flowers.');const expected=structuredClone(h.saved);h.editor.dialog.close();assert.equal(h.closed,1);assert.equal(h.disconnected,1);assert.equal(h.editor.host.isConnected,false);
 const reopened=await h.open();assert.deepEqual(reopened.state,expected);assert.equal(reopened.root.querySelector('[data-field="scene"]').value,expected.scene);const caption=reopened.root.querySelector('.primary .caption');assert.equal(caption.value,expected.regions[0].caption);assert.equal(reopened.root.activeElement,reopened.viewport);assert.equal(reopened.root.querySelectorAll('.bbox').length,1);
});

test('all twelve aspect ratio presets remain visible regardless of the current ratio',async t=>{
 const h=await setup(t,{...createState(),width:2,height:3});assert.equal(h.query('datalist'),null);const choices=[...h.editor.root.querySelectorAll('[data-ratio]')].map(el=>el.dataset.ratio);assert.deepEqual(choices,['1:1','2:3','3:2','3:4','4:3','4:5','5:4','9:16','16:9','2:1','1:2','21:9']);
 h.query('.ratio-menu').open=true;h.query('[data-ratio="21:9"]').click();assert.equal(h.query('.ratio-menu').open,false);assert.equal(h.saved.width,7);assert.equal(h.saved.height,3);assert.equal(h.query('[data-field="aspect_ratio"]').value,'7:3');assert.equal(h.editor.root.querySelectorAll('[data-ratio]').length,12);
});

test('custom aspect ratios preserve boxes, validate input, and use pixel-sized nudges',async t=>{
 const h=await setup(t);h.draw([.1,.2],[.6,.8]);h.input('caption','A wooden chair.');const geometry=[...h.saved.regions[0].bbox];h.change('aspect_ratio','1.85:1');assert.equal(h.saved.width,37);assert.equal(h.saved.height,20);assert.equal(h.query('[data-field="aspect_ratio"]').value,'37:20');assert.equal(h.query('[data-field="width"]'),null);assert.equal(h.query('[data-field="height"]'),null);assert.deepEqual(h.saved.regions[0].bbox,geometry);
 h.click('undo');assert.equal(h.query('[data-field="aspect_ratio"]').value,'1:1');const writes=h.writes.length;h.change('aspect_ratio','wide');assert.equal(h.writes.length,writes);assert.equal(h.saved.width,1024);assert.ok(h.query('[data-field="aspect_ratio"]').validationMessage);h.input('aspect_ratio','2:3');h.change('aspect_ratio','2:3');assert.equal(h.query('[data-field="aspect_ratio"]').validationMessage,'');assert.equal(h.saved.width,2);assert.equal(h.saved.height,3);h.key('ArrowRight');const dx=h.saved.regions[0].bbox[0]-geometry[0];assert.ok(dx>0&&dx<.01);
});

test('Import prompt reads the clipboard, applies a whole native prompt, and supports undo',async t=>{
 const state=oneBox();state.image={name:'reference.png',type:'input'};const h=await setup(t,state);const source={...createState(),scene:'A studio.',regions:[{id:'source',label:'text',caption:'Green lettering.',text:'  \u4f60\u597d\n\u00c9T\u00c9  ',bbox:[.1,.2,.6,.8]}]};source.summary={meta:['poster'],canvas:'custom collage',palette:[]};source.regions[0].tags=['bold','green'];source.regions[0].palette=['green'];const nativePrompt=compilePrompt(source);const prompt=JSON.stringify({...JSON.parse(nativePrompt),...resolveDimensions(source)});let reads=0;h.window.navigator.clipboard.readText=async()=>{reads++;return ' \n'+prompt.slice(0,-1)+'\n';};
 h.click('import-prompt');await h.flush();assert.equal(reads,1);assert.equal(h.saved.scene,'A studio.');assert.equal(h.saved.regions.length,1);assert.equal(h.saved.regions[0].text,source.regions[0].text);assert.equal(h.saved.image.name,'reference.png');assert.deepEqual(h.saved.summary,source.summary);assert.deepEqual(h.saved.regions[0].tags,source.regions[0].tags);assert.deepEqual(h.saved.regions[0].palette,source.regions[0].palette);assert.equal(compilePrompt(h.saved),nativePrompt);assert.notEqual(h.saved.regions[0].id,'source');assert.equal(h.query('.prompt-panel').hidden,true);assert.match(h.query('.feedback').textContent,/Prompt imported.*missing closing brace/);assertCanvasFocus(h,'Green lettering.');h.click('undo');assert.equal(h.saved.scene,state.scene);assert.deepEqual(h.saved.regions,state.regions);
});

test('invalid clipboard import opens a simple error and leaves the full layout untouched',async t=>{
 const state=oneBox();state.groups=[{id:'folder',name:'Furniture',collapsed:false}];state.regions[0].groupId='folder';state.summary={palette:['red']};const h=await setup(t,state);const before=structuredClone(h.editor.state);h.window.navigator.clipboard.readText=async()=>JSON.stringify({summary:{caption:'A room.'},items:[{label:'object',caption:'A sofa.',bbox:[0,0,1]}],bbox_coord_space:'abs_centralized',bbox_format:'yxyx'});
 h.click('import-prompt');await h.flush();assert.deepEqual(h.editor.state,before);assert.equal(h.writes.length,0);assert.equal(h.editor.undo.length,0);assert.equal(h.query('.prompt-panel').hidden,false);assert.equal(h.query('.import-error').hidden,false);assert.equal(h.query('.import-error').textContent,'Box 1 needs four coordinates.');
});

test('denied clipboard access allows a simple paste and import without losing current data',async t=>{
 const h=await setup(t,oneBox());h.window.navigator.clipboard.readText=async()=>{throw new h.window.DOMException('denied','NotAllowedError');};h.click('import-prompt');await h.flush();assert.equal(h.query('.prompt-panel').hidden,false);assert.equal(h.query('.import-error').textContent,'Clipboard access is unavailable. Paste the prompt here.');assert.equal(h.editor.root.activeElement,h.query('[data-field="prompt_import"]'));assert.equal(h.writes.length,0);
 const source=oneBox();source.scene='Pasted scene.';const prompt=JSON.stringify({...JSON.parse(compilePrompt(source)),...resolveDimensions(source)});h.input('prompt_import',prompt);h.click('apply-prompt');assert.equal(h.saved.scene,'Pasted scene.');assert.equal(h.query('.prompt-panel').hidden,true);assertCanvasFocus(h,'A chair.');
});

test('copy prompt uses the shared workflow megapixels value',async t=>{
 const h=await setup(t);let copied;h.adapter.megapixels=()=>1.5;h.window.navigator.clipboard.writeText=async value=>{copied=value;};h.change('aspect_ratio','3:2');h.draw([.1,.1],[.8,.8]);h.input('caption','A ceramic vase.');h.click('copy');assert.equal(copied,undefined);h.click('copy-prompt');await h.flush();assert.equal(copied,compilePrompt(h.editor.state,1.5));assert.deepEqual(JSON.parse(copied).items[0].bbox,[-410,-615,308,461]);
});

test('middle mouse pans with a selection and Space drag pans after clearing selection',async t=>{
 const state=oneBox();const h=await setup(t,state);h.editor.panX=200;h.editor.panY=150;h.pointer('pointerdown',.5,.5,h.editor.board,{button:1,buttons:4});assert.ok(h.editor.pan);assert.equal(h.editor.viewport.hasPointerCapture(7),true);h.pointer('pointermove',.6,.7);h.pointer('pointerup',.6,.7,h.editor.board,{button:1});assert.equal(h.editor.panX,300);assert.equal(h.editor.panY,250);assert.equal(h.editor.pan,null);assert.equal(h.editor.viewport.hasPointerCapture(7),false);
 h.pointer('pointerdown',.99,.99);h.pointer('pointerup',.99,.99);assert.equal(h.editor.selection.size,0);h.key(' ',{code:'Space'});assert.equal(h.editor.space,true);assert.equal(h.editor.viewport.classList.contains('can-pan'),true);h.pointer('pointerdown',.4,.4);h.pointer('pointermove',.45,.45);h.pointer('pointerup',.45,.45);assert.equal(h.editor.panX,350);assert.equal(h.editor.panY,275);h.editor.viewport.dispatchEvent(new h.window.KeyboardEvent('keyup',{key:' ',code:'Space',bubbles:true,composed:true}));assert.equal(h.editor.space,false);assert.equal(h.editor.viewport.classList.contains('can-pan'),false);assert.deepEqual(h.editor.state,{...state,groups:[]});assert.equal(h.editor.drag,undefined);assert.equal(h.writes.length,0);
});

test('zoom preserves the point at the viewport center or wheel cursor and Fit resets panning',async t=>{
 const h=await setup(t);const viewport=h.editor.viewport;viewport.getBoundingClientRect=()=>({left:20,top:30,width:1200,height:800,right:1220,bottom:830});h.editor.board.getBoundingClientRect=()=>({left:20+(1200-h.editor.boardWidth)/2+h.editor.panX,top:30+(800-h.editor.boardHeight)/2+h.editor.panY,width:h.editor.boardWidth,height:h.editor.boardHeight});const pointAt=([x,y])=>{const rect=h.editor.board.getBoundingClientRect();return[(x-rect.left)/rect.width,(y-rect.top)/rect.height];};
 const center=[620,430],before=pointAt(center);h.click('zoom-in');assert.deepEqual(rounded(pointAt(center)),rounded(before));assert.equal(h.editor.panX,0);assert.equal(h.editor.panY,0);const cursor=[340,250],cursorBefore=pointAt(cursor);const wheel=new h.window.WheelEvent('wheel',{bubbles:true,composed:true,cancelable:true,deltaY:-100,clientX:cursor[0],clientY:cursor[1]});Object.assign(wheel,{clientX:cursor[0],clientY:cursor[1]});viewport.dispatchEvent(wheel);assert.equal(wheel.defaultPrevented,true);assert.deepEqual(rounded(pointAt(cursor)),rounded(cursorBefore));assert.ok(h.editor.zoom>1.25);assert.ok(h.editor.panX>0);h.click('fit');assert.equal(h.editor.zoom,1);assert.equal(h.editor.panX,0);assert.equal(h.editor.panY,0);assert.equal(h.writes.length,0);
});

test('editor shortcuts remain local and description fields keep their native editing shortcuts',async t=>{
 const h=await setup(t,oneBox());let leaked=0;h.window.document.addEventListener('keydown',()=>leaked++);h.window.document.addEventListener('keyup',()=>leaked++);const caption=h.query('.primary .caption');h.key('Delete',{},caption);h.key('z',{ctrlKey:true},caption);h.key(' ',{code:'Space'},caption);assert.equal(h.editor.state.regions.length,1);assert.notEqual(h.editor.space,true);const before=structuredClone(h.editor.state);h.key('s',{ctrlKey:true});h.key('q',{},caption);h.editor.viewport.dispatchEvent(new h.window.KeyboardEvent('keyup',{key:'q',bubbles:true,composed:true}));assert.equal(leaked,0);assert.deepEqual(h.editor.state,before);
});

test('closing before stylesheet completion never reopens an orphaned modal and closes once',async t=>{
 const h=await setup(t);const nativeDispatch=h.window.HTMLLinkElement.prototype.dispatchEvent;h.window.HTMLLinkElement.prototype.dispatchEvent=function(event){return['load','error'].includes(event.type)?true:nativeDispatch.call(this,event);};const pending=new BBoxEditor(h.adapter);const opening=pending.open();h.window.HTMLLinkElement.prototype.dispatchEvent=nativeDispatch;pending.close();pending.close();assert.equal(pending.host.isConnected,false);pending.root.querySelector('link').dispatchEvent(new h.window.Event('load'));await opening;assert.equal(pending.dialog.open,false);assert.equal(pending.observer,undefined);assert.equal(h.closed,1);assert.equal(h.disconnected,0);
});

test('Fit preserves extreme image aspect ratios',async t=>{
 const h=await setup(t,{...createState(),width:16384,height:16});let width=parseFloat(h.editor.board.style.width),height=parseFloat(h.editor.board.style.height);assert.equal(Math.round(width/height),1024);h.editor.state.width=16;h.editor.state.height=16384;h.editor.fit();width=parseFloat(h.editor.board.style.width);height=parseFloat(h.editor.board.style.height);assert.equal(Math.round(height/width),1024);
});



test('muting a box excludes only its prompt entry and undo keeps its complete description and wording',async t=>{
 const state=createState();const cup=addRegion(state,[.1,.1,.4,.5]);cup.caption='A ceramic cup.';const sign=addRegion(state,[.5,.2,.9,.4],'text');sign.caption='Green lettering.';sign.text='  \u4f60\u597d\nCAF\u00c9  ';sign.tags=['lettering'];state.groups=[{id:'folder',name:'Still life',collapsed:false}];cup.groupId='folder';sign.groupId='folder';
 const h=await setup(t,state);const original=compilePrompt(h.editor.state);h.query(`[data-mute-box="${sign.id}"]`).click();assert.equal(h.saved.regions.length,2);assert.equal(h.saved.regions[1].muted,true);assert.equal(h.saved.regions[1].text,sign.text);assert.equal(h.saved.regions[1].caption,sign.caption);assert.deepEqual(h.saved.regions[1].tags,sign.tags);assert.deepEqual(h.saved.groups,state.groups);assert.equal(h.query(`[data-box="${sign.id}"]`).classList.contains('muted'),true);assert.equal(h.query(`[data-mute-box="${sign.id}"]`).getAttribute('aria-pressed'),'true');assert.deepEqual(JSON.parse(compilePrompt(h.saved)).items.map(item=>item.caption),['A ceramic cup.']);
 h.click('undo');assert.equal(compilePrompt(h.saved),original);assert.equal(h.query(`[data-box="${sign.id}"]`).classList.contains('muted'),false);assert.equal(h.saved.regions[1].text,sign.text);h.click('redo');assert.equal(h.saved.regions[1].muted,true);h.query(`[data-mute-box="${sign.id}"]`).click();assert.equal(compilePrompt(h.saved),original);assert.equal(h.saved.regions[1].muted,false);
});

test('automatic reference updates change only the preview without saving or changing authored boxes',async t=>{
 const state=oneBox();state.summary={meta:['portrait']};const h=await setup(t,state);const before=structuredClone(h.editor.state);const reference={name:'latest.png',subfolder:'generated',type:'output'};h.editor.setReference(reference);assert.equal(h.writes.length,0);assert.equal(h.editor.undo.length,0);assert.deepEqual(h.editor.state,{...before,image:reference});assert.equal(h.query('.image-name').textContent,'latest.png');assert.equal(h.query('.reference').getAttribute('src'),'/view?filename=latest.png');assert.equal(h.query('[data-action="remove-image"]').hidden,false);assert.notStrictEqual(h.editor.state.image,reference);
});

test('empty folder titles remain selectable',async t=>{
 const state=oneBox();state.groups=[{id:'folder',name:'Furniture',collapsed:true}];const h=await setup(t,state);assert.equal(h.query('[data-select-folder="folder"]').disabled,false);assert.equal(h.query('.folder-boxes').hidden,true);
 h.query('[data-select-folder="folder"]').click();assert.equal(h.editor.selection.size,0);assert.equal(h.query('.folder-boxes').hidden,true);assert.equal(h.writes.length,0);
});

test('cancelling a group drag restores its boxes, multi-selection, primary editor and pointer capture',async t=>{
 const state=createState();const first=addRegion(state,[.1,.1,.3,.3]);first.caption='A cup.';const second=addRegion(state,[.5,.2,.7,.4]);second.caption='A plate.';const third=addRegion(state,[.75,.6,.9,.9]);third.caption='A vase.';const h=await setup(t,state);h.shiftClick(`[data-select="${second.id}"]`);const before=structuredClone(h.editor.state);assert.equal(h.editor.selected,second.id);
 h.pointer('pointerdown',.3,.2,h.query('[data-drag-selection]'));h.pointer('pointermove',.4,.3);assert.notDeepEqual(h.editor.state.regions,before.regions);assert.equal(h.editor.board.hasPointerCapture(7),true);const cancel=new h.window.Event('cancel',{cancelable:true});h.editor.dialog.dispatchEvent(cancel);assert.equal(cancel.defaultPrevented,true);assert.equal(h.editor.drag,null);assert.deepEqual(h.editor.state,before);assert.deepEqual(new Set(h.editor.selectedIds()),new Set([first.id,second.id]));assert.equal(h.editor.selected,second.id);assert.equal(h.editor.root.activeElement,h.editor.viewport);assert.equal(h.editor.board.hasPointerCapture(7),false);assert.equal(h.writes.length,0);assert.equal(h.editor.undo.length,0);
});

const generationPixels=bbox=>bbox.map((value,index)=>Number((value*(index%2?1024:1536)).toFixed(9)));

test('enabling the 16-pixel grid preserves imported geometry and saves only the snap preference',async t=>{
 const state={...createState(),width:3,height:2,scene:'A room.',image:{name:'reference.png',type:'input'}};addRegion(state,[.103,.117,.491,.743]).caption='An imported chair.';const h=await setup(t,state);h.adapter.megapixels=()=>1.5;let preference=false;h.adapter.getSnap=()=>preference;h.adapter.setSnap=value=>{preference=value;};const before=structuredClone(h.editor.state),prompt=compilePrompt(h.editor.state,1.5);
 assert.equal(h.query('.grid-overlay').hidden,true);h.click('snap');assert.equal(h.editor.snap,true);assert.equal(preference,true);assert.equal(h.query('[data-action="snap"]').getAttribute('aria-pressed'),'true');assert.equal(h.query('.grid-overlay').hidden,false);assert.equal(parseFloat(h.query('.grid-overlay').style.getPropertyValue('--cell-x')),1600/1536);assert.equal(parseFloat(h.query('.grid-overlay').style.getPropertyValue('--cell-y')),1600/1024);assert.deepEqual(h.editor.state,before);assert.equal(compilePrompt(h.editor.state,1.5),prompt);assert.equal(h.writes.length,0);assert.equal(h.editor.undo.length,0);
 h.click('snap');assert.equal(preference,false);assert.equal(h.query('.grid-overlay').hidden,true);assert.deepEqual(h.editor.state,before);h.click('snap');const reopened=await h.open();assert.equal(reopened.snap,true);assert.equal(reopened.root.querySelector('.grid-overlay').hidden,false);assert.deepEqual(reopened.state,before);assert.equal(h.writes.length,0);
});

test('Draw, move, resize and plus snap to actual 16-pixel generation edges at the workflow megapixels',async t=>{
 const h=await setup(t,{...createState(),width:3,height:2});h.adapter.megapixels=()=>1.5;h.click('snap');h.draw([.113,.127],[.487,.713]);assert.deepEqual(generationPixels(h.saved.regions[0].bbox),[176,128,752,736]);h.input('caption','A framed artwork.');
 h.pointer('pointerdown',.2,.3);h.pointer('pointermove',.233,.334);h.pointer('pointerup',.233,.334);assert.deepEqual(generationPixels(h.saved.regions[0].bbox),[224,160,800,768]);assertCanvasFocus(h,'A framed artwork.');
 h.pointer('pointerdown',800/1536,768/1024,h.query('[data-handle="se"]'));h.pointer('pointermove',.611,.832);h.pointer('pointerup',.611,.832);assert.deepEqual(generationPixels(h.saved.regions[0].bbox),[224,160,944,848]);const first=[...h.saved.regions[0].bbox];h.click('add');assert.deepEqual(generationPixels(h.saved.regions[1].bbox),[416,288,1040,688]);assert.deepEqual(h.saved.regions[0].bbox,first);assertCanvasFocus(h,'');
});

test('snapped multi-box movement uses shared 16-pixel deltas while preserving imported sizes and spacing',async t=>{
 const state={...createState(),width:3,height:2};const first=addRegion(state,[.103,.117,.303,.317]);first.caption='A cup.';const second=addRegion(state,[.493,.427,.743,.677]);second.caption='A plate.';const h=await setup(t,state);h.adapter.megapixels=()=>1.5;h.shiftClick(`[data-select="${second.id}"]`);h.click('snap');const original=structuredClone(h.editor.state.regions);
 h.pointer('pointerdown',.5,.5,h.query('[data-drag-selection]'));h.pointer('pointermove',.55,.54);h.pointer('pointerup',.55,.54);const dx=h.saved.regions[0].bbox[0]-original[0].bbox[0],dy=h.saved.regions[0].bbox[1]-original[0].bbox[1];assert.deepEqual(rounded([dx*1536,dy*1024]),[80,48]);for(let index=0;index<2;index++)assert.deepEqual(rounded(h.saved.regions[index].bbox),rounded(original[index].bbox.map((value,edge)=>value+(edge%2?dy:dx))));const moved=structuredClone(h.saved.regions);h.click('snap');assert.deepEqual(h.editor.state.regions,moved);
});

test('snap selection and handle clicks preserve off-grid imports, and zoomed Ctrl-click never creates a box',async t=>{
 const state={...createState(),width:3,height:2,image:{name:'reference.png',type:'input'}};addRegion(state,[.103,.117,.491,.743]).caption='An imported chair.';const h=await setup(t,state);h.adapter.megapixels=()=>1.5;h.click('snap');const before=structuredClone(h.editor.state);
 h.pointer('pointerdown',.2,.3);h.pointer('pointerup',.2,.3);assert.deepEqual(h.editor.state,before);assertCanvasFocus(h,'An imported chair.');
 h.pointer('pointerdown',.2,.3);h.pointer('pointermove',.201,.302);h.pointer('pointerup',.201,.302);assert.deepEqual(h.editor.state,before);
 h.pointer('pointerdown',.491,.743,h.query('[data-handle="se"]'));h.pointer('pointerup',.491,.743);assert.deepEqual(h.editor.state,before);
 h.click('zoom-in');assert.ok(h.editor.zoom>1);h.pointer('pointerdown',.2,.3,h.editor.board,{ctrlKey:true});h.pointer('pointerup',.2,.3,h.editor.board,{ctrlKey:true});assert.deepEqual(h.editor.state,before);assert.equal(h.editor.state.regions.length,1);assert.equal(h.writes.length,0);assert.equal(h.editor.undo.length,0);assert.equal(h.editor.board.hasPointerCapture(7),false);
});

test('focused text edits save immediately and survive direct close and Escape without Done',async t=>{
 const state=oneBox();state.regions[0].label='text';state.regions[0].text='Original wording';const h=await setup(t,state);h.input('scene','A hand-painted sign.');h.input('caption','Blue serif lettering on ivory paper.');const firstText=h.input('text','  F\u00f8rste\n\u4f60\u597d  ');assert.equal(h.editor.root.activeElement,firstText);assert.equal(h.saved.regions[0].text,firstText.value);const firstSaved=structuredClone(h.saved),firstWrites=h.writes.length;
 h.editor.dialog.close();assert.equal(h.writes.length,firstWrites);const reopened=await h.open();assert.deepEqual(reopened.state,firstSaved);
 const caption=reopened.root.querySelector('[data-field="caption"]');caption.focus();caption.value='Green handwritten lettering on ivory paper.';caption.dispatchEvent(new h.window.Event('input',{bubbles:true,composed:true}));const wording=reopened.root.querySelector('[data-field="text"]');wording.focus();wording.value='  Anden "\u00c9T\u00c9"\n\u4e00\u523b  ';wording.dispatchEvent(new h.window.Event('input',{bubbles:true,composed:true}));assert.equal(reopened.root.activeElement,wording);assert.equal(h.saved.regions[0].caption,caption.value);assert.equal(h.saved.regions[0].text,wording.value);const finalSaved=structuredClone(h.saved),finalWrites=h.writes.length;
 const escape=new h.window.Event('cancel',{cancelable:true});reopened.dialog.dispatchEvent(escape);assert.equal(escape.defaultPrevented,false);
 // Native dialogs close after an unprevented Escape cancel; happy-dom needs that default action.
 if(reopened.dialog.open)reopened.dialog.close();assert.equal(h.writes.length,finalWrites);assert.equal(h.closed,2);const again=await h.open();assert.deepEqual(again.state,finalSaved);assert.equal(again.root.querySelector('[data-field="text"]').value,wording.value);
});


function doubleClick(h,selector){
 const target=h.query(selector);assert.ok(target,'Missing double-click target '+selector);
 target.dispatchEvent(new h.window.MouseEvent('click',{bubbles:true,composed:true,detail:1}));assert.equal(target.isConnected,true);
 target.dispatchEvent(new h.window.MouseEvent('click',{bubbles:true,composed:true,detail:2}));assert.equal(target.isConnected,true);
 target.dispatchEvent(new h.window.MouseEvent('dblclick',{bubbles:true,composed:true,cancelable:true,detail:2}));
}

function folderState(){
 const state=createState();const first=addRegion(state,[.1,.1,.3,.3]);first.caption='A cup.';first.groupId='folder';const second=addRegion(state,[.5,.2,.7,.4]);second.caption='A plate.';second.groupId='folder';const outside=addRegion(state,[.8,.8,.95,.95]);outside.caption='An unrelated vase.';state.groups=[{id:'folder',name:'Still life',collapsed:false}];return state;
}

test('single-clicking a group name or icon selects its boxes without renaming or replacing the preceding editor',async t=>{
 const state=folderState(),h=await setup(t,state);const title=h.query('[data-select-folder="folder"]'),oldEditor=h.query('.region-edit');title.querySelector('.folder-name').click();assert.deepEqual(h.editor.selectedIds(),state.regions.slice(0,2).map(r=>r.id));assert.equal(h.editor.root.activeElement,h.editor.viewport);assert.equal(h.query('[data-group-name]'),null);assert.strictEqual(h.query('[data-select-folder="folder"]'),title);assert.equal(oldEditor.isConnected,true);assert.equal(h.writes.length,0);
 const key=new h.window.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,composed:true,cancelable:true});h.editor.root.activeElement.dispatchEvent(key);assert.equal(key.defaultPrevented,true);for(let index=0;index<2;index++)assert.deepEqual(rounded(h.saved.regions[index].bbox),rounded(state.regions[index].bbox.map((value,edge)=>value+(edge%2?0:1/1024))));assert.deepEqual(h.saved.regions[2],state.regions[2]);assert.equal(h.editor.root.activeElement,h.editor.viewport);
 h.query('[data-select="'+state.regions[2].id+'"]').click();h.query('[data-select-folder="folder"] svg').dispatchEvent(new h.window.MouseEvent('click',{bubbles:true,composed:true}));assert.deepEqual(h.editor.selectedIds(),state.regions.slice(0,2).map(r=>r.id));assert.equal(h.editor.root.activeElement,h.editor.viewport);assert.equal(h.query('[data-group-name]'),null);
});

test('double-click renaming saves names, Enter and blur finish, and Escape restores without closing the modal',async t=>{
 const state=folderState(),h=await setup(t,state);doubleClick(h,'[data-select-folder="folder"] .folder-name');let field=h.query('[data-group-name="folder"]');assert.ok(field);assert.equal(h.editor.root.activeElement,field);assert.equal(field.selectionStart,0);assert.equal(field.selectionEnd,'Still life'.length);field.value='Furniture scene';field.dispatchEvent(new h.window.Event('input',{bubbles:true,composed:true}));assert.equal(h.saved.groups[0].name,'Furniture scene');assert.equal(h.key('Enter',{},field).defaultPrevented,true);assert.equal(h.query('[data-group-name]'),null);assert.equal(h.query('.folder-title .folder-name').textContent,'Furniture scene');assert.equal(h.editor.dialog.open,true);
 doubleClick(h,'[data-select-folder="folder"] svg');field=h.query('[data-group-name="folder"]');field.value='Unwanted draft';field.dispatchEvent(new h.window.Event('input',{bubbles:true,composed:true}));assert.equal(h.key('Escape',{},field).defaultPrevented,true);assert.equal(h.saved.groups[0].name,'Furniture scene');assert.equal(h.query('[data-group-name]'),null);assert.equal(h.editor.dialog.open,true);
 doubleClick(h,'[data-select-folder="folder"]');field=h.query('[data-group-name="folder"]');field.value='Final arrangement';field.dispatchEvent(new h.window.Event('input',{bubbles:true,composed:true}));const collapse=h.query('[data-collapse-folder="folder"]'),remove=h.query('[data-remove-folder="folder"]');collapse.focus();assert.equal(field.isConnected,false);assert.equal(collapse.isConnected,true);assert.equal(remove.isConnected,true);assert.strictEqual(h.query('[data-collapse-folder="folder"]'),collapse);assert.strictEqual(h.query('[data-remove-folder="folder"]'),remove);assert.equal(h.saved.groups[0].name,'Final arrangement');collapse.click();assert.equal(h.saved.groups[0].collapsed,true);assert.deepEqual(h.saved.regions,state.regions);
});

test('an empty group can be selected and double-clicked to rename',async t=>{
 const state=oneBox();state.groups=[{id:'empty',name:'Empty',collapsed:false}];const h=await setup(t,state);const title=h.query('[data-select-folder="empty"]');assert.equal(title.disabled,false);title.click();assert.equal(h.editor.selection.size,0);assert.equal(h.editor.root.activeElement,h.editor.viewport);assert.equal(h.query('[data-group-name]'),null);assert.equal(h.writes.length,0);
 doubleClick(h,'[data-select-folder="empty"]');const field=h.query('[data-group-name="empty"]');assert.ok(field);field.value='Named before adding boxes';field.dispatchEvent(new h.window.Event('input',{bubbles:true,composed:true}));h.key('Enter',{},field);assert.equal(h.saved.groups[0].name,'Named before adding boxes');assert.deepEqual(h.saved.regions,state.regions);
});

test('dragging the gap inside the group union moves every selected box without changing sizes or spacing',async t=>{
 const state=folderState();state.regions[0].bbox=[.103,.117,.303,.317];state.regions[1].bbox=[.493,.427,.743,.677];const h=await setup(t,state);h.query('[data-select-folder="folder"]').click();const original=structuredClone(h.editor.state.regions);h.pointer('pointerdown',.4,.36);h.pointer('pointermove',.45,.4);h.pointer('pointerup',.45,.4);
 assert.equal(h.editor.selection.size,2);for(let index=0;index<2;index++)assert.deepEqual(rounded(h.saved.regions[index].bbox),rounded(original[index].bbox.map((value,edge)=>value+(edge%2?.04:.05))));assert.deepEqual(h.saved.regions[2],original[2]);assert.equal(h.editor.root.activeElement,h.editor.viewport);
});

test('the group union exposes eight resize handles and individual rows still resize one box',async t=>{
 const state=folderState(),h=await setup(t,state);h.query('[data-select-folder="folder"]').click();assert.deepEqual(new Set([...h.editor.root.querySelectorAll('[data-group-handle]')].map(el=>el.dataset.groupHandle)),new Set(['nw','n','ne','e','se','s','sw','w']));h.pointer('pointerdown',.7,.4,h.query('[data-group-handle="se"]'));h.pointer('pointermove',.9,.7);h.pointer('pointerup',.9,.7);assert.deepEqual(rounded(h.saved.regions[0].bbox),[.1,.1,.366666667,.5]);assert.deepEqual(rounded(h.saved.regions[1].bbox),[.633333333,.3,.9,.7]);assert.deepEqual(h.saved.regions[2],state.regions[2]);assert.equal(h.editor.root.activeElement,h.editor.viewport);
 const second=structuredClone(h.saved.regions[1]);h.query('[data-select="'+state.regions[0].id+'"]').click();assert.equal(h.editor.selection.size,1);assert.equal(h.query('.selection-frame'),null);assert.equal(h.editor.root.querySelectorAll('[data-handle]').length,8);h.pointer('pointerdown',.366666667,.5,h.query('[data-handle="se"]'));h.pointer('pointermove',.45,.6);h.pointer('pointerup',.45,.6);assert.deepEqual(rounded(h.saved.regions[0].bbox),[.1,.1,.45,.6]);assert.deepEqual(h.saved.regions[1],second);assertCanvasFocus(h,'A cup.');
});

test('snapped union resizing aligns every child edge to the actual generation grid',async t=>{
 const state=folderState();state.width=3;state.height=2;state.regions[0].bbox=[.125,.125,.375,.375];state.regions[1].bbox=[.5,.25,.75,.5];const h=await setup(t,state);h.adapter.megapixels=()=>1.5;h.query('[data-select-folder="folder"]').click();h.click('snap');h.pointer('pointerdown',.75,.5,h.query('[data-group-handle="se"]'));h.pointer('pointermove',.871,.747);h.pointer('pointerup',.871,.747);assert.deepEqual(generationPixels(h.saved.regions[0].bbox),[192,128,656,560]);assert.deepEqual(generationPixels(h.saved.regions[1].bbox),[880,336,1344,768]);assert.deepEqual(h.saved.regions.map(r=>[r.id,r.caption,r.groupId]),state.regions.map(r=>[r.id,r.caption,r.groupId]));assert.deepEqual(h.saved.regions[2],state.regions[2]);assert.equal(h.editor.root.activeElement,h.editor.viewport);
});

test('snapped group arrows stop before a partial grid step at the canvas edge',async t=>{
 const state=folderState();state.width=3;state.height=2;state.regions[0].bbox=[.6,.1,.8,.3];state.regions[1].bbox=[.8,.4,.995,.6];const h=await setup(t,state);h.adapter.megapixels=()=>1.5;h.query('[data-select-folder="folder"]').click();h.click('snap');const before=structuredClone(h.editor.state);h.key('ArrowRight');assert.deepEqual(h.editor.state,before);assert.equal(h.writes.length,0);h.key('ArrowLeft');for(let index=0;index<2;index++)assert.deepEqual(rounded(h.saved.regions[index].bbox),rounded(state.regions[index].bbox.map((value,edge)=>value-(edge%2?0:16/1536))));assert.deepEqual(h.saved.regions[2],state.regions[2]);assert.equal(h.editor.root.activeElement,h.editor.viewport);
});

test('Alt-clicking a child inside a group selection returns to individual canvas selection',async t=>{
 const state=folderState(),h=await setup(t,state);h.query('[data-select-folder="folder"]').click();assert.equal(h.editor.selection.size,2);h.pointer('pointerdown',.2,.2,h.editor.board,{altKey:true});h.pointer('pointerup',.2,.2);assert.equal(h.editor.selection.size,1);assert.equal(h.editor.selected,state.regions[0].id);assert.equal(h.query('[data-group-handle]'),null);assert.equal(h.editor.root.querySelectorAll('[data-handle]').length,8);assertCanvasFocus(h,'A cup.');assert.equal(h.writes.length,0);
});


test('editing a preserved child inspector after group selection changes that child only',async t=>{
 const state=folderState(),h=await setup(t,state);const caption=h.query('.primary .caption');h.query('[data-select-folder="folder"]').click();assert.equal(h.editor.selection.size,2);assert.equal(caption.isConnected,true);assert.equal(h.editor.root.activeElement,h.editor.viewport);caption.focus();assert.equal(h.editor.selection.size,1);assert.equal(h.editor.selected,state.regions[0].id);assert.equal(caption.isConnected,true);caption.value='A blue ceramic cup.';caption.dispatchEvent(new h.window.Event('input',{bubbles:true,composed:true}));assert.equal(h.saved.regions[0].caption,'A blue ceramic cup.');assert.equal(h.saved.regions[1].caption,'A plate.');assert.deepEqual(h.saved.regions[2],state.regions[2]);
});


function nativeFourMegapixelFixture(){
 return JSON.stringify({summary:{caption:'A source portrait composition.'},items:[
  {label:'object',caption:'A centered frame.',bbox:[-608,-432,608,432]},
  {label:'text',caption:'A small title.',text:'  Source title\nÉTÉ  ',bbox:[-608,-432,-304,0]},
 ],bbox_coord_space:'abs_centralized',bbox_format:'yxyx'});
}

function importDestination(){
 const state=oneBox();state.width=3;state.height=2;state.scene='Keep this until import is confirmed.';state.image={name:'destination-reference.png',subfolder:'moss-bbox',type:'input'};state.groups=[{id:'existing-folder',name:'Existing objects',collapsed:false}];state.regions[0].groupId='existing-folder';return state;
}

async function beginNativeImport(h,text){
 h.window.navigator.clipboard.readText=async()=>text;h.click('import-prompt');await h.flush();
 assert.equal(h.query('.prompt-panel').hidden,false);assert.ok(h.query('[data-action="import-current-canvas"]'));assert.ok(h.query('[data-action="import-source-canvas"]'));
}

test('a native import without source dimensions waits without changing saved boxes, selection, image or history',async t=>{
 const h=await setup(t,importDestination());h.adapter.megapixels=()=>1;const before=structuredClone(h.editor.state),selected=h.editor.selected;
 await beginNativeImport(h,nativeFourMegapixelFixture());assert.deepEqual(h.editor.state,before);assert.equal(h.editor.selected,selected);assert.equal(h.writes.length,0);assert.equal(h.editor.undo.length,0);assert.equal(h.adapter.megapixels(),1);
 h.query('.source-exact').open=true;h.input('import_source_width','1728');h.input('import_source_height','2432');assert.deepEqual(h.editor.state,before);assert.equal(h.writes.length,0);assert.equal(h.editor.undo.length,0);
 h.click('close-import');assert.equal(h.query('.prompt-panel').hidden,true);assert.deepEqual(h.editor.state,before);assert.equal(h.editor.selected,selected);assert.equal(h.writes.length,0);
 await beginNativeImport(h,nativeFourMegapixelFixture());const cancel=new h.window.Event('cancel',{cancelable:true});h.editor.dialog.dispatchEvent(cancel);assert.equal(cancel.defaultPrevented,true);assert.equal(h.editor.dialog.open,true);assert.equal(h.query('.prompt-panel').hidden,true);assert.deepEqual(h.editor.state,before);assert.equal(h.writes.length,0);
});

test('choosing a 1728 by 2432 source imports a 4MP prompt into a different 1MP canvas without changing its ratio or image',async t=>{
 const h=await setup(t,importDestination());let megapixels=1;h.adapter.megapixels=()=>megapixels;const before=structuredClone(h.editor.state);
 await beginNativeImport(h,nativeFourMegapixelFixture());h.query('.source-exact').open=true;h.input('import_source_width','1728');h.input('import_source_height','2432');h.click('import-source-canvas');
 assert.equal(h.query('.prompt-panel').hidden,true);assert.equal(h.saved.scene,'A source portrait composition.');assert.equal(h.saved.width,3);assert.equal(h.saved.height,2);assert.equal(megapixels,1);assert.deepEqual(h.saved.image,before.image);assert.equal(h.query('[data-field="aspect_ratio"]').value,'3:2');assert.deepEqual(h.saved.regions.map(r=>rounded(r.bbox)),[[.25,.25,.75,.75],[.25,.25,.5,.375]]);assert.equal(h.saved.regions[1].text,'  Source title\nÉTÉ  ');assert.equal(h.writes.length,1);assert.equal(h.editor.undo.length,1);
 const compiled=JSON.parse(compilePrompt(h.saved,1));assert.deepEqual(compiled.items[0].bbox,[-208,-312,208,312]);assert.equal(compiled.items[1].text,'  Source title\nÉTÉ  ');
 h.click('undo');assert.deepEqual(h.saved,before);assert.equal(megapixels,1);
});

test('source aspect ratio and megapixels resolve the source canvas without editing destination settings',async t=>{
 const h=await setup(t,importDestination());h.adapter.megapixels=()=>1;const before=structuredClone(h.editor.state);await beginNativeImport(h,nativeFourMegapixelFixture());
 h.change('import_source_ratio','27:38');h.change('import_source_megapixels','4');assert.equal(h.query('.source-exact').open,false);assert.equal(Number(h.query('[data-field="import_source_width"]').value),1728);assert.equal(Number(h.query('[data-field="import_source_height"]').value),2432);assert.deepEqual(h.editor.state,before);assert.equal(h.writes.length,0);
 h.click('import-source-canvas');assert.deepEqual(rounded(h.saved.regions[0].bbox),[.25,.25,.75,.75]);assert.equal(h.saved.width,3);assert.equal(h.saved.height,2);assert.equal(h.adapter.megapixels(),1);
});

test('Use current canvas is explicit and refuses a larger incompatible native prompt without touching the layout',async t=>{
 const h=await setup(t,importDestination());h.adapter.megapixels=()=>1;const before=structuredClone(h.editor.state);await beginNativeImport(h,nativeFourMegapixelFixture());h.click('import-current-canvas');
 assert.deepEqual(h.editor.state,before);assert.equal(h.writes.length,0);assert.equal(h.editor.undo.length,0);assert.equal(h.query('.prompt-panel').hidden,false);assert.match(h.query('.import-error').textContent,/outside the source canvas/i);
 const source={...createState(),width:3,height:2,scene:'Coordinates from this canvas.'};addRegion(source,[.25,.25,.75,.75]).caption='A compatible square.';h.input('prompt_import',compilePrompt(source,1));h.click('apply-prompt');assert.equal(h.writes.length,0);h.click('import-current-canvas');
 assert.equal(h.query('.prompt-panel').hidden,true);assert.deepEqual(rounded(h.saved.regions[0].bbox),[.25,.25,.75,.75]);assert.equal(h.saved.width,3);assert.equal(h.saved.height,2);assert.equal(h.adapter.megapixels(),1);assert.deepEqual(h.saved.image,before.image);
});

test('Copy menu preserves exact node prompt output and offers a normalized editable layout with muted boxes and groups',async t=>{
 const state=importDestination();state.summary={meta:['poster'],canvas:'custom collage',palette:['blue']};const muted=addRegion(state,[.125,.25,.375,.5],'text');muted.caption='A muted sign.';muted.text='  CAFÉ\n你好  ';muted.muted=true;muted.groupId='existing-folder';muted.tags=['serif'];const h=await setup(t,state);h.adapter.megapixels=()=>4;const copied=[];h.window.navigator.clipboard.writeText=async value=>copied.push(value);const before=structuredClone(h.editor.state);
 h.click('copy');assert.equal(copied.length,0);h.click('copy-prompt');await h.flush();assert.equal(copied[0],compilePrompt(before,4));assert.equal(JSON.parse(copied[0]).items.length,1);
 h.click('copy');assert.equal(copied.length,1);h.click('copy-layout');await h.flush();const editable=JSON.parse(copied[1]);assert.deepEqual(editable,before);assert.equal(editable.version,1);assert.deepEqual(editable.regions[1].bbox,[.125,.25,.375,.5]);assert.equal(editable.regions[1].muted,true);assert.equal(editable.regions[1].text,muted.text);assert.deepEqual(editable.groups,before.groups);assert.equal(h.writes.length,0);assert.deepEqual(h.editor.state,before);
 h.window.navigator.clipboard.readText=async()=>copied[1];h.click('import-prompt');await h.flush();assert.equal(h.query('.prompt-panel').hidden,true);assert.deepEqual(h.saved.regions.map(r=>[r.bbox,r.caption,r.text,r.muted??false]),before.regions.map(r=>[r.bbox,r.caption,r.text,r.muted??false]));assert.deepEqual(h.saved.groups.map(group=>group.name),before.groups.map(group=>group.name));assert.equal(h.saved.width,before.width);assert.equal(h.saved.height,before.height);
});

function clipboard(h,type,{target=h.editor.root.activeElement||h.editor.viewport,text='',data}={}){
 const clipboardData=data||new h.window.DataTransfer();if(text)clipboardData.setData('text/plain',text);
 const event=new h.window.ClipboardEvent(type,{bubbles:true,composed:true,cancelable:true,clipboardData});target.dispatchEvent(event);
 return{event,data:clipboardData};
}

function selectionClipboard(regions){
 return JSON.stringify({type:'moss-bbox-selection',version:1,regions});
}

test('each list duplicate button copies only its own box and keeps text, muted state and metadata through undo',async t=>{
 const state=createState(),first=addRegion(state,[.1,.1,.3,.3]),original=addRegion(state,[.65,.6,.85,.8],'text');first.caption='A ceramic cup.';original.caption='A painted label.';original.text='  CAF\u00c9\n\u4f60\u597d  ';original.muted=true;original.groupId='labels';original.tags=['serif'];original.extra={material:'enamel'};state.groups=[{id:'labels',name:'Labels',collapsed:false}];
 const h=await setup(t,state);h.shiftClick('[data-select="'+original.id+'"]');assert.equal(h.editor.selection.size,2);
 const duplicate=h.query('[data-duplicate-box="'+original.id+'"]');assert.ok(duplicate);assert.match(duplicate.getAttribute('aria-label'),/duplicate/i);duplicate.click();
 assert.equal(h.saved.regions.length,3);const copy=h.editor.state.regions[2];assert.notEqual(copy.id,original.id);assert.deepEqual(rounded(copy.bbox),[.675,.625,.875,.825]);assert.deepEqual({...copy,id:original.id,bbox:original.bbox},original);assert.notStrictEqual(copy.tags,h.editor.state.regions[1].tags);assert.notStrictEqual(copy.extra,h.editor.state.regions[1].extra);assert.deepEqual(h.saved.regions.slice(0,2),state.regions);assert.deepEqual(h.editor.selectedIds(),[copy.id]);assert.equal(h.writes.length,1);assert.equal(h.editor.undo.length,1);
 h.click('undo');assert.deepEqual(h.saved,state);h.click('redo');assert.equal(h.saved.regions[2].id,copy.id);assert.equal(h.saved.regions[2].text,original.text);assert.equal(h.saved.regions[2].muted,true);
});

test('copy and paste use the selected box after canvas selection and after leaving list description editing',async t=>{
 const state=createState(),first=addRegion(state,[.1,.1,.3,.3]),second=addRegion(state,[.6,.6,.8,.8]);first.caption='A cup.';second.caption='A blue plate.';const h=await setup(t,state);
 h.pointer('pointerdown',.7,.7);h.pointer('pointerup',.7,.7);assert.equal(h.editor.selected,second.id);assertCanvasFocus(h,second.caption);
 h.key('c',{ctrlKey:true},h.editor.root.activeElement);const canvasCopy=clipboard(h,'copy');assert.equal(canvasCopy.event.defaultPrevented,true);const payload=JSON.parse(canvasCopy.data.getData('text/plain'));assert.equal(payload.type,'moss-bbox-selection');assert.equal(payload.version,1);assert.deepEqual(payload.regions,[second]);assert.deepEqual(JSON.parse(canvasCopy.data.getData('application/x-moss-bbox+json')),payload);assert.equal(h.writes.length,0);
 h.key('v',{ctrlKey:true},h.editor.root.activeElement);assert.equal(h.editor.state.regions.length,2);const canvasPaste=clipboard(h,'paste',{data:canvasCopy.data});assert.equal(canvasPaste.event.defaultPrevented,true);assert.equal(h.saved.regions.length,3);assert.equal(h.saved.regions[2].caption,second.caption);assert.notEqual(h.saved.regions[2].id,second.id);assert.deepEqual(rounded(h.saved.regions[2].bbox),[.625,.625,.825,.825]);assert.deepEqual(h.editor.selectedIds(),[h.saved.regions[2].id]);
 h.query('[data-select="'+first.id+'"]').click();assertDescriptionFocus(h,first.caption);h.key('Enter',{},h.editor.root.activeElement);assertCanvasFocus(h,first.caption);h.key('c',{metaKey:true},h.editor.root.activeElement);const listCopy=clipboard(h,'copy');h.key('v',{metaKey:true},h.editor.root.activeElement);clipboard(h,'paste',{data:listCopy.data});assert.equal(h.saved.regions.length,4);assert.equal(h.saved.regions[3].caption,first.caption);assert.deepEqual(rounded(h.saved.regions[3].bbox),[.125,.125,.325,.325]);assert.deepEqual(h.saved.regions.slice(0,2),state.regions);assert.equal(h.writes.length,2);
});

test('copy snapshots a multi-selection and repeated pastes preserve its geometry at the canvas boundary',async t=>{
 const state=createState(),first=addRegion(state,[.6,.45,.75,.6]),second=addRegion(state,[.85,.7,.98,.98]),outside=addRegion(state,[.02,.02,.1,.1]);first.caption='A cup.';second.caption='A plate.';outside.caption='An unrelated vase.';const h=await setup(t,state);h.shiftClick('[data-select="'+second.id+'"]');assert.equal(h.editor.selection.size,2);
 const copied=clipboard(h,'copy',{target:h.editor.viewport});assert.equal(copied.event.defaultPrevented,true);assert.equal(h.writes.length,0);
 h.editor.state.regions[0].caption='Edited after copying.';h.editor.state.regions[0].bbox=[.1,.1,.2,.2];h.editor.state.regions[1].bbox=[.3,.3,.4,.4];const originalAtPaste=structuredClone(h.editor.state.regions);
 clipboard(h,'paste',{target:h.editor.viewport,data:copied.data});const firstPaste=structuredClone(h.saved.regions.slice(3));assert.equal(firstPaste.length,2);assert.deepEqual(firstPaste.map(r=>rounded(r.bbox)),[[.62,.47,.77,.62],[.87,.72,1,1]]);assert.deepEqual(firstPaste.map(r=>r.caption),['A cup.','A plate.']);assert.deepEqual(h.saved.regions.slice(0,3),originalAtPaste);assert.deepEqual(h.editor.selectedIds(),firstPaste.map(r=>r.id));
 clipboard(h,'paste',{target:h.editor.viewport,data:copied.data});const secondPaste=h.saved.regions.slice(5);assert.deepEqual(secondPaste.map(r=>rounded(r.bbox)),firstPaste.map(r=>rounded(r.bbox)));assert.equal(new Set(h.saved.regions.map(r=>r.id)).size,7);assert.deepEqual(h.editor.selectedIds(),secondPaste.map(r=>r.id));assert.equal(h.writes.length,2);assert.equal(h.editor.undo.length,2);
 h.click('undo');assert.deepEqual(h.saved.regions.slice(3),firstPaste);h.click('undo');assert.deepEqual(h.saved.regions,originalAtPaste);
});

test('modal captures keyboard and clipboard before graph document handlers and releases them on close',async t=>{
 const captured=[],bubbled=[],types=['keydown','keyup','copy','cut','paste'];const h=await setup(t,oneBox(),window=>{for(const type of types){window.document.addEventListener(type,event=>captured.push(event.type),true);window.addEventListener(type,event=>bubbled.push(event.type));}});
 const caption=h.query('.primary .caption');caption.focus();caption.setSelectionRange(0,1);
 for(const key of ['c','v','x']){h.key(key,{ctrlKey:true},caption);caption.dispatchEvent(new h.window.KeyboardEvent('keyup',{key,ctrlKey:true,bubbles:true,composed:true,cancelable:true}));}
 clipboard(h,'copy',{target:caption});clipboard(h,'cut',{target:caption});clipboard(h,'paste',{target:caption,text:'Some ordinary text.'});assert.deepEqual(captured,[]);assert.deepEqual(bubbled,[]);assert.equal(h.writes.length,0);
 h.editor.dialog.close();const input=h.window.document.createElement('textarea');h.window.document.body.append(input);input.focus();
 for(const type of types){if(type==='keydown'||type==='keyup')input.dispatchEvent(new h.window.KeyboardEvent(type,{key:'v',ctrlKey:true,bubbles:true,composed:true,cancelable:true}));else clipboard(h,type,{target:input,text:'Graph clipboard.'});}
 assert.deepEqual(captured,types);assert.deepEqual(bubbled,types);assert.equal(h.closed,1);
});

test('native text clipboard operations remain available in descriptions, scene and shadow input fields',async t=>{
 const state=oneBox();state.groups=[{id:'folder',name:'Furniture',collapsed:false}];const h=await setup(t,state),caption=h.query('.primary .caption');caption.focus();caption.setSelectionRange(0,1);
 for(const type of ['copy','cut']){const operation=clipboard(h,type,{target:caption});assert.equal(operation.event.defaultPrevented,false);assert.equal(operation.data.getData('application/x-moss-bbox+json'),'');}
 assert.equal(h.key('c',{ctrlKey:true},caption).defaultPrevented,false);assert.equal(h.key('v',{ctrlKey:true},caption).defaultPrevented,false);assert.equal(clipboard(h,'paste',{target:caption,text:'A replacement description.'}).event.defaultPrevented,false);
 const scene=h.query('[data-field="scene"]');scene.focus();scene.setSelectionRange(0,0);assert.equal(clipboard(h,'copy',{target:scene}).event.defaultPrevented,false);assert.equal(clipboard(h,'paste',{target:scene,text:selectionClipboard(state.regions)}).event.defaultPrevented,false);
 const ratio=h.query('[data-field="aspect_ratio"]');ratio.focus();ratio.setSelectionRange(0,0);assert.equal(clipboard(h,'copy',{target:ratio}).event.defaultPrevented,false);assert.equal(clipboard(h,'paste',{target:ratio,text:'16:9'}).event.defaultPrevented,false);
 doubleClick(h,'[data-select-folder="folder"] .folder-name');const folder=h.query('[data-group-name="folder"]');folder.setSelectionRange(0,0);assert.equal(clipboard(h,'copy',{target:folder}).event.defaultPrevented,false);assert.equal(clipboard(h,'paste',{target:folder,text:selectionClipboard(state.regions)}).event.defaultPrevented,false);assert.equal(h.editor.state.regions.length,1);assert.equal(h.writes.length,0);assert.equal(h.editor.undo.length,0);
});

test('paste accepts plain-text bbox payloads from another editor and leaves unrelated layout settings intact',async t=>{
 const state=oneBox();state.scene='Keep the current scene.';state.width=3;state.height=2;state.image={name:'reference.png',subfolder:'moss-bbox',type:'input'};const incoming={id:'source-box',label:'text',caption:'A white sign.',text:'  \u00c9T\u00c9\n\u4f60\u597d  ',bbox:[.1,.2,.3,.4],muted:true,tags:['serif'],groupId:'missing-source-folder'};const h=await setup(t,state),before=structuredClone(h.editor.state);
 const pasted=clipboard(h,'paste',{text:selectionClipboard([incoming])});assert.equal(pasted.event.defaultPrevented,true);assert.equal(h.saved.regions.length,2);const copy=h.saved.regions[1];assert.notEqual(copy.id,incoming.id);assert.equal(copy.text,incoming.text);assert.equal(copy.caption,incoming.caption);assert.equal(copy.muted,true);assert.deepEqual(copy.tags,incoming.tags);assert.deepEqual(rounded(copy.bbox),[.125,.225,.325,.425]);assert.equal(copy.groupId,undefined);assert.deepEqual({...h.saved,regions:before.regions},before);assert.equal(h.editor.undo.length,1);
});

test('invalid bbox payloads and nontext clipboard contents cannot change boxes or reach graph handlers',async t=>{
 const graph=[],h=await setup(t,oneBox(),window=>window.document.addEventListener('paste',event=>graph.push(event),true)),before=structuredClone(h.editor.state);
 const invalid=[
  {type:'moss-bbox-selection',version:2,regions:before.regions},
  {type:'moss-bbox-selection',version:1,regions:[{...before.regions[0],bbox:[.1,.2,.1,.4]}]},
  {type:'moss-bbox-selection',version:1,regions:[{...before.regions[0],bbox:[-.1,.2,.3,.4]}]},
  {type:'moss-bbox-selection',version:1,regions:[{...before.regions[0],bbox:[.1,.2,1.3,.4]}]},
  {type:'moss-bbox-selection',version:1,regions:[{...before.regions[0],bbox:[.1,.2,.3]}]},
  {type:'moss-bbox-selection',version:1,regions:[{...before.regions[0],caption:{invalid:true}}]},
 ];
 for(const payload of invalid){const operation=clipboard(h,'paste',{text:JSON.stringify(payload)});assert.equal(operation.event.defaultPrevented,true);assert.deepEqual(h.editor.state,before);}
 h.editor.viewport.focus();assert.equal(clipboard(h,'paste',{target:h.editor.viewport,text:'Unrelated clipboard text.'}).event.defaultPrevented,true);assert.equal(clipboard(h,'paste',{target:h.editor.viewport,text:'{"nodes":[{"id":1}],"links":[]}'}).event.defaultPrevented,true);assert.deepEqual(graph,[]);assert.deepEqual(h.editor.state,before);assert.equal(h.writes.length,0);assert.equal(h.editor.undo.length,0);
 h.pointer('pointerdown',.99,.99);h.pointer('pointerup',.99,.99);assert.equal(h.editor.selection.size,0);const copy=clipboard(h,'copy',{target:h.editor.viewport});assert.equal(copy.event.defaultPrevented,true);assert.equal(copy.data.getData('application/x-moss-bbox+json'),'');assert.equal(h.writes.length,0);
});
test('the exact-wording field copies selected text natively and copies boxes when its caret is collapsed',async t=>{
 const state=oneBox(),original=state.regions[0];original.label='text';original.text='  CAF\u00c9 "\u00c9T\u00c9"\n\u4f60\u597d  ';original.muted=true;const h=await setup(t,state),wording=h.query('[data-field="text"]');wording.focus();wording.setSelectionRange(2,6);
 assert.equal(clipboard(h,'copy',{target:wording}).event.defaultPrevented,false);assert.equal(clipboard(h,'paste',{target:wording,text:'Native wording.'}).event.defaultPrevented,false);
 wording.setSelectionRange(wording.value.length,wording.value.length);const copied=clipboard(h,'copy',{target:wording});assert.equal(copied.event.defaultPrevented,true);assert.deepEqual(JSON.parse(copied.data.getData('text/plain')).regions,[original]);assert.equal(clipboard(h,'paste',{target:wording,data:copied.data}).event.defaultPrevented,true);assert.equal(h.saved.regions.length,2);assert.equal(h.saved.regions[1].text,original.text);assert.equal(h.saved.regions[1].muted,true);assert.equal(h.writes.length,1);
});
test('editor header uses the requested name without a leading icon',async t=>{
 const h=await setup(t);const heading=h.query('.editor-header h1');assert.equal(heading.textContent.trim(),'MOSS-Image BBOX editor');assert.equal(heading.querySelector('svg'),null);assert.equal(h.editor.dialog.getAttribute('aria-label'),'MOSS-Image BBOX editor');
});

test('category icons replace numbered badges in rows, canvas and overlap choices and update when edited',async t=>{
 const state=createState(),object=addRegion(state,[.1,.1,.9,.9]),text=addRegion(state,[.1,.1,.9,.9],'text'),character=addRegion(state,[.1,.1,.9,.9],'character');
 const h=await setup(t,state),labels=['Object','Text','Character'],icons=[];
 assert.equal(h.query('.region-number'),null);assert.equal(h.query('.box-number'),null);
 for(const[index,region]of state.regions.entries()){
  const tile=h.query('[data-select="'+region.id+'"] .region-category');assert.equal(tile.dataset.category,region.label);assert.equal(tile.title,labels[index]);assert.equal(tile.getAttribute('aria-label'),labels[index]);assert.equal(tile.textContent.trim(),'');assert.ok(tile.querySelector('svg'));icons.push(tile.querySelector('svg').innerHTML);
  const badge=h.query('[data-canvas-select="'+region.id+'"]');assert.ok(badge.classList.contains('box-category'));assert.equal(badge.dataset.category,region.label);assert.equal(badge.textContent.trim(),'');assert.equal(badge.querySelector('svg').innerHTML,icons[index]);assert.equal(badge.title,labels[index]);assert.match(badge.getAttribute('aria-label'),new RegExp(region.label,'i'));assert.doesNotMatch(badge.getAttribute('aria-label'),/\bbox \d+\b/i);
  const row=h.query('[data-select="'+region.id+'"]');assert.doesNotMatch(row.getAttribute('aria-label'),/\bbox \d+\b/i);assert.doesNotMatch(row.querySelector('.region-summary').textContent,/\bbox \d+\b/i);
 }
 assert.equal(new Set(icons).size,3);
 h.query('[data-select="'+character.id+'"] .region-category').click();assert.equal(h.editor.selected,character.id);h.change('label','text');assert.equal(h.saved.regions[2].label,'text');assert.equal(h.query('[data-select="'+character.id+'"] .region-category').dataset.category,'text');assert.equal(h.query('[data-canvas-select="'+character.id+'"]').dataset.category,'text');assert.equal(h.query('[data-canvas-select="'+character.id+'"] svg').innerHTML,icons[1]);
 h.query('[data-canvas-select="'+object.id+'"]').click();assert.equal(h.editor.selected,object.id);assert.equal(h.editor.selection.size,1);
 h.editor.board.dispatchEvent(new h.window.MouseEvent('contextmenu',{bubbles:true,composed:true,cancelable:true,clientX:420,clientY:230}));
 const choices=[...h.editor.root.querySelectorAll('[data-choose-box] .region-category')];assert.deepEqual(choices.map(element=>element.dataset.category),['text','text','object']);assert.deepEqual(choices.map(element=>element.querySelector('svg').innerHTML),[icons[1],icons[1],icons[0]]);assert.ok(choices.every(element=>element.textContent.trim()===''));assert.equal(h.query('.region-number'),null);
 h.query('[data-choose-box="'+text.id+'"]').click();assert.equal(h.editor.selected,text.id);assert.equal(h.query('.overlap-menu').hidden,true);
});
test('each row deletes only that box and keeps the other selection, complete metadata and undo history',async t=>{
 const state=folderState();state.scene='Keep this scene.';state.summary={meta:['preserve-me']};state.image={name:'reference.png',subfolder:'moss-bbox',type:'input'};const[first,second,third]=state.regions;first.label='text';first.text='  CAF\u00c9\n\u4f60\u597d  ';first.muted=true;first.tags=['serif'];second.tags=['ceramic'];
 const h=await setup(t,state);h.shiftClick('[data-select="'+second.id+'"]');const before=structuredClone(h.editor.state);assert.deepEqual(new Set(h.editor.selectedIds()),new Set([first.id,second.id]));
 for(const region of state.regions){const control=h.query('[data-delete-box="'+region.id+'"]');assert.ok(control);assert.match(control.getAttribute('aria-label'),/delete/i);}
 h.query('[data-delete-box="'+third.id+'"]').click();assert.deepEqual(h.saved.regions,before.regions.slice(0,2));assert.deepEqual(new Set(h.editor.selectedIds()),new Set([first.id,second.id]));assert.equal(h.writes.length,1);assert.equal(h.editor.undo.length,1);assert.deepEqual({...h.saved,regions:before.regions},before);
 h.click('undo');assert.deepEqual(h.saved,before);assert.deepEqual(new Set(h.editor.selectedIds()),new Set([first.id,second.id]));
 h.query('[data-delete-box="'+first.id+'"]').click();assert.deepEqual(h.saved.regions,[before.regions[1],before.regions[2]]);assert.deepEqual(h.editor.selectedIds(),[second.id]);assert.equal(h.editor.selected,second.id);assert.equal(h.query('[data-box="'+first.id+'"]'),null);assertCanvasFocus(h,second.caption);
 h.click('undo');assert.deepEqual(h.saved,before);assert.equal(h.saved.regions[0].text,first.text);assert.deepEqual(h.saved.regions[0].tags,first.tags);assert.equal(h.saved.regions[0].muted,true);assert.deepEqual(h.saved.groups,before.groups);
});

test('deleting the last box from its row leaves an empty editor and undo restores it',async t=>{
 const h=await setup(t,oneBox()),before=structuredClone(h.editor.state),id=before.regions[0].id;
 h.query('[data-delete-box="'+id+'"]').click();assert.deepEqual(h.saved.regions,[]);assert.equal(h.editor.selection.size,0);assert.equal(h.editor.selected,undefined);assert.equal(h.query('.bbox'),null);assert.equal(h.query('[data-action="delete"]').disabled,true);h.click('undo');assert.deepEqual(h.saved,before);assert.equal(h.query('[data-delete-box="'+id+'"]').disabled,false);
});

test('Paste image reads the first clipboard image without a file picker and preserves boxes, folders and captions',async t=>{
 const state=folderState();state.scene='A still life.';state.summary={meta:['keep-me']};state.image={name:'old.png',type:'input'};state.regions[1].label='text';state.regions[1].text='  CAF\u00c9\n\u4f60\u597d  ';state.regions[1].muted=true;state.regions[1].tags=['handwritten'];
 const h=await setup(t,state);h.shiftClick('[data-select="'+state.regions[1].id+'"]');const before=structuredClone(h.editor.state),selection=h.editor.selectedIds(),paste=h.query('[data-action="paste-image"]'),importButton=h.query('[data-action="import"]');assert.ok(paste);assert.equal(importButton.nextElementSibling,paste);assert.match(paste.textContent,/Paste image/);
 let resolveRead,resolveUpload,reads=0,pickers=0,uploaded,decoded=0,closed=0;const requested=[];h.query('.file-picker').click=()=>pickers++;
 h.window.navigator.clipboard.read=()=>{reads++;return new Promise(resolve=>{resolveRead=resolve;});};
 globalThis.createImageBitmap=async(file,options)=>{decoded++;assert.ok(file instanceof h.window.File);assert.equal(options.imageOrientation,'from-image');assert.equal(file.type,'image/webp');assert.equal(await file.text(),'clipboard image bytes');return{width:2401,height:1350,close(){closed++;}};};
 h.adapter.upload=file=>{uploaded=file;return new Promise(resolve=>{resolveUpload=resolve;});};
 h.click('paste-image');assert.equal(reads,1);assert.equal(paste.disabled,true);assert.deepEqual(h.editor.state,before);assert.equal(pickers,0);
 const image=new h.window.Blob(['clipboard image bytes'],{type:'image/webp'});resolveRead([{types:['text/plain'],getType:async()=>{throw new Error('Text clipboard entry must not be read as an image.');}},{types:['text/html','image/webp','image/png'],getType:async type=>{requested.push(type);return image;}}]);await h.flush();await h.flush();
 assert.deepEqual(requested,['image/webp']);assert.equal(decoded,1);assert.equal(closed,1);assert.ok(uploaded);assert.match(uploaded.name,/^clipboard-.+\.webp$/);assert.equal(importButton.disabled,true);assert.equal(paste.disabled,true);assert.deepEqual(h.editor.state,before);assert.equal(h.writes.length,0);
 resolveUpload({name:uploaded.name,subfolder:'moss-bbox',type:'input'});await h.flush();await h.flush();
 assert.equal(paste.disabled,false);assert.equal(importButton.disabled,false);assert.equal(pickers,0);assert.equal(h.saved.width,2401);assert.equal(h.saved.height,1350);assert.equal(h.saved.image.name,uploaded.name);assert.deepEqual(h.saved.regions,before.regions);assert.deepEqual(h.saved.groups,before.groups);assert.deepEqual(h.saved.summary,before.summary);assert.equal(h.saved.scene,before.scene);assert.deepEqual(h.editor.selectedIds(),selection);assert.equal(h.writes.length,1);assert.equal(h.editor.undo.length,1);assert.equal(h.query('.reference').getAttribute('src'),'/view?filename='+encodeURIComponent(uploaded.name));
 h.click('undo');assert.deepEqual(h.saved,before);assert.equal(h.query('.reference').getAttribute('src'),'/view?filename=old.png');
});

test('clipboard image failures report feedback and restore controls without altering the saved layout',async t=>{
 const cases=[
  ['unsupported browser',()=>undefined],
  ['empty clipboard',()=>async()=>[]],
  ['text-only clipboard',()=>async()=>[{types:['text/plain']}]],
  ['denied clipboard permission',window=>async()=>{throw new window.DOMException('Clipboard access denied.','NotAllowedError');}],
  ['unreadable image',()=>async()=>[{types:['image/png'],getType:async()=>{throw new Error('Clipboard image unavailable.');}}]],
 ];
 for(const[name,reader]of cases)await t.test(name,async t=>{
  const h=await setup(t,folderState());h.shiftClick('[data-select="'+h.editor.state.regions[1].id+'"]');const before=structuredClone(h.editor.state),selection=h.editor.selectedIds();let uploaded=0,pickers=0;h.window.navigator.clipboard.read=reader(h.window);h.adapter.upload=async()=>{uploaded++;throw new Error('Unexpected upload.');};h.query('.file-picker').click=()=>pickers++;
  await h.editor.pasteImage();assert.equal(uploaded,0);assert.equal(pickers,0);assert.deepEqual(h.editor.state,before);assert.deepEqual(h.editor.selectedIds(),selection);assert.equal(h.writes.length,0);assert.equal(h.editor.undo.length,0);assert.equal(h.query('[data-action="paste-image"]').disabled,false);assert.equal(h.query('[data-action="import"]').disabled,false);assert.equal(h.query('.feedback').hidden,false);assert.match(h.query('.feedback').textContent,/clipboard|image|access|denied|unavailable/i);
 });
});

test('clipboard image decode and upload failures preserve the previous reference and leave both buttons usable',async t=>{
 for(const stage of ['decode','upload'])await t.test(stage,async t=>{
  const state=oneBox();state.image={name:'keep.png',type:'input'};const h=await setup(t,state),before=structuredClone(h.editor.state);let decoded=0,closed=0,uploads=0;const image=new h.window.Blob(['bad image'],{type:'image/png'});h.window.navigator.clipboard.read=async()=>[{types:['image/png'],getType:async()=>image}];
  globalThis.createImageBitmap=async()=>{decoded++;if(stage==='decode')throw new Error('Clipboard image could not be decoded.');return{width:100,height:100,close(){closed++;}};};h.adapter.upload=async()=>{uploads++;throw new Error('Image upload failed.');};
  await h.editor.pasteImage();assert.equal(decoded,1);assert.equal(uploads,stage==='upload'?1:0);assert.equal(closed,stage==='upload'?1:0);assert.deepEqual(h.editor.state,before);assert.equal(h.writes.length,0);assert.equal(h.editor.undo.length,0);assert.equal(h.query('[data-action="import"]').disabled,false);assert.equal(h.query('[data-action="paste-image"]').disabled,false);assert.equal(h.query('.feedback').hidden,false);assert.match(h.query('.feedback').textContent,/image/i);assert.equal(h.query('.reference').getAttribute('src'),'/view?filename=keep.png');
 });
});
test('Snap 16 starts enabled when no preference exists and preserves explicit and toggled preferences across editors',async t=>{
 const h=await setup(t,oneBox()),before=structuredClone(h.editor.state);assert.equal(h.editor.snap,false);assert.equal(h.query('.grid-overlay').hidden,true);h.editor.dialog.close();delete h.adapter.getSnap;
 const defaultEditor=await h.open();assert.equal(defaultEditor.snap,true);assert.equal(defaultEditor.root.querySelector('.grid-overlay').hidden,false);assert.equal(defaultEditor.root.querySelector('[data-action="snap"]').getAttribute('aria-pressed'),'true');assert.deepEqual(defaultEditor.state,before);assert.equal(h.writes.length,0);
 let preference;h.adapter.getSnap=()=>preference;h.adapter.setSnap=value=>{preference=value;};defaultEditor.root.querySelector('[data-action="snap"]').click();assert.equal(preference,false);assert.equal(defaultEditor.snap,false);assert.equal(defaultEditor.root.querySelector('.grid-overlay').hidden,true);defaultEditor.dialog.close();
 const offEditor=await h.open();assert.equal(offEditor.snap,false);assert.equal(offEditor.root.querySelector('.grid-overlay').hidden,true);offEditor.root.querySelector('[data-action="snap"]').click();assert.equal(preference,true);assert.equal(offEditor.snap,true);offEditor.dialog.close();
 const onEditor=await h.open();assert.equal(onEditor.snap,true);assert.equal(onEditor.root.querySelector('.grid-overlay').hidden,false);assert.deepEqual(onEditor.state,before);assert.equal(h.writes.length,0);assert.equal(onEditor.undo.length,0);
});

test('hovering or focusing overlap choices highlights only the corresponding canvas box without editing or selecting it',async t=>{
 const state=createState(),outer=addRegion(state,[.1,.1,.9,.9]),middle=addRegion(state,[.2,.2,.8,.8],'text'),inner=addRegion(state,[.3,.3,.6,.6],'character');outer.caption='A room.';middle.caption='A sign.';middle.text='CAF\u00c9';inner.caption='A reader.';
 const h=await setup(t,state),before=structuredClone(h.editor.state),selection=h.editor.selectedIds(),primary=h.editor.selected,menu=h.query('.overlap-menu');
 const open=()=>h.editor.board.dispatchEvent(new h.window.MouseEvent('contextmenu',{bubbles:true,composed:true,cancelable:true,clientX:420,clientY:230}));
 const hover=id=>h.query('[data-choose-box="'+id+'"] .region-category').dispatchEvent(new h.window.MouseEvent('mouseover',{bubbles:true,composed:true}));
 const highlighted=id=>{assert.deepEqual([...h.editor.root.querySelectorAll('.bbox.menu-hover')].map(element=>element.dataset.box),id?[id]:[]);assert.deepEqual([...h.editor.root.querySelectorAll('[data-choose-box].box-hover')].map(element=>element.dataset.chooseBox),id?[id]:[]);};
 const unchanged=()=>{assert.deepEqual(h.editor.state,before);assert.deepEqual(h.editor.selectedIds(),selection);assert.equal(h.editor.selected,primary);assert.equal(h.writes.length,0);assert.equal(h.editor.undo.length,0);};
 open();assert.equal(menu.hidden,false);hover(inner.id);highlighted(inner.id);unchanged();hover(middle.id);highlighted(middle.id);unchanged();
 menu.dispatchEvent(new h.window.MouseEvent('mouseleave',{relatedTarget:h.editor.viewport}));highlighted();unchanged();
 h.query('[data-choose-box="'+outer.id+'"]').focus();highlighted(outer.id);unchanged();h.editor.viewport.focus();highlighted();unchanged();
 hover(inner.id);highlighted(inner.id);open();highlighted();assert.equal(menu.hidden,false);unchanged();
 hover(middle.id);h.click('visibility');assert.equal(menu.hidden,true);highlighted();unchanged();h.click('visibility');
 open();hover(inner.id);h.query('[data-choose-box="'+inner.id+'"]').click();assert.equal(menu.hidden,true);highlighted();assert.equal(h.editor.selected,inner.id);assert.deepEqual(h.editor.selectedIds(),[inner.id]);assert.deepEqual(h.editor.state,before);assert.equal(h.writes.length,0);assert.equal(h.editor.undo.length,0);
 open();hover(outer.id);h.editor.board.dispatchEvent(new h.window.MouseEvent('contextmenu',{bubbles:true,composed:true,cancelable:true,clientX:1010,clientY:525}));assert.equal(menu.hidden,true);highlighted();assert.equal(h.writes.length,0);
});
test('Save prompt downloads the exact native prompt at current workflow megapixels without changing the layout',async t=>{
 const state=oneBox();state.width=3;state.height=2;state.scene='A sunlit room.';state.regions[0].label='text';state.regions[0].text='  CAF\u00c9\n\u4f60\u597d  ';state.regions[0].tags=['lettering'];const h=await setup(t,state);h.adapter.megapixels=()=>4;const before=structuredClone(h.editor.state),selection=h.editor.selectedIds(),expected=compilePrompt(before,4),downloads=[],revoked=[];let blob,creates=0,clipboardWrites=0;
 h.window.URL.createObjectURL=value=>{blob=value;creates++;return'blob:moss-prompt-download';};h.window.URL.revokeObjectURL=value=>revoked.push(value);h.window.HTMLAnchorElement.prototype.click=function(){downloads.push({href:this.href,name:this.download,connected:this.isConnected,inEditor:h.editor.root.contains(this)});};h.window.navigator.clipboard.writeText=async()=>{clipboardWrites++;};
 const control=h.query('[data-action="save-prompt"]');assert.ok(control);assert.match(control.textContent,/Save prompt/);h.click('save-prompt');await h.flush();
 assert.equal(creates,1);assert.ok(blob instanceof h.window.Blob);assert.equal(await blob.text(),expected);assert.deepEqual(JSON.parse(await blob.text()),JSON.parse(compilePrompt(before,4)));assert.deepEqual(downloads,[{href:'blob:moss-prompt-download',name:'moss-image-prompt.json',connected:true,inEditor:true}]);assert.deepEqual(revoked,['blob:moss-prompt-download']);assert.equal(h.query('a[download]'),null);assert.equal(clipboardWrites,0);assert.deepEqual(h.editor.state,before);assert.deepEqual(h.editor.selectedIds(),selection);assert.equal(h.writes.length,0);assert.equal(h.editor.undo.length,0);
});

test('Save prompt downloads a plain scene as text and reports megapixel errors without starting a download',async t=>{
 const state=createState();state.scene='A quiet garden at dusk.\nSoft blue light.';const h=await setup(t,state),before=structuredClone(h.editor.state),downloads=[],revoked=[];let blob,creates=0;h.window.URL.createObjectURL=value=>{blob=value;creates++;return'blob:moss-scene-download';};h.window.URL.revokeObjectURL=value=>revoked.push(value);h.window.HTMLAnchorElement.prototype.click=function(){downloads.push({href:this.href,name:this.download});};
 h.click('save-prompt');await h.flush();assert.equal(creates,1);assert.equal(await blob.text(),state.scene);assert.deepEqual(downloads,[{href:'blob:moss-scene-download',name:'moss-image-prompt.txt'}]);assert.deepEqual(revoked,['blob:moss-scene-download']);assert.equal(h.query('a[download]'),null);assert.deepEqual(h.editor.state,before);assert.equal(h.writes.length,0);assert.equal(h.editor.undo.length,0);
 h.adapter.megapixels=()=>{throw new Error('Generation megapixels unavailable.');};h.click('save-prompt');await h.flush();assert.equal(creates,1);assert.equal(downloads.length,1);assert.equal(h.query('.feedback').hidden,false);assert.match(h.query('.feedback').textContent,/Generation megapixels unavailable/);assert.deepEqual(h.editor.state,before);assert.equal(h.writes.length,0);assert.equal(h.editor.undo.length,0);
});

test('workspace fills the viewport with generation controls and a route back to the workflow',async t=>{
 const h=await setup(t,oneBox(),undefined,{workspace:true});assert.equal(h.editor.workspace,true);assert.equal(h.editor.dialog.classList.contains('workspace'),true);assert.equal(h.query('form[method="dialog"] button').textContent,'Back to workflow');assert.ok(h.query('.generation-bar [data-action="generate"]'));assert.match(h.query('[data-action="generate"]').textContent,/Generate/);assert.equal(h.query('.generation-status').getAttribute('role'),'status');assert.equal(h.query('.generation-status').getAttribute('aria-busy'),'false');assert.ok(h.query('.canvas-column'));assert.ok(h.query('.sidebar'));
 h.editor.dialog.close();h.adapter.workspace=false;const ordinary=await h.open();assert.equal(ordinary.workspace,false);assert.equal(ordinary.dialog.classList.contains('workspace'),false);assert.equal(ordinary.root.querySelector('.generation-bar'),null);assert.equal(ordinary.root.querySelector('form[method="dialog"] button').textContent,'Done');
});

test('Generate finishes folder naming and saves current edits before queueing',async t=>{
 const state=folderState(),h=await setup(t,state,undefined,{workspace:true});h.editor.startGroupRename(state.groups[0].id);const name=h.query('[data-group-name]');name.value='';name.dispatchEvent(new h.window.Event('input',{bubbles:true,composed:true}));h.editor.state.scene='Latest scene before generation.';let queued;
 h.adapter.generate=()=>{assert.equal(h.editor.renameSession,null);assert.equal(h.query('[data-group-name]'),null);queued=h.saved;return true;};h.writes.length=0;h.click('generate');await h.flush();
 assert.equal(h.writes.length,2);assert.equal(queued.scene,'Latest scene before generation.');assert.equal(queued.groups[0].name,state.groups[0].name);assert.deepEqual(queued.regions,state.regions);assert.equal(h.editor.dialog.open,true);assert.match(h.query('.generation-status').textContent,/Queued/);
});

test('Generate discards unfinished canvas drags before saving the queued layout',async t=>{
 const h=await setup(t,oneBox(),undefined,{workspace:true}),before=structuredClone(h.editor.state);let queued;h.adapter.generate=()=>{queued=h.saved;assert.equal(h.editor.drag,null);return true;};h.pointer('pointerdown',.3,.3);h.pointer('pointermove',.4,.4);assert.notDeepEqual(h.editor.state.regions,before.regions);
 h.click('generate');await h.flush();assert.deepEqual(queued,before);assert.deepEqual(h.editor.state,before);assert.equal(h.writes.length,1);assert.equal(h.editor.undo.length,0);assert.equal(h.editor.board.hasPointerCapture(7),false);
});

test('workspace Ctrl+Enter commits a pending aspect ratio and refuses invalid ratios before queueing',async t=>{
 const h=await setup(t,oneBox(),undefined,{workspace:true});let queued=[];h.adapter.generate=()=>{queued.push(h.saved);return true;};const ratio=h.input('aspect_ratio','37:19');assert.notEqual(h.editor.state.width/h.editor.state.height,37/19);h.key('Enter',{ctrlKey:true},ratio);await h.flush();assert.equal(queued.length,1);assert.equal(queued[0].width/queued[0].height,37/19);assert.equal(h.editor.state.width/h.editor.state.height,37/19);const before=structuredClone(h.saved),writes=h.writes.length;
 h.input('aspect_ratio','bad ratio');h.key('Enter',{ctrlKey:true},ratio);await h.flush();assert.equal(queued.length,1);assert.equal(ratio.validity.valid,false);assert.deepEqual(h.saved,before);assert.equal(h.writes.length,writes);assert.equal(h.query('[data-action="generate"]').disabled,false);assert.match(h.query('.generation-status').textContent,/ratio/i);assert.equal(h.query('.feedback').hidden,false);
 h.input('aspect_ratio','1:1');h.key('Enter',{ctrlKey:true},ratio);await h.flush();assert.equal(queued.length,2);assert.equal(queued[1].width,queued[1].height);assert.equal(ratio.validity.valid,true);
});

test('Generate blocks duplicate submissions, allows another queue afterward and preserves fast execution status',async t=>{
 const h=await setup(t,oneBox(),undefined,{workspace:true});let queues=0,resolveQueue;h.adapter.generate=()=>{queues++;return new Promise(resolve=>{resolveQueue=resolve;});};const button=h.query('[data-action="generate"]'),status=h.query('.generation-status');
 h.click('generate');h.click('generate');h.key('Enter',{ctrlKey:true},h.query('[data-field="caption"]'));assert.equal(queues,1);assert.equal(button.disabled,true);assert.equal(button.getAttribute('aria-busy'),'true');assert.equal(status.textContent,'Queueing…');assert.equal(status.getAttribute('aria-busy'),'true');
 h.editor.setGenerationStatus('Generating step 1 of 4',{busy:true});resolveQueue(true);await h.flush();assert.equal(button.disabled,false);assert.equal(button.getAttribute('aria-busy'),'false');assert.equal(status.textContent,'Generating step 1 of 4');assert.equal(status.getAttribute('aria-busy'),'true');h.click('generate');assert.equal(queues,2);resolveQueue(true);await h.flush();assert.equal(button.disabled,false);assert.match(status.textContent,/Queued/);
});

test('queue failures appear inline and Generate recovers for another attempt',async t=>{
 for(const result of ['false','error'])await t.test(result,async t=>{
  const h=await setup(t,oneBox(),undefined,{workspace:true});h.adapter.generate=async()=>{if(result==='error')throw new Error('Missing checkpoint input.');return false;};h.click('generate');await h.flush();const status=h.query('.generation-status'),button=h.query('[data-action="generate"]');assert.match(status.textContent,result==='error'?/Missing checkpoint input/:/Could not queue/);assert.equal(status.getAttribute('aria-busy'),'false');assert.equal(h.query('.feedback').hidden,false);assert.equal(h.query('.feedback').textContent,status.textContent);assert.equal(button.disabled,false);assert.equal(h.editor.generationSubmitting,false);let queues=0;h.adapter.generate=async()=>{queues++;return true;};h.click('generate');await h.flush();assert.equal(queues,1);assert.equal(button.disabled,false);assert.match(status.textContent,/Queued/);
 });
});

test('workspace Ctrl+Enter generates from text fields without repeating or leaking into graph shortcuts',async t=>{
 const h=await setup(t,oneBox(),undefined,{workspace:true});let queues=0,leaked=0;h.adapter.generate=async()=>{queues++;return true;};h.window.document.addEventListener('keydown',()=>leaked++,true);const caption=h.query('[data-field="caption"]');
 assert.equal(h.key('Enter',{},caption).defaultPrevented,true);assert.equal(h.editor.root.activeElement,h.editor.viewport);assert.equal(queues,0);assert.equal(h.key('Enter',{ctrlKey:true},caption).defaultPrevented,true);assert.equal(queues,1);await h.flush();assert.equal(h.key('Enter',{ctrlKey:true,repeat:true},caption).defaultPrevented,true);assert.equal(queues,1);assert.equal(h.key('Enter',{metaKey:true},h.query('[data-field="scene"]')).defaultPrevented,true);assert.equal(queues,2);assert.equal(leaked,0);await h.flush();
 h.editor.dialog.close();h.adapter.workspace=false;const ordinary=await h.open(),field=ordinary.root.querySelector('[data-field="caption"]');field.dispatchEvent(new h.window.KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true,composed:true,cancelable:true}));await h.flush();assert.equal(queues,2);assert.equal(leaked,0);
});
