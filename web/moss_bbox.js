import {app} from '../../scripts/app.js';
import {api} from '../../scripts/api.js';
import {BBoxEditor} from './editor.js';
import {parseState,colorFor,formatAspectRatio} from './state.js';
import {GeneratedPreviewFollower} from './generated_preview.js';

const editors=new WeakMap();
const followers=new Map();
const verifiedOutputs=new WeakMap();
const followProperty='moss_bbox_follow_latest';
const latestProperty='moss_bbox_latest_image';
const reportError=error=>app.extensionManager.toast.add({severity:'error',summary:'MOSS-Image BBOX editor',detail:error.message,life:6000});
const layoutWidget=node=>node.widgets.find(w=>w.name==='layout_json');
const imageURL=reference=>api.apiURL(`/view?${new URLSearchParams({filename:reference.name,subfolder:reference.subfolder||'',type:reference.type||'input'})}`);
const containsNode=(graph,node)=>(graph?.nodes||graph?._nodes||[]).some(child=>child===node||(child.subgraph&&containsNode(child.subgraph,node)));

function workspaceStatus(message,options){
 for(const node of followers.keys()){const editor=editors.get(node);if(editor?.workspace)editor.setGenerationStatus(message,options);}
}

function readLayout(node){
 const value=layoutWidget(node).value,latest=node.properties?.[latestProperty];
 if(!latest)return value;
 const state=parseState(value);state.image={...latest};return JSON.stringify(state);
}

function writeLayout(node,value){
 const widget=layoutWidget(node);if(widget.value===value&&!node.properties?.[latestProperty])return;
 const graph=node.graph||app.graph;
 graph.beforeChange();delete node.properties[latestProperty];widget.value=value;graph.afterChange();node.setDirtyCanvas(true,true);
 node.widgets.find(w=>w.type==='moss_bbox_preview')?.triggerDraw?.();
}

function followGeneratedImages(node){
 node.properties||={};node.properties[followProperty]??=false;
 const follower=new GeneratedPreviewFollower({
  getGraph:()=>app.rootGraph||app.graph,node,getOutputs:()=>app.nodeOutputs,
  loadImage:reference=>new Promise((resolve,reject)=>{
   const image=new Image();image.onload=resolve;image.onerror=()=>reject(new Error('The latest image could not be loaded.'));image.src=imageURL(reference);
  }),
  applyImage:reference=>{
   node.properties[latestProperty]={...reference};node.setDirtyCanvas(true,true);
   node.widgets.find(w=>w.type==='moss_bbox_preview')?.triggerDraw?.();
   const editor=editors.get(node);editor?.setReference(reference);if(editor?.workspace)editor.setGenerationStatus('Result updated');
  },
  onError:error=>{
   const editor=editors.get(node);
   if(editor?.workspace){editor.setGenerationStatus(error.message);editor.notify(error.message);}else reportError(error);
  },
 });
 followers.set(node,follower);
 const widget=node.addWidget('toggle','Follow latest image',Boolean(node.properties?.[followProperty]),value=>{
  const graph=node.graph||app.graph;graph.beforeChange();node.properties[followProperty]=Boolean(value);graph.afterChange();
  void follower.setEnabled(value||editors.get(node)?.workspace);node.setDirtyCanvas(true,true);
 },{serialize:false,tooltip:'Use the final image from this workflow as the box reference after each successful generation.'});
 widget.serialize=false;
 return follower;
}

function openEditor(node,workspace=false){
 const current=editors.get(node);if(current){if(current.workspace===workspace){current.dialog?.focus();return;}current.close();}
 let editor;
 try{editor=new BBoxEditor({
  workspace,
  read:()=>readLayout(node),
  write:value=>writeLayout(node,value),
  generate:()=>{
   if(!containsNode(app.rootGraph||app.graph,node))throw new Error('The workflow changed. Reopen the BBOX workspace.');
   if(app.processingQueue)throw new Error('ComfyUI is still submitting a prompt. Try Generate again.');
   return app.queuePrompt(0,1);
  },
  imageURL,
  getSnap:()=>Boolean(node.properties.moss_bbox_snap_grid??true),
  setSnap:value=>{node.properties.moss_bbox_snap_grid=value;node.setDirtyCanvas(true,true);},
  megapixels:()=>{
   const index=node.inputs.findIndex(input=>input.name==='megapixels');
   if(index>=0&&node.inputs[index].link!=null){
    const source=node.getInputNode(index);
    if((source?.comfyClass||source?.type)!=='PrimitiveFloat')throw new Error('Use the prompt output when Megapixels comes from a computed value.');
    return Number(source.widgets.find(widget=>widget.name==='value').value);
   }
   return Number(node.widgets.find(widget=>widget.name==='megapixels')?.value??1);
  },
  upload:async file=>{
   const data=new FormData();data.append('image',file);data.append('type','input');data.append('subfolder','moss-bbox');
   const response=await api.fetchApi('/upload/image',{method:'POST',body:data});
   if(!response.ok)throw new Error(`Image upload failed (${response.status}).`);
   const result=await response.json();return{name:result.name,subfolder:result.subfolder||'',type:result.type||'input'};
  },
  closed:()=>{
   editors.delete(node);
   if(workspace)void followers.get(node)?.setEnabled(Boolean(node.properties?.[followProperty]));
  },
 });}catch(error){reportError(error);return;}
 editors.set(node,editor);editor.open().then(()=>{
  if(editors.get(node)!==editor||!workspace)return;
  editor.setGenerationStatus('Ready · results update automatically');void followers.get(node)?.setEnabled(true);
 }).catch(error=>{editor.close();reportError(error);});
}

function previewWidget(node){
 let source='',image=null;
 return{
  name:'Layout preview',type:'moss_bbox_preview',serialize:false,options:{serialize:false},computeSize:width=>[Math.max(300,width),210],
  draw(ctx,_node,width,y){
   const element=ctx.canvas;
   if(element&&element!==app.canvas?.canvas&&element.clientWidth>0)width=element.clientWidth;
   let state;try{state=parseState(readLayout(node));}catch{return;}
   const next=state.image?imageURL(state.image):'';
   if(next!==source){source=next;image=null;if(next){const pending=new Image();pending.onload=()=>{if(source===next){image=pending;node.setDirtyCanvas(true,true);node.widgets.find(w=>w.type==='moss_bbox_preview')?.triggerDraw?.();}};pending.src=next;}}
   ctx.save();ctx.fillStyle='#202329';ctx.beginPath();ctx.roundRect(10,y+5,width-20,174,6);ctx.fill();
   const scale=Math.min((width-38)/state.width,154/state.height),w=state.width*scale,h=state.height*scale,x=(width-w)/2,top=y+15+(154-h)/2;
   ctx.fillStyle='#2c3036';ctx.fillRect(x,top,w,h);if(image)ctx.drawImage(image,x,top,w,h);
   for(const[r,index]of state.regions.map((r,i)=>[r,i])){const[a,b,c,d]=r.bbox;ctx.strokeStyle=colorFor(index);ctx.lineWidth=1.2;ctx.strokeRect(x+a*w,top+b*h,(c-a)*w,(d-b)*h);}
   ctx.fillStyle='#a6aeb9';ctx.font='11px system-ui';ctx.textBaseline='middle';ctx.textAlign='left';ctx.fillText(`${state.regions.length} ${state.regions.length===1?'box':'boxes'}`,14,y+195);
   ctx.textAlign='right';ctx.fillText(formatAspectRatio(state),width-14,y+195);ctx.restore();
  },
 };
}

app.registerExtension({
 name:'MOSS.BBoxStudio',
 beforeConfigureGraph(){for(const node of followers.keys())editors.get(node)?.close();},
 setup(){
  api.addEventListener('execution_start',({detail})=>{for(const follower of followers.values())follower.start(detail.prompt_id);workspaceStatus('Generating…',{busy:true});});
  api.addEventListener('progress',({detail})=>{
   if(detail?.max>0)workspaceStatus(`Step ${detail.value} of ${detail.max}`,
    {busy:true,step:detail.value,steps:detail.max});
  });
  api.addEventListener('executed',({detail})=>{
   const verifiedNode=verifiedOutputs.get(detail.output);if(!verifiedNode)return;
   for(const follower of followers.values())follower.executed(detail,verifiedNode);
  });
  api.addEventListener('execution_success',({detail})=>{workspaceStatus('Generation complete');for(const follower of followers.values())void follower.finish(detail.prompt_id,true);});
  for(const event of ['execution_error','execution_interrupted'])api.addEventListener(event,({detail})=>{for(const follower of followers.values())follower.finish(detail.prompt_id,false);workspaceStatus(event==='execution_interrupted'?'Generation interrupted':'Generation failed. Check the workflow for details.');});
 },
 async beforeRegisterNodeDef(nodeType,nodeData){
  if(['SaveImage','PreviewImage'].includes(nodeData.name)){
   const executed=nodeType.prototype.onExecuted;
   nodeType.prototype.onExecuted=function(output){
    // Native ComfyUI calls this only after checking the job belongs to the active workflow.
    if(output&&typeof output==='object')verifiedOutputs.set(output,this);
    return executed?.apply(this,arguments);
   };
  }
  if(nodeData.name!=='MOSSBBoxStudio')return;
  const created=nodeType.prototype.onNodeCreated;
  nodeType.prototype.onNodeCreated=function(){
   const result=created?.apply(this,arguments),widget=layoutWidget(this);
   widget.type='moss_bbox_hidden';widget.computeSize=()=>[0,-4];widget.draw=()=>{};
   const edit=this.addWidget('button','Edit boxes',null,()=>openEditor(this),{serialize:false});edit.serialize=false;
   const workspace=this.addWidget('button','Open BBOX workspace',null,()=>openEditor(this,true),{serialize:false});workspace.serialize=false;
   followGeneratedImages(this);this.addCustomWidget(previewWidget(this));
   this.size[0]=Math.max(this.size[0],320);this.setSize(this.computeSize());return result;
  };
  const configured=nodeType.prototype.onConfigure;
  nodeType.prototype.onConfigure=function(){
   const result=configured?.apply(this,arguments),enabled=Boolean(this.properties?.[followProperty]);
   this.widgets.find(w=>w.name==='Follow latest image').value=enabled;
   void followers.get(this)?.setEnabled(enabled||editors.get(this)?.workspace);
   this.widgets.find(w=>w.type==='moss_bbox_preview')?.triggerDraw?.();return result;
  };
  const removed=nodeType.prototype.onRemoved;
  nodeType.prototype.onRemoved=function(){editors.get(this)?.close();followers.get(this)?.dispose();followers.delete(this);return removed?.apply(this,arguments);};
 },
});
