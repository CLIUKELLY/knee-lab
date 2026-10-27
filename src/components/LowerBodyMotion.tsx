import { KneeModel, createTissueTexture, type KneeModelProps } from "./KneeAnatomy";
import { pivot } from "../anatomy/motion";
import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { sampleLowerBody, THIGH, SHIN, STEP_HEIGHT, WALK_STRIDE, type Activity, type LowerBodyPose, type Point2 } from "../anatomy/lowerBody";
import { useLanguage } from "../i18n/Language";
import { useVisibleCanvas } from "../hooks/useVisibleCanvas";
type Props = { anatomy: Omit<KneeModelProps,"flexion">; activity: Activity; phaseRef: { current: number }; manualAngle: number; reducedMotion: boolean };
const leftColor = '#8fb5ff', rightColor = '#f0cf86';
const beltGridSpacing = (WALK_STRIDE / 0.62) / 4;
const position = (p: Point2, side: number) => new THREE.Vector3(side * 0.16, p.height, p.forward);
class RigBoundary extends Component<{children: ReactNode; fallback: ReactNode}, {failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed?this.props.fallback:this.props.children;}
}
function DetailedLeg({side,props}:{side:number;props:Props}) {
  const root=useRef<THREE.Group>(null), angle=useRef(0);
  useFrame(()=>{
    const pose=sampleLowerBody(props.activity,props.phaseRef.current,props.manualAngle);
    const leg=side<0?pose.left:pose.right;
    angle.current=leg.flexion;
    if(root.current){
      root.current.position.set(side*0.16,leg.knee.height,leg.knee.forward);
      root.current.rotation.x=Math.atan2(leg.hip.forward-leg.knee.forward,leg.hip.height-leg.knee.height);
    }
  },-2);
  return <group ref={root}><group scale={[side<0?-1:1,1,1]}><group position={[-pivot.x,-pivot.y,-pivot.z]}>
    <KneeModel {...props.anatomy} anatomicalSpace flexion={0} flexionSource={angle} viewRotation={0} boneContextOpacity={0.16} showLabels={props.anatomy.showLabels && (side<0 || props.anatomy.selected!=="all")}/>
  </group></group></group>;
}
function BoneMaterial({anatomy}:{anatomy:Props['anatomy']}){
  const texture=useMemo(()=>createTissueTexture('bone'),[]);
  useEffect(()=>()=>texture.dispose(),[texture]);
  const active=anatomy.selected==='all'||anatomy.selected==='bone';
  return <meshPhysicalMaterial color="#eeeaf2" map={texture} bumpMap={texture} bumpScale={0.00055} roughness={0.48} clearcoat={0.12} transparent={!active||anatomy.xray} opacity={!active?0.16:anatomy.xray?0.12:1} depthWrite={active&&!anatomy.xray} wireframe={anatomy.xray}/>;
}
function DetailedFoot({side,props}:{side:number;props:Props}){
  const root=useRef<THREE.Group>(null);
  useFrame(()=>{
    const pose=sampleLowerBody(props.activity,props.phaseRef.current,props.manualAngle);
    const leg=side<0?pose.left:pose.right;
    root.current?.position.set(side*0.16,leg.ankle.height,leg.ankle.forward);
  },-2);
  const select=()=>{props.anatomy.onSelect('bone');props.anatomy.onEntitySelect(null);};
  return <group ref={root} onClick={event=>{event.stopPropagation();select();}}>
    {/* Tarsal blocks and five metatarsal / phalange rays extend the source knee. */}
    {[{p:[0,-0.047,-0.032],s:[0.038,0.031,0.048]},{p:[0,-0.016,-0.008],s:[0.03,0.023,0.028]},{p:[-side*0.018,-0.035,0.035],s:[0.027,0.02,0.031]},{p:[side*0.025,-0.049,0.035],s:[0.024,0.021,0.029]}].map((bone,i)=><mesh key={i} position={bone.p as [number,number,number]} scale={bone.s as [number,number,number]}><sphereGeometry args={[1,20,16]}/><BoneMaterial anatomy={props.anatomy}/></mesh>)}
    {Array.from({length:5},(_,i)=>{
      const x=(i-2)*0.018*side,length=0.082-i*0.006;
      return <group key={i} position={[x,-0.055,0.07]} rotation={[0,(i-2)*0.065*side,0]}>
        <mesh position={[0,0,length/2]} rotation={[Math.PI/2,0,0]}><capsuleGeometry args={[i===0?0.009:0.006,length,5,12]}/><BoneMaterial anatomy={props.anatomy}/></mesh>
        {[0,1,2].slice(0,i===0?2:3).map(j=><mesh key={j} position={[0,-0.006,length+0.017+j*0.018]} rotation={[Math.PI/2,0,0]}><capsuleGeometry args={[i===0?0.009:0.0055,0.012,4,10]}/><BoneMaterial anatomy={props.anatomy}/></mesh>)}
      </group>;
    })}
  </group>;
}
function DetailedPelvis({props}:{props:Props}){
  const root=useRef<THREE.Group>(null);
  const wing=useMemo(()=>{
    const shape=new THREE.Shape();shape.moveTo(0.025,0.13);shape.bezierCurveTo(0.12,0.23,0.25,0.17,0.22,0.07);shape.bezierCurveTo(0.20,0,0.13,-0.05,0.11,-0.12);shape.bezierCurveTo(0.02,-0.15,0.01,-0.06,0.035,0.005);shape.lineTo(0.025,0.13);
    const hole=new THREE.Path();hole.absellipse(0.075,-0.065,0.028,0.035,0,Math.PI*2,true,0);shape.holes.push(hole);
    const geometry=new THREE.ExtrudeGeometry(shape,{depth:0.045,bevelEnabled:true,bevelSegments:4,steps:1,bevelSize:0.009,bevelThickness:0.009,curveSegments:24});geometry.translate(0,0,-0.025);return geometry;
  },[]);
  useEffect(()=>()=>wing.dispose(),[wing]);
  useFrame(()=>{const pose=sampleLowerBody(props.activity,props.phaseRef.current,props.manualAngle);root.current?.position.set(0,pose.hip.height,pose.hip.forward);},-2);
  return <group ref={root}>
    {[-1,1].map(side=><mesh key={side} geometry={wing} scale={[side,1,1]}><BoneMaterial anatomy={props.anatomy}/></mesh>)}
    <mesh position={[0,0.06,-0.025]} scale={[0.045,0.075,0.035]}><sphereGeometry args={[1,20,16]}/><BoneMaterial anatomy={props.anatomy}/></mesh>
  </group>;
}
function RigScene(props:Props){
  const grid=useRef<THREE.Group>(null);const {camera,size}=useThree();
  useEffect(()=>{const c=camera as THREE.OrthographicCamera;c.zoom=Math.min(size.width/1.65,size.height/1.55);c.lookAt(0,0.58,0.10);c.updateProjectionMatrix();},[camera,size]);
  useFrame(()=>{if(grid.current){const pose=sampleLowerBody(props.activity,props.phaseRef.current,props.manualAngle);grid.current.position.z=props.activity==='walking'?-(pose.beltOffset%beltGridSpacing):0;}});
  return <>
    <ambientLight intensity={0.85}/><hemisphereLight args={["#f3f6ff","#343047",1.25]}/><directionalLight position={[3,4,5]} intensity={2.8}/><directionalLight position={[-4,1,-3]} intensity={1.4} color="#c7dcff"/>
    <DetailedPelvis props={props}/>
    <Suspense fallback={null}>{[-1,1].map(side=><DetailedLeg key={side} side={side} props={props}/>)}</Suspense>
    {[-1,1].map(side=><DetailedFoot key={side} side={side} props={props}/>)}
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,-0.003,0]}><planeGeometry args={[2.2,2]}/><meshStandardMaterial color="#111a2f" roughness={1}/></mesh>
    <group ref={grid}>{Array.from({length:11},(_,i)=><mesh key={i} position={[0,0.001,-0.9+i*beltGridSpacing]}><boxGeometry args={[1.4,0.002,0.002]}/><meshBasicMaterial color="#8fb5ff" transparent opacity={0.18}/></mesh>)}</group>
    {props.activity==='stairs'&&<mesh position={[0,STEP_HEIGHT/2,0.57]}><boxGeometry args={[0.95,STEP_HEIGHT,0.64]}/><meshStandardMaterial color="#223653" roughness={0.8}/></mesh>}
  </>;
}
function MotionDiagram({pose,activity,anatomy}:{pose:LowerBodyPose;activity:Activity;anatomy:Props['anatomy']}){
  const {t}=useLanguage();
  const p=(point:Point2,side:number)=>({x:300+point.forward*280+side*31,y:370-point.height*280-side*10});
  type P={x:number;y:number};
  const opacity=(layer:string)=>anatomy.selected==='all'||anatomy.selected===layer?1:layer==='bone'?0.16:0.06;
  const bone=(a:P,b:P,width:number)=>{
    const dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy),nx=-dy/l,ny=dx/l;
    const q=(u:number,w:number)=>`${a.x+dx*u+nx*w},${a.y+dy*u+ny*w}`;
    return `M${q(0,width)} Q${q(-0.11,0)} ${q(0,-width)} C${q(0.22,-width*0.5)} ${q(0.73,-width*0.35)} ${q(0.91,-width)} Q${q(1.09,-width*1.3)} ${q(1,width*0.2)} Q${q(1.03,width*1.45)} ${q(0.90,width)} C${q(0.72,width*0.35)} ${q(0.25,width*0.45)} ${q(0,width)} Z`;
  };
  const muscle=(a:P,b:P,side:number)=>{
    const dx=b.x-a.x,dy=b.y-a.y,l=Math.hypot(dx,dy),nx=-dy/l,ny=dx/l;
    const q=(u:number,w:number)=>`${a.x+dx*u+nx*w*side},${a.y+dy*u+ny*w*side}`;
    return `M${q(0.07,7)} C${q(0.15,29)} ${q(0.64,25)} ${q(0.93,10)} C${q(0.65,8)} ${q(0.35,5)} ${q(0.07,7)} Z`;
  };
  const hp=p(pose.hip,0);
  return <svg className="lower-body-diagram" viewBox="0 0 600 440" role="img" aria-label={t('Anatomical illustration of both legs with tissue layers')}>
    <defs><linearGradient id="leg-bone"><stop stopColor="#fff8ee"/><stop offset=".5" stopColor="#d4d6df"/><stop offset="1" stopColor="#f3eff8"/></linearGradient><linearGradient id="leg-muscle"><stop stopColor="#d98580"/><stop offset=".6" stopColor="#a94751"/><stop offset="1" stopColor="#f0afa0"/></linearGradient></defs>
    {[-1,1].map(side=><line key={side} x1="70" x2="540" y1={370-side*10} y2={370-side*10} stroke="#6c83aa" strokeWidth="2"/>)}
    {activity==='walking'&&[-1,1].flatMap(side=>Array.from({length:11},(_,i)=>{
      const x=300+(-0.9+i*beltGridSpacing-(pose.beltOffset%beltGridSpacing))*280+side*31;
      return <line key={`${side}-${i}`} x1={x} x2={x} y1={367-side*10} y2={373-side*10} stroke="#8fb5ff" strokeWidth="2"/>;
    }))}
    {activity==='stairs'&&[-1,1].map(side=><path key={side} d={`M${370+side*31} ${370-side*10} L${370+side*31} ${370-side*10-STEP_HEIGHT*280} L550 ${370-side*10-STEP_HEIGHT*280} L550 ${370-side*10}`} fill="#223653" stroke="#8fb5ff" strokeWidth="2"/>)}
    <g opacity={opacity('bone')} fill="url(#leg-bone)" stroke="#ebedf6" strokeWidth="1.5">
      {[-1,1].map(side=><g key={side} transform={`translate(${hp.x},${hp.y}) scale(${side},1)`}><path d="M3 -43 Q24 -65 52 -37 Q61 -19 31 -6 Q32 13 16 18 Q-2 14 9 -10 L3 -43 Z"/><ellipse cx="17" cy="5" rx="7" ry="9" fill="#0a1020"/></g>)}
    </g>
    {[pose.right,pose.left].map((leg,index)=>{
      const side=index===0?1:-1,h=p(leg.hip,side),k=p(leg.knee,side),a=p(leg.ankle,side);
      const heat=anatomy.tensionMap?`hsl(${15+35*Math.min(leg.flexion/130,1)},85%,70%)`:'#f0cf86';
      const select=(key:Parameters<Props['anatomy']['onSelect']>[0])=>{anatomy.onSelect(key);anatomy.onEntitySelect(null);};
      return <g key={index}>
        <g opacity={opacity('bone')*(anatomy.xray?0.25:1)} fill="url(#leg-bone)" stroke="#f2eef7" strokeWidth="1" strokeDasharray={anatomy.xray?'3 3':undefined} onClick={()=>select('bone')}>
          <path d={bone(h,k,10)} transform={anatomy.exploded?'translate(0,-10)':undefined}/>
          <path d={bone(k,a,8)} transform={anatomy.exploded?'translate(0,10)':undefined}/>
          <path d={`M${k.x+10} ${k.y+9} Q${a.x+9} ${a.y-30} ${a.x+10} ${a.y}`} fill="none" strokeWidth="3"/>
          <ellipse cx={a.x-2} cy={a.y+14} rx="14" ry="9"/>
          {Array.from({length:5},(_,i)=><g key={i}><path d={`M${a.x+1} ${a.y+8+i*2} Q${a.x+17} ${a.y+2+i*3} ${a.x+35-i*2} ${a.y+8+i*3}`} fill="none" strokeWidth="3.5"/><path d={`M${a.x+38-i*2} ${a.y+8+i*3} l10 0 m2 0 l5 0`} fill="none" strokeWidth="3"/></g>)}
        </g>
        <g opacity={opacity('muscle')*0.8} fill="url(#leg-muscle)" stroke="#f0b6a3" strokeWidth=".7" onClick={()=>select('muscle')}>
          <path d={muscle(h,k,-1)}/><path d={muscle(h,k,1)}/><path d={muscle(k,a,1)}/>
        </g>
        <g opacity={opacity('cartilage')} fill="#69d2ff" onClick={()=>select('cartilage')}><ellipse cx={k.x} cy={k.y-7} rx="12" ry="3"/><ellipse cx={k.x} cy={k.y+8} rx="12" ry="3"/></g>
        <g opacity={opacity('meniscus')} fill="#a9b7ff" stroke="#e2ddff" strokeWidth=".7" onClick={()=>select('meniscus')}><path d={`M${k.x-13} ${k.y+1} q5 -7 9 1 q-3 5 -9 1 Z M${k.x+4} ${k.y+1} q5 -7 9 1 q-3 5 -9 1 Z`}/></g>
        <g opacity={opacity('ligament')} fill="none" stroke={heat} strokeWidth="2.5" strokeLinecap="round" onClick={()=>select('ligament')}>
          <path stroke={anatomy.aclState==='tear'?'#ff7794':anatomy.aclState==='strain'?'#ff775c':heat} d={anatomy.aclState==='tear'?`M${k.x-8} ${k.y-10} l5 8 m4 6 l5 7`:`M${k.x-8} ${k.y-10} Q${k.x} ${k.y} ${k.x+8} ${k.y+12}`}/>
          <path d={`M${k.x+8} ${k.y-10} L${k.x-8} ${k.y+12} M${k.x-15} ${k.y-12} q-3 16 1 28 M${k.x+15} ${k.y-12} q3 16 -1 28`}/>
        </g>
        <ellipse opacity={opacity('bone')} cx={k.x+17} cy={k.y} rx="4" ry="7" fill="#eeeaf2"/>
        {anatomy.showLabels&&index===1&&<text x={k.x+30} y={k.y-15} fill="#d3e4ff" fontSize="14">{t(anatomy.selected==='all'?'ACL':anatomy.selected==='muscle'?'Quadriceps':anatomy.selected==='bone'?'Patella':anatomy.selected==='cartilage'?'Cartilage':anatomy.selected==='meniscus'?'Menisci':'ACL')}</text>}
      </g>;
    })}
    <text x="44" y="35" fill={leftColor} fontSize="17">{t('Left leg')}</text><text x="430" y="35" fill={rightColor} fontSize="17">{t('Right leg')}</text>
  </svg>;
}
export default function LowerBodyMotion(props:Props){
  const {t}=useLanguage();const {ref,visible}=useVisibleCanvas('150px');const [diagram,setDiagram]=useState(false);const [frame,setFrame]=useState(0);
  useEffect(()=>{
    if(!visible||props.reducedMotion||props.activity==='manual')return;
    let id=0,last=0;const tick=(now:number)=>{if(now-last>=33){setFrame(now);last=now;}id=requestAnimationFrame(tick);};id=requestAnimationFrame(tick);return()=>cancelAnimationFrame(id);
  },[visible,props.reducedMotion,props.activity]);
  void frame;
  const pose=sampleLowerBody(props.activity,props.phaseRef.current,props.manualAngle);
  const fallback=<MotionDiagram pose={pose} activity={props.activity} anatomy={props.anatomy}/>;
  return <div className="lower-body-view" ref={ref}>
    <div className="lower-body-scene">{diagram?fallback:visible&&<RigBoundary fallback={fallback}><Canvas orthographic camera={{position:[1.8,1.3,2.7],near:0.1,far:30}} dpr={[1,1.5]}><RigScene {...props}/></Canvas></RigBoundary>}</div>
    <div className="lower-body-status"><span>{t(pose.phaseLabel)}</span><button type="button" onClick={()=>setDiagram(value=>!value)}>{t(diagram?'3D view':'2D view')}</button></div>
    <div className="lower-body-legs"><span style={{color:leftColor}}>{t('Left leg')}: {Math.round(pose.left.flexion)}° · {t(pose.left.contact?'Support':'Swing')}</span><span style={{color:rightColor}}>{t('Right leg')}: {Math.round(pose.right.flexion)}° · {t(pose.right.contact?'Support':'Swing')}</span></div>
    <p className="lower-body-note">{t(props.activity==='walking'?'Body-relative walking view · The floor moves beneath the stance foot.':'Detailed knee anatomy on both legs · Pelvis and feet are schematic extensions.')}</p>
  </div>;
}
