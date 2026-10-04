import assert from "node:assert/strict";
import { test } from "node:test";
import { drainDeliveries, type Delivery } from "../lib/signal-delivery";
test('a failed send stays queued and is delivered after restarting the drain',async()=>{
 const item:Delivery={signal:{id:1,posted_at:new Date(),action:'BUY',ticker:'TEST',instrument:null,entry:null,target:null,stop:null,detail:''},destination:'123456',attempts:1,lease_token:'lease'};
 let queued=true, available=true, retries=0, delivered=0;
 const store={claim:async()=>{if(!queued||!available)return null;available=false;return item;},
 finish:async()=>{queued=false;delivered++;return true;},retry:async()=>{retries++;}};
 await drainDeliveries(store,async()=>{throw Error('Discord unavailable');});
 assert.equal(queued,true);assert.equal(retries,1);assert.equal(delivered,0);
 available=true;
 await drainDeliveries(store,async()=> 'discord-message');
 assert.equal(queued,false);assert.equal(delivered,1);
 await drainDeliveries(store,async()=>{throw Error('must not resend');});
 assert.equal(delivered,1);
});
