import assert from 'node:assert/strict';
import test from 'node:test';
import {Window} from 'happy-dom';
import {BBoxEditor} from '../web/editor.js';
import {addRegion,createState} from '../web/state.js';

async function fixture(t,{snap=false}={}){
 const window=new Window({url:'http://localhost:8188/',settings:{enableCSSFileLoading:false,enableImageFileLoading:false,handleDisabledFileLoadingAsSuccess:true}}),state=createState();
 const first=addRegion(state,[.1,.1,.3,.3]),second=addRegion(state,[.55,.35,.7,.5]),nested=addRegion(state,[.12,.12,.18,.18]),last=addRegion(state,[.8,.7,.95,.95]);
 const previous=new Map(['document','navigator','ResizeObserver'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 Object.defineProperties(globalThis,{document:{value:window.document,configurable:true},navigator:{value:window.navigator,configurable:true},ResizeObserver:{value:class{observe(){}disconnect(){}},configurable:true}});
 window.HTMLElement.prototype.scrollIntoView=function(){};window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new window.Event('close'));};
 const writes=[],editor=new BBoxEditor({read:()=>JSON.stringify(state),write:value=>writes.push(value),getSnap:()=>snap,imageURL:()=>''}),opening=editor.open();editor.root.querySelector('link').dispatchEvent(new window.Event('load'));await opening;
 Object.defineProperties(editor.viewport,{clientWidth:{value:1200},clientHeight:{value:800}});editor.board.getBoundingClientRect=()=>({left:20,top:30,width:1000,height:500});editor.fit();
 const captured=new Set();editor.board.setPointerCapture=id=>captured.add(id);editor.board.hasPointerCapture=id=>captured.has(id);editor.board.releasePointerCapture=id=>captured.delete(id);
 const query=selector=>editor.root.querySelector(selector);
 const pointer=(type,x,y,options={},target=editor.board)=>target.dispatchEvent(new window.PointerEvent(type,{bubbles:true,composed:true,cancelable:true,pointerId:7,button:0,buttons:type==='pointerup'?0:1,clientX:20+x*1000,clientY:30+y*500,...options}));
 const drag=(start,end,options={ctrlKey:true})=>{pointer('pointerdown',...start,options);pointer('pointermove',...end,options);pointer('pointerup',...end,options);};
 const key=(key,options={})=>{editor.viewport.focus();const event=new window.KeyboardEvent('keydown',{key,bubbles:true,composed:true,cancelable:true,...options});editor.viewport.dispatchEvent(event);return event;};
 t.after(async()=>{editor.close();await window.happyDOM.close();for(const[key,descriptor]of previous)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];});
 return{window,editor,writes,query,pointer,drag,key,first,second,nested,last};
}

test('Ctrl marquee selects every intersected box and replaces the previous selection without saving',async t=>{
 const h=await fixture(t),before=JSON.stringify(h.editor.state);h.editor.select(h.last.id,false);h.editor.redo.push('existing redo');
 h.pointer('pointerdown',.01,.02,{ctrlKey:true});h.pointer('pointermove',.61,.42,{ctrlKey:true});
 assert.deepEqual(h.editor.selectedIds(),[h.first.id,h.second.id,h.nested.id]);assert.ok(h.query('.selection-marquee'));assert.ok(h.query('.selection-frame'));assert.equal(h.query('.selection-count').textContent,'3 selected');
 h.pointer('pointerup',.61,.42,{ctrlKey:true});assert.equal(h.query('.selection-marquee'),null);assert.equal(h.editor.selected,h.nested.id);assert.equal(h.editor.root.activeElement,h.editor.viewport);assert.equal(h.editor.board.hasPointerCapture(7),false);
 assert.equal(JSON.stringify(h.editor.state),before);assert.equal(h.writes.length,0);assert.equal(h.editor.undo.length,0);assert.deepEqual(h.editor.redo,['existing redo']);
 h.drag([.4,.7],[.5,.9]);assert.equal(h.editor.selection.size,0);assert.equal(h.writes.length,0);
});

test('Ctrl marquee takes priority over Draw, handles and selected frames and ignores snap',async t=>{
 const h=await fixture(t,{snap:true}),before=JSON.stringify(h.editor.state);h.editor.setTool('draw');
 h.pointer('pointerdown',.013,.027,{ctrlKey:true},h.query('[data-handle="nw"]'));h.pointer('pointermove',.583,.431,{ctrlKey:true});
 const marquee=h.query('.selection-marquee');assert.equal(parseFloat(marquee.style.left),1.3);assert.equal(parseFloat(marquee.style.top),2.7);assert.ok(Math.abs(parseFloat(marquee.style.width)-57)<1e-8);assert.ok(Math.abs(parseFloat(marquee.style.height)-40.4)<1e-8);
 assert.equal(h.editor.drag.kind,'marquee');assert.equal(h.editor.state.regions.length,4);assert.equal(h.editor.board.classList.contains('draw-cursor'),false);assert.equal(h.editor.board.classList.contains('marquee-cursor'),true);
 h.pointer('pointerup',.583,.431,{ctrlKey:true});assert.equal(h.editor.drawArmed,true);assert.deepEqual(h.editor.selectedIds(),[h.first.id,h.second.id,h.nested.id]);
 h.pointer('pointerdown',.6,.4,{ctrlKey:true},h.query('[data-group-handle="se"]'));h.pointer('pointerup',.98,.98,{ctrlKey:true});assert.deepEqual(h.editor.selectedIds(),[h.second.id,h.last.id]);
 assert.equal(JSON.stringify(h.editor.state),before);assert.equal(h.writes.length,0);assert.equal(h.editor.undo.length,0);
});

test('Ctrl Shift marquee adds to the original selection and tracks a shrinking region',async t=>{
 const h=await fixture(t);h.editor.select(h.last.id,false);h.pointer('pointerdown',.01,.01,{ctrlKey:true,shiftKey:true});h.pointer('pointermove',.75,.6,{ctrlKey:true,shiftKey:true});
 assert.equal(h.editor.selection.size,4);h.pointer('pointermove',.2,.2,{ctrlKey:true,shiftKey:true});assert.deepEqual(new Set(h.editor.selectedIds()),new Set([h.first.id,h.nested.id,h.last.id]));
 h.pointer('pointerup',.2,.2,{ctrlKey:true,shiftKey:true});assert.equal(h.editor.selected,h.nested.id);assert.equal(h.writes.length,0);
});

test('Escape and pointer cancellation restore the original selection without changing content or history',async t=>{
 const h=await fixture(t),before=JSON.stringify(h.editor.state);h.editor.selectMany([h.second.id,h.last.id],false);const original=h.editor.selected;
 for(const cancel of [()=>h.key('Escape'),()=>h.editor.board.dispatchEvent(new h.window.PointerEvent('pointercancel',{pointerId:7})),()=>h.editor.board.dispatchEvent(new h.window.PointerEvent('lostpointercapture',{pointerId:7})),()=>h.window.dispatchEvent(new h.window.Event('blur'))]){
  h.pointer('pointerdown',.01,.01,{ctrlKey:true});h.pointer('pointermove',.2,.2,{ctrlKey:true});assert.deepEqual(h.editor.selectedIds(),[h.first.id,h.nested.id]);cancel();
  assert.equal(h.editor.drag,null);assert.deepEqual(h.editor.selectedIds(),[h.second.id,h.last.id]);assert.equal(h.editor.selected,original);assert.equal(h.query('.selection-marquee'),null);assert.equal(h.editor.board.hasPointerCapture(7),false);assert.equal(JSON.stringify(h.editor.state),before);assert.equal(h.writes.length,0);assert.equal(h.editor.undo.length,0);
 }
});

test('boxes selected by marquee move together using their selection frame',async t=>{
 const h=await fixture(t);h.drag([.05,.05],[.4,.4]);assert.deepEqual(h.editor.selectedIds(),[h.first.id,h.nested.id]);
 h.pointer('pointerdown',.2,.2,{},h.query('[data-drag-selection]'));h.pointer('pointermove',.3,.3);h.pointer('pointerup',.3,.3);
 const rounded=box=>box.map(value=>Math.round(value*1e8)/1e8);assert.deepEqual(rounded(h.editor.state.regions[0].bbox),[.2,.2,.4,.4]);assert.deepEqual(rounded(h.editor.state.regions[2].bbox),[.22,.22,.28,.28]);assert.deepEqual(h.editor.state.regions[1].bbox,h.second.bbox);assert.equal(h.writes.length,1);assert.equal(h.editor.undo.length,1);
});

test('Meta drag selects like Ctrl and key release restores the current tool cursor',async t=>{
 const h=await fixture(t);h.editor.setTool('draw');h.key('Meta',{metaKey:true});assert.ok(h.editor.board.classList.contains('marquee-cursor'));assert.equal(h.editor.board.classList.contains('draw-cursor'),false);
 h.drag([.75,.65],[.99,.99],{metaKey:true});assert.deepEqual(h.editor.selectedIds(),[h.last.id]);assert.equal(h.editor.state.regions.length,4);
 h.editor.viewport.dispatchEvent(new h.window.KeyboardEvent('keyup',{key:'Meta',bubbles:true,composed:true}));assert.equal(h.editor.marqueeArmed,false);assert.equal(h.editor.board.classList.contains('marquee-cursor'),false);assert.ok(h.editor.board.classList.contains('draw-cursor'));assert.equal(h.writes.length,0);
});
