import {requireAccountUser,requireYoutubeMember} from './youtube-member.js';
import {database} from './private-documents.js';
export async function requireGrowthUser(request){
 const user=await requireAccountUser(request,{verifyLive:true});if(!user.ok)return user;
 try{const state=await database(request,'rpc/ikigai_growth_access_v1',{method:'POST',body:{}});return state?.allowed===true?user:{ok:false,status:403,message:'登録画面で挨拶メッセージを入力すると成長ログを利用できます。'}}
 catch(error){if(error?.code==='PGRST202')return requireYoutubeMember(request);return {ok:false,status:503,message:'成長ログの利用状態を確認できませんでした。'}}
}
