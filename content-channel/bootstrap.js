import {installContentChild} from './child.js'
const parameters=new URL(import.meta.url).searchParams
installContentChild(window,{instanceId:parameters.get('instance'),parentOrigin:parameters.get('parent')})
