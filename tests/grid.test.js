import assert from 'node:assert/strict';
import test from 'node:test';
import {snapPoint,snapBox,snapMove,snapResize} from '../web/grid.js';
import {createState,resolveDimensions} from '../web/state.js';
import {moveRegions,resizeRegions,selectionBounds} from '../web/groups.js';

const dimensions={width:1424,height:736};
const normalized=values=>values.map((value,index)=>value/(index%2?dimensions.height:dimensions.width));
const pixels=values=>values.map((value,index)=>Number((value*(index%2?dimensions.height:dimensions.width)).toFixed(8)));
const region=(id,box)=>({id,bbox:normalized(box),caption:id,label:'object'});

test('uses resolved generation dimensions for a custom 37:19 ratio at 1 MP',()=>{
 assert.deepEqual(resolveDimensions({...createState(),width:37,height:19},1),dimensions);
 assert.deepEqual(pixels(snapPoint(normalized([17,47]),dimensions)),[16,48]);
 assert.deepEqual(pixels(snapPoint([.5,.5],dimensions)),[720,368]);
 // An odd number of 16px columns has its central grid lines 8px from the center.
 assert.equal(pixels(snapPoint([.5,.5],dimensions))[0]-dimensions.width/2,8);
});
test('point snapping is anchored at the top left and clamps to canvas edges',()=>{
 assert.deepEqual(snapPoint([-4,5],dimensions),[0,1]);
 assert.deepEqual(snapPoint([0,0],dimensions),[0,0]);
 assert.deepEqual(snapPoint([1,1],dimensions),[1,1]);
 assert.deepEqual(pixels(snapPoint(normalized([7,9]),dimensions,8)),[8,8]);
});
test('new boxes snap all edges and keep at least one cell of area',()=>{
 const original=normalized([17,18,34,47]);
 assert.deepEqual(pixels(snapBox(original,dimensions)),[16,16,32,48]);
 assert.deepEqual(pixels(original),[17,18,34,47]);
 assert.deepEqual(pixels(snapBox(normalized([18,18,19,19]),dimensions)),[16,16,32,32]);
 assert.deepEqual(pixels(snapBox(normalized([1423.5,735.5,1424,736]),dimensions)),[1408,720,1424,736]);
 assert.deepEqual(snapBox([.3,.3,.4,.4],{width:16,height:16}),[0,0,1,1]);
});
test('moving a selection snaps its origin once and preserves off-grid member spacing',()=>{
 const state={regions:[region('cup',[3,7,100,150]),region('plate',[191,87,251,197]),region('untouched',[400,400,410,410])]};
 const before=structuredClone(state),selected=new Set(['cup','plate']);
 const delta=snapMove(state,selected,20/dimensions.width,40/dimensions.height,dimensions);
 assert.deepEqual(state,before);
 assert.deepEqual(pixels(delta),[13,41]);
 moveRegions(state,selected,...delta);
 assert.deepEqual(pixels(state.regions[0].bbox),[16,48,113,191]);
 assert.deepEqual(pixels(state.regions[1].bbox),[204,128,264,238]);
 assert.deepEqual(state.regions[2],before.regions[2]);
 assert.equal(pixels(state.regions[1].bbox)[0]-pixels(state.regions[0].bbox)[0],188);
});
test('shared movement stops at the canvas edge without changing group geometry',()=>{
 const state={regions:[region('cup',[3,7,100,150]),region('plate',[191,87,251,197])]};
 const delta=snapMove(state,['cup','plate'],10,10,dimensions);
 assert.deepEqual(pixels(delta),[1173,539]);moveRegions(state,['cup','plate'],...delta);
 assert.deepEqual(pixels(state.regions[0].bbox),[1176,546,1273,689]);
 assert.deepEqual(pixels(state.regions[1].bbox),[1364,626,1424,736]);
 const back=snapMove(state,['cup','plate'],-10,-10,dimensions);moveRegions(state,['cup','plate'],...back);
 assert.deepEqual(pixels(state.regions[0].bbox),[0,0,97,143]);
 assert.deepEqual(pixels(state.regions[1].bbox),[188,80,248,190]);
 assert.deepEqual(snapMove(state,[],1,1,dimensions),[0,0]);
});
test('resizing changes only active edges and preserves inactive imported coordinates exactly',()=>{
 const box=normalized([3,7,100,150]);
 for(const[handle,target,expected]of[
  ['e',[91,300],[3,7,96,150]],
  ['w',[99,300],[80,7,100,150]],
  ['n',[300,200],[3,128,100,150]],
  ['s',[300,8],[3,7,100,32]],
  ['nw',[99,200],[80,128,100,150]],
  ['ne',[4,200],[3,128,32,150]],
  ['sw',[99,8],[80,7,100,32]],
  ['se',[4,8],[3,7,32,32]],
 ]){
  const resized=snapResize(box,handle,normalized(target),dimensions);
  assert.deepEqual(pixels(resized),expected,handle);
  for(const[index,edge]of ['w','n','e','s'].entries())if(!handle.includes(edge))assert.equal(resized[index],box[index],`${handle}: inactive ${edge}`);
 }
 assert.deepEqual(pixels(box),[3,7,100,150]);
});
test('resize clamps out-of-bounds pointers, prevents flips and enforces one grid cell',()=>{
 const box=normalized([16,32,96,160]);
 assert.deepEqual(pixels(snapResize(box,'nw',[-10,-10],dimensions)),[0,0,96,160]);
 assert.deepEqual(pixels(snapResize(box,'se',[10,10],dimensions)),[16,32,1424,736]);
 assert.deepEqual(pixels(snapResize(box,'nw',[1,1],dimensions)),[80,144,96,160]);
 assert.deepEqual(pixels(snapResize(box,'se',[0,0],dimensions)),[16,32,32,48]);
});
test('an edge-pinned sub-cell import remains intact when no valid active edge exists',()=>{
 const box=normalized([3,4,12,14]);
 assert.deepEqual(snapResize(box,'nw',[0,0],dimensions),box);
 const opposite=normalized([1416,728,1420,732]);
 assert.deepEqual(snapResize(opposite,'se',[1,1],dimensions),opposite);
});
test('grid helpers reject invalid generation dimensions and spacing',()=>{
 for(const invalid of [{width:0,height:736},{width:1424,height:NaN},{}])assert.throws(()=>snapPoint([.5,.5],invalid),/positive/);
 assert.throws(()=>snapBox([.1,.1,.2,.2],dimensions,0),/positive/);
});


test('resizing several boxes snaps every transformed edge on the resolved generation grid',()=>{
 const state={regions:[region('cup',[16,32,80,96]),region('untouched',[400,400,416,416]),region('plate',[160,112,256,208])]};
 state.regions[0].tags=['ceramic'];state.regions[2].groupId='tableware';
 const untouched=structuredClone(state.regions[1]),ids=['plate','cup'];
 const bounds=selectionBounds(state,ids),target=normalized([32,48,384,304]);
 resizeRegions(state,ids,bounds,target,{snapBox:box=>snapBox(box,dimensions)});
 assert.deepEqual(pixels(state.regions[0].bbox),[32,48,128,144]);
 assert.deepEqual(pixels(state.regions[2].bbox),[240,160,384,304]);
 assert.deepEqual(state.regions.map(item=>item.id),['cup','untouched','plate']);
 assert.deepEqual(state.regions[0].tags,['ceramic']);
 assert.equal(state.regions[2].groupId,'tableware');
 assert.deepEqual(state.regions[1],untouched);
});

test('shrinking a selection to one grid cell keeps each member positive and within the canvas',()=>{
 const original={regions:[region('cup',[16,32,80,96]),region('plate',[160,112,256,208]),region('spoon',[92,70,100,77])]};
 const ids=['cup','plate','spoon'],bounds=selectionBounds(original,ids);
 for(const target of [[0,0,16,16],[1408,720,1424,736],[16,32,32,736],[0,0,1424,16]]){
  const state=structuredClone(original);
  resizeRegions(state,ids,bounds,normalized(target),{snapBox:box=>snapBox(box,dimensions)});
  for(const item of state.regions){
   const [left,top,right,bottom]=pixels(item.bbox);
   assert.ok(left>=0&&top>=0&&right<=dimensions.width&&bottom<=dimensions.height);
   assert.ok(right-left>=16&&bottom-top>=16);
   assert.ok([left,top,right,bottom].every(value=>value%16===0));
   assert.equal(item.caption,item.id);
  }
 }
});

test('aligned groups keep every edge aligned after repeated moves and shared boundary clamping',()=>{
 const state={regions:[region('cup',[16,32,80,96]),region('plate',[160,112,256,208])]};
 const original=structuredClone(state),ids=['cup','plate'];
 for(const[dx,dy]of[[13,37],[-5,17],[10000,10000],[-10000,-10000],[29,-12]]){
  const delta=snapMove(state,ids,dx/dimensions.width,dy/dimensions.height,dimensions);
  assert.ok(pixels(delta).every(value=>value%16===0));
  moveRegions(state,ids,...delta);
  for(const[index,item]of state.regions.entries()){
   const box=pixels(item.bbox),before=pixels(original.regions[index].bbox);
   assert.ok(box.every(value=>value%16===0));
   assert.equal(box[2]-box[0],before[2]-before[0]);
   assert.equal(box[3]-box[1],before[3]-before[1]);
   assert.ok(box[0]>=0&&box[1]>=0&&box[2]<=dimensions.width&&box[3]<=dimensions.height);
  }
  const cup=pixels(state.regions[0].bbox),plate=pixels(state.regions[1].bbox);
  assert.equal(plate[0]-cup[0],144);assert.equal(plate[1]-cup[1],80);
 }
});

test('relative snapped movement keeps all imported edge phases and uses one common grid delta',()=>{
 const state={regions:[region('cup',[3,7,100,150]),region('plate',[191,87,251,197]),region('untouched',[400,400,410,410])]};
 const before=structuredClone(state),ids=['cup','plate'];
 const delta=snapMove(state,ids,20/dimensions.width,40/dimensions.height,dimensions,16,{relative:true});
 assert.deepEqual(pixels(delta),[16,48]);
 assert.deepEqual(state,before);
 moveRegions(state,ids,...delta);
 assert.deepEqual(pixels(state.regions[0].bbox),[19,55,116,198]);
 assert.deepEqual(pixels(state.regions[1].bbox),[207,135,267,245]);
 assert.deepEqual(state.regions[2],before.regions[2]);
 for(const[index,item]of state.regions.slice(0,2).entries()){
  const box=pixels(item.bbox),original=pixels(before.regions[index].bbox);
  assert.deepEqual(box.map(value=>value%16),original.map(value=>value%16));
  assert.equal(box[2]-box[0],original[2]-original[0]);
  assert.equal(box[3]-box[1],original[3]-original[1]);
 }
});

test('relative group movement stops on a feasible whole step at both canvas edges',()=>{
 const state={regions:[region('cup',[3,7,100,150]),region('plate',[191,87,251,197])]};
 const ids=['cup','plate'],original=structuredClone(state);
 const forward=snapMove(state,ids,10,10,dimensions,16,{relative:true});
 assert.deepEqual(pixels(forward),[1168,528]);
 moveRegions(state,ids,...forward);
 assert.deepEqual(pixels(state.regions[0].bbox),[1171,535,1268,678]);
 assert.deepEqual(pixels(state.regions[1].bbox),[1359,615,1419,725]);
 assert.deepEqual(pixels(snapMove(state,ids,10,10,dimensions,16,{relative:true})),[0,0]);
 const backward=snapMove(state,ids,-10,-10,dimensions,16,{relative:true});
 assert.deepEqual(pixels(backward),[-1168,-528]);
 moveRegions(state,ids,...backward);
 assert.deepEqual(state.regions.map(item=>pixels(item.bbox)),original.regions.map(item=>pixels(item.bbox)));
 assert.deepEqual(pixels(snapMove(state,ids,-10,-10,dimensions,16,{relative:true})),[0,0]);
});

test('relative snapped movement honors an aligned canvas boundary without float rounding drift',()=>{
 const state={regions:[region('cup',[16,32,80,96]),region('plate',[160,112,256,208])]};
 const ids=['cup','plate'];
 for(let cycle=0;cycle<6;cycle++){
  const forward=snapMove(state,ids,10,10,dimensions,16,{relative:true});
  assert.ok(pixels(forward).every(value=>value%16===0));moveRegions(state,ids,...forward);
  assert.deepEqual(pixels(state.regions[1].bbox),[1328,640,1424,736]);
  const backward=snapMove(state,ids,-10,-10,dimensions,16,{relative:true});
  assert.ok(pixels(backward).every(value=>value%16===0));moveRegions(state,ids,...backward);
  assert.deepEqual(pixels(state.regions[0].bbox),[0,0,64,64]);
 }
});
