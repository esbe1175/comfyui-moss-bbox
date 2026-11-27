import assert from 'node:assert/strict';
import test from 'node:test';
import {Window} from 'happy-dom';
import {BBoxEditor} from '../web/editor.js';
import {addRegion,createState} from '../web/state.js';
import {listEntries} from '../web/list.js';

function boxes(count=3){
 const state=createState();
 for(let index=0;index<count;index++)addRegion(state,[.05+index*.2,.1,.2+index*.2,.4]).caption=`Box ${index+1}`;
 return state;
}

async function setup(t,state=boxes()){
 const window=new Window({url:'http://localhost:8188/',settings:{enableCSSFileLoading:false,enableImageFileLoading:false,handleDisabledFileLoadingAsSuccess:true}});
 const globals=new Map(['document','navigator','ResizeObserver','createImageBitmap'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 Object.defineProperties(globalThis,{
  document:{value:window.document,configurable:true},navigator:{value:window.navigator,configurable:true},
  ResizeObserver:{value:class{observe(){}disconnect(){}},configurable:true},
  createImageBitmap:{value:async()=>{throw new Error('Unexpected image decode');},configurable:true},
 });
 window.HTMLElement.prototype.scrollIntoView=function(){};
 window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new window.Event('close'));};
 const writes=[];let saved=JSON.stringify(state);
 const editor=new BBoxEditor({read:()=>saved,write:value=>{saved=value;writes.push(JSON.parse(value));},closed(){},getSnap:()=>false});
 const opening=editor.open();editor.root.querySelector('link').dispatchEvent(new window.Event('load'));await opening;
 t.after(async()=>{if(editor.host.isConnected)editor.dialog.close();await window.happyDOM.close();for(const[key,descriptor]of globals)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];});
 const query=selector=>editor.root.querySelector(selector);
 const dataTransfer={effectAllowed:'uninitialized',dropEffect:'none',values:new Map(),setData(type,value){this.values.set(type,value);},getData(type){return this.values.get(type)||'';},setDragImage(){}};
 const fire=(type,target,clientY=150)=>{assert.ok(target,`Missing ${type} event target`);const event=new window.Event(type,{bubbles:true,composed:true,cancelable:true});Object.defineProperties(event,{clientX:{value:50},clientY:{value:clientY},dataTransfer:{value:dataTransfer}});target.dispatchEvent(event);return event;};
 const row=id=>query(`.region[data-id="${id}"]`);
 const title=id=>query(`[data-drag-region="${id}"]`);
 const folder=id=>query(`[data-drag-folder="${id}"]`);
 let lastY=150;
 const hover=(target,portion=.5)=>{
  if(typeof target==='string')target=query(target);
  for(let element=target;element&&element!==query('.regions');element=element.parentElement)element.getBoundingClientRect=()=>({left:0,right:300,top:100,bottom:200,width:300,height:100});
  lastY=100+portion*100;return fire('dragover',target,lastY);
 };
 return{window,editor,writes,query,row,title,folder,fire,hover,start:id=>fire('dragstart',title(id)),drop:target=>fire('drop',typeof target==='string'?query(target):target,lastY),end:()=>fire('dragend',query('.regions')),order:()=>listEntries(editor.state).map(entry=>entry.id),get saved(){return JSON.parse(saved);}};
}

test('box type menu prefixes its choices with the shared category icons and replaces folder assignment',async t=>{
 const state=boxes();state.regions[1].label='text';state.regions[2].label='character';const h=await setup(t,state);const [first]=h.editor.state.regions;
 assert.equal(h.query('[data-field="groupId"]'),null);assert.equal(h.query('select[data-field="label"]'),null);
 const options=[...h.editor.root.querySelectorAll('[data-box-type]')];
 assert.deepEqual(new Set(options.map(option=>option.dataset.boxType)),new Set(['object','text','character']));
 for(const option of options){assert.equal(option.getAttribute('role'),'menuitemradio');assert.ok(option.querySelector('svg'),`Missing ${option.dataset.boxType} icon`);assert.equal(option.firstElementChild.tagName.toLowerCase(),'svg');assert.equal(option.querySelector('svg').innerHTML,h.query(`.region-category[data-category="${option.dataset.boxType}"] svg`).innerHTML);}
 const menu=options[0].closest('details'),summary=menu.querySelector('summary');
 assert.equal(summary.getAttribute('aria-label'),'Box type');assert.ok(summary.querySelector('svg'));assert.match(summary.textContent,/Object/);
 menu.open=true;h.query('[data-box-type="character"]').click();
 assert.equal(h.editor.state.regions.find(region=>region.id===first.id).label,'character');
 const selected=h.query('[data-box-type="character"]');assert.equal(selected.getAttribute('aria-checked'),'true');assert.equal(selected.closest('details').open,false);assert.match(selected.closest('details').querySelector('summary').textContent,/Character/);
});

test('drag hover keeps source ghosts in place and previews insertion without writing or changing history',async t=>{
 const h=await setup(t);const[first,second,third]=h.editor.state.regions;
 h.editor.selection=new Set([first.id,second.id]);h.editor.selected=second.id;h.editor.render();
 const source=h.row(first.id),otherSource=h.row(second.id),target=h.row(third.id),before=structuredClone(h.editor.state),nodes=[...h.query('.regions').children];
 assert.equal(h.title(first.id).getAttribute('draggable'),'true');h.start(first.id);
 assert.equal(source.classList.contains('drag-source'),true);assert.equal(otherSource.classList.contains('drag-source'),true);
 assert.equal(h.hover(target,.05).defaultPrevented,true);
 assert.ok(target.contains(h.query('[data-drop-position="before"]')));assert.match(h.query('.list-drop-hint').textContent,/before|above/i);
 assert.deepEqual(h.editor.state,before);assert.equal(h.writes.length,0);assert.equal(h.editor.undo.length,0);
 assert.equal(h.row(first.id),source);assert.equal(h.row(second.id),otherSource);assert.deepEqual([...h.query('.regions').children],nodes);
 h.hover(target,.5);assert.equal(h.query('[data-drop-position="before"]'),null);assert.ok(h.query('[data-drop-position="group"]'));assert.match(h.query('.list-drop-hint').textContent,/group|folder/i);
 h.end();assert.equal(h.query('.drag-source'),null);assert.equal(h.query('[data-drop-position]'),null);assert.ok(!h.query('.list-drop-hint')||h.query('.list-drop-hint').hidden);assert.deepEqual(h.editor.state,before);assert.equal(h.writes.length,0);
});

test('dragging a box to an edge reorders the list and one undo restores its original position',async t=>{
 const h=await setup(t);const[first,second,third]=h.editor.state.regions;const before=structuredClone(h.editor.state);
 h.start(third.id);h.hover(h.row(first.id),.05);h.drop(h.row(first.id));h.end();
 assert.deepEqual(h.order(),[third.id,first.id,second.id]);assert.deepEqual(h.saved.regions.map(region=>region.id),[third.id,first.id,second.id]);assert.equal(h.editor.selected,third.id);assert.equal(h.editor.undo.length,1);assert.equal(h.writes.length,1);assert.equal(h.query('.drag-source'),null);assert.equal(h.query('[data-drop-position]'),null);
 h.query('[data-action="undo"]').click();assert.deepEqual(h.editor.state,before);
 h.start(first.id);h.hover(h.row(third.id),.95);h.drop(h.row(third.id));h.end();assert.deepEqual(h.order(),[second.id,third.id,first.id]);
});

test('drop commits the last preview when list scrolling changes row hit zones before release',async t=>{
 const h=await setup(t);const[first,second,third]=h.editor.state.regions;const target=h.row(first.id);
 h.start(third.id);h.hover(target,.05);assert.ok(h.query('[data-drop-position="before"]'));
 target.getBoundingClientRect=()=>({left:0,right:300,top:55,bottom:155,width:300,height:100});
 h.drop(target);h.end();assert.deepEqual(h.order(),[third.id,first.id,second.id]);assert.equal(h.saved.groups.length,0);assert.equal(h.editor.undo.length,1);
});

test('dropping noncontiguous selected root boxes after a sibling gathers them in visual order',async t=>{
 const h=await setup(t,boxes(4));const[first,second,third,fourth]=h.editor.state.regions;
 h.editor.selection=new Set([fourth.id,second.id]);h.editor.selected=fourth.id;h.editor.render();
 h.start(second.id);h.hover(h.row(first.id),.95);h.drop(h.row(first.id));h.end();
 assert.deepEqual(h.order(),[first.id,second.id,fourth.id,third.id]);assert.deepEqual(h.saved.regions.map(region=>region.id),[first.id,second.id,fourth.id,third.id]);assert.equal(h.saved.groups.length,0);assert.deepEqual(new Set(h.editor.selectedIds()),new Set([second.id,fourth.id]));assert.equal(h.editor.undo.length,1);
});

test('dropping noncontiguous selected folder boxes after a sibling gathers them inside that folder',async t=>{
 const state=boxes(4),[first,second,third,fourth]=state.regions;state.groups=[{id:'folder',name:'Folder',collapsed:false}];for(const region of state.regions)region.groupId='folder';
 const h=await setup(t,state);h.editor.selection=new Set([fourth.id,second.id]);h.editor.selected=fourth.id;h.editor.render();
 h.start(second.id);h.hover(h.row(first.id),.95);h.drop(h.row(first.id));h.end();
 assert.deepEqual(h.saved.regions.map(region=>region.id),[first.id,second.id,fourth.id,third.id]);assert.ok(h.saved.regions.every(region=>region.groupId==='folder'));assert.deepEqual(h.order(),['folder']);assert.equal(h.saved.groups.length,1);assert.equal(h.editor.undo.length,1);
});

test('dropping a selected block inside a collapsed folder moves the block together and reveals it',async t=>{
 const state=boxes(4),[first,second,third,fourth]=state.regions;state.groups=[{id:'destination',name:'Destination',collapsed:true}];fourth.groupId='destination';
 const h=await setup(t,state);h.editor.selection=new Set([third.id,first.id]);h.editor.selected=third.id;h.editor.render();
 h.start(first.id);const target=h.folder('destination');assert.equal(target.getAttribute('draggable'),'true');h.hover(target,.5);
 assert.ok(h.query('[data-drop-position="inside"]'));assert.match(h.query('.list-drop-hint').textContent,/Destination/);
 assert.equal(h.editor.state.groups[0].collapsed,true);h.drop(target);h.end();
 assert.deepEqual(h.saved.regions.filter(region=>region.groupId==='destination').map(region=>region.id),[fourth.id,first.id,third.id]);assert.equal(h.saved.regions.find(region=>region.id===second.id).groupId,undefined);assert.equal(h.saved.groups[0].collapsed,false);assert.equal(h.query('.folder-boxes').hidden,false);assert.deepEqual(new Set(h.editor.selectedIds()),new Set([first.id,third.id]));assert.equal(h.editor.undo.length,1);
});

test('dropping onto the middle of a box creates one folder containing the target and dragged boxes',async t=>{
 const h=await setup(t);const[first,second,third]=h.editor.state.regions;const before=structuredClone(h.editor.state);
 h.start(third.id);h.hover(h.row(first.id),.5);assert.ok(h.query('[data-drop-position="group"]'));h.drop(h.row(first.id));h.end();
 assert.equal(h.saved.groups.length,1);const group=h.saved.groups[0];assert.equal(group.collapsed,false);assert.deepEqual(h.saved.regions.filter(region=>region.groupId===group.id).map(region=>region.id),[first.id,third.id]);assert.equal(h.saved.regions.find(region=>region.id===second.id).groupId,undefined);assert.deepEqual(h.order(),[group.id,second.id]);assert.equal(h.editor.undo.length,1);
 h.query('[data-action="undo"]').click();assert.deepEqual(h.editor.state,before);
});

test('root drop area removes folder membership and appends dragged boxes at the top level',async t=>{
 const state=boxes(),[first,second,third]=state.regions;state.groups=[{id:'folder',name:'Folder',collapsed:false}];first.groupId='folder';second.groupId='folder';
 const h=await setup(t,state);h.start(first.id);const rootTarget=h.query('.list-root-drop');assert.ok(rootTarget);h.hover(rootTarget,.5);h.drop(rootTarget);h.end();
 assert.deepEqual(h.order(),['folder',third.id,first.id]);assert.equal(h.saved.regions.find(region=>region.id===first.id).groupId,undefined);assert.equal(h.saved.regions.find(region=>region.id===second.id).groupId,'folder');assert.equal(h.saved.groups.length,1);
});

test('folder dragging reorders whole folders without nesting or changing their members',async t=>{
 const state=boxes(),[first,second,third]=state.regions;state.groups=[{id:'first-folder',name:'First',collapsed:false},{id:'second-folder',name:'Second',collapsed:false}];first.groupId='first-folder';second.groupId='second-folder';
 const h=await setup(t,state);h.fire('dragstart',h.folder('second-folder'));h.hover(h.folder('first-folder'),.05);assert.ok(h.query('[data-drop-position="before"]'));h.drop(h.folder('first-folder'));h.end();
 assert.deepEqual(h.order(),['second-folder','first-folder',third.id]);assert.deepEqual(h.saved.groups.map(group=>group.id),['second-folder','first-folder']);assert.equal(h.saved.regions.find(region=>region.id===first.id).groupId,'first-folder');assert.equal(h.saved.regions.find(region=>region.id===second.id).groupId,'second-folder');assert.equal(h.saved.groups.length,2);assert.equal(h.editor.undo.length,1);
});

test('tool shortcuts remain visible and the type menu handles keyboard focus without firing box shortcuts',async t=>{
 const h=await setup(t);assert.deepEqual([...h.editor.root.querySelectorAll('.mode-tools kbd')].map(key=>key.textContent),['V','R']);
 const key=(target,value,options={})=>{target.focus();const event=new h.window.KeyboardEvent('keydown',{key:value,bubbles:true,composed:true,cancelable:true,...options});target.dispatchEvent(event);return event;};
 let menu=h.query('.type-selector'),summary=menu.querySelector('summary');const choices=[...menu.querySelectorAll('[data-box-type]')];
 assert.equal(key(summary,'ArrowDown').defaultPrevented,true);assert.equal(menu.open,true);assert.equal(h.editor.root.activeElement,choices[0]);
 key(choices[0],'ArrowDown');assert.equal(h.editor.root.activeElement,choices[1]);
 const count=h.editor.state.regions.length;key(choices[1],'Delete');key(choices[1],'d',{ctrlKey:true});assert.equal(h.editor.state.regions.length,count);assert.equal(h.editor.drawArmed,false);
 key(choices[1],'Enter');choices[1].click();assert.equal(h.editor.state.regions[0].label,choices[1].dataset.boxType);
 menu=h.query('.type-selector');summary=menu.querySelector('summary');menu.open=true;h.editor.setTool('draw');key(menu.querySelector('[data-box-type]'),'Escape');assert.equal(menu.open,false);assert.equal(h.editor.root.activeElement,h.editor.viewport);assert.equal(h.editor.drawArmed,true);assert.equal(h.editor.state.regions.length,count);
 menu.open=true;key(summary,'v');assert.equal(menu.open,false);assert.equal(h.editor.drawArmed,false);assert.equal(h.editor.root.activeElement,h.editor.viewport);
 menu.open=true;key(menu.querySelector('[data-box-type]'),'r');assert.equal(menu.open,false);assert.equal(h.editor.drawArmed,true);assert.equal(h.editor.root.activeElement,h.editor.viewport);
});
