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

  var trail=[];
  var trailClasses=['',' flavor-trail--mustard',' flavor-trail--blue'];
  for(var trailIndex=0;trailIndex<7;trailIndex++){
    var trailElement=document.createElement('div');
    trailElement.className='flavor-trail'+trailClasses[trailIndex%trailClasses.length];
    trailElement.setAttribute('aria-hidden','true');
    trailElement.style.setProperty('--trail-alpha',String(.3-(trailIndex*.027)));
    body.appendChild(trailElement);
    trail.push({element:trailElement,x:window.innerWidth*.5,y:window.innerHeight*.3});
  }

  var pointerFrame=0;
  var trailFrame=0;
  var trailLastMove=0;
  var hasPointerPosition=false;
  var pointerOnPage=false;
  var pointerX=window.innerWidth*.5;
  var pointerY=window.innerHeight*.3;
  function paintPointer(){
    pointerFrame=0;
    root.style.setProperty('--pointer-x',pointerX+'px');
    root.style.setProperty('--pointer-y',pointerY+'px');
    glow.classList.add('is-active');
  }
  function paintTrail(time){
    trailFrame=0;
    var leadX=pointerX;
    var leadY=pointerY;
    var settled=true;
    trail.forEach(function(node,index){
      var ease=Math.max(.12,.25-(index*.016));
      var dx=leadX-node.x;
      var dy=leadY-node.y;
      node.x+=dx*ease;
      node.y+=dy*ease;
      node.element.style.transform='translate3d('+(node.x-66)+'px,'+(node.y-66)+'px,0)';
      node.element.classList.add('is-active');
      if(Math.abs(dx)>.35||Math.abs(dy)>.35)settled=false;
      leadX=node.x;
      leadY=node.y;
    });
    if((time-trailLastMove)<460||!settled){
      trailFrame=window.requestAnimationFrame(paintTrail);
    }else{
      trail.forEach(function(node){node.element.classList.remove('is-active');});
    }
  }
  document.addEventListener('pointermove',function(event){
    pointerOnPage=true;
    pointerX=event.clientX;
    pointerY=event.clientY;
    if(!hasPointerPosition){
      hasPointerPosition=true;
      trail.forEach(function(node){node.x=pointerX;node.y=pointerY;});
    }
    trailLastMove=window.performance.now();
    if(!pointerFrame)pointerFrame=window.requestAnimationFrame(paintPointer);
    if(!trailFrame)trailFrame=window.requestAnimationFrame(paintTrail);
  },{passive:true});
  document.addEventListener('pointerout',function(event){
    if(!event.relatedTarget){
      pointerOnPage=false;
      hasPointerPosition=false;
      glow.classList.remove('is-active');
      trail.forEach(function(node){node.element.classList.remove('is-active');});
      if(trailFrame){window.cancelAnimationFrame(trailFrame);trailFrame=0;}
    }
  },{passive:true});
})();
