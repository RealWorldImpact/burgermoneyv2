(function(){
  'use strict';

  var root=document.documentElement;
  var body=document.body;
  if(!body)return;

  var precisePointer=window.matchMedia('(hover: hover) and (pointer: fine)');
  var reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
  if(!precisePointer.matches||reducedMotion.matches)return;

  var glow=document.createElement('div');
  glow.className='flavor-glow';
  glow.setAttribute('aria-hidden','true');
  body.appendChild(glow);

  var cursor=document.createElement('div');
  cursor.className='flavor-cursor';
  cursor.setAttribute('aria-hidden','true');
  body.appendChild(cursor);

  var trail=[];
  for(var trailIndex=0;trailIndex<8;trailIndex++){
    var trailElement=document.createElement('div');
    var trailSize=118-(trailIndex*8);
    trailElement.className='flavor-trail';
    trailElement.setAttribute('aria-hidden','true');
    trailElement.style.setProperty('--trail-size',trailSize+'px');
    trailElement.style.setProperty('--trail-alpha',String(.24-(trailIndex*.019)));
    body.appendChild(trailElement);
    trail.push({element:trailElement,size:trailSize,x:window.innerWidth*.5,y:window.innerHeight*.3});
  }

  var pointerFrame=0;
  var trailFrame=0;
  var trailLastMove=0;
  var hasPointerPosition=false;
  var pointerX=window.innerWidth*.5;
  var pointerY=window.innerHeight*.3;
  function paintPointer(){
    pointerFrame=0;
    root.style.setProperty('--pointer-x',pointerX+'px');
    root.style.setProperty('--pointer-y',pointerY+'px');
    glow.classList.add('is-active');
    cursor.classList.add('is-active');
  }
  function paintTrail(time){
    trailFrame=0;
    var leadX=pointerX;
    var leadY=pointerY;
    var settled=true;
    trail.forEach(function(node,index){
      var ease=Math.max(.12,.27-(index*.017));
      var dx=leadX-node.x;
      var dy=leadY-node.y;
      node.x+=dx*ease;
      node.y+=dy*ease;
      node.element.style.transform='translate3d('+(node.x-(node.size/2))+'px,'+(node.y-(node.size/2))+'px,0)';
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
      hasPointerPosition=false;
      glow.classList.remove('is-active');
      cursor.classList.remove('is-active');
      trail.forEach(function(node){node.element.classList.remove('is-active');});
      if(trailFrame){window.cancelAnimationFrame(trailFrame);trailFrame=0;}
    }
  },{passive:true});
})();
