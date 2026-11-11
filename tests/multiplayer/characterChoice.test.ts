import { describe, expect, it } from 'vitest';
import { RoomManager } from '../../server/rooms/roomManager';
import { ServerPackService } from '../../server/question-service/packService';
import { AuthoritativeMatchEngine, type PlayerMoveInput } from '../../shared/rules/matchStateMachine';
import { BUNDLED_QUESTION_PACKS } from '../../content/packRegistry';
import type { ClientToServerMessage, ServerToClientMessage } from '../../shared/protocol/messages';

type Joined = Extract<ServerToClientMessage, {type:'ROOM_JOINED'}>;
const neutral: PlayerMoveInput = { moveX:0, moveZ:0, sprint:false, shoot:false };

describe('Independent cosmetic character choices', () => {
  it('keeps each student’s complete appearance through ready, match start and reconnect', () => {
    const rooms = new RoomManager(new ServerPackService(), {defaultSeed:71});
    const call = (id:string, messages:ClientToServerMessage[], room?:Joined) => rooms.handleHttpSync({
      clientId:id, messages, ...(room ? {roomCode:room.roomCode,reconnectToken:room.reconnectToken} : {}),
    }).messages;
    const host = call('host', [{type:'CREATE_ROOM',pseudonym:'A',appearancePreset:4,packId:BUNDLED_QUESTION_PACKS[0].packId,roomPresetId:'standard',sessionLengthId:'quick'}]).find(m=>m.type==='ROOM_JOINED') as Joined;
    const guest = call('guest', [{type:'JOIN_ROOM',roomCode:host.roomCode,pseudonym:'B',appearancePreset:3}]).find(m=>m.type==='ROOM_JOINED') as Joined;
    expect(guest.lobby.players.map(p=>p?.appearancePreset)).toEqual([4,3]);
    call('host',[{type:'SET_READY',ready:true}],host);
    const started = call('guest',[{type:'SET_READY',ready:true}],guest).find(m=>m.type==='MATCH_SNAPSHOT');
    expect(started?.type==='MATCH_SNAPSHOT'&&started.snapshot.players.map(p=>p.appearancePreset)).toEqual([4,3]);
    const restored = call('new-guest',[{type:'RECONNECT_ROOM',roomCode:guest.roomCode,reconnectToken:guest.reconnectToken}],guest).find(m=>m.type==='ROOM_JOINED') as Joined;
    expect(restored.yourSlot).toBe(1);
    expect(restored.lobby.players.map(p=>p?.appearancePreset)).toEqual([4,3]);
  });

  it('rejects unsafe appearance IDs while retaining every supported character/palette combination', () => {
    for (const id of [0,1,2,3,4,5,6,7,-1,8,NaN,Infinity,1.5,'/other-model.glb']) {
      const rooms = new RoomManager(new ServerPackService());
      const joined = rooms.handleHttpSync({clientId:'host',messages:[{type:'CREATE_ROOM',pseudonym:'A',appearancePreset:id as number,packId:BUNDLED_QUESTION_PACKS[0].packId,roomPresetId:'standard',sessionLengthId:'quick'}]}).messages.find(m=>m.type==='ROOM_JOINED') as Joined;
      expect(joined.lobby.players[0]?.appearancePreset).toBe(typeof id==='number'&&Number.isInteger(id)&&id>=0&&id<8 ? id : 0);
    }
  });

  it('gives the characters identical movement, stamina, question draws and basketball outcomes', () => {
    const game = (appearancePreset:number) => {
      const e = new AuthoritativeMatchEngine({matchId:'cosmetic-balance',mode:'solo',seed:71,pack:BUNDLED_QUESTION_PACKS[0],roomPresetId:'standard',sessionLengthId:'quick',player0:{id:'a',pseudonym:'A',appearancePreset},player1:{id:'b',pseudonym:'B',isAi:false,appearancePreset:1}});
      e.startMatch();return e;
    };
    const a=game(0),b=game(4);
    for(let i=0;i<400;i++) {
      const input:PlayerMoveInput={...neutral,moveZ:i<25?-1:0,sprint:i<10,trick:i===5?'crossover':undefined,shoot:i===20};
      for(const e of [a,b])e.step(50,[input,neutral]);
      expect(a.phase).toBe(b.phase);
      expect(a.players.map(({appearancePreset:_,...p})=>p)).toEqual(b.players.map(({appearancePreset:_,...p})=>p));
      expect(a.scoreState).toEqual(b.scoreState);
      expect(a.activeDuel?.publicQuestionsBySlot).toEqual(b.activeDuel?.publicQuestionsBySlot);
    }
  });
});
