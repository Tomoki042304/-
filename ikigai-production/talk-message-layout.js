// Same day boundaries, five-minute author blocks and DOM classes as GIVE BUDDIES.
export function messageBlocks(day){
 let lastDay='',previous='',previousAt=0;
 return (sender,at)=>{const label=day(at),newDay=!!label&&label!==lastDay;if(newDay){lastDay=label;previous=''}const time=Date.parse(at),first=sender!==previous||time-previousAt>300000;previous=sender;previousAt=time;return {first,day:newDay?label:''}};
}
export function messageShell({mine,first,name,avatar,className=''}){
 const row=document.createElement('div');row.className='msg'+(mine?' me':'')+(first?' first':' cont')+(className?' '+className:'');
 const body=document.createElement('div');body.className='body';
 if(!mine&&first){const from=document.createElement('span');from.className='from';from.textContent=name;body.append(from)}
 const line=document.createElement('div');line.className='line';body.append(line);
 if(!mine){if(first)row.append(avatar());else{const space=document.createElement('span');space.className='av-sp';row.append(space)}}row.append(body);
 return {row,body,line};
}
export function dayDivider(label){const node=document.createElement('div');node.className='chat-day';node.textContent=label;return node;}
