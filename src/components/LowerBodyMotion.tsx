import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { sampleLowerBody, THIGH, SHIN, STEP_HEIGHT, type Activity, type LowerBodyPose, type Point2 } from "../anatomy/lowerBody";
import { useLanguage } from "../i18n/Language";
import { useVisibleCanvas } from "../hooks/useVisibleCanvas";
type Props = { activity: Activity; phaseRef: { current: number }; manualAngle: number; reducedMotion: boolean };
const leftColor = '#8fb5ff', rightColor = '#f0cf86';
const beltGridSpacing = (0.48 / 0.62) / 4;
const position = (p: Point2, side: number) => new THREE.Vector3(side * 0.16, p.height, p.forward);
class RigBoundary extends Component<{children: ReactNode; fallback: ReactNode}, {failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed?this.props.fallback:this.props.children;}
}
function RigScene({ activity, phaseRef, manualAngle }: Props) {
  const pelvis=useRef<THREE.Group>(null), leftThigh=useRef<THREE.Mesh>(null), rightThigh=useRef<THREE.Mesh>(null), leftShin=useRef<THREE.Mesh>(null), rightShin=useRef<THREE.Mesh>(null);
  const joints=useRef<(THREE.Mesh|null)[]>([]), feet=useRef<(THREE.Group|null)[]>([]), grid=useRef<THREE.Group>(null);
  const {camera,size}=useThree();
  useEffect(()=>{
    const c=camera as THREE.OrthographicCamera;
    c.zoom=Math.min(size.width/1.65,size.height/1.48);c.lookAt(0,0.57,0.12);c.updateProjectionMatrix();
  },[camera,size]);
  const placeBone=(mesh: THREE.Mesh|null,a:THREE.Vector3,b:THREE.Vector3)=>{
    if(!mesh)return;mesh.position.copy(a).lerp(b,0.5);mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),a.clone().sub(b).normalize());
  };
  useFrame(()=>{
    const pose=sampleLowerBody(activity,phaseRef.current,manualAngle);
    pelvis.current?.position.set(0,pose.hip.height,pose.hip.forward);
    [pose.left,pose.right].forEach((leg,i)=>{
      const side=i===0?-1:1,h=position(leg.hip,side),k=position(leg.knee,side),a=position(leg.ankle,side);
      placeBone(i===0?leftThigh.current:rightThigh.current,h,k);placeBone(i===0?leftShin.current:rightShin.current,k,a);
      [h,k,a].forEach((point,j)=>joints.current[i*3+j]?.position.copy(point));
      feet.current[i]?.position.copy(a);
    });
    if(grid.current)grid.current.position.z=activity==='walking'?-(pose.beltOffset % beltGridSpacing):0;
  });
  return <>
    <ambientLight intensity={1.7}/><directionalLight position={[2,3,4]} intensity={2.4}/><directionalLight position={[-2,1,-2]} intensity={1} color="#8fb5ff"/>
    <group ref={pelvis}>

    </group>
    {/* A restrained, schematic pelvic ring supplies a stable hip reference. */}
    <PelvicShape pelvis={pelvis}/>
    {[{thigh:leftThigh,shin:leftShin,color:leftColor},{thigh:rightThigh,shin:rightShin,color:rightColor}].map((leg,i)=><group key={i}>
      <mesh ref={leg.thigh}><cylinderGeometry args={[0.023,0.033,THIGH,20]}/><meshStandardMaterial color="#eeeaf2" roughness={0.6}/></mesh>
      <mesh ref={leg.shin}><cylinderGeometry args={[0.032,0.018,SHIN,20]}/><meshStandardMaterial color="#d8dce9" roughness={0.65}/></mesh>
      {[0,1,2].map(j=><mesh key={j} ref={e=>{joints.current[i*3+j]=e;}}><sphereGeometry args={[j===1?0.042:0.029,20,16]}/><meshStandardMaterial color={j===1?leg.color:'#dce3f5'} roughness={0.45}/></mesh>)}
      <group ref={e=>{feet.current[i]=e;}}>
        <mesh position={[0,-0.049,0.062]}><boxGeometry args={[0.11,0.062,0.266]}/><meshStandardMaterial color={leg.color} roughness={0.65}/></mesh>
        <mesh position={[0,-0.025,0.025]} scale={[0.052,0.044,0.095]}><sphereGeometry args={[1,20,12]}/><meshStandardMaterial color="#e1e5ee"/></mesh>
      </group>
    </group>)}
    <mesh rotation={[-Math.PI/2,0,0]} position={[0,-0.003,0]}><planeGeometry args={[2.2,2]}/><meshStandardMaterial color="#111a2f" roughness={1}/></mesh>
    <group ref={grid}>{Array.from({length:11},(_,i)=><mesh key={i} position={[0,0.001,-0.9+i*beltGridSpacing]}><boxGeometry args={[1.4,0.002,0.002]}/><meshBasicMaterial color="#8fb5ff" transparent opacity={0.18}/></mesh>)}</group>
    {activity==='stairs'&&<mesh position={[0,STEP_HEIGHT/2,0.57]}><boxGeometry args={[0.95,STEP_HEIGHT,0.64]}/><meshStandardMaterial color="#223653" roughness={0.8}/></mesh>}
  </>;
}
function PelvicShape({pelvis}:{pelvis:React.RefObject<THREE.Group|null>}){
  const shape=useRef<THREE.Group>(null);
  useFrame(()=>{if(shape.current&&pelvis.current)shape.current.position.copy(pelvis.current.position);});
  return <group ref={shape}>
    {[-1,1].map(side=><mesh key={side} position={[side*0.12,0.05,0]} rotation={[0,0,-side*0.3]} scale={[0.10,0.12,0.065]}><sphereGeometry args={[1,24,16]}/><meshStandardMaterial color="#dedfee" roughness={0.65}/></mesh>)}
    <mesh position={[0,0.045,-0.015]} scale={[0.07,0.085,0.05]}><sphereGeometry args={[1,20,16]}/><meshStandardMaterial color="#bfc7dd"/></mesh>
    <mesh position={[0,0.14,-0.02]}><cylinderGeometry args={[0.035,0.05,0.12,16]}/><meshStandardMaterial color="#d5dbeb"/></mesh>
  </group>;
}
function MotionDiagram({pose,activity}:{pose:LowerBodyPose;activity:Activity}){
  const {t}=useLanguage();
  const p=(point:Point2,side:number)=>({x:300+point.forward*280+side*26,y:370-point.height*280-side*8});
  const hipLeft=p(pose.hip,-1),hipRight=p(pose.hip,1);
  return <svg className="lower-body-diagram" viewBox="0 0 600 440" role="img" aria-label={t('Both legs with hip, knee, ankle and foot motion')}>
    {[-1,1].map(side=><line key={side} x1="70" x2="530" y1={370-side*8} y2={370-side*8} stroke="#6c83aa" strokeWidth="2"/>)}
    {activity==='walking'&&[-1,1].flatMap(side=>Array.from({length:11},(_,i)=>{
      const x=300+(-0.9+i*beltGridSpacing-(pose.beltOffset%beltGridSpacing))*280+side*26;
      return <line key={`${side}-${i}`} x1={x} x2={x} y1={367-side*8} y2={373-side*8} stroke="#8fb5ff" strokeWidth="2"/>;
    }))}
    {activity==='stairs'&&[-1,1].map(side=><path key={side} d={`M${370+side*26} ${370-side*8} L${370+side*26} ${370-side*8-STEP_HEIGHT*280} L550 ${370-side*8-STEP_HEIGHT*280} L550 ${370-side*8}`} fill="#223653" stroke="#8fb5ff" strokeWidth="2"/>)}
    <path d={`M${hipLeft.x-15} ${hipLeft.y-20} Q300 ${Math.min(hipLeft.y,hipRight.y)-65} ${hipRight.x+15} ${hipRight.y-20} L${hipRight.x} ${hipRight.y} L${hipLeft.x} ${hipLeft.y} Z`} fill="#c5cde13b" stroke="#dce3f5" strokeWidth="3"/>
    {[pose.right,pose.left].map((leg,index)=>{
      const side=index===0?1:-1,color=index===0?rightColor:leftColor,h=p(leg.hip,side),k=p(leg.knee,side),a=p(leg.ankle,side);
      return <g key={index}><path d={`M${h.x} ${h.y} L${k.x} ${k.y} L${a.x} ${a.y}`} fill="none" stroke="#dce3f5" strokeWidth="12" strokeLinecap="round"/>
        <path d={`M${a.x-15} ${a.y+14} L${a.x+44} ${a.y+14}`} stroke={color} strokeWidth="14" strokeLinecap="round"/>
        {[h,k,a].map((point,i)=><circle key={i} cx={point.x} cy={point.y} r={i===1?9:6} fill={color}/>)}
      </g>;
    })}
    <text x="44" y="44" fill={leftColor} fontSize="17">{t('Left leg')}</text><text x="430" y="44" fill={rightColor} fontSize="17">{t('Right leg')}</text>
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
  const fallback=<MotionDiagram pose={pose} activity={props.activity}/>;
  return <div className="lower-body-view" ref={ref}>
    <div className="lower-body-scene">{diagram?fallback:visible&&<RigBoundary fallback={fallback}><Canvas orthographic camera={{position:[1.8,1.3,2.7],near:0.1,far:30}} dpr={[1,1.5]}><RigScene {...props}/></Canvas></RigBoundary>}</div>
    <div className="lower-body-status"><span>{t(pose.phaseLabel)}</span><button type="button" onClick={()=>setDiagram(value=>!value)}>{t(diagram?'3D view':'2D view')}</button></div>
    <div className="lower-body-legs"><span style={{color:leftColor}}>{t('Left leg')}: {Math.round(pose.left.flexion)}° · {t(pose.left.contact?'Support':'Swing')}</span><span style={{color:rightColor}}>{t('Right leg')}: {Math.round(pose.right.flexion)}° · {t(pose.right.contact?'Support':'Swing')}</span></div>
    <p className="lower-body-note">{t(props.activity==='walking'?'Body-relative walking view · The floor moves beneath the stance foot.':'Schematic hip, knee and ankle coordination · Feet stay level during support.')}</p>
  </div>;
}
