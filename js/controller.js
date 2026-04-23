(function(){
const cursor=document.getElementById("padCursor");
let x=innerWidth/2,y=innerHeight/2;

function loop(){
  const p=navigator.getGamepads()[0];
  if(p){
    const dx=p.axes[0],dy=p.axes[1];
    if(Math.abs(dx)+Math.abs(dy)>.15){
      cursor.style.display="block";
      x+=dx*18; y+=dy*18;
      x=Math.max(0,Math.min(innerWidth,x));
      y=Math.max(0,Math.min(innerHeight,y));
      cursor.style.left=(x-13)+"px";
      cursor.style.top=(y-13)+"px";
      window.dispatchEvent(new PointerEvent("pointermove",{clientX:x,clientY:y}));
    }
  }
  requestAnimationFrame(loop);
}
loop();
})();
