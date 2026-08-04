
const http=require('http'),fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto');
const {URL}=require('url');
const E=require('./game-engine');
const PORT=Number(process.env.PORT||3000),HOST='0.0.0.0',PUBLIC=path.join(__dirname,'public'),rooms=new Map();
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
function cleanName(v){const s=String(v||'').replace(/\s+/g,' ').trim().slice(0,14);if(!s)throw Error('닉네임을 입력해 주세요.');return s}
function cleanCode(v){return String(v||'').replace(/[^A-Za-z0-9]/g,'').toUpperCase().slice(0,6)}
function code(){const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';for(let z=0;z<999;z++){let s='';for(let i=0;i<5;i++)s+=c[Math.floor(Math.random()*c.length)];if(!rooms.has(s))return s}throw Error('방 코드를 만들지 못했습니다.')}
function room(v){const r=rooms.get(cleanCode(v));if(!r)throw Error('방을 찾을 수 없습니다.');return r}
function auth(p){const r=room(p.roomCode),u=r.players.find(x=>x.id===p.playerId&&x.token===p.reconnectToken);if(!u)throw Error('재접속 정보가 올바르지 않습니다.');return{r,u}}
function pubGame(r,viewer){
 const g=r.game;if(!g)return null;
 return {status:g.status,handNumber:g.handNumber,phase:g.phase,currentPlayerId:g.currentPlayerId,pile:g.pile,
 passers:g.passers,finishOrder:g.finishOrder,winnerId:g.winnerId,logs:g.logs.slice(-50),
 tax:g.phase==='revolution'?{eligibleForViewer:g.tax.eligible.includes(viewer),declined:g.tax.declined.includes(viewer)}:
     g.phase==='tax'?{stage:g.tax.stage,pending:g.currentPlayerId===viewer?g.tax.pending:null}:null,
 players:g.players.map(p=>({id:p.id,name:p.name,role:p.role,roleIndex:p.roleIndex,connected:p.connected,
 handCount:p.hand.length,finished:p.finished,finishPlace:p.finishPlace,
 hand:p.id===viewer?p.hand.map(c=>({id:c.id,rank:c.rank})):null}))};
}
function state(r,v){return{room:{code:r.code,capacity:r.capacity,hostId:r.hostId,players:r.players.map(p=>({id:p.id,name:p.name,connected:p.connected})),started:!!r.game},viewerId:v,game:pubGame(r,v)}}
function sess(r,u){return{roomCode:r.code,playerId:u.id,reconnectToken:u.token}}
function sse(res,event,data){try{res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);return true}catch{return false}}
function emit(r){if(r.game)for(const gp of r.game.players){const lp=r.players.find(x=>x.id===gp.id);gp.connected=!!lp?.connected}
 for(const p of r.players)if(p.stream&&!sse(p.stream,'state',state(r,p.id))){p.stream=null;p.connected=false}}
const A={
 'create-room':p=>{const n=Number(p.capacity);if(![4,5,6,7,8].includes(n))throw Error('인원은 4~8명으로 설정해 주세요.');const u={id:crypto.randomUUID(),token:crypto.randomUUID(),name:cleanName(p.name),connected:true,stream:null},r={code:code(),capacity:n,hostId:u.id,players:[u],game:null};rooms.set(r.code,r);return{session:sess(r,u),state:state(r,u.id)}},
 'join-room':p=>{const r=room(p.roomCode);if(r.game)throw Error('이미 시작된 방입니다.');if(r.players.length>=r.capacity)throw Error('방이 가득 찼습니다.');const name=cleanName(p.name);if(r.players.some(x=>x.name.toLowerCase()===name.toLowerCase()))throw Error('같은 닉네임이 있습니다.');const u={id:crypto.randomUUID(),token:crypto.randomUUID(),name,connected:true,stream:null};r.players.push(u);emit(r);return{session:sess(r,u),state:state(r,u.id)}},
 'reconnect-session':p=>{const {r,u}=auth(p);u.connected=true;emit(r);return{session:sess(r,u),state:state(r,u.id)}},
 'start-game':p=>{const {r,u}=auth(p);if(u.id!==r.hostId)throw Error('방장만 시작할 수 있습니다.');if(r.players.length!==r.capacity)throw Error(`${r.capacity}명이 모두 입장해야 합니다.`);r.game=E.createGame(r.players.map(x=>({id:x.id,name:x.name,connected:true})));emit(r);return{}},
 'declare-revolution':p=>{const {r,u}=auth(p);E.declareRevolution(r.game,u.id,!!p.greater);emit(r);return{}},
 'decline-revolution':p=>{const {r,u}=auth(p);E.declineRevolution(r.game,u.id);emit(r);return{}},
 'tax-return':p=>{const {r,u}=auth(p);E.taxReturn(r.game,u.id,p.cardIds);emit(r);return{}},
 'play-cards':p=>{const {r,u}=auth(p);E.playCards(r.game,u.id,p.cardIds);emit(r);return{}},
 'pass':p=>{const {r,u}=auth(p);E.pass(r.game,u.id);emit(r);return{}},
 'next-hand':p=>{const {r,u}=auth(p);E.nextHand(r.game,u.id);emit(r);return{}}
};
function json(res,status,obj){const b=JSON.stringify(obj);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(b)});res.end(b)}
function body(req){return new Promise((ok,no)=>{let s='';req.on('data',d=>{s+=d;if(s.length>1e6)req.destroy()});req.on('end',()=>{try{ok(s?JSON.parse(s):{})}catch(e){no(e)}});req.on('error',no)})}
const server=http.createServer(async(req,res)=>{try{
 const u=new URL(req.url,`http://${req.headers.host||'localhost'}`);
 if(req.method==='POST'&&u.pathname==='/api/action'){const p=await body(req),fn=A[p.type];if(!fn)throw Error('알 수 없는 요청입니다.');return json(res,200,{ok:true,...fn(p)})}
 if(req.method==='GET'&&u.pathname==='/api/events'){const p=Object.fromEntries(u.searchParams),{r,u:pl}=auth(p);if(pl.stream)pl.stream.end();pl.connected=true;res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});pl.stream=res;sse(res,'state',state(r,pl.id));req.on('close',()=>{if(pl.stream===res){pl.stream=null;pl.connected=false;emit(r)}});return}
 let f=u.pathname==='/'?'index.html':decodeURIComponent(u.pathname.slice(1));f=path.normalize(f).replace(/^(\.\.[/\\])+/, '');const full=path.join(PUBLIC,f);if(!full.startsWith(PUBLIC)||!fs.existsSync(full)||fs.statSync(full).isDirectory()){res.writeHead(404);return res.end('Not found')}
 const ext=path.extname(full);res.writeHead(200,{'Content-Type':MIME[ext]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(full).pipe(res)
 }catch(e){json(res,400,{ok:false,error:e.message||'오류가 발생했습니다.'})}});
function ips(){const a=[];for(const xs of Object.values(os.networkInterfaces()))for(const x of xs||[])if(x.family==='IPv4'&&!x.internal)a.push(x.address);return a}
server.listen(PORT,HOST,()=>{console.log('\nGreat Dalmuti server is running.');console.log(`This computer: http://localhost:${PORT}`);for(const ip of ips())console.log(`Other devices: http://${ip}:${PORT}`);console.log('\nPress Ctrl+C to stop.\n')});
