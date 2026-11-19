export const DEFAULT_DURATION=25*60*1000;
const LIMIT=60*60*1000;
export function createClock(mode='timer',duration=DEFAULT_DURATION){return {mode:mode==='stopwatch'?'stopwatch':'timer',duration:Math.min(LIMIT,Math.max(60000,Number(duration)||DEFAULT_DURATION)),elapsed:0,startedAt:null};}
export function elapsedAt(clock,now=Date.now()){const elapsed=Math.max(0,clock.elapsed+(clock.startedAt===null?0:Math.max(0,now-clock.startedAt)));return clock.mode==='timer'?Math.min(clock.duration,elapsed):elapsed;}
export function snapshot(clock,now=Date.now()){const elapsed=elapsedAt(clock,now),finished=clock.mode==='timer'&&elapsed>=clock.duration;return {elapsed,remaining:Math.max(0,clock.duration-elapsed),progress:Math.min(1,elapsed/clock.duration),running:clock.startedAt!==null&&!finished,finished};}
export function startClock(clock,now=Date.now()){if(snapshot(clock,now).finished||clock.startedAt!==null)return clock;return {...clock,startedAt:now};}
export function pauseClock(clock,now=Date.now()){return {...clock,elapsed:elapsedAt(clock,now),startedAt:null};}
export function restoreClock(value,now=Date.now()){if(!value||!['timer','stopwatch'].includes(value.mode)||!Number.isFinite(value.duration)||value.duration<60000||value.duration>LIMIT||!Number.isFinite(value.elapsed)||value.elapsed<0||value.elapsed>Number.MAX_SAFE_INTEGER||!(value.startedAt===null||Number.isFinite(value.startedAt)&&value.startedAt>=0&&value.startedAt<=now))return createClock();return {...createClock(value.mode,value.duration),elapsed:value.elapsed,startedAt:value.startedAt};}
export function formatTime(ms){const seconds=Math.floor(Math.max(0,ms)/1000),h=Math.floor(seconds/3600),m=Math.floor(seconds%3600/60),s=seconds%60;return (h?String(h).padStart(2,'0')+':':'')+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');}

export function restoreClockBook(value,now=Date.now()){
 const book={mode:'timer',clocks:{timer:createClock('timer'),stopwatch:createClock('stopwatch')}};
 if(value?.clocks){book.mode=value.mode==='stopwatch'?'stopwatch':'timer';for(const mode of ['timer','stopwatch']){const restored=restoreClock(value.clocks[mode],now);if(restored.mode===mode)book.clocks[mode]=restored;}}
 else if(value){const restored=restoreClock(value,now);book.mode=restored.mode;book.clocks[restored.mode]=restored;}
 for(const mode of ['timer','stopwatch'])if(mode!==book.mode)book.clocks[mode]=pauseClock(book.clocks[mode],now);
 return book;
}
