export function preferredLoginProvider({search='',storage}={}){
 const requested=new URLSearchParams(search).get('login');
 if(requested==='github'||requested==='line'){try{storage?.setItem('ikigai.login-provider',requested)}catch{}return requested;}
 try{return storage?.getItem('ikigai.login-provider')==='github'?'github':'line'}catch{return 'line'}
}
