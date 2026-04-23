(function(){
const cursor=document.getElementById("padCursor");
let x=innerWidth/2,y=innerHeight/2;
let active=false;

function update(){
  const pads=navigator.getGamepads();
  const p=pads&&pads[0];
  if(!p)return;

  const dx=p.axes[0], dy=p.axes[1];
  if(Math.abs(dx)+Math.abs(dy)>0.2){
    active=true;
    cursor.style.display="block";
    x+=dx*18; y+=dy*18;
    x=Math.max(0,Math.min(innerWidth,x));
    y=Math.max(0,Math.min(innerHeight,y));
    cursor.style.left=(x-14)+"px";
    cursor.style.top=(y-14)+"px";
    window.dispatchEvent(new PointerEvent("pointermove",{clientX:x,clientY:y}));
  }
  requestAnimationFrame(update);
}
update();
})();
