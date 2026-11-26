export { creationFixture } from './creation-test-fixture.mjs'

export const rectangle = (id,x,y,w,h,extra={}) => ({type:'create_shape',id,shapeType:'geo',x,y,props:{w,h,fill:'solid'},...extra})
export const commands = () => [rectangle('shape:fixed',200,200,100,80),rectangle('shape:moving',430,320,60,50)]
export const moving = f => f.previewShapes().find(s=>s.id==='shape:moving')
