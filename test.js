
const E=require('./game-engine');
const ps=Array.from({length:4},(_,i)=>({id:'p'+i,name:'P'+i}));
const g=E.createGame(ps);
if(g.players.length!==4)throw Error('players');
const total=g.players.reduce((n,p)=>n+p.hand.length,0);
if(total!==80)throw Error('deck');
const ranks={};for(const p of g.players)for(const c of p.hand)ranks[c.rank]=(ranks[c.rank]||0)+1;
for(let r=1;r<=12;r++)if(ranks[r]!==r)throw Error('rank '+r);
if(ranks[13]!==2)throw Error('jesters');
console.log('All tests passed.');
