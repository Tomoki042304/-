const KEY='ikigai.entry.growth.v1';
const TTL=30*60*1000;
export function rememberGrowthEntry(location,storage,now=Date.now()){
 try{if(new URL(location.href).searchParams.get('view')==='growth')storage.setItem(KEY,String(now));}catch{}
}
export function consumeGrowthEntry(storage,now=Date.now()){
 try{const value=storage.getItem(KEY);storage.removeItem(KEY);const at=Number(value);return value!==null&&Number.isFinite(at)&&at<=now&&now-at<TTL;}catch{return false;}
}
export function growthLoginTarget(location){
 try{return new URL(location?.href).searchParams.get('view')==='growth'?'&view=growth':'';}catch{return '';}
}
