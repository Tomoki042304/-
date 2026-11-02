import {database} from './private-documents.js';
export async function hasTalkIntroduction(request){
 let value;try{value=await database(request,'rpc/ikigai_talk_introduction_v1',{method:'POST',body:{p_action:'status',p_fields:null}})}catch(error){if(error?.code==='PGRST202')return true;throw error}
 return value?.introduced===true;
}
