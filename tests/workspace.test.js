import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {Window} from 'happy-dom';

const base=dirname(fileURLToPath(import.meta.url));
const flush=()=>new Promise(setImmediate);
const output=filename=>({images:[{filename,subfolder:'MOSS',type:'output'}]});
const reference=name=>({name,subfolder:'MOSS',type:'output'});
let fixtureId=0;

async function setup(t){
 const window=new Window({url:'http://localhost:8188/',settings:{enableCSSFileLoading:false,enableImageFileLoading:false,handleDisabledFileLoadingAsSuccess:true}});
 const events=new window.EventTarget(),loaded=[],queued=[],errors=[];
 const original={version:1,width:3,height:2,scene:'A seated woman.',image:null,regions:[{id:'box1',label:'character',bbox:[.1,.1,.8,.9],caption:'A woman in red.'}],groups:[]};
 const graph={id:'workflow-A',nodes:[],links:{1:{target_id:3}},beforeChange(){},afterChange(){}};
 let extension,node;
 const app={rootGraph:graph,graph,nodeOutputs:{},processingQueue:false,registerExtension:value=>extension=value,queuePrompt:async(...args)=>{queued.push({args,layout:JSON.parse(node.widgets[0].value)});return true;},extensionManager:{toast:{add:error=>errors.push(error.detail)}}};
 const api={addEventListener:(...args)=>events.addEventListener(...args),apiURL:path=>path};
 const previous=new Map(['__mossWorkspaceApp','__mossWorkspaceApi','document','navigator','ResizeObserver','Image','createImageBitmap'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 Object.defineProperties(globalThis,{
  __mossWorkspaceApp:{value:app,configurable:true},__mossWorkspaceApi:{value:api,configurable:true},
  document:{value:window.document,configurable:true},navigator:{value:window.navigator,configurable:true},
  ResizeObserver:{value:class{observe(){}disconnect(){}},configurable:true},
  Image:{value:class{set src(value){loaded.push(value);queueMicrotask(()=>this.onload?.());}},configurable:true},
  createImageBitmap:{value:async()=>{throw new Error('Unexpected image decode.');},configurable:true},
 });
 window.HTMLElement.prototype.scrollIntoView=function(){};
 window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new window.Event('close'));};
 t.after(async()=>{
  node?.onRemoved();await window.happyDOM.close();
  for(const[key,descriptor]of previous)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
 });
 let source=await readFile(resolve(base,'../web/moss_bbox.js'),'utf8');
 source=source.replace("import {app} from '../../scripts/app.js';",'const app=globalThis.__mossWorkspaceApp;').replace("import {api} from '../../scripts/api.js';",'const api=globalThis.__mossWorkspaceApi;');
 for(const name of ['editor.js','state.js','generated_preview.js'])source=source.replace(`from './${name}'`,`from '${pathToFileURL(resolve(base,'../web',name)).href}'`);
 await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#workspace-${fixtureId++}`);
 class SaveImageNode{}
 class BBoxNode{
  constructor(){this.id=6;this.type='MOSSBBoxStudio';this.graph=graph;this.properties={};this.size=[300,300];this.inputs=[];this.outputs=[{links:[1]}];this.widgets=[{name:'layout_json',value:JSON.stringify(original)}];this.onNodeCreated();}
  addWidget(type,name,value,callback,options){const widget={type,name,value,callback,options};this.widgets.push(widget);return widget;}
  addCustomWidget(widget){this.widgets.push(widget);return widget;}
  setDirtyCanvas(){}computeSize(){return[320,300];}setSize(size){this.size=size;}
 }
 await extension.beforeRegisterNodeDef(SaveImageNode,{name:'SaveImage'});
 await extension.beforeRegisterNodeDef(BBoxNode,{name:'MOSSBBoxStudio'});
 extension.setup();
 node=new BBoxNode();const save=Object.assign(new SaveImageNode(),{id:3,type:'SaveImage',outputs:[],graph});graph.nodes=[node,save];
 const widget=name=>{const result=node.widgets.find(widget=>widget.name===name);assert.ok(result,`Missing ${name} node widget`);return result;};
 const hosts=()=>[...window.document.body.children].filter(host=>host.shadowRoot);
 async function open(name='Open BBOX workspace'){
  widget(name).callback();const host=hosts().at(-1);assert.ok(host,'Editor host should be attached');
  const root=host.shadowRoot;root.querySelector('link').dispatchEvent(new window.Event('load'));await flush();
  assert.equal(root.querySelector('dialog').open,true);assert.deepEqual(errors,[]);return{host,root,dialog:root.querySelector('dialog')};
 }
 const dispatch=(type,detail)=>events.dispatchEvent(new window.CustomEvent(type,{detail}));
 async function result(filename,promptId='job-A',verified=true){
  dispatch('execution_start',{prompt_id:promptId});const detail={prompt_id:promptId,node:'3',output:output(filename)};
  if(verified)save.onExecuted(detail.output);dispatch('executed',detail);dispatch('execution_success',{prompt_id:promptId});await flush();
 }
 function input(root,field,value){const element=root.querySelector(`[data-field="${field}"]`);assert.ok(element);element.focus();element.value=value;element.dispatchEvent(new window.Event('input',{bubbles:true,composed:true}));return element;}
 return{window,app,graph,node,save,extension,original,queued,loaded,errors,widget,hosts,open,result,input,dispatch};
}

test('sampler progress renders one dot per step next to Generate',async t=>{
 const h=await setup(t),{root}=await h.open();
 const bar=root.querySelector('.generation-steps');
 assert.equal(bar.hidden,true);
 h.dispatch('execution_start',{prompt_id:'progress-job'});
 h.dispatch('progress',{prompt_id:'progress-job',value:3,max:8});
 assert.equal(bar.hidden,false);
 assert.equal(bar.children.length,8);
 assert.equal(bar.querySelectorAll('.done').length,3);
 assert.equal(bar.getAttribute('aria-valuenow'),'3');
 assert.equal(root.querySelector('.generation-status').textContent,'Step 3 of 8');
 assert.equal(bar.closest('.generation-bar').querySelector('[data-action="generate"]').textContent.includes('Generate'),true);
 h.dispatch('progress',{prompt_id:'progress-job',value:14,max:30});
 assert.equal(bar.children.length,30);
 assert.equal(bar.querySelectorAll('.done').length,14);
 assert.equal(bar.querySelector('.current'),bar.children[13]);
 assert.equal(bar.classList.contains('dense'),true);
 h.dispatch('progress',{prompt_id:'progress-job',value:31,max:60});
 assert.equal(bar.children.length,30);
 assert.equal(bar.querySelectorAll('.done').length,15);
 assert.equal(bar.querySelector('.current'),bar.children[15]);
 assert.equal(root.querySelector('.generation-dot-key').textContent,'2 steps per dot');
 Object.defineProperty(bar,'clientWidth',{value:120,configurable:true});
 h.dispatch('progress',{prompt_id:'progress-job',value:14,max:30});
 assert.equal(bar.children.length,15);
 assert.equal(bar.getAttribute('aria-valuenow'),'14');
 h.dispatch('execution_interrupted',{prompt_id:'progress-job'});
 assert.equal(bar.hidden,true);
});

test('workspace forces the latest successful native result onto the open editor without changing its layout',async t=>{
 const h=await setup(t),workspace=h.widget('Open BBOX workspace');assert.equal(workspace.serialize,false);assert.equal(workspace.options.serialize,false);
 const{root,dialog}=await h.open();assert.equal(dialog.classList.contains('workspace'),true);assert.ok(root.querySelector('[data-action="generate"]'));assert.equal(root.querySelector('form[method="dialog"] button').textContent,'Back to workflow');
 const toggle=h.widget('Follow latest image');assert.equal(toggle.value,false);assert.equal(h.node.properties.moss_bbox_follow_latest,false);toggle.callback(false);h.node.onConfigure();
 const overlay=root.querySelector('.boxes').innerHTML;
 await h.result('foreign.png','job-foreign',false);assert.equal(h.node.properties.moss_bbox_latest_image,undefined);assert.equal(root.querySelector('.reference').getAttribute('src'),null);
 await h.result('generated.png');assert.deepEqual(h.node.properties.moss_bbox_latest_image,reference('generated.png'));assert.equal(h.node.properties.moss_bbox_follow_latest,false);assert.equal(toggle.value,false);
 assert.equal(root.querySelector('.reference').getAttribute('src'),'/view?filename=generated.png&subfolder=MOSS&type=output');assert.equal(root.querySelector('.reference').hidden,false);assert.equal(root.querySelector('.image-name').textContent,'generated.png');assert.equal(root.querySelector('.boxes').innerHTML,overlay);
 assert.equal(root.querySelector('[data-field="scene"]').value,h.original.scene);assert.equal(root.querySelector('[data-field="caption"]').value,h.original.regions[0].caption);assert.equal(root.querySelector('[data-field="aspect_ratio"]').value,'3:2');assert.deepEqual(JSON.parse(h.node.widgets[0].value),h.original);assert.equal(root.querySelector('.generation-status').textContent,'Result updated');
 root.querySelector('[data-action="generate"]').click();await flush();assert.deepEqual(h.queued[0].layout,{...h.original,image:reference('generated.png')});
});

test('workspace Generate saves current scene, box descriptions and pending aspect ratio before native queue submission',async t=>{
 const h=await setup(t),{root,dialog}=await h.open();h.input(root,'scene','A woman reading beside a window.');h.input(root,'caption','A woman in a blue linen shirt.');h.input(root,'aspect_ratio','37:19');root.querySelector('[data-action="generate"]').click();await flush();
 assert.equal(h.queued.length,1);assert.deepEqual(h.queued[0].args,[0,1]);const saved=h.queued[0].layout;assert.equal(saved.scene,'A woman reading beside a window.');assert.equal(saved.regions[0].caption,'A woman in a blue linen shirt.');assert.deepEqual(saved.regions[0].bbox,h.original.regions[0].bbox);assert.equal(saved.width/saved.height,37/19);assert.equal(dialog.open,true);assert.match(root.querySelector('.generation-status').textContent,/Queued/);
});

test('closing a workspace restores the persisted follower preference and ordinary Edit boxes stays ordinary',async t=>{
 const h=await setup(t),workspace=await h.open();await h.result('workspace.png');workspace.dialog.close();await flush();assert.equal(workspace.host.isConnected,false);assert.equal(h.node.properties.moss_bbox_follow_latest,false);
 await h.result('after-close.png','job-B');assert.deepEqual(h.node.properties.moss_bbox_latest_image,reference('workspace.png'));assert.equal(h.loaded.length,1);
 const ordinary=await h.open('Edit boxes');assert.equal(ordinary.dialog.classList.contains('workspace'),false);assert.equal(ordinary.root.querySelector('.generation-bar'),null);assert.equal(ordinary.root.querySelector('form[method="dialog"] button').textContent,'Done');
 await h.result('ordinary.png','job-C');assert.deepEqual(h.node.properties.moss_bbox_latest_image,reference('workspace.png'));assert.equal(ordinary.root.querySelector('.image-name').textContent,'workspace.png');assert.equal(h.loaded.length,1);assert.equal(h.queued.length,0);
});

test('native queue submission refuses a busy queue or a node outside the active workflow and can recover',async t=>{
 const h=await setup(t),{root}=await h.open(),generate=root.querySelector('[data-action="generate"]');
 h.app.processingQueue=true;generate.click();await flush();assert.equal(h.queued.length,0);assert.match(root.querySelector('.generation-status').textContent,/still submitting a prompt/);assert.equal(generate.disabled,false);
 h.app.processingQueue=false;h.graph.nodes=[h.save];generate.click();await flush();assert.equal(h.queued.length,0);assert.match(root.querySelector('.generation-status').textContent,/workflow changed/);assert.equal(generate.disabled,false);
 h.graph.nodes.unshift(h.node);generate.click();await flush();assert.equal(h.queued.length,1);assert.deepEqual(h.queued[0].args,[0,1]);
});

test('configuring another graph closes the workspace and releases its forced follower',async t=>{
 const h=await setup(t),{host,dialog}=await h.open();h.extension.beforeConfigureGraph();await flush();assert.equal(dialog.open,false);assert.equal(host.isConnected,false);assert.equal(h.hosts().length,0);
 await h.result('after-reconfigure.png');assert.equal(h.node.properties.moss_bbox_latest_image,undefined);assert.equal(h.loaded.length,0);assert.equal(h.node.properties.moss_bbox_follow_latest,false);
});
