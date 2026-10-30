import { describe, expect, it } from 'vitest';
import { AuthoritativeMatchEngine, PlayerMoveInput } from '../../shared/rules/matchStateMachine';
import { BUNDLED_QUESTION_PACKS } from '../../content/packRegistry';
import { DUNK_STYLES, dunkBallPosition, dunkRig } from '../../shared/rules/dunks';
import { getAirPose } from '../../shared/rules/streetMoves';
import { InputGuardController } from '../../client/game/input/controls';
import { RoomManager } from '../../server/rooms/roomManager';
import { ServerPackService } from '../../server/question-service/packService';
import { ServerToClientMessage } from '../../shared/protocol/messages';

const N: PlayerMoveInput = { moveX: 0, moveZ: 0, sprint: false, shoot: false };
function game() {
  const e = new AuthoritativeMatchEngine({ matchId:'arcade', mode:'solo', seed:123, pack:BUNDLED_QUESTION_PACKS[0], roomPresetId:'standard',sessionLengthId:'quick',player0:{id:'a',pseudonym:'A'},player1:{id:'b',pseudonym:'B',isAi:false} });
  e.startMatch(); return e;
}
function step(e: AuthoritativeMatchEngine, ms: number, a=N, b=N) {
  for(let t=0;t<ms;t+=10) e.step(Math.min(10,ms-t),[a,b]);
}
function closeDunk(e: AuthoritativeMatchEngine) {
  e.players[0].x=0;e.players[0].z=-2.4;e.players[1].x=0;e.players[1].z=-3.6;e.players[1].facingAngle=0;
  e.initiateShotAttempt({...N,dunk:true});
}
function answerAndResolve(e: AuthoritativeMatchEngine) {
  step(e,3100);const q=e.activeDuel!;
  e.submitAnswer({slot:0,duelId:q.duelId,optionId:q.question.correctOptionId});
  step(e,300);
  e.submitAnswer({slot:1,duelId:q.duelId,optionId:q.question.options.find(o=>o.id!==q.question.correctOptionId)!.id});
  step(e,100);
}

describe('Arcade dunks and risk/reward defense',()=>{
  it.each(DUNK_STYLES)('%s has a distinct high-flying rig and an actual gather without teleporting the ball',(style)=>{
    const e=game();e.players[0].z=-2.3;e.players[1].x=5;
    const before=e.getBallPosition3D();e.initiateShotAttempt({...N,dunk:true,dunkStyle:style});
    expect(e.players[0].finishKind).toBe('dunk');expect(e.players[0].dunkStyle).toBe(style);
    expect(e.getBallPosition3D()).toEqual(before);
    step(e,500);expect(getAirPose(e.players[0]).y).toBeGreaterThan(1.6);
    const rig=dunkRig(e.players[0]);
    if(style==='360')expect(rig.twist).toBeGreaterThan(Math.PI);
    if(style==='windmill')expect(rig.arm).toBeLessThan(-Math.PI);
    if(style==='reverse')expect(rig.twist).toBeGreaterThan(1.5);
    expect(e.getBallPosition3D()).toEqual(dunkBallPosition(e.players[0],getAirPose(e.players[0])));
    step(e,400);expect(e.phase).toBe('Duel');expect(e.getBallPosition3D().y).toBeGreaterThan(3);
  });
  it('does not allow a dunk from outside the launch zone',()=>{
    const e=game();e.initiateShotAttempt({...N,dunk:true,dunkStyle:'360'});expect(e.players[0].finishKind).toBe('jump');
  });
  it('a well-timed in-range defensive jump swats a dunk even if the attacker wins the question',()=>{
    const e=game();closeDunk(e);step(e,180);e.step(10,[N,{...N,defense:'jump'}]);step(e,150);
    expect(e.activeDuel!.physicalBlock).toBe(true);expect(e.players[1].defenseResult).toBe('timed-block');
    answerAndResolve(e);expect(e.activeDuel!.resolvedOutcome?.outcome).toBe('block');
    step(e,2200);expect(e.attemptEvents[0].basketballOutcome).toBe('block');expect(e.scoreState.scores).toEqual([0,0]);
    expect(e.getLearningSummaries()[0].correctAnswers).toBe(1);
  });
  it('a late jump cannot retroactively block and attack inputs never jump on defense',()=>{
    const e=game();closeDunk(e);step(e,750);e.step(10,[{...N,defense:'jump'}, {...N,defense:'jump'}]);
    step(e,50);expect(e.activeDuel!.physicalBlock).toBe(false);expect(e.players[0].defenseAction).toBe(null);
  });
  it('out-of-range jumps cannot swat and swiping recovery disables frozen block eligibility',()=>{
    const f=game();f.players[0].z=-2.4;f.players[1].x=5;f.initiateShotAttempt({...N,dunk:true});
    step(f,150);f.step(10,[N,{...N,defense:'jump'}]);step(f,200);expect(f.activeDuel!.physicalBlock).toBe(false);
    const g=game();g.players[1].z=g.players[0].z-1.1;
    g.step(10,[N,{...N,defense:'swipe'}]);g.initiateShotAttempt();expect(g.activeDuel!.releaseSnapshot.blockEligibility.eligible).toBe(false);
  });
  it('missed swipes freeze the defender for one full second, cannot be spammed, and allow a drive past',()=>{
    const e=game();e.players[1].x=2.1;e.players[1].z=e.players[0].z;
    const pos={x:e.players[1].x,z:e.players[1].z};
    e.step(10,[{...N,moveZ:-1},{...N,moveX:-1,defense:'swipe'}]);
    step(e,990,{...N,moveZ:-1},{...N,moveX:-1,defense:'swipe'});
    expect(e.players[1].defenseResult).toBe('miss');expect(e.players[1].x).toBe(pos.x);expect(e.players[1].z).toBe(pos.z);
    expect(e.players[1].defenseRecoverySec).toBeGreaterThan(0);
    expect(e.players[0].z).toBeLessThan(e.players[1].z-4);
    step(e,50,N,{...N,moveX:-1});expect(e.players[1].x).toBeLessThan(pos.x);
  });
  it('a clean exposed-ball swipe switches possession at the live location once and does not penalise learning',()=>{
    const e=game();e.players[1].x=0.32;e.players[1].z=e.players[0].z-0.9;e.players[1].facingAngle=0;
    e.step(10,[N,{...N,defense:'swipe'}]);step(e,140);
    expect(e.scoreState.currentAttacker).toBe(1);expect(e.phase).toBe('Possession');
    expect(e.attemptEvents).toHaveLength(1);expect(e.attemptEvents[0].basketballOutcome).toBe('steal-turnover');
    expect(e.scoreState.possessionsCompleted).toEqual([1,0]);expect(e.getLearningSummaries()[0].totalQuestions).toBe(0);
    expect(e.players[1].z).toBeCloseTo(1.7,1);expect(e.movementClockRemainingMs).toBeGreaterThan(14900);
    step(e,200);expect(e.attemptEvents).toHaveLength(1);
  });
  it('a swipe behind the ball or into a protected spin misses',()=>{
    for(const spin of [false,true]){
      const e=game();e.players[1].x=0.32;e.players[1].z=e.players[0].z-0.9;e.players[1].facingAngle=spin?0:Math.PI;
      e.step(10,[spin?{...N,trick:'spin'}:N,{...N,defense:'swipe'}]);step(e,160);
      expect(e.scoreState.currentAttacker).toBe(0);
    }
  });
  it('dunk style and defense need fresh input and only jump is allowed during takeoff',()=>{
    const c=new InputGuardController();c.syncDuelContext({phase:'Possession',duelId:null,readingProtected:false,displayedOptions:[]});
    c.handleKeyDown({code:'KeyV'});c.handleKeyDown({code:'KeyR'});
    const dunk=c.consumeMoveInput('Possession');expect(dunk.dunk).toBe(true);expect(dunk.dunkStyle).toBe('windmill');
    c.handleKeyDown({code:'KeyR',repeat:true});expect(c.consumeMoveInput('Possession').dunk).toBeUndefined();
    c.syncDuelContext({phase:'QuestionReady',duelId:'d1',readingProtected:true,displayedOptions:[]});
    c.handleKeyDown({code:'KeyB'});expect(c.consumeMoveInput('QuestionReady').defense).toBe('jump');
    c.handleKeyDown({code:'KeyZ'});expect(c.consumeMoveInput('QuestionReady').defense).toBeUndefined();
    c.handleKeyUp({code:'KeyB'});c.syncDuelContext({phase:'Duel',duelId:'d1',readingProtected:false,displayedOptions:[]});
    c.handleKeyDown({code:'KeyB'});expect(c.consumeMoveInput('Duel').defense).toBeUndefined();
  });
  it('HTTP rooms accept defensive actions and consume them once rather than re-swiping on every tick',()=>{
    const rooms=new RoomManager(new ServerPackService(),{defaultSeed:24});
    const create=rooms.handleHttpSync({clientId:'da',messages:[{type:'CREATE_ROOM',pseudonym:'A',appearancePreset:0,packId:BUNDLED_QUESTION_PACKS[0].packId,roomPresetId:'standard',sessionLengthId:'quick'}]});
    const a=create.messages.find((m):m is Extract<ServerToClientMessage,{type:'ROOM_JOINED'}>=>m.type==='ROOM_JOINED')!;
    const join=rooms.handleHttpSync({clientId:'db',messages:[{type:'JOIN_ROOM',roomCode:a.roomCode,pseudonym:'B',appearancePreset:1}]});
    const b=join.messages.find((m):m is Extract<ServerToClientMessage,{type:'ROOM_JOINED'}>=>m.type==='ROOM_JOINED')!;
    const ra={roomCode:a.roomCode,reconnectToken:a.reconnectToken},rb={roomCode:a.roomCode,reconnectToken:b.reconnectToken};
    rooms.handleHttpSync({clientId:'da',...ra,messages:[{type:'SET_READY',ready:true}]});
    rooms.handleHttpSync({clientId:'db',...rb,messages:[{type:'SET_READY',ready:true},{type:'MOVE_INTENT',input:{...N,defense:'swipe'}},{type:'MOVE_INTENT',input:N}]});
    rooms.tickAllRooms(20);rooms.tickAllRooms(150);
    const messages=rooms.handleHttpSync({clientId:'da',...ra,messages:[]}).messages;
    const snap=messages.find((m):m is Extract<ServerToClientMessage,{type:'MATCH_SNAPSHOT'}>=>m.type==='MATCH_SNAPSHOT')!.snapshot;
    expect(snap.players[1].defenseAction).toBe('swipe');expect(snap.players[1].defenseResult).toBe('miss');
    for(let i=0;i<8;i++)rooms.tickAllRooms(200);
    const later=rooms.handleHttpSync({clientId:'da',...ra,messages:[]}).messages.find((m):m is Extract<ServerToClientMessage,{type:'MATCH_SNAPSHOT'}>=>m.type==='MATCH_SNAPSHOT')!.snapshot;
    expect(later.players[1].defenseAction).toBe(null);expect(later.players[1].defenseCooldownSec).toBe(0);
  });
});
