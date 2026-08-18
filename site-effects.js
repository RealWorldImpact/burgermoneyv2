(function(){
  'use strict';

  var root=document.documentElement;
  var body=document.body;
  if(!body)return;

  var progress=document.createElement('div');
  progress.className='scroll-relish';
  progress.setAttribute('aria-hidden','true');
  body.appendChild(progress);

  var progressFrame=0;
  function paintProgress(){
    progressFrame=0;
    var max=Math.max(1,root.scrollHeight-window.innerHeight);
    var value=Math.min(1,Math.max(0,window.scrollY/max));
    root.style.setProperty('--scroll-progress',String(value));
  }
  function requestProgressPaint(){
    if(!progressFrame)progressFrame=window.requestAnimationFrame(paintProgress);
  }
  document.addEventListener('scroll',requestProgressPaint,{passive:true});
  window.addEventListener('resize',requestProgressPaint,{passive:true});
  paintProgress();

  var precisePointer=window.matchMedia('(hover: hover) and (pointer: fine)');
  var reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
  if(!precisePointer.matches||reducedMotion.matches)return;

  var glow=document.createElement('div');
  glow.className='flavor-glow';
  glow.setAttribute('aria-hidden','true');
  body.appendChild(glow);

  var pointerFrame=0;
  var pointerX=window.innerWidth*.5;
  var pointerY=window.innerHeight*.3;
  function paintPointer(){
    pointerFrame=0;
    root.style.setProperty('--pointer-x',pointerX+'px');
    root.style.setProperty('--pointer-y',pointerY+'px');
    glow.classList.add('is-active');
  }
  document.addEventListener('pointermove',function(event){
    pointerX=event.clientX;
    pointerY=event.clientY;
    if(!pointerFrame)pointerFrame=window.requestAnimationFrame(paintPointer);
  },{passive:true});
  document.addEventListener('pointerout',function(event){
    if(!event.relatedTarget)glow.classList.remove('is-active');
  },{passive:true});
})();
