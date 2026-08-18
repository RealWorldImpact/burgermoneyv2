(function(){
  'use strict';

  var root=document.documentElement;
  var body=document.body;
  if(!body)return;

  var reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
  var impact=document.querySelector('.page-home .impact-proof');
  function animateImpactNumber(element){
    if(!element||element.dataset.counted==='true')return;
    var raw=element.textContent.trim();
    var match=raw.match(/^([^0-9-]*)(-?[\d,]+(?:\.\d+)?)(.*)$/);
    if(!match)return;
    var target=Number(match[2].replace(/,/g,''));
    if(!isFinite(target))return;
    element.dataset.counted='true';
    var decimals=(match[2].split('.')[1]||'').length;
    var started=window.performance.now();
    function frame(now){
      var progress=Math.min(1,(now-started)/900);
      var eased=1-Math.pow(1-progress,3);
      var value=target*eased;
      var formatted;
      if(decimals){
        var parts=value.toFixed(decimals).split('.');
        parts[0]=Number(parts[0]).toLocaleString('en-US');
        formatted=parts.join('.');
      }else{
        formatted=Math.round(value).toLocaleString('en-US');
      }
      element.textContent=match[1]+formatted+match[3];
      if(progress<1)window.requestAnimationFrame(frame);
      else element.textContent=raw;
    }
    window.requestAnimationFrame(frame);
  }
  function revealImpact(){
    if(!impact||impact.classList.contains('impact-animated'))return;
    impact.classList.add('impact-animated');
    if(!reducedMotion.matches){
      animateImpactNumber(document.getElementById('heroDonated'));
    }
  }
  if(impact){
    if('IntersectionObserver' in window){
      var impactObserver=new IntersectionObserver(function(entries){
        if(entries.some(function(entry){return entry.isIntersecting;})){
          revealImpact();
          impactObserver.disconnect();
        }
      },{threshold:.25});
      impactObserver.observe(impact);
    }else revealImpact();
  }

  var precisePointer=window.matchMedia('(hover: hover) and (pointer: fine)');
  if(!precisePointer.matches||reducedMotion.matches)return;

  var glow=document.createElement('div');
  glow.className='flavor-glow';
  glow.setAttribute('aria-hidden','true');
  body.appendChild(glow);

  var trail=[];
  for(var trailIndex=0;trailIndex<6;trailIndex++){
    var trailElement=document.createElement('div');
    var trailSize=72-(trailIndex*8);
    trailElement.className='flavor-trail';
    trailElement.setAttribute('aria-hidden','true');
    trailElement.style.setProperty('--trail-size',trailSize+'px');
    trailElement.style.setProperty('--trail-alpha',String(.12-(trailIndex*.017)));
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
  }
  function paintTrail(time){
    trailFrame=0;
    var trailIsFresh=(time-trailLastMove)<200;
    var leadX=pointerX;
    var leadY=pointerY;
    var settled=true;
    trail.forEach(function(node,index){
      var ease=Math.max(.15,.3-(index*.025));
      var dx=leadX-node.x;
      var dy=leadY-node.y;
      node.x+=dx*ease;
      node.y+=dy*ease;
      node.element.style.transform='translate3d('+(node.x-(node.size/2))+'px,'+(node.y-(node.size/2))+'px,0)';
      node.element.classList.toggle('is-active',trailIsFresh);
      if(Math.abs(dx)>.35||Math.abs(dy)>.35)settled=false;
      leadX=node.x;
      leadY=node.y;
    });
    if(trailIsFresh||!settled){
      trailFrame=window.requestAnimationFrame(paintTrail);
    }else{
      trail.forEach(function(node){node.element.classList.remove('is-active');});
    }
  }
  document.addEventListener('pointermove',function(event){
    var moveTime=window.performance.now();
    pointerX=event.clientX;
    pointerY=event.clientY;
    if(!hasPointerPosition||(moveTime-trailLastMove)>300){
      hasPointerPosition=true;
      trail.forEach(function(node){node.x=pointerX;node.y=pointerY;});
    }
    trailLastMove=moveTime;
    if(!pointerFrame)pointerFrame=window.requestAnimationFrame(paintPointer);
    if(!trailFrame)trailFrame=window.requestAnimationFrame(paintTrail);
  },{passive:true});
  document.addEventListener('pointerout',function(event){
    if(!event.relatedTarget){
      hasPointerPosition=false;
      glow.classList.remove('is-active');
      trail.forEach(function(node){node.element.classList.remove('is-active');});
      if(trailFrame){window.cancelAnimationFrame(trailFrame);trailFrame=0;}
    }
  },{passive:true});
})();
