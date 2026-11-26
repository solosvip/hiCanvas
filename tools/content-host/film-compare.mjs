import {app,nativeImage} from 'electron'
import {readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'

app.setActivationPolicy?.('prohibited')
app.setPath('userData',process.argv.at(-2));app.setPath('sessionData',process.argv.at(-2))
try{
  const directory=process.argv.at(-1),results=[],pcm=[]
  const read=name=>readFile(join(directory,name))
  const [off,on]=await Promise.all(['off','on'].map(async mode=>JSON.parse(await read(mode+'.json'))))
  if(off.frames.length!==30||JSON.stringify(off.frames)!==JSON.stringify(on.frames))throw new Error('帧数或时间戳改变')
  for(let index=0;index<30;index++){
    const images=['off','on'].map(mode=>nativeImage.createFromPath(join(directory,mode+'-frame-'+index+'.png')))
    if(images.some(image=>image.getSize().width!==320||image.getSize().height!==180))throw new Error('输出帧尺寸改变')
    const [a,b]=images.map(image=>image.toBitmap());let changed=0,total=0,red=0,green=0,yellow=0,yellowX=0,title=0,star=0,background=0
    for(let pixel=0;pixel<a.length;pixel+=4){
      let max=0
      for(let channel=0;channel<4;channel++){const delta=Math.abs(a[pixel+channel]-b[pixel+channel]);total+=delta;max=Math.max(max,delta)}
      if(max>8)changed++
      if(a[pixel+2]>180&&a[pixel+1]<150)red++
      if(a[pixel+1]>100&&a[pixel+2]<90)green++
      const x=(pixel/4)%320,y=Math.floor(pixel/4/320)
      if(x>=200&&x<296&&y>=100&&y<164&&a[pixel+2]>180&&a[pixel+1]>130&&a[pixel]<100){yellow++;yellowX+=x}
      if(x>=78&&x<300&&y>=20&&y<80&&a[pixel+2]>210&&a[pixel+1]>210&&a[pixel]>210)title++
      if(x>=24&&x<76&&y>=14&&y<65&&a[pixel+2]>180&&a[pixel+1]>120&&a[pixel]<180)star++
      if(a[pixel]>a[pixel+2]+30)background++
    }
    const ratio=changed/(a.length/4),mean=total/a.length
    if(ratio>.01||mean>.5)throw new Error('帧像素差异超限 '+index+' '+ratio+' '+mean)
    if(red<200||green<1000)throw new Error('动画或内嵌视频未出现 '+index+' '+red+' '+green)
    if(yellow<200)throw new Error('内嵌视频黄色条缺失 '+index)
    if(title<100||star<60||background<20000)throw new Error('字体、伪元素或背景缺失 '+index+' '+title+' '+star+' '+background)
    results.push({index,changedPixels:changed,ratio,mean,red,green,title,star,background,videoYellowCenter:yellowX/yellow})
  }
  if(results.at(-1).videoYellowCenter-results[0].videoYellowCenter<40)throw new Error('内嵌视频没有随逐帧时间解码')
  if((await read('off-frame-0.png')).equals(await read('off-frame-29.png'))|| (await read('on-frame-0.png')).equals(await read('on-frame-29.png')))throw new Error('影片没有逐帧变化')
  for(let channel=0;channel<2;channel++){
    const [a,b]=await Promise.all(['off','on'].map(mode=>read(mode+'-pcm-'+channel+'.f32')))
    if(a.length!==48000*4||b.length!==a.length)throw new Error('PCM长度改变')
    let max=0,energy=0,pre=0,pulse=0
    for(let offset=0;offset<a.length;offset+=4){const sample=a.readFloatLE(offset);max=Math.max(max,Math.abs(sample-b.readFloatLE(offset)));energy+=sample*sample;if(offset<4800*4)pre+=sample*sample;if(offset>=24000*4&&offset<28800*4)pulse+=sample*sample}
    if(max!==0||energy<=1||pulse<=pre*1.5)throw new Error('PCM不一致或音乐/音效缺失 '+max+' '+energy+' '+pre+' '+pulse)
    pcm.push({channel,samples:48000,maxAbsoluteDifference:max,energy,pre,pulse})
  }
  if((await read('off-pcm-0.f32')).equals(await read('off-pcm-1.f32')))throw new Error('立体声音轨未保留不同的左右声道')
  const legacy=[]
  for(let channel=0;channel<2;channel++){
    const [a,b,reference]=await Promise.all(['off-legacy','on-legacy','off'].map(mode=>read(mode+'-pcm-'+channel+'.f32')))
    if(a.length!==48000*4||!a.equals(b)||!a.equals(reference))throw new Error('旧Web Audio音轨与现代renderAudio结果不一致')
    legacy.push({channel,samples:48000,maxAbsoluteDifference:0})
  }
  const report={tolerance:{channelDelta:8,maxChangedRatio:.01,maxMeanAbsoluteDifference:.5,pcmMaxAbsoluteDifference:0},results,pcm,elapsed:{off:off.artifacts.elapsed,on:on.artifacts.elapsed,ratio:on.artifacts.elapsed/off.artifacts.elapsed},slow:{off:off.artifacts.slow,on:on.artifacts.slow},slowAudio:{off:off.artifacts.slowAudio,on:on.artifacts.slowAudio},failures:on.artifacts.failures}
  report.phaseFailures=on.artifacts.phaseFailures
  report.legacy=legacy
  await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2));app.exit(0)
}catch(error){console.error(error);app.exit(1)}
