import assert from 'node:assert/strict';
import test from 'node:test';
import {Window} from 'happy-dom';
import {BBoxEditor} from '../web/editor.js';
import {addRegion,createState} from '../web/state.js';

function boxes(){
 const state=createState();addRegion(state,[.1,.1,.35,.4]).caption='A chair.';addRegion(state,[.55,.2,.8,.5]).caption='A table.';return state;
}

async function fixture(t,{state=boxes(),workspace=false}={}){
 const window=new Window({url:'http://localhost:8188/',settings:{enableCSSFileLoading:false,enableImageFileLoading:false,handleDisabledFileLoadingAsSuccess:true}});
 const previous=new Map(['document','navigator','ResizeObserver'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 Object.defineProperties(globalThis,{document:{value:window.document,configurable:true},navigator:{value:window.navigator,configurable:true},ResizeObserver:{value:class{observe(){}disconnect(){}},configurable:true}});
 window.HTMLElement.prototype.scrollIntoView=function(){};window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new window.Event('close'));};
 let saved=JSON.stringify(state);const writes=[],adapter={workspace,read:()=>saved,write:value=>{saved=value;writes.push(JSON.parse(value));},getSnap:()=>false,imageURL:()=>''};
 const editor=new BBoxEditor(adapter),opening=editor.open();editor.root.querySelector('link').dispatchEvent(new window.Event('load'));await opening;
 Object.defineProperties(editor.viewport,{clientWidth:{value:1200},clientHeight:{value:800}});editor.board.getBoundingClientRect=()=>({left:20,top:30,width:1000,height:500});editor.fit();
 for(const target of [editor.board,editor.viewport]){const captured=new Set();target.setPointerCapture=id=>captured.add(id);target.hasPointerCapture=id=>captured.has(id);target.releasePointerCapture=id=>captured.delete(id);}
 const query=selector=>editor.root.querySelector(selector);
 const pointer=(type,x,y,options={},target=editor.board)=>target.dispatchEvent(new window.PointerEvent(type,{bubbles:true,composed:true,cancelable:true,pointerId:7,button:0,buttons:type==='pointerup'?0:1,clientX:20+x*1000,clientY:30+y*500,...options}));
 const drag=(start,end,options={},target=editor.board)=>{pointer('pointerdown',...start,options,target);pointer('pointermove',...end,options);pointer('pointerup',...end,options);};
 const key=(key,options={},target=editor.root.activeElement||editor.viewport)=>{target.focus();const event=new window.KeyboardEvent('keydown',{key,bubbles:true,composed:true,cancelable:true,...options});target.dispatchEvent(event);return event;};
 const input=(field,value)=>{const element=query(`[data-field="${field}"]`);assert.ok(element,`Missing ${field} field`);element.focus();element.value=value;element.dispatchEvent(new window.Event('input',{bubbles:true,composed:true}));return element;};
 const paste=regions=>{const text=JSON.stringify({type:'moss-bbox-selection',version:1,regions}),event=new window.Event('paste',{bubbles:true,composed:true,cancelable:true});Object.defineProperty(event,'clipboardData',{value:{getData:type=>['application/x-moss-bbox+json','text/plain'].includes(type)?text:''}});editor.viewport.dispatchEvent(event);return event;};
 t.after(async()=>{editor.close();await window.happyDOM.close();for(const[key,descriptor]of previous)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];});
 return{window,editor,adapter,writes,query,pointer,drag,key,input,paste,get saved(){return JSON.parse(saved);}};
}

function assertCanvasFocus(h){assert.equal(h.editor.root.activeElement,h.editor.viewport);}
function assertEditFocus(h){const field=h.query('.primary .caption');assert.ok(field);assert.equal(h.editor.root.activeElement,field);assert.equal(field.selectionStart,field.value.length);assert.equal(field.selectionEnd,field.value.length);return field;}
function nativeText(h,field,text){field.setRangeText(text,field.selectionStart,field.selectionEnd,'end');field.dispatchEvent(new h.window.Event('input',{bubbles:true,composed:true}));}

test('opening a populated editor keeps the canvas ready for V and R until Enter starts description editing',async t=>{
 const h=await fixture(t),before=JSON.stringify(h.editor.state);assertCanvasFocus(h);h.key('r');assert.equal(h.editor.drawArmed,true);assertCanvasFocus(h);h.key('v');assert.equal(h.editor.drawArmed,false);assertCanvasFocus(h);
 const enter=h.key('Enter');assert.equal(enter.defaultPrevented,true);assertEditFocus(h);assert.equal(JSON.stringify(h.editor.state),before);assert.equal(h.writes.length,0);
});

test('opening an empty editor keeps tool shortcuts available and Enter without a selection does not edit scene',async t=>{
 const h=await fixture(t,{state:createState()});assertCanvasFocus(h);h.key('r');assert.equal(h.editor.drawArmed,true);h.key('v');assert.equal(h.editor.drawArmed,false);h.key('Enter');assertCanvasFocus(h);assert.equal(h.editor.selection.size,0);assert.equal(h.writes.length,0);
});

test('Enter requires one selected box and waits until an active canvas drag has ended',async t=>{
 const h=await fixture(t);h.editor.selectMany(h.editor.state.regions.map(region=>region.id),false);h.key('Enter');assertCanvasFocus(h);assert.equal(h.editor.selection.size,2);assert.equal(h.writes.length,0);
 h.editor.select(h.editor.state.regions[0].id,false);h.pointer('pointerdown',.25,.3);h.pointer('pointermove',.3,.35);const drag=h.editor.drag;assert.ok(drag);h.key('Enter');assert.equal(h.editor.drag,drag);assertCanvasFocus(h);assert.equal(h.writes.length,0);h.key('Escape');assertCanvasFocus(h);
});

test('Enter reveals the selected box inside a collapsed folder before focusing its description',async t=>{
 const state=boxes();state.groups=[{id:'furniture',name:'Furniture',collapsed:true}];state.regions[0].groupId='furniture';const h=await fixture(t,{state});assert.equal(h.query('.folder-boxes').hidden,true);
 h.key('Enter');assert.equal(h.query('.folder-boxes').hidden,false);assert.equal(assertEditFocus(h).value,'A chair.');assert.equal(h.writes.length,0);
});

test('drawing and adding boxes leave the canvas focused and Enter edits the new description',async t=>{
 const h=await fixture(t,{state:createState()});h.key('r');h.drag([.15,.2],[.45,.7]);assert.equal(h.editor.state.regions.length,1);assert.equal(h.editor.drawArmed,false);assertCanvasFocus(h);h.key('Enter');assertEditFocus(h);
 h.key('Enter');assertCanvasFocus(h);h.query('[data-action="add"]').click();assert.equal(h.editor.state.regions.length,2);assertCanvasFocus(h);h.key('r');assert.equal(h.editor.drawArmed,true);h.key('v');h.key('Enter');assert.equal(assertEditFocus(h).value,'');
});

test('canvas selection, overlap cycling and overlap menu choices retain canvas focus',async t=>{
 const state=boxes(),nested=addRegion(state,[.15,.15,.2,.2]);nested.caption='A cup.';const h=await fixture(t,{state});
 h.drag([.65,.3],[.65,.3]);assert.equal(h.editor.selected,state.regions[1].id);assertCanvasFocus(h);
 h.drag([.18,.18],[.18,.18],{altKey:true});assert.equal(h.editor.selected,nested.id);assertCanvasFocus(h);
 h.editor.board.dispatchEvent(new h.window.MouseEvent('contextmenu',{bubbles:true,composed:true,cancelable:true,clientX:200,clientY:120}));
 h.query(`[data-choose-box="${state.regions[0].id}"]`).click();assert.equal(h.editor.selected,state.regions[0].id);assertCanvasFocus(h);h.key('r');assert.equal(h.editor.drawArmed,true);h.key('v');h.key('Enter');assert.equal(assertEditFocus(h).value,'A chair.');assert.equal(h.writes.length,0);
});

test('canvas move, resize and cancelled changes return to canvas focus',async t=>{
 const h=await fixture(t);h.drag([.25,.3],[.35,.4]);assertCanvasFocus(h);h.drag([.45,.5],[.5,.6],{},h.query('[data-handle="se"]'));assertCanvasFocus(h);
 const before=JSON.stringify(h.editor.state);h.pointer('pointerdown',.3,.4);h.pointer('pointermove',.4,.5);h.key('Escape');assert.equal(h.editor.drag,null);assert.equal(JSON.stringify(h.editor.state),before);assertCanvasFocus(h);
 h.key('r');assert.equal(h.editor.drawArmed,true);h.key('v');assert.equal(h.editor.drawArmed,false);h.key('Enter');assert.equal(assertEditFocus(h).value,'A chair.');
});

test('keyboard duplicate and paste keep the canvas focused while explicit list selection opens description editing',async t=>{
 const h=await fixture(t),original=structuredClone(h.editor.state.regions[0]);h.key('d',{ctrlKey:true});assert.equal(h.editor.state.regions.length,3);assertCanvasFocus(h);h.key('r');assert.equal(h.editor.drawArmed,true);h.key('v');
 h.key('v',{ctrlKey:true});assert.equal(h.paste([original]).defaultPrevented,true);assert.equal(h.editor.state.regions.length,4);assertCanvasFocus(h);
 h.query(`[data-select="${h.editor.state.regions[1].id}"]`).click();assert.equal(assertEditFocus(h).value,'A table.');
});

test('Enter finishes caption and exact-text editing without adding a newline and Shift Enter preserves native newlines',async t=>{
 const state=boxes();state.regions[0].label='text';state.regions[0].text='Original wording';const h=await fixture(t,{state});
 for(const[field,value]of [['caption','A blue enamel sign.'],['text','Exact words to render']]){
  const textarea=h.input(field,value),writes=h.writes.length;textarea.setSelectionRange(4,4);const enter=h.key('Enter',{},textarea);
  assert.equal(enter.defaultPrevented,true);assertCanvasFocus(h);assert.equal(textarea.value,value);assert.equal(h.saved.regions[0][field],value);assert.equal(h.writes.length,writes);
  textarea.focus();textarea.setSelectionRange(value.length,value.length);const shiftEnter=h.key('Enter',{shiftKey:true},textarea);assert.equal(shiftEnter.defaultPrevented,false);assert.equal(h.editor.root.activeElement,textarea);nativeText(h,textarea,'\n');assert.equal(h.saved.regions[0][field],value+'\n');
 }
});

test('Escape finishes description editing while retaining saved text, active tool and the open editor',async t=>{
 const h=await fixture(t);h.key('r');h.key('Enter');const caption=h.input('caption','Updated chair description.');const writes=h.writes.length;
 const escape=h.key('Escape',{},caption);assert.equal(escape.defaultPrevented,true);assertCanvasFocus(h);assert.equal(h.editor.drawArmed,true);assert.equal(h.editor.dialog.open,true);assert.equal(h.saved.regions[0].caption,'Updated chair description.');assert.equal(h.writes.length,writes);
});

test('scene Enter and Escape finish editing with saved content while Shift Enter keeps multiline editing',async t=>{
 const h=await fixture(t);h.key('r');const scene=h.input('scene','A quiet room.');scene.setSelectionRange(scene.value.length,scene.value.length);const shiftEnter=h.key('Enter',{shiftKey:true},scene);assert.equal(shiftEnter.defaultPrevented,false);nativeText(h,scene,'\nWarm afternoon light.');const value=scene.value,writes=h.writes.length;
 const enter=h.key('Enter',{},scene);assert.equal(enter.defaultPrevented,true);assertCanvasFocus(h);assert.equal(h.saved.scene,value);assert.equal(h.writes.length,writes);assert.equal(h.editor.drawArmed,true);
 scene.focus();const escape=h.key('Escape',{},scene);assert.equal(escape.defaultPrevented,true);assertCanvasFocus(h);assert.equal(h.saved.scene,value);assert.equal(h.editor.dialog.open,true);assert.equal(h.editor.drawArmed,true);
});

test('arbitrary canvas typing never redirects to the description and V or R inside text stays native',async t=>{
 const h=await fixture(t),before=JSON.stringify(h.editor.state);for(const letter of ['x','!','a']){h.key(letter);assertCanvasFocus(h);}assert.equal(JSON.stringify(h.editor.state),before);assert.equal(h.writes.length,0);
 h.key('Enter');const caption=assertEditFocus(h);for(const letter of ['v','r']){const event=h.key(letter,{},caption);assert.equal(event.defaultPrevented,false);assert.equal(h.editor.drawArmed,false);assert.equal(h.editor.root.activeElement,caption);nativeText(h,caption,letter);}assert.equal(h.saved.regions[0].caption,'A chair.vr');
});

test('repeating Enter after starting editing cannot immediately finish or insert a newline',async t=>{
 const h=await fixture(t);h.key('Enter');const caption=assertEditFocus(h),before=caption.value;const repeated=h.key('Enter',{repeat:true},caption);assert.equal(repeated.defaultPrevented,true);assert.equal(h.editor.root.activeElement,caption);assert.equal(caption.value,before);assert.equal(h.writes.length,0);
});

test('IME Enter remains native in text and never starts or finishes description editing',async t=>{
 const h=await fixture(t);const composing=h.key('Enter',{isComposing:true});assert.equal(composing.defaultPrevented,false);assertCanvasFocus(h);h.key('Enter');const caption=assertEditFocus(h);
 const finishComposition=h.key('Enter',{isComposing:true},caption);assert.equal(finishComposition.defaultPrevented,false);assert.equal(h.editor.root.activeElement,caption);assert.equal(h.writes.length,0);
});

test('prompt import remains multiline and modified Enter never finishes description editing',async t=>{
 const h=await fixture(t);const caption=h.input('caption','A chair.');for(const modifier of ['ctrlKey','metaKey','altKey']){const event=h.key('Enter',{[modifier]:true},caption);assert.equal(event.defaultPrevented,false);assert.equal(h.editor.root.activeElement,caption);}
 h.query('.prompt-panel').hidden=false;const prompt=h.input('prompt_import','{');const enter=h.key('Enter',{},prompt);assert.equal(enter.defaultPrevented,false);assert.equal(h.editor.root.activeElement,prompt);nativeText(h,prompt,'\n');assert.equal(prompt.value,'{\n');
});

test('workspace Ctrl Enter still generates from description editing without finishing or repeating',async t=>{
 const h=await fixture(t,{workspace:true});let generated=0;h.adapter.generate=async()=>{generated++;return true;};const caption=h.input('caption','Ready for generation.');
 const enter=h.key('Enter',{ctrlKey:true},caption);assert.equal(enter.defaultPrevented,true);await Promise.resolve();assert.equal(generated,1);assert.equal(h.editor.root.activeElement,caption);assert.equal(h.saved.regions[0].caption,'Ready for generation.');
 const repeated=h.key('Enter',{ctrlKey:true,repeat:true},caption);assert.equal(repeated.defaultPrevented,true);assert.equal(generated,1);
});

test('workspace Ctrl Enter generates while the type selector has keyboard focus',async t=>{
 const h=await fixture(t,{workspace:true});let generated=0;h.adapter.generate=async()=>{generated++;return true;};
 const menu=h.query('.type-selector');menu.open=true;const option=menu.querySelector('[data-box-type]');
 const enter=h.key('Enter',{ctrlKey:true},option);assert.equal(enter.defaultPrevented,true);await Promise.resolve();assert.equal(generated,1);assert.equal(h.editor.state.regions.length,2);
 const repeated=h.key('Enter',{ctrlKey:true,repeat:true},option);assert.equal(repeated.defaultPrevented,true);assert.equal(generated,1);
});
