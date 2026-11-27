import {esc} from './icons.js';

const key=value=>`<kbd>${esc(value)}</kbd>`;
const chord=(...keys)=>keys.map(key).join('<span class="key-plus">+</span>');
const row=(keys,label)=>`<div class="shortcut-row"><span class="shortcut-keys">${keys}</span><span>${label}</span></div>`;
const hints=[
 {target:'.header-actions [data-action="undo"]',title:'History',side:'canvas-history',html:row(chord('Ctrl','Z'),'Undo')+row(chord('Ctrl','Shift','Z'),'Redo')},
 {target:'.mode-tools',title:'Tools',side:'bottom',html:row(key('V'),'Select and move')+row(key('R'),'Draw one box')+row(key('Esc'),'Return to Select')},
 {target:'.selection-tools',title:'Selection actions',side:'bottom',html:row(chord('Ctrl','D'),'Duplicate')+row(key('Delete'),'Delete')+row(chord('Ctrl','G'),'Group')},
 {target:'[data-action="fit"]',title:'View',side:'bottom',html:row(key('0'),'Fit image')},
 {target:'.viewport',title:'On the image',side:'inside-left',html:row(chord('Ctrl','Drag'),'Select boxes in a region')+row(chord('Ctrl','Shift','Drag'),'Add boxes in a region')+row(chord('Space','Drag')+' / '+key('MMB'),'Pan')+row(key('Wheel'),'Zoom at pointer')+row(chord('Shift','Click'),'Select more boxes')+row(chord('Alt','Click'),'Cycle overlaps')+row(key('Right click'),'Choose overlapping box')+row(key('↑ ← ↓ →'),'Nudge · Shift for larger steps')},
 {target:'.regions',title:'Canvas and box list',side:'canvas-right',html:row(chord('Ctrl','A'),'Select all boxes')+row(chord('Ctrl','C'),'Copy selected boxes')+row(chord('Ctrl','V'),'Paste boxes')+row(key('Enter'),'Edit description / finish editing')+row(chord('Shift','Enter'),'New line while editing')+row(key('Esc'),'Leave text editing')+'<p>Tool shortcuts apply outside text fields. Text edits save as you type; Enter or Esc returns to the canvas.</p>'},
];

// These stay out of the normal editing flow. Hover, focus, or pin the keyboard
// button to reveal one set of callouts connected to the actual controls.
export function installShortcutHelp(root){
 const shell=root.querySelector('.editor-shell'),button=root.querySelector('[data-action="shortcuts"]');
 const window=shell.ownerDocument.defaultView;
 const layer=shell.ownerDocument.createElement('div');
 layer.className='shortcut-layer';layer.id=`${root.querySelector('dialog').id}-shortcuts`;layer.hidden=true;
 layer.setAttribute('role','tooltip');layer.setAttribute('aria-label','Keyboard shortcuts');
 layer.innerHTML='<svg class="shortcut-connectors" aria-hidden="true"></svg>';
 shell.append(layer);
 button.setAttribute('aria-controls',layer.id);button.setAttribute('aria-expanded','false');button.setAttribute('aria-pressed','false');
 const cards=hints.map(hint=>{
  const target=root.querySelector(hint.target);if(!target)return null;
  const card=shell.ownerDocument.createElement('section');card.className=`shortcut-callout shortcut-${hint.side}`;
  card.innerHTML=`<h3>${hint.title}</h3>${hint.html}`;layer.append(card);
  return{...hint,target,card};
 }).filter(Boolean);
 let pinned=false,hover=false,focused=false,frame,disposed=false;
 const clamp=(value,min,max)=>Math.max(min,Math.min(Math.max(min,max),value));
 function position(){
  frame=undefined;if(layer.hidden||disposed)return;
  const bounds=shell.getBoundingClientRect(),width=shell.clientWidth||bounds.width,height=shell.clientHeight||bounds.height;
  const relative=element=>{const rect=element?.getBoundingClientRect();return rect?{left:rect.left-bounds.left,top:rect.top-bounds.top,width:rect.width,height:rect.height}:null;};
  const canvas=relative(root.querySelector('.viewport')),artboard=relative(root.querySelector('.artboard'));
  const occupied=[],svg=layer.querySelector('svg');svg.replaceChildren();svg.setAttribute('viewBox',`0 0 ${width} ${height}`);
  for(const hint of cards){
   const rect=hint.target.getBoundingClientRect(),target={left:rect.left-bounds.left,top:rect.top-bounds.top,width:rect.width,height:rect.height};
   const size=hint.card.getBoundingClientRect(),w=size.width||220,h=size.height||140;
   const center={x:target.left+target.width/2,y:target.top+target.height/2};
   let x,y;
   if(hint.side==='canvas-history'&&canvas){x=center.x-w/2-64;y=canvas.top+12;}
   else if(hint.side==='inside-left'){x=target.left+20;y=target.top+Math.max(30,(target.height-h)/2);}
   else if(hint.side==='canvas-right'&&canvas){x=canvas.left+canvas.width-w-24;y=canvas.top+(canvas.height-h)/2;}
   else{x=center.x-w/2;y=target.top+target.height+12;}
   x=clamp(x,10,width-w-10);y=clamp(y,10,height-h-10);
   // Adjacent toolbar anchors share limited space. Stack their callouts until
   // there is a clear slot, then connect the card back to its own control.
   for(let attempts=0;attempts<cards.length*2;attempts++){
    const collision=occupied.find(box=>x<box.x+box.w+8&&x+w+8>box.x&&y<box.y+box.h+8&&y+h+8>box.y);
    if(!collision)break;
    const below=collision.y+collision.h+10;
    if(below+h<height-10)y=below;
    else if(collision.x+collision.w+w+20<width){x=collision.x+collision.w+10;y=clamp(target.top+target.height+12,10,height-h-10);}
    else{x=clamp(collision.x-w-10,10,width-w-10);y=clamp(collision.y-h-10,10,height-h-10);}
   }
   hint.card.style.left=`${x}px`;hint.card.style.top=`${y}px`;occupied.push({x,y,w,h});
   const anchor=hint.side==='inside-left'?{x:artboard?.left??target.left+target.width/2,y:clamp(y+h/2,artboard?.top??target.top,(artboard?.top??target.top)+(artboard?.height??target.height))}:hint.side==='canvas-right'&&canvas?{x:canvas.left+canvas.width,y:clamp(y+h/2,target.top,target.top+target.height)}:{x:center.x,y:target.top+target.height};
   const end={x:clamp(anchor.x,x,x+w),y:clamp(anchor.y,y,y+h)};
   const line=shell.ownerDocument.createElementNS('http://www.w3.org/2000/svg','line');
   for(const[k,v]of Object.entries({x1:anchor.x,y1:anchor.y,x2:end.x,y2:end.y}))line.setAttribute(k,String(v));
   svg.append(line);
   const dot=shell.ownerDocument.createElementNS('http://www.w3.org/2000/svg','circle');dot.setAttribute('cx',String(anchor.x));dot.setAttribute('cy',String(anchor.y));dot.setAttribute('r','3');svg.append(dot);
  }
 }
 const schedule=()=>{if(!frame&&!layer.hidden)frame=window.requestAnimationFrame(position);};
 function update(){
  const shown=pinned||hover||focused;layer.hidden=!shown;
  button.setAttribute('aria-expanded',String(shown));button.setAttribute('aria-pressed',String(pinned));
  button.classList.toggle('btn-active',pinned);
  if(shown){button.setAttribute('aria-describedby',layer.id);position();}else button.removeAttribute('aria-describedby');
 }
 const enter=()=>{hover=true;update();},leave=()=>{hover=false;update();};
 const focus=()=>{focused=true;update();},blur=()=>{focused=false;update();};
 const toggle=()=>{if(pinned)pinned=hover=focused=false;else pinned=true;update();};
 button.addEventListener('mouseenter',enter);button.addEventListener('mouseleave',leave);
 button.addEventListener('focus',focus);button.addEventListener('blur',blur);button.addEventListener('click',toggle);
 window.addEventListener('resize',schedule);root.addEventListener('scroll',schedule,true);
 return{
  dismiss(){if(layer.hidden)return false;pinned=hover=focused=false;update();return true;},
  destroy(){disposed=true;if(frame)window.cancelAnimationFrame(frame);window.removeEventListener('resize',schedule);root.removeEventListener('scroll',schedule,true);button.removeEventListener('mouseenter',enter);button.removeEventListener('mouseleave',leave);button.removeEventListener('focus',focus);button.removeEventListener('blur',blur);button.removeEventListener('click',toggle);layer.remove();},
 };
}
