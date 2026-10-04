import {planBoundSnapshotEvents,type BoundSnapshotMessage} from "./snapshot-provider-events";

/**
 * Read-only pagination coordinator. The injected GET transport must authenticate
 * to HubSpot; the binding must already come from a trusted durable ledger.
 * Returns proposed events only, never applies them or infers a new binding.
 */
export async function inspectBoundSnapshotDelivery(
  binding:BoundSnapshotMessage,
  getPage:(query:{recipient:string;campaignId:number;startTimestamp:number;limit:number;offset?:string},signal:AbortSignal)=>Promise<any>,
  now=Date.now(),
  readTimeoutMs=10_000,
){
  const initial=planBoundSnapshotEvents(binding,{hasMore:false,events:[]},now);
  if(initial.status==="hold"&&initial.reason==="invalid_stored_message_binding")return initial;
  const events:unknown[]=[],seen=new Set<string>();let offset:string|undefined;
  try{
    for(let pages=0;pages<20;pages++){
      const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
      let page:any;
      try{
        page=await Promise.race([
          getPage({recipient:binding.email,campaignId:binding.campaignId,
            startTimestamp:binding.sentEvent.created,limit:100, ...(offset?{offset}:{})},controller.signal),
          new Promise<never>((_,reject)=>{timer=setTimeout(()=>{
            controller.abort();reject(new Error("Provider read timeout"));
          },Math.min(10_000,Math.max(10,readTimeoutMs)));}),
        ]);
      }finally{if(timer)clearTimeout(timer);controller.abort();}
      if(!page||!Array.isArray(page.events)||typeof page.hasMore!=="boolean"||page.events.length>100)
        return {status:"hold" as const,reason:"incomplete_provider_read",events:[]};
      events.push(...page.events);
      if(!page.hasMore)return planBoundSnapshotEvents(binding,{hasMore:false,events},now);
      if(typeof page.offset!=="string"||!page.offset||seen.has(page.offset))
        return {status:"hold" as const,reason:"invalid_pagination",events:[]};
      seen.add(page.offset);offset=page.offset;
    }
    return {status:"hold" as const,reason:"provider_page_limit",events:[]};
  }catch{return {status:"hold" as const,reason:"provider_read_unavailable",events:[]};}
}
