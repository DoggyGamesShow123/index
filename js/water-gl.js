(function(){
const canvas=document.getElementById("ocean");
let gl=canvas.getContext("webgl");
if(!gl){
  console.warn("Low-end GPU detected: disabling water");
  canvas.style.display="none";
  window.water={pause(){},resume(){},setMode(){}};
  return;
}

let W,H,time=0,mode="calm";
function resize(){
  W=canvas.width=innerWidth;
  H=canvas.height=innerHeight;
  gl.viewport(0,0,W,H);
}
addEventListener("resize",resize);
resize();

const vs=`attribute vec2 p;varying vec2 uv;
void main(){uv=p*.5+.5;gl_Position=vec4(p,0,1);}`;

const fs=`precision highp float;
varying vec2 uv;
uniform float t;
uniform int mode;

float noise(vec2 p){
 return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5);
}

void main(){
 vec2 p=uv*2.-1.;
 float w=sin(p.x*6.+t)*.04+sin(p.y*4.-t)*.04;

 float caust=sin((p.x+p.y)*14.+t*2.);
 caust+=sin(p.x*18.-t*1.6);
 caust=pow(abs(caust),2.);

 float beams=exp(-abs(p.x)*6.)*sin(t*2.+p.y*6.)*.15;

 if(mode==1) caust+=noise(p*40.+t*3.)*.4;
 if(mode==2) caust+=noise(p*60.+t*6.)*.8;

 vec3 deep=vec3(0.02,0.15,0.25);
 vec3 shallow=vec3(0.1,0.45,0.65);
 vec3 col=mix(deep,shallow,uv.y+w);

 col+=caust*.12;
 col+=beams;

 gl_FragColor=vec4(col,1);
}`;

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
const um=gl.getUniformLocation(prog,"mode");

function loop(){
 time+=0.016;
 gl.uniform1f(ut,time);
 gl.uniform1i(um,mode==="calm"?0:mode==="rain"?1:2);
 gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
 requestAnimationFrame(loop);
}
loop();

window.water={
 pause(){canvas.style.display="none";},
 resume(){canvas.style.display="block";},
 setMode(m){mode=m;}
};
})();
