import test from 'node:test';
import assert from 'node:assert/strict';
import {Window} from 'happy-dom';
import {installShortcutHelp} from '../web/shortcut_help.js';

async function fixture(t){
 const window=new Window(),document=window.document;
 const host=document.createElement('div'),root=host.attachShadow({mode:'open'});document.body.append(host);
 root.innerHTML=`<dialog id="editor"><div class="editor-shell"><div class="header-actions"><button data-action="undo"></button><button data-action="shortcuts"></button></div><div class="mode-tools"></div><div class="selection-tools"></div><button data-action="fit"></button><div class="viewport"><div class="artboard"></div></div><div class="regions"></div></div></dialog>`;
 const shell=root.querySelector('.editor-shell'),button=root.querySelector('[data-action="shortcuts"]');
 Object.defineProperties(shell,{clientWidth:{value:1400},clientHeight:{value:900}});
 shell.getBoundingClientRect=()=>({left:20,top:20,width:1400,height:900});
 for(const [selector,left,top,width,height]of [['[data-action="undo"]',700,40,32,32],['.mode-tools',40,100,140,32],['.selection-tools',220,100,220,32],['[data-action="fit"]',850,100,32,32],['.viewport',40,150,950,680],['.artboard',450,165,450,650],['.regions',1020,300,350,550]])root.querySelector(selector).getBoundingClientRect=()=>({left,top,width,height});
 const help=installShortcutHelp(root),layer=root.querySelector('.shortcut-layer');
 const sizes={'History':[190,95],'Tools':[150,120],'Selection actions':[155,120],'View':[105,70],'On the image':[243,245],'Canvas and box list':[260,180]};
 for(const card of layer.querySelectorAll('.shortcut-callout')){const[width,height]=sizes[card.querySelector('h3').textContent];card.getBoundingClientRect=()=>({width,height});}
 t.after(async()=>{help.destroy();await window.happyDOM.close();});
 return{window,root,button,help,layer};
}

test('hover renders keycaps and connectors at controls, image, and list without taking focus',async t=>{
 const h=await fixture(t);assert.equal(h.layer.hidden,true);const active=h.root.activeElement;
 h.button.dispatchEvent(new h.window.MouseEvent('mouseenter'));
 assert.equal(h.layer.hidden,false);assert.equal(h.root.activeElement,active);
 assert.equal(h.layer.querySelectorAll('.shortcut-callout').length,6);
 assert.equal(h.layer.querySelectorAll('line').length,6);assert.equal(h.layer.querySelectorAll('circle').length,6);
 assert.ok(h.layer.querySelectorAll('kbd').length>25);
 assert.match(h.layer.textContent,/On the image/);assert.match(h.layer.textContent,/Canvas and box list/);
 assert.match(h.layer.textContent,/Select boxes in a region/);assert.match(h.layer.textContent,/Add boxes in a region/);assert.doesNotMatch(h.layer.textContent,/Draw a box/);
 assert.equal(h.button.getAttribute('aria-expanded'),'true');assert.equal(h.button.getAttribute('aria-describedby'),h.layer.id);
 for(const card of h.layer.querySelectorAll('.shortcut-callout')){assert.ok(parseFloat(card.style.left)>=10);assert.ok(parseFloat(card.style.top)>=10);assert.ok(parseFloat(card.style.left)+card.getBoundingClientRect().width<=1390);}
 h.button.dispatchEvent(new h.window.MouseEvent('mouseleave'));assert.equal(h.layer.hidden,true);
});

test('History and list hints stay in the canvas and image connector points inward',async t=>{
 const h=await fixture(t);h.button.dispatchEvent(new h.window.MouseEvent('mouseenter'));
 const cards=[...h.layer.querySelectorAll('.shortcut-callout')],find=title=>cards.find(card=>card.querySelector('h3').textContent===title);
 const history=find('History'),list=find('Canvas and box list'),onImage=find('On the image'),view=find('View');
 const left=card=>parseFloat(card.style.left),top=card=>parseFloat(card.style.top),right=card=>left(card)+card.getBoundingClientRect().width;
 assert.ok(left(history)<601,'History moves left of its old centered placement');
 assert.ok(top(history)>=130,'History sits below the toolbar in the image viewport');
 assert.ok(right(history)+8<=left(view),'History leaves space beside the View hint');
 assert.ok(left(list)>=495&&right(list)<970,'List hint fits on the right side of the canvas, before the sidebar');
 assert.equal(top(list)+list.getBoundingClientRect().height/2,470,'List hint is centered vertically in the viewport');
 const lines=[...h.layer.querySelectorAll('line')],imageLine=lines[cards.indexOf(onImage)],listLine=lines[cards.indexOf(list)];
 assert.equal(Number(imageLine.getAttribute('x1')),430,'Image connector targets the artboard left edge');
 assert.equal(Number(imageLine.getAttribute('x2')),right(onImage),'Image connector starts at the inward-facing card edge');
 assert.equal(imageLine.getAttribute('y1'),imageLine.getAttribute('y2'),'Image connector runs straight into the artboard');
 assert.equal(Number(listLine.getAttribute('x1')),970,'List connector points to the sidebar boundary');
 assert.equal(Number(listLine.getAttribute('x2')),right(list));
 assert.equal(listLine.getAttribute('y1'),listLine.getAttribute('y2'));
});

test('keyboard focus reveals hints, click pins them, and Escape dismissal can consume one key',async t=>{
 const h=await fixture(t);h.button.focus();assert.equal(h.layer.hidden,false);
 h.button.click();assert.equal(h.button.getAttribute('aria-pressed'),'true');h.button.click();assert.equal(h.layer.hidden,true);
 h.button.click();h.button.blur();assert.equal(h.layer.hidden,false);assert.equal(h.button.getAttribute('aria-pressed'),'true');
 assert.equal(h.help.dismiss(),true);assert.equal(h.layer.hidden,true);assert.equal(h.button.getAttribute('aria-pressed'),'false');
 assert.equal(h.help.dismiss(),false);
 h.button.dispatchEvent(new h.window.MouseEvent('mouseenter'));h.button.click();h.button.dispatchEvent(new h.window.MouseEvent('mouseleave'));assert.equal(h.layer.hidden,false);
 h.button.click();assert.equal(h.layer.hidden,true);
});

test('destroy removes the overlay and event handlers',async t=>{
 const h=await fixture(t);h.help.destroy();assert.equal(h.root.querySelector('.shortcut-layer'),null);
 h.button.dispatchEvent(new h.window.MouseEvent('mouseenter'));assert.equal(h.button.getAttribute('aria-expanded'),'false');
});
