import assert from 'node:assert/strict';
import test from 'node:test';
import {Window} from 'happy-dom';
import {BBoxEditor} from '../web/editor.js';
import {createState,addRegion} from '../web/state.js';

const rounded=value=>Math.round(value*1e8)/1e8;
async function setup(t,{box=false}={}){
 const window=new Window({url:'http://localhost:8188/',settings:{enableCSSFileLoading:false,enableImageFileLoading:false,handleDisabledFileLoadingAsSuccess:true}}),state={...createState(),width:2,height:1};
 if(box)addRegion(state,[.2,.2,.5,.6]).caption='A chair.';
 const previous=new Map(['document','navigator','ResizeObserver'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 Object.defineProperties(globalThis,{document:{value:window.document,configurable:true},navigator:{value:window.navigator,configurable:true},ResizeObserver:{value:class{observe(){}disconnect(){}},configurable:true}});
 window.HTMLElement.prototype.scrollIntoView=function(){};window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new window.Event('close'));};
 let writes=0;const editor=new BBoxEditor({read:()=>JSON.stringify(state),write:()=>writes++,getSnap:()=>false,imageURL:()=>''}),opening=editor.open();editor.root.querySelector('link').dispatchEvent(new window.Event('load'));await opening;
 Object.defineProperties(editor.viewport,{clientWidth:{value:1000},clientHeight:{value:600}});
 editor.viewport.getBoundingClientRect=()=>({left:10,top:20,width:1000,height:600,right:1010,bottom:620});
 editor.board.getBoundingClientRect=()=>({left:10+(1000-editor.boardWidth)/2+editor.panX,top:20+(600-editor.boardHeight)/2+editor.panY,width:editor.boardWidth,height:editor.boardHeight});
 for(const target of [editor.viewport,editor.board]){const captured=new Set();target.setPointerCapture=id=>captured.add(id);target.hasPointerCapture=id=>captured.has(id);target.releasePointerCapture=id=>captured.delete(id);}
 editor.fit();
 const query=selector=>editor.root.querySelector(selector),click=action=>query(`[data-action="${action}"]`).click();
 const pointer=(type,x,y,target=editor.board,options={})=>{const event=new window.PointerEvent(type,{bubbles:true,composed:true,cancelable:true,pointerId:7,button:0,buttons:type==='pointerup'?0:1,clientX:x,clientY:y,...options});target.dispatchEvent(event);return event;};
 const key=(value,target=editor.viewport,options={})=>{target.focus();const event=new window.KeyboardEvent('keydown',{key:value,bubbles:true,composed:true,cancelable:true,...options});target.dispatchEvent(event);return event;};
 const normalized=([x,y])=>{const r=editor.board.getBoundingClientRect();return[(x-r.left)/r.width,(y-r.top)/r.height].map(rounded);};
 t.after(async()=>{editor.close();await window.happyDOM.close();for(const[key,descriptor]of previous)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];});
 return{window,editor,query,click,pointer,key,normalized,get writes(){return writes;}};
}

test('ordinary wheel zoom anchors the image point and stays inside the modal canvas',async t=>{
 const h=await setup(t),point=[325,217],before=h.normalized(point);let leaked=0;h.window.document.addEventListener('wheel',()=>leaked++,true);
 const wheel=new h.window.WheelEvent('wheel',{bubbles:true,composed:true,cancelable:true,deltaY:-100,clientX:point[0],clientY:point[1]});Object.assign(wheel,{clientX:point[0],clientY:point[1]});h.editor.viewport.dispatchEvent(wheel);
 assert.equal(wheel.defaultPrevented,true);assert.equal(leaked,0);assert.equal(h.editor.zoom,1.15);assert.deepEqual(h.normalized(point),before);assert.ok(h.editor.viewport.classList.contains('zooming-in'));
 const zoom=h.editor.zoom,sidebarWheel=new h.window.WheelEvent('wheel',{bubbles:true,composed:true,cancelable:true,deltaY:100});h.query('.regions').dispatchEvent(sidebarWheel);assert.equal(sidebarWheel.defaultPrevented,false);assert.equal(h.editor.zoom,zoom);
 h.editor.dialog.close();const external=new h.window.WheelEvent('wheel',{bubbles:true,composed:true,cancelable:true,deltaY:100});h.window.document.body.dispatchEvent(external);assert.equal(external.defaultPrevented,false);assert.equal(leaked,2);assert.equal(h.writes,0);
});

test('zoom preserves panned coordinates crossing 100 percent and Fit recenters',async t=>{
 const h=await setup(t);h.editor.panX=100;h.editor.panY=-60;h.editor.applyPan();const target=[350,250],before=h.normalized(target);
 h.editor.setZoom(1.25,target);assert.deepEqual(h.normalized(target),before);h.editor.setZoom(1,target);assert.deepEqual(h.normalized(target),before);assert.equal(rounded(h.editor.panX),100);assert.equal(rounded(h.editor.panY),-60);
 h.click('fit');assert.equal(h.editor.zoom,1);assert.equal(h.editor.panX,0);assert.equal(h.editor.panY,0);assert.equal(h.query('.board-wrap').style.transform,'translate(0px, 0px)');assert.equal(h.writes,0);
});

test('MMB pan works at fit and at either boundary keeps a visible image corner',async t=>{
 const h=await setup(t,{box:true}),before=structuredClone(h.editor.state);const start=h.pointer('pointerdown',500,300,h.editor.board,{button:1,buttons:4});assert.equal(start.defaultPrevented,true);assert.ok(h.editor.pan);assert.ok(h.editor.viewport.classList.contains('panning'));assert.equal(h.editor.viewport.hasPointerCapture(7),true);
 h.pointer('pointermove',15000,15000);let r=h.editor.board.getBoundingClientRect();assert.equal(rounded(1010-r.left),48);assert.equal(rounded(620-r.top),48);
 h.pointer('pointermove',-15000,-15000);r=h.editor.board.getBoundingClientRect();assert.equal(rounded(r.left+r.width-10),48);assert.equal(rounded(r.top+r.height-20),48);
 h.pointer('pointerup',-15000,-15000,h.editor.board,{button:1});assert.equal(h.editor.pan,null);assert.equal(h.editor.viewport.hasPointerCapture(7),false);assert.equal(h.editor.viewport.classList.contains('panning'),false);assert.deepEqual(h.editor.state,before);assert.equal(h.writes,0);
 const aux=new h.window.MouseEvent('auxclick',{button:1,bubbles:true,cancelable:true});h.editor.viewport.dispatchEvent(aux);assert.equal(aux.defaultPrevented,true);
});

test('Space drag pans with selected boxes; typing fields keep native Space and tool letters',async t=>{
 const h=await setup(t,{box:true}),before=structuredClone(h.editor.state);h.key(' ',h.editor.viewport,{code:'Space'});assert.equal(h.editor.space,true);assert.ok(h.editor.viewport.classList.contains('can-pan'));
 h.pointer('pointerdown',500,300);assert.ok(h.editor.pan);assert.equal(h.editor.drag,undefined);h.pointer('pointermove',600,350);h.pointer('pointerup',600,350);assert.equal(h.editor.panX,100);assert.equal(h.editor.panY,50);
 h.editor.viewport.dispatchEvent(new h.window.KeyboardEvent('keyup',{key:' ',code:'Space',bubbles:true,composed:true}));assert.equal(h.editor.space,false);assert.equal(h.editor.viewport.classList.contains('can-pan'),false);
 assert.equal(h.editor.root.activeElement,h.editor.viewport);h.key('Enter');const caption=h.query('.caption');assert.equal(h.editor.root.activeElement,caption);assert.equal(h.key(' ',caption,{code:'Space'}).defaultPrevented,false);assert.equal(h.key('r',caption).defaultPrevented,false);assert.equal(h.editor.drawArmed,false);assert.deepEqual(h.editor.state,before);assert.equal(h.writes,0);assert.equal(h.key('Escape',caption).defaultPrevented,true);assert.equal(h.editor.root.activeElement,h.editor.viewport);
});

test('Draw returns to Select after each box, V and Escape select, Ctrl drag selects boxes',async t=>{
 const h=await setup(t);assert.equal(h.query('[data-action="select"]').getAttribute('aria-pressed'),'true');h.key('r');assert.equal(h.editor.drawArmed,true);assert.equal(h.query('[data-action="draw"]').getAttribute('aria-pressed'),'true');assert.ok(h.editor.board.classList.contains('draw-cursor'));assert.ok(h.editor.viewport.classList.contains('draw-tool'));h.pointer('pointermove',15,25,h.editor.viewport);assert.ok(h.editor.viewport.classList.contains('draw-tool'));
 for(let i=0;i<2;i++){if(i)h.key('r');const r=h.editor.board.getBoundingClientRect();h.pointer('pointerdown',r.left+r.width*.2,r.top+r.height*.2);h.pointer('pointermove',r.left+r.width*.5,r.top+r.height*.6);h.pointer('pointerup',r.left+r.width*.5,r.top+r.height*.6);assert.equal(h.editor.drawArmed,false);}
 assert.equal(h.editor.state.regions.length,2);h.key('v');assert.equal(h.editor.drawArmed,false);assert.equal(h.editor.board.classList.contains('draw-cursor'),false);assert.equal(h.editor.viewport.classList.contains('draw-tool'),false);assert.ok(h.editor.viewport.classList.contains('select-tool'));h.click('draw');h.key('Escape');assert.equal(h.editor.drawArmed,false);
 const r=h.editor.board.getBoundingClientRect();h.pointer('pointerdown',r.left+r.width*.1,r.top+r.height*.1,h.editor.board,{ctrlKey:true});h.pointer('pointermove',r.left+r.width*.9,r.top+r.height*.8,h.editor.board,{ctrlKey:true});h.pointer('pointerup',r.left+r.width*.9,r.top+r.height*.8,h.editor.board,{ctrlKey:true});assert.equal(h.editor.drawArmed,false);assert.equal(h.editor.state.regions.length,2);assert.equal(h.editor.selection.size,2);
});

test('finishing a box selects it and immediately allows handle resizing and moving without V',async t=>{
 const h=await setup(t);h.key('r');const r=h.editor.board.getBoundingClientRect(),point=(type,x,y,target=h.editor.board)=>h.pointer(type,r.left+r.width*x,r.top+r.height*y,target);
 point('pointerdown',.2,.2);point('pointermove',.5,.6);point('pointerup',.5,.6);
 const box=h.editor.state.regions[0],id=box.id;assert.deepEqual(box.bbox.map(rounded),[.2,.2,.5,.6]);assert.equal(h.editor.selected,id);assert.equal(h.editor.drawArmed,false);assert.equal(h.query('[data-action="select"]').getAttribute('aria-pressed'),'true');assert.equal(h.query('[data-action="draw"]').getAttribute('aria-pressed'),'false');assert.equal(h.editor.viewport.classList.contains('draw-tool'),false);assert.ok(h.editor.viewport.classList.contains('select-tool'));assert.equal(h.editor.root.activeElement,h.editor.viewport);assert.equal(h.editor.undo.length,1);assert.equal(h.writes,1);
 const handle=h.query('[data-handle="se"]');assert.ok(handle);point('pointerdown',.5,.6,handle);assert.equal(h.editor.drag.kind,'resize');point('pointermove',.65,.75);point('pointerup',.65,.75);assert.deepEqual(h.editor.state.regions[0].bbox.map(rounded),[.2,.2,.65,.75]);assert.equal(h.editor.state.regions.length,1);assert.equal(h.editor.selected,id);assert.equal(h.editor.root.activeElement,h.editor.viewport);
 point('pointerdown',.3,.35);assert.equal(h.editor.drag.kind,'move');point('pointermove',.4,.45);point('pointerup',.4,.45);assert.deepEqual(h.editor.state.regions[0].bbox.map(rounded),[.3,.3,.75,.85]);assert.equal(h.editor.state.regions.length,1);assert.equal(h.editor.selected,id);assert.equal(h.editor.undo.length,3);assert.equal(h.writes,3);
 h.click('undo');assert.deepEqual(h.editor.state.regions[0].bbox.map(rounded),[.2,.2,.65,.75]);h.click('undo');assert.deepEqual(h.editor.state.regions[0].bbox.map(rounded),[.2,.2,.5,.6]);h.click('undo');assert.equal(h.editor.state.regions.length,0);assert.equal(h.editor.undo.length,0);
});

test('tiny or pointer-cancelled Draw attempts retain Draw for another attempt',async t=>{
 const h=await setup(t);h.key('r');const r=h.editor.board.getBoundingClientRect(),point=(type,x,y)=>h.pointer(type,r.left+r.width*x,r.top+r.height*y);
 point('pointerdown',.2,.2);point('pointerup',.201,.201);assert.equal(h.editor.state.regions.length,0);assert.equal(h.editor.drawArmed,true);assert.ok(h.editor.viewport.classList.contains('draw-tool'));assert.equal(h.writes,0);assert.equal(h.editor.undo.length,0);
 point('pointerdown',.2,.2);point('pointermove',.5,.6);h.editor.board.dispatchEvent(new h.window.PointerEvent('pointercancel',{pointerId:7}));assert.equal(h.editor.state.regions.length,0);assert.equal(h.editor.drawArmed,true);assert.equal(h.editor.root.activeElement,h.editor.viewport);assert.equal(h.writes,0);assert.equal(h.editor.undo.length,0);
 point('pointerdown',.2,.2);point('pointermove',.5,.6);point('pointerup',.5,.6);assert.equal(h.editor.state.regions.length,1);assert.equal(h.editor.drawArmed,false);assert.equal(h.editor.undo.length,1);
});

test('pan cancellation and window blur clear transient cursors and preserve view state',async t=>{
 const h=await setup(t,{box:true});h.key('Control');assert.ok(h.editor.board.classList.contains('marquee-cursor'));h.key(' ',h.editor.viewport,{code:'Space'});h.pointer('pointerdown',500,300);h.pointer('pointermove',600,350);assert.ok(h.editor.pan);h.editor.showZoomCursor(true);
 h.window.dispatchEvent(new h.window.Event('blur'));assert.equal(h.editor.pan,null);assert.equal(h.editor.space,false);assert.equal(h.editor.marqueeArmed,false);assert.equal(h.editor.board.classList.contains('marquee-cursor'),false);assert.equal(h.editor.board.classList.contains('draw-cursor'),false);assert.equal(h.editor.viewport.classList.contains('panning'),false);assert.equal(h.editor.viewport.classList.contains('can-pan'),false);assert.equal(h.editor.viewport.classList.contains('zooming-in'),false);assert.equal(h.editor.viewport.hasPointerCapture(7),false);assert.equal(h.editor.panX,100);
});

test('Select keeps a normal hover cursor and active move or resize indicates the operation',async t=>{
 const h=await setup(t,{box:true}),r=h.editor.board.getBoundingClientRect(),x=r.left+r.width*.3,y=r.top+r.height*.3;h.pointer('pointermove',x,y);assert.equal(h.editor.board.style.cursor,'');assert.ok(h.editor.viewport.classList.contains('select-tool'));h.pointer('pointerdown',x,y);assert.equal(h.editor.board.style.cursor,'move');h.pointer('pointerup',x,y);
 h.pointer('pointerdown',r.left+r.width*.5,r.top+r.height*.6,h.query('[data-handle="se"]'));assert.equal(h.editor.board.style.cursor,'nwse-resize');h.editor.cancelDrag();h.pointer('pointermove',r.left+r.width*.9,r.top+r.height*.9);assert.equal(h.editor.board.style.cursor,'');
});

test('power button names describe its current on/off state and next action',async t=>{
 const h=await setup(t,{box:true});let control=h.query('[data-mute-box]');assert.match(control.title,/is on.*turn off/);assert.match(control.getAttribute('aria-label'),/^Turn off/);control.click();control=h.query('[data-mute-box]');assert.match(control.title,/is off.*turn on/);assert.match(control.getAttribute('aria-label'),/^Turn on/);assert.equal(control.getAttribute('aria-pressed'),'true');
});

test('zoom extremes retain part of the image and transformed drags edit normalized boxes',async t=>{
 const h=await setup(t,{box:true});for(const zoom of [.5,6]){h.editor.setZoom(zoom);h.editor.panX=1e6;h.editor.panY=-1e6;h.editor.applyPan();const r=h.editor.board.getBoundingClientRect();assert.equal(rounded(1010-r.left),48);assert.equal(rounded(r.top+r.height-20),48);}
 h.editor.resetView();h.editor.setZoom(2);h.editor.panX=180;h.editor.panY=90;h.editor.applyPan();let r=h.editor.board.getBoundingClientRect();
 const start=[r.left+r.width*.3,r.top+r.height*.3],end=[r.left+r.width*.4,r.top+r.height*.4];h.pointer('pointerdown',...start);h.pointer('pointermove',...end);h.pointer('pointerup',...end);assert.deepEqual(h.editor.state.regions[0].bbox.map(rounded),[.3,.3,.6,.7]);
 r=h.editor.board.getBoundingClientRect();h.pointer('pointerdown',r.left+r.width*.6,r.top+r.height*.7,h.query('[data-handle="se"]'));h.pointer('pointermove',r.left+r.width*.8,r.top+r.height*.9);h.pointer('pointerup',r.left+r.width*.8,r.top+r.height*.9);assert.deepEqual(h.editor.state.regions[0].bbox.map(rounded),[.3,.3,.8,.9]);assert.equal(h.writes,2);assert.equal(h.editor.panX,180);assert.equal(h.editor.panY,90);
});

test('Escape cancels a box in progress before returning to Select',async t=>{
 const h=await setup(t,{box:true}),before=structuredClone(h.editor.state);h.click('draw');const r=h.editor.board.getBoundingClientRect();h.pointer('pointerdown',r.left+r.width*.3,r.top+r.height*.3);h.pointer('pointermove',r.left+r.width*.7,r.top+r.height*.8);assert.ok(h.editor.drag);assert.equal(h.editor.state.regions.length,2);h.key('Escape');assert.equal(h.editor.drag,null);assert.equal(h.editor.drawArmed,false);assert.equal(h.editor.board.hasPointerCapture(7),false);assert.deepEqual(h.editor.state,before);assert.equal(h.writes,0);
});
