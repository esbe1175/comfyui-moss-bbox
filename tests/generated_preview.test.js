import assert from 'node:assert/strict';
import test from 'node:test';
import {downstreamImageNodes, generatedImageReference, GeneratedPreviewFollower} from '../web/generated_preview.js';

const output=(filename='final_0001.png',type='output')=>({images:[{filename,subfolder:'MOSS',type}]});
const reference=filename=>({name:filename,subfolder:'MOSS',type:'output'});
function graphFixture(){
 const bbox={id:6,type:'MOSSBBoxStudio',outputs:[{links:[1]}]};
 const pipeline={id:2,type:'moss-subgraph',outputs:[{links:[2]},{links:[3]}]};
 const save={id:3,type:'SaveImage',outputs:[]},control={id:4,type:'PreviewImage',outputs:[]},unrelated={id:9,type:'SaveImage',outputs:[]};
 const graph={id:'workflow-A',nodes:[bbox,pipeline,save,control,unrelated],links:{1:{target_id:2},2:{target_id:3},3:{target_id:4}}};
 for(const node of graph.nodes)node.graph=graph;
 return{graph,bbox,pipeline,save,control,unrelated};
}
function followerFixture(options={}){
 const fixture=graphFixture(),applied=[],errors=[],loads=[],outputs={};let graph=fixture.graph;
 const follower=new GeneratedPreviewFollower({
  node:fixture.bbox,getGraph:()=>graph,getOutputs:()=>outputs,
  loadImage:async image=>{loads.push(image);if(options.loadImage)await options.loadImage(image);},
  applyImage:image=>applied.push(image),onError:error=>errors.push(error.message),
 });
 const execute=(name='final_0001.png',node=fixture.save,promptId='job-A',verifiedNode=node)=>follower.executed({node:String(node.id),output:output(name),prompt_id:promptId},verifiedNode);
 return{...fixture,follower,applied,errors,loads,outputs,execute,setGraph:value=>graph=value};
}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}

test('follows the connected final branch and ignores control and unrelated previews',()=>{
 const{graph,bbox,save}=graphFixture();assert.deepEqual(downstreamImageNodes(graph,bbox).map(entry=>entry.node),[save]);
});
test('falls back to a connected PreviewImage without a connected active SaveImage',()=>{
 const{graph,bbox,save,control}=graphFixture();save.mode=2;
 assert.deepEqual(downstreamImageNodes(graph,bbox).map(entry=>entry.node),[control]);
});
test('resolves nested execution IDs and graph links stored as a Map',()=>{
 const{graph,bbox,pipeline,save}=graphFixture();graph.nodes=graph.nodes.filter(node=>node!==save);
 const internal={id:3,type:'SaveImage',outputs:[]};pipeline.subgraph={id:'subgraph',nodes:[internal],links:new Map()};
 graph.links=new Map(Object.entries(graph.links).map(([key,value])=>[Number(key),value]));
 assert.deepEqual(downstreamImageNodes(graph,bbox).map(entry=>entry.id),['2:3']);
 assert.deepEqual(downstreamImageNodes(graph,internal).map(entry=>entry.node),[internal]);
});
test('does not confuse output IDs in separate instances of a shared subgraph',()=>{
 const{graph,bbox,pipeline}=graphFixture();const saved={id:3,type:'SaveImage',outputs:[]};
 pipeline.subgraph={id:'shared',nodes:[saved],links:{}};graph.nodes.push({id:20,type:'moss-subgraph',subgraph:pipeline.subgraph,outputs:[]});
 assert.deepEqual(downstreamImageNodes(graph,bbox).map(entry=>entry.id),['3','2:3']);
});
test('accepts local generated references and chooses the last batch image',()=>{
 assert.deepEqual(generatedImageReference({images:[...output('first.png').images,...output('last.png').images]}),reference('last.png'));
 for(const image of [
  {filename:'https://other/image.png',type:'output'},
  {filename:'image.png',type:'input'},
  {filename:'image.png',type:'output',subfolder:'../secret'},
  {filename:'image.png',type:'output',subfolder:'C:/secret'},
  {filename:'../image.png',type:'output'},
 ])assert.equal(generatedImageReference({images:[image]}),null);
 assert.equal(generatedImageReference({images:{bad:true}}),null);
});
test('changes reference only after the workflow successfully finishes',async()=>{
 const h=followerFixture();await h.follower.setEnabled(true);h.follower.start('job-A');h.execute();
 assert.deepEqual(h.applied,[]);await h.follower.finish('job-A',true);
 assert.deepEqual(h.applied,[reference('final_0001.png')]);
});
test('requires native workflow verification, connected output and current prompt ID',async()=>{
 const h=followerFixture();await h.follower.setEnabled(true);h.follower.start('job-A');
 h.execute('foreign.png',h.save,'job-A',null);h.execute('control.png',h.control);h.execute('unrelated.png',h.unrelated);h.execute('old.png',h.save,'job-old');
 await h.follower.finish('job-A',true);assert.deepEqual(h.applied,[]);
 h.execute('correct.png');await h.follower.finish('job-A',true);assert.deepEqual(h.applied,[reference('correct.png')]);
});
test('off preserves reference, and enabling uses the latest successful result',async()=>{
 const h=followerFixture();h.follower.start('job-A');h.execute();await h.follower.finish('job-A',true);assert.deepEqual(h.applied,[]);
 await h.follower.setEnabled(true);assert.deepEqual(h.applied,[reference('final_0001.png')]);
 await h.follower.setEnabled(false);h.follower.start('job-B');h.execute('second.png',h.save,'job-B');await h.follower.finish('job-B',true);
 assert.equal(h.applied.length,1);await h.follower.setEnabled(true);assert.deepEqual(h.applied.at(-1),reference('second.png'));
});
test('enabling immediately reuses an existing active workflow output',async()=>{
 const h=followerFixture();h.outputs['3']=output('already-generated.png');h.outputs['4']=output('control.png','temp');h.outputs['9']=output('unrelated.png');
 await h.follower.setEnabled(true);assert.deepEqual(h.applied,[reference('already-generated.png')]);
});
test('errors and interruptions do not apply or restore unsuccessful results',async()=>{
 const h=followerFixture();h.follower.start('job-A');h.execute('failed.png');h.outputs['3']=output('failed.png');
 await h.follower.finish('job-A',false);await h.follower.setEnabled(true);assert.deepEqual(h.applied,[]);
});
test('turning off or removing a node during image loading cancels its pending update',async()=>{
 for(const dispose of [false,true]){
  const load=deferred(),h=followerFixture({loadImage:()=>load.promise});h.outputs['3']=output();const pending=h.follower.setEnabled(true);
  if(dispose)h.follower.dispose();else await h.follower.setEnabled(false);
  load.resolve();await pending;assert.deepEqual(h.applied,[]);
 }
});
test('newer images win even if the earlier image finishes loading last',async()=>{
 const first=deferred(),second=deferred(),h=followerFixture({loadImage:image=>image.name==='first.png'?first.promise:second.promise});
 await h.follower.setEnabled(true);h.follower.start('job-A');h.execute('first.png');const previous=h.follower.finish('job-A',true);
 h.follower.start('job-B');h.execute('second.png',h.save,'job-B');const latest=h.follower.finish('job-B',true);
 second.resolve();await latest;first.resolve();await previous;assert.deepEqual(h.applied,[reference('second.png')]);
});
test('switching workflows during image loading discards the pending update',async()=>{
 const load=deferred(),h=followerFixture({loadImage:()=>load.promise});h.outputs['3']=output();const pending=h.follower.setEnabled(true);
 h.graph.id='workflow-B';load.resolve();await pending;assert.deepEqual(h.applied,[]);
});
test('unreadable image preserves reference and reports a short error',async()=>{
 const h=followerFixture({loadImage:async()=>{throw new Error('The latest image could not be loaded.');}});
 h.outputs['3']=output();await h.follower.setEnabled(true);assert.deepEqual(h.applied,[]);assert.deepEqual(h.errors,['The latest image could not be loaded.']);
});

test('native adapter persists toggle and keeps automatic images out of generation inputs',async t=>{
 const{readFile}=await import('node:fs/promises');
 const{pathToFileURL,fileURLToPath}=await import('node:url');
 const{dirname,resolve}=await import('node:path');
 const base=dirname(fileURLToPath(import.meta.url));
 const events=new EventTarget(),original={version:1,width:3,height:2,scene:'A seated woman.',image:null,regions:[{id:'box1',bbox:[.1,.1,.8,.9],caption:'A woman in red.'}],groups:[]};
 let graphChanges=0;
 const graph={id:'workflow-A',nodes:[],links:{1:{target_id:3}},beforeChange(){},afterChange(){graphChanges++;}};
 let extension;
 const app={rootGraph:graph,graph,nodeOutputs:{},registerExtension:value=>extension=value,extensionManager:{toast:{add:error=>assert.fail(error.detail)}}};
 const api={addEventListener:(...args)=>events.addEventListener(...args),apiURL:path=>path};
 const previous=new Map(['__mossPreviewApp','__mossPreviewApi','Image'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 const loaded=[];
 Object.defineProperties(globalThis,{
  __mossPreviewApp:{value:app,configurable:true},__mossPreviewApi:{value:api,configurable:true},
  Image:{value:class{set src(value){loaded.push(value);queueMicrotask(()=>this.onload());}},configurable:true},
 });
 t.after(()=>{for(const[key,value]of previous)if(value)Object.defineProperty(globalThis,key,value);else delete globalThis[key];});
 let source=await readFile(resolve(base,'../web/moss_bbox.js'),'utf8');
 source=source.replace("import {app} from '../../scripts/app.js';",'const app=globalThis.__mossPreviewApp;').replace("import {api} from '../../scripts/api.js';",'const api=globalThis.__mossPreviewApi;');
 for(const name of ['editor.js','state.js','generated_preview.js'])source=source.replace(`from './${name}'`,`from '${pathToFileURL(resolve(base,'../web',name)).href}'`);
 await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
 class SaveImageNode{}
 class BBoxNode{
  constructor(){this.id=6;this.type='MOSSBBoxStudio';this.graph=graph;this.properties={};this.size=[300,300];this.inputs=[];this.outputs=[{links:[1]}];this.widgets=[{name:'layout_json',value:JSON.stringify(original)}];this.onNodeCreated();}
  addWidget(type,name,value,callback,options){const widget={type,name,value,callback,options};this.widgets.push(widget);return widget;}
  addCustomWidget(widget){this.widgets.push(widget);return widget;}
  setDirtyCanvas(){} computeSize(){return[320,300];}setSize(size){this.size=size;}
 }
 await extension.beforeRegisterNodeDef(SaveImageNode,{name:'SaveImage'});
 await extension.beforeRegisterNodeDef(BBoxNode,{name:'MOSSBBoxStudio'});
 extension.setup();
 const node=new BBoxNode(),save=Object.assign(new SaveImageNode(),{id:3,type:'SaveImage',outputs:[],graph});graph.nodes=[node,save];
 const toggle=node.widgets.find(widget=>widget.name==='Follow latest image');
 assert.equal(toggle.serialize,false);assert.equal(toggle.options.serialize,false);assert.equal(node.properties.moss_bbox_follow_latest,false);
 toggle.callback(true);assert.equal(node.properties.moss_bbox_follow_latest,true);const changesBeforePreview=graphChanges;
 const dispatch=(type,detail)=>events.dispatchEvent(new CustomEvent(type,{detail}));
 dispatch('execution_start',{prompt_id:'job-A'});
 const foreign={prompt_id:'job-A',node:'3',output:output('foreign.png')};dispatch('executed',foreign);dispatch('execution_success',{prompt_id:'job-A'});
 await new Promise(setImmediate);assert.deepEqual(JSON.parse(node.widgets[0].value),original);
 const detail={prompt_id:'job-A',node:'3',output:output('generated.png')};save.onExecuted(detail.output);dispatch('executed',detail);
 await new Promise(setImmediate);assert.deepEqual(JSON.parse(node.widgets[0].value),original);
 dispatch('execution_success',{prompt_id:'job-A'});await new Promise(setImmediate);
 assert.deepEqual(JSON.parse(node.widgets[0].value),original);
 assert.deepEqual(node.properties.moss_bbox_latest_image,reference('generated.png'));assert.equal(graphChanges,changesBeforePreview);
 assert.match(loaded[0],/^\/view\?filename=generated\.png&subfolder=MOSS&type=output$/);
 node.properties.moss_bbox_follow_latest=false;node.onConfigure();assert.equal(toggle.value,false);
 node.onRemoved();
});
