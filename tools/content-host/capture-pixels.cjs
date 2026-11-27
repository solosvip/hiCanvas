const {app,nativeImage}=require('electron')
const fs=require('node:fs'),path=require('node:path')
app.setActivationPolicy?.('prohibited')
const output=process.argv.at(-1),results=[]
try{
  for(const [left,right,strict]of [['first','repeat',false],['plain','plain-repeat',true],['plain','failed',true],['plain','timeout',true],['first','cross-origin',true],['first','script-font',true]]){
    for(const key of ['png','copy','annotation','page-01','page-02']){
      const images=[left,right].map(sample=>nativeImage.createFromPath(path.join(output,sample+'-'+key+'.png')))
      const size=images[0].getSize()
      if(images.some(image=>image.isEmpty())||JSON.stringify(size)!==JSON.stringify(images[1].getSize()))throw Error('PNG缺失或尺寸改变 '+key)
      const a=images[0].toBitmap(),b=images[1].toBitmap();let changed=0,total=0,red=0,green=0
      for(let i=0;i<a.length;i+=4){
        let max=0
        for(let c=0;c<4;c++){const delta=Math.abs(a[i+c]-b[i+c]);total+=delta;max=Math.max(max,delta)}
        if(max>(strict?0:8))changed++
        if(a[i+2]>180&&a[i+1]<120)red++
        if(a[i+1]>100&&a[i+2]<80)green++
      }
      const ratio=changed/(a.length/4),mean=total/a.length
      if(strict?changed!==0:ratio>.01||mean>.5)throw Error('像素差异超限 '+left+'/'+right+' '+key+' '+JSON.stringify({changed,ratio,mean}))
      if(red<1000||green<1000)throw Error('延迟图片未实际出现 '+key)
      results.push({left,right,key,...size,strict,changedPixels:changed,ratio,mean,red,green})
    }
  }
  fs.writeFileSync(path.join(output,'pixels.json'),JSON.stringify({tolerance:{strict:{channelDelta:0,changedPixels:0},repeat:{channelDelta:8,maxChangedRatio:.01,maxMeanAbsoluteDifference:.5}},results},null,2)+'\n')
  app.exit(0)
}catch(error){console.error(error);app.exit(1)}
