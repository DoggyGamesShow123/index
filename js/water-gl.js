(function(){
const canvas=document.getElementById("ocean");
const gl=canvas.getContext("webgl");
if(!gl){ canvas.style.display="none"; return; }

let W,H,time=0;
let mx=0,my=0,impulse=0;

function resize(){
  W=canvas.width=innerWidth;
  H=canvas.height=innerHeight;
  gl.viewport(0,0,W,H);
}
addEventListener("resize",resize);
resize();

const vs=`
attribute vec2 p;
varying vec2 uv;
void main(){uv=p*.5+.5;gl_Position=vec4(p,0,1);}
`;

const fs=`
precision highp float;
varying vec2 uv;
uniform float t;
uniform vec2 m;
uniform float impulse;

float wave(vec2 p){
  return sin(p.x*8.+t*2.)*.04 +
         sin(p.y*6.-t*1.6)*.04;
}

void main(){
  vec2 p=uv*2.-1.;
  float d=length(p-m);
  float drag=exp(-d*8.)*impulse;

  float w=wave(p)+drag;

  vec3 deep=vec3(0.02,0.1,0.18);
  vec3 shallow=vec3(0.1,0.4,0.6);
  vec3 col=mix(deep,shallow,uv.y+w);

  // caustics
  float c=sin((p.x+p.y)*14.+t*3.);
  col+=pow(abs(c),2.)*.08;

  gl_FragColor=vec4(col,1);
}
`;

function compile(t,s){
  const sh=gl.createShader(t);
  gl.shaderSource(sh,s);
  gl.compileShader(sh);
  return sh;
}

const prog=gl.createProgram();
gl.attachShader(prog,compile(gl.VERTEX_SHADER,vs));
gl.attachShader(prog,compile(gl.FRAGMENT_SHADER,fs));
gl.linkProgram(prog);
gl.useProgram(prog);

const buf=gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER,buf);
gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
const loc=gl.getAttribLocation(prog,"p");
gl.enableVertexAttribArray(loc);
gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);

const ut=gl.getUniformLocation(prog,"t");
const um=gl.getUniformLocation(prog,"m");
const ui=gl.getUniformLocation(prog,"impulse");

function loop(){
  time+=0.016;
  impulse*=0.92;
  gl.uniform1f(ut,time);
  gl.uniform2f(um,mx,my);
  gl.uniform1f(ui,impulse);
  gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
  requestAnimationFrame(loop);
}
loop();

/* Input */
function setPos(x,y){
  mx=(x/W)*2-1;
  my=1-(y/H)*2;
  impulse=Math.min(1,impulse+.08);
}

addEventListener("pointermove",e=>setPos(e.clientX,e.clientY));
addEventListener("pointerdown",e=>{setPos(e.clientX,e.clientY); impulse=1;});

/* Reflection distortion */
setInterval(()=>{
  document.querySelectorAll(".reflect").forEach(r=>{
    const ox=(Math.random()-.5)*6;
    r.style.transform=`scaleY(-1) translateX(${ox}px)`;
  });
},50);

window.water={
  pause(){canvas.style.display="none";},
  resume(){canvas.style.display="block";}
};
})();
