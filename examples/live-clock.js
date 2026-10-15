// Live local time. The app calls refreshMs after a live drawing and schedules the next refresh.
// No interval, mutable counter, or persistent Worker is needed. Exports are static snapshots.
({
  initState(){ return {}; },
  initStyle(){ return { w:180, h:208, strokeOn:false, fontSize:14 }; },
  refreshMs(){ return 1000; },
  children(state, style, w, h){
    const now=new Date();
    const d=Math.max(1,Math.min(w,h-28)), cx=w/2, cy=d/2, r=d/2;
    const thin=Math.max(1,(style.size||2)/2);
    const items=[{type:'ellipse',x:cx-r,y:0,w:d,h:d,color:style.color,size:thin,
      strokeOn:true,fill:style.fill,fillColor:style.fillColor}];
    for(let i=0;i<12;i++){
      const a=i/12*Math.PI*2;
      items.push({type:'line',x1:cx+Math.sin(a)*r*.84,y1:cy-Math.cos(a)*r*.84,
        x2:cx+Math.sin(a)*r*.95,y2:cy-Math.cos(a)*r*.95,color:style.color,size:thin});
    }
    const seconds=now.getSeconds(), minutes=now.getMinutes()+seconds/60;
    const hours=now.getHours()%12+minutes/60;
    for(const [value,total,length,size,color] of [
      [hours,12,.5,style.size||2,style.color],
      [minutes,60,.72,style.size||2,style.color],
      [seconds,60,.82,thin,style.textColor]
    ]){
      const a=value/total*Math.PI*2;
      items.push({type:'line',x1:cx,y1:cy,x2:cx+Math.sin(a)*r*length,
        y2:cy-Math.cos(a)*r*length,color,size});
    }
    const pad=n=>String(n).padStart(2,'0');
    items.push({type:'text',x:0,y:d+4,w,h:24,
      text:[now.getHours(),now.getMinutes(),seconds].map(pad).join(':'),
      align:'center',font:style.font,color:style.textColor,strokeOn:false,fill:false});
    return items;
  },
})
