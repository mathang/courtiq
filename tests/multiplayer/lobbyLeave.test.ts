import {describe,expect,it} from 'vitest';
import {RoomManager} from '../../server/rooms/roomManager';
import {ServerPackService} from '../../server/question-service/packService';
import {ClientToServerMessage,ServerToClientMessage} from '../../shared/protocol/messages';
type Joined=Extract<ServerToClientMessage,{type:'ROOM_JOINED'}>;
function setup(){
 const rooms=new RoomManager(new ServerPackService(),{defaultSeed:4});
 const call=(id:string,messages:ClientToServerMessage[],room?:Joined)=>rooms.handleHttpSync({clientId:id,messages,...(room?{roomCode:room.roomCode,reconnectToken:room.reconnectToken}:{})}).messages;
 const a=call('a',[{type:'CREATE_ROOM',pseudonym:'A',appearancePreset:0,packId:'spx101-w09-performance-analysis',roomPresetId:'standard',sessionLengthId:'quick'}]).find(m=>m.type==='ROOM_JOINED') as Joined;
 const b=call('b',[{type:'JOIN_ROOM',roomCode:a.roomCode,pseudonym:'B',appearancePreset:1}]).find(m=>m.type==='ROOM_JOINED') as Joined;
 return{rooms,call,a,b};
}
describe('Simple lobby room lifecycle',()=>{
 it.each(['a','b'])('lets %s leave before play, frees that slot and clears readiness before a new classmate joins',who=>{
  const{call,a,b}=setup();call('a',[{type:'SET_READY',ready:true}],a);
  const leaving=who==='a'?a:b,remaining=who==='a'?b:a,other=who==='a'?'b':'a';
  expect(call(who,[{type:'LEAVE_ROOM'}],leaving).some(m=>m.type==='ROOM_LEFT')).toBe(true);
  const lobby=call(other,[],remaining).find(m=>m.type==='LOBBY_UPDATE');
  expect(lobby?.type==='LOBBY_UPDATE'&&lobby.lobby.players[leaving.yourSlot]).toBeNull();
  expect(lobby?.type==='LOBBY_UPDATE'&&lobby.lobby.players[remaining.yourSlot]?.ready).toBe(false);
  const c=call('c',[{type:'JOIN_ROOM',roomCode:a.roomCode,pseudonym:'C',appearancePreset:2}]).find(m=>m.type==='ROOM_JOINED') as Joined;
  expect(c.yourSlot).toBe(leaving.yourSlot);
  call(other,[{type:'SET_READY',ready:true}],remaining);const messages=call('c',[{type:'SET_READY',ready:true}],c);
  expect(messages.some(m=>m.type==='MATCH_SNAPSHOT'&&m.snapshot.phase==='Possession')).toBe(true);
 });
 it('does not let a stray leave request remove a student, or a lobby-only leave interrupt a started match',()=>{
  const{call,a,b}=setup();expect(call('stranger',[{type:'LEAVE_ROOM'}]).some(m=>m.type==='ERROR')).toBe(true);
  call('a',[{type:'SET_READY',ready:true}],a);call('b',[{type:'SET_READY',ready:true}],b);
  expect(call('a',[{type:'LEAVE_ROOM'}],a).some(m=>m.type==='ERROR')).toBe(true);
  expect(call('b',[],b).some(m=>m.type==='MATCH_SNAPSHOT'&&m.snapshot.phase==='Possession')).toBe(true);
 });
});
