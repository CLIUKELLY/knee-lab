import { type KneeModelProps } from "./KneeAnatomy";
import { useEffect, useState } from "react";
import { sampleLowerBody, STEP_HEIGHT, WALK_STRIDE, type Activity, type LowerBodyPose, type Point2 } from "../anatomy/lowerBody";
import { useLanguage } from "../i18n/Language";
import { useVisibleCanvas } from "../hooks/useVisibleCanvas";
type Props = { anatomy: Omit<KneeModelProps,"flexion">; activity: Activity; phaseRef: { current: number }; manualAngle: number; reducedMotion: boolean };
const leftColor = '#8fb5ff', rightColor = '#f0cf86';
const beltGridSpacing = (WALK_STRIDE / 0.62) / 4;
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
        <path d={`M${h.x} ${h.y} L${k.x} ${k.y} L${a.x} ${a.y}`} fill="none" stroke={side<0?leftColor:rightColor} strokeWidth="24" opacity="0.12" strokeLinecap="round" strokeLinejoin="round"/>
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
    <g fontSize="15" fontWeight="600"><circle cx="42" cy="33" r="5" fill={leftColor}/><text x="54" y="38" fill="#dbe6ff">{t('Left leg')}</text><circle cx="432" cy="33" r="5" fill={rightColor}/><text x="444" y="38" fill="#f7e8c4">{t('Right leg')}</text></g>
  </svg>;
}
export default function LowerBodyMotion(props:Props){
  const {t}=useLanguage();const {ref,visible}=useVisibleCanvas('150px');const [frame,setFrame]=useState(0);
  useEffect(()=>{
    if(!visible||props.reducedMotion||props.activity==='manual')return;
    let id=0,last=0;const tick=(now:number)=>{if(now-last>=33){setFrame(now);last=now;}id=requestAnimationFrame(tick);};id=requestAnimationFrame(tick);return()=>cancelAnimationFrame(id);
  },[visible,props.reducedMotion,props.activity]);
  void frame;
  const pose=sampleLowerBody(props.activity,props.phaseRef.current,props.manualAngle);
  return <div className="lower-body-view" ref={ref}>
    <div className="lower-body-scene"><MotionDiagram pose={pose} activity={props.activity} anatomy={props.anatomy}/></div>
    <div className="lower-body-status"><span>{t(pose.phaseLabel)}</span><span className="lower-body-mode">{t('2D anatomical illustration')}</span></div>
    <div className="lower-body-legs"><span style={{color:leftColor}}>{t('Left leg')}: {Math.round(pose.left.flexion)}° · {t(pose.left.contact?'Support':'Swing')}</span><span style={{color:rightColor}}>{t('Right leg')}: {Math.round(pose.right.flexion)}° · {t(pose.right.contact?'Support':'Swing')}</span></div>
    <p className="lower-body-note">{t(props.activity==='walking'?'Body-relative walking view · The floor moves beneath the stance foot.':'Illustrative anatomy · The pelvis, feet and tissue shapes are schematic.')}</p>
  </div>;
}
