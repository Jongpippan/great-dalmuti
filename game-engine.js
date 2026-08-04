
const crypto = require('crypto');

const JESTER = 13;
const RANK_NAMES = {
  1:'대 달무티',2:'대주교',3:'원수',4:'남작부인',5:'수도원장',
  6:'기사',7:'재봉사',8:'석공',9:'요리사',10:'양치기',
  11:'석공 노동자',12:'농노',13:'광대'
};

function shuffle(a) {
  const arr=[...a];
  for(let i=arr.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];}
  return arr;
}
function makeDeck(){
  const cards=[];
  for(let rank=1;rank<=12;rank++){
    for(let i=0;i<rank;i++) cards.push({id:crypto.randomUUID(),rank});
  }
  cards.push({id:crypto.randomUUID(),rank:JESTER});
  cards.push({id:crypto.randomUUID(),rank:JESTER});
  return shuffle(cards);
}
function sortHand(hand){ hand.sort((a,b)=>a.rank-b.rank || a.id.localeCompare(b.id)); }
function roleName(index, n){
  if(index===0) return '대 달무티';
  if(index===1) return '소 달무티';
  if(index===n-2) return '소 농노';
  if(index===n-1) return '대 농노';
  return '상인';
}
function createGame(lobbyPlayers){
  const players = shuffle(lobbyPlayers).map((p,i)=>({
    ...p, seat:i, roleIndex:i, role:roleName(i,lobbyPlayers.length),
    hand:[], finished:false, finishPlace:null, connected:true
  }));
  const game={
    status:'playing', handNumber:0, players, phase:'', currentPlayerId:null,
    pile:null, passers:[], lastPlayerId:null, finishOrder:[], logs:[],
    tax:{eligible:[],declined:[],stage:null,pending:null}, winnerId:null
  };
  startHand(game, true);
  return game;
}
function startHand(game, first=false){
  game.handNumber++;
  game.phase='deal';
  game.pile=null; game.passers=[]; game.lastPlayerId=null; game.finishOrder=[]; game.winnerId=null;
  for(const p of game.players){ p.hand=[];p.finished=false;p.finishPlace=null; }
  const deck=makeDeck();
  let i=0;
  while(deck.length){ game.players[i%game.players.length].hand.push(deck.pop()); i++; }
  for(const p of game.players) sortHand(p.hand);
  game.logs=[`${game.handNumber}번째 판이 시작되었습니다.`];
  const eligible=game.players.filter(p=>p.hand.filter(c=>c.rank===JESTER).length===2).map(p=>p.id);
  game.tax={eligible,declined:[],stage:null,pending:null};
  if(eligible.length){ game.phase='revolution'; game.currentPlayerId=null; }
  else beginTax(game);
}
function beginTax(game){
  const n=game.players.length;
  game.phase='tax';
  const gd=game.players.find(p=>p.roleIndex===0), ld=game.players.find(p=>p.roleIndex===1);
  const lp=game.players.find(p=>p.roleIndex===n-2), gp=game.players.find(p=>p.roleIndex===n-1);
  game.tax.stage='greater-return';
  const given = takeBest(gp,2);
  gd.hand.push(...given); sortHand(gd.hand);
  game.tax.pending={fromId:gp.id,toId:gd.id,count:2,given:given.map(c=>c.id)};
  game.currentPlayerId=gd.id;
  game.logs.push(`${gp.name}이(가) 대 달무티에게 최고 카드 2장을 바쳤습니다.`);
}
function takeBest(player,count){
  sortHand(player.hand);
  return player.hand.splice(0,count);
}
function selectCards(player, ids, count){
  if(!Array.isArray(ids)||ids.length!==count||new Set(ids).size!==count) throw new Error(`${count}장을 선택해 주세요.`);
  const cards=ids.map(id=>player.hand.find(c=>c.id===id));
  if(cards.some(c=>!c)) throw new Error('선택한 카드를 찾을 수 없습니다.');
  player.hand=player.hand.filter(c=>!ids.includes(c.id));
  return cards;
}
function taxReturn(game, playerId, ids){
  if(game.phase!=='tax'||game.currentPlayerId!==playerId) throw new Error('지금은 세금 카드를 돌려줄 차례가 아닙니다.');
  const n=game.players.length;
  const gd=game.players.find(p=>p.roleIndex===0), ld=game.players.find(p=>p.roleIndex===1);
  const lp=game.players.find(p=>p.roleIndex===n-2), gp=game.players.find(p=>p.roleIndex===n-1);
  if(game.tax.stage==='greater-return'){
    const cards=selectCards(gd,ids,2); gp.hand.push(...cards); sortHand(gp.hand); sortHand(gd.hand);
    game.logs.push(`${gd.name}이(가) 대 농노에게 카드 2장을 돌려주었습니다.`);
    const given=takeBest(lp,1); ld.hand.push(...given); sortHand(ld.hand);
    game.tax.stage='lesser-return'; game.tax.pending={fromId:lp.id,toId:ld.id,count:1,given:given.map(c=>c.id)};
    game.currentPlayerId=ld.id;
    game.logs.push(`${lp.name}이(가) 소 달무티에게 최고 카드 1장을 바쳤습니다.`);
  } else if(game.tax.stage==='lesser-return'){
    const cards=selectCards(ld,ids,1); lp.hand.push(...cards); sortHand(lp.hand); sortHand(ld.hand);
    game.logs.push(`${ld.name}이(가) 소 농노에게 카드 1장을 돌려주었습니다.`);
    beginPlay(game);
  }
}
function declareRevolution(game, playerId, greater){
  if(game.phase!=='revolution'||!game.tax.eligible.includes(playerId)) throw new Error('혁명을 선언할 수 없습니다.');
  const p=game.players.find(x=>x.id===playerId);
  const n=game.players.length;
  if(greater){
    if(p.roleIndex!==n-1) throw new Error('대 농노만 대혁명을 선언할 수 있습니다.');
    for(const x of game.players) x.roleIndex=n-1-x.roleIndex;
    normalizeRoles(game);
    game.logs.push(`${p.name}이(가) 대혁명을 선언했습니다! 계급이 완전히 뒤집혔습니다.`);
  } else {
    game.logs.push(`${p.name}이(가) 혁명을 선언했습니다. 이번 판의 세금이 취소됩니다.`);
  }
  beginPlay(game);
}
function declineRevolution(game, playerId){
  if(game.phase!=='revolution'||!game.tax.eligible.includes(playerId)) throw new Error('응답할 수 없습니다.');
  if(!game.tax.declined.includes(playerId)) game.tax.declined.push(playerId);
  if(game.tax.declined.length===game.tax.eligible.length) beginTax(game);
}
function normalizeRoles(game){
  game.players.sort((a,b)=>a.roleIndex-b.roleIndex);
  game.players.forEach((p,i)=>{p.roleIndex=i;p.seat=i;p.role=roleName(i,game.players.length);});
}
function beginPlay(game){
  game.phase='play';game.pile=null;game.passers=[];game.lastPlayerId=null;
  const gd=game.players.find(p=>p.roleIndex===0);
  game.currentPlayerId=gd.id;
  game.logs.push(`${gd.name} 대 달무티가 첫 묶음을 냅니다.`);
}
function activePlayers(game){return game.players.filter(p=>!p.finished);}
function nextActive(game, fromId){
  const ordered=[...game.players].sort((a,b)=>a.roleIndex-b.roleIndex);
  const idx=ordered.findIndex(p=>p.id===fromId);
  for(let step=1;step<=ordered.length;step++){const p=ordered[(idx+step)%ordered.length];if(!p.finished)return p;}
  return null;
}
function effectivePlay(cards){
  const normal=cards.filter(c=>c.rank!==JESTER);
  if(!normal.length) return {rank:JESTER,count:cards.length};
  const rank=normal[0].rank;
  if(normal.some(c=>c.rank!==rank)) throw new Error('같은 숫자의 카드끼리만 낼 수 있습니다. 광대는 조커로 함께 낼 수 있습니다.');
  return {rank,count:cards.length};
}
function playCards(game, playerId, ids){
  if(game.phase!=='play'||game.currentPlayerId!==playerId) throw new Error('내 차례가 아닙니다.');
  const p=game.players.find(x=>x.id===playerId);
  if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length) throw new Error('낼 카드를 선택해 주세요.');
  const cards=ids.map(id=>p.hand.find(c=>c.id===id));
  if(cards.some(c=>!c)) throw new Error('선택한 카드를 찾을 수 없습니다.');
  const play=effectivePlay(cards);
  if(game.pile){
    if(play.count!==game.pile.count) throw new Error(`카드 ${game.pile.count}장을 내야 합니다.`);
    if(play.rank>=game.pile.rank) throw new Error('현재 묶음보다 더 높은 계급(더 작은 숫자)의 카드를 내야 합니다.');
  }
  p.hand=p.hand.filter(c=>!ids.includes(c.id));
  game.pile={rank:play.rank,count:play.count,playerId:p.id,cards:cards.map(c=>({rank:c.rank}))};
  game.lastPlayerId=p.id; game.passers=[];
  game.logs.push(`${p.name}이(가) ${RANK_NAMES[play.rank]} ${play.count}장을 냈습니다.`);
  if(p.hand.length===0){
    p.finished=true;p.finishPlace=game.finishOrder.length+1;game.finishOrder.push(p.id);
    game.logs.push(`${p.name}이(가) ${p.finishPlace}위로 카드를 모두 털었습니다!`);
    if(activePlayers(game).length===1){ finishHand(game); return; }
  }
  const next=nextActive(game,p.id);
  game.currentPlayerId=next.id;
}
function pass(game, playerId){
  if(game.phase!=='play'||game.currentPlayerId!==playerId) throw new Error('내 차례가 아닙니다.');
  if(!game.pile) throw new Error('새 묶음을 시작할 때는 패스할 수 없습니다.');
  if(!game.passers.includes(playerId)) game.passers.push(playerId);
  const p=game.players.find(x=>x.id===playerId);
  game.logs.push(`${p.name}이(가) 패스했습니다.`);
  const active=activePlayers(game);
  const last=game.players.find(x=>x.id===game.lastPlayerId);
  const needed=active.filter(x=>x.id!==last?.id).map(x=>x.id);
  if(needed.every(id=>game.passers.includes(id))){
    let leader=last && !last.finished ? last : nextActive(game,last?.id || playerId);
    game.pile=null;game.passers=[];game.lastPlayerId=null;game.currentPlayerId=leader.id;
    game.logs.push(`묶음이 끝났습니다. ${leader.name}이(가) 새 묶음을 시작합니다.`);
  } else {
    game.currentPlayerId=nextActive(game,playerId).id;
  }
}
function finishHand(game){
  const remaining=activePlayers(game)[0];
  remaining.finished=true;remaining.finishPlace=game.players.length;game.finishOrder.push(remaining.id);
  const ordered=game.finishOrder.map(id=>game.players.find(p=>p.id===id));
  ordered.forEach((p,i)=>p.roleIndex=i);
  normalizeRoles(game);
  game.phase='results';game.currentPlayerId=null;game.winnerId=ordered[0].id;
  game.logs.push(`${ordered[0].name}이(가) 새 대 달무티가 되었습니다.`);
}
function nextHand(game, requesterId){
  if(game.phase!=='results') throw new Error('현재 판이 끝나지 않았습니다.');
  const gd=game.players.find(p=>p.roleIndex===0);
  if(requesterId!==gd.id) throw new Error('새 대 달무티만 다음 판을 시작할 수 있습니다.');
  startHand(game);
}
module.exports={createGame,taxReturn,declareRevolution,declineRevolution,playCards,pass,nextHand,RANK_NAMES,JESTER};
